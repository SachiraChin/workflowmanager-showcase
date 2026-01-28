"""
OpenAI Provider - Self-contained OpenAI API implementation

This provider handles all OpenAI-specific logic:
- Message format conversion
- Image encoding and formatting
- API endpoint selection (responses vs completions)
- Token usage extraction
- Prompt caching
"""

import os
import sys
import json
import re
import time
import threading
import base64
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from ...base import LLMProviderBase, Message, MessageContent, ContentType
from ...registry import register
from ...call_logger import get_api_call_logger
from engine.context_utils import require_step_id, require_module_name, require_step_id_from_metadata


@register("openai")
class OpenAIProvider(LLMProviderBase):
    """
    OpenAI API provider implementation.

    Supports:
    - GPT-4, GPT-4o, GPT-4.1 models (chat completions)
    - O1, O3 reasoning models (responses API)
    - GPT-5 models (responses API with caching)
    - Vision (images in messages)
    - Structured output (JSON schemas)
    - Prompt caching (for supported models)
    """

    def __init__(self):
        """Initialize provider and load model capabilities."""
        self._models = self._load_models_config()

    def _load_models_config(self) -> Dict[str, Any]:
        """Load models.json from same directory as this file."""
        models_path = Path(__file__).parent / "models.json"
        try:
            with open(models_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            # Return minimal default if config not found
            return {
                "default": {
                    "api_endpoint": "responses",
                    "supports": {
                        "temperature": {"min": 0, "max": 2, "default": 1},
                        "max_tokens": {"max": 16384},
                        "vision": True,
                        "structured_output": True
                    }
                }
            }

    @property
    def provider_id(self) -> str:
        return "openai"

    def get_model_capabilities(self, model: str) -> Dict[str, Any]:
        """Get capabilities for a specific model."""
        # Try exact match first
        if model in self._models:
            return self._models[model]

        # Try prefix matching (e.g., "gpt-4o-2024-11-20" matches "gpt-4o")
        for model_key in self._models:
            if model.startswith(model_key):
                return self._models[model_key]

        # Fall back to default
        return self._models.get("default", {})

    def call(
        self,
        model: str,
        messages: List[Message],
        context: Any,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        output_schema: Optional[Dict] = None,
        metadata: Optional[Dict] = None,
        api_key: Optional[str] = None,
        api_endpoint: Optional[str] = None,
        cache_system_message: bool = False,
        cache_user_prefix: bool = False,
        reasoning_effort: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Make an API call to OpenAI.

        Args:
            model: Model identifier (e.g., "gpt-4o", "o3")
            messages: List of Message objects
            context: Execution context
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens in response
            output_schema: JSON schema for structured output
            metadata: Request metadata for logging
            api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)
            api_endpoint: API endpoint override ("responses" or "completions")
            cache_system_message: Enable prompt caching for system message
            cache_user_prefix: Enable prompt caching for user prefix
            reasoning_effort: Reasoning effort for o-series models ("low", "medium", "high")

        Returns:
            Dict with content, usage, and raw_response
        """
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError(
                "openai library not installed. Install with: pip install openai"
            )

        # Build kwargs dict from explicit parameters for validation
        kwargs = {}
        if temperature is not None:
            kwargs['temperature'] = temperature
        if max_tokens is not None:
            kwargs['max_tokens'] = max_tokens
        if reasoning_effort is not None:
            kwargs['reasoning_effort'] = reasoning_effort

        # Get capabilities and validate kwargs
        capabilities = self.get_model_capabilities(model)
        validated_kwargs = self.validate_kwargs(kwargs, capabilities, context)
        supports = capabilities.get("supports", {})

        # Check if messages contain images and validate vision support
        has_images = self._messages_contain_images(messages)
        if has_images and not supports.get("vision", False):
            raise RuntimeError(
                f"Model '{model}' does not support vision/image inputs. "
                f"Use a vision-capable model like gpt-4o, gpt-4.1, o3, o4-mini, or gpt-5.1."
            )

        # Get API key
        api_key = api_key or os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise RuntimeError(
                "OpenAI API key not provided and OPENAI_API_KEY env var not set"
            )

        # Initialize client
        client = OpenAI(api_key=api_key)

        # Convert messages to OpenAI format
        api_messages = self._convert_messages(messages, context)

        # Determine API endpoint
        api_endpoint = api_endpoint or capabilities.get("api_endpoint", "responses")
        supports = capabilities.get("supports", {})

        # Build request parameters
        if api_endpoint == "responses":
            request_params = self._build_responses_request(
                model, api_messages, validated_kwargs, output_schema, supports,
                cache_system_message, cache_user_prefix, context
            )
        else:
            request_params = self._build_completions_request(
                model, api_messages, validated_kwargs, output_schema, supports, context
            )

        # Log and save request
        logger = get_api_call_logger()
        sanitized_params = logger._sanitize_for_logging(request_params)
        context.logger.info(f"[AI REQUEST] OpenAI {api_endpoint} - model={model}")
        context.logger.info(f"[AI REQUEST BODY]\n{json.dumps(sanitized_params, indent=2)}")

        step_id = require_step_id_from_metadata(metadata)
        call_ctx = logger.save_request(context, step_id, 'openai', model, request_params, output_schema, metadata)

        # Start timer display
        start_time = time.time()
        timer_running = threading.Event()
        timer_running.set()

        def show_timer():
            while timer_running.is_set():
                elapsed = time.time() - start_time
                if context.router:
                    context.router.update_temp_status(f"Calling OpenAI API ({model})... {elapsed:.1f}s")
                time.sleep(0.1)

        timer_thread = threading.Thread(target=show_timer, daemon=True)
        timer_thread.start()

        try:
            # Make API call
            if api_endpoint == "responses":
                response = client.responses.create(**request_params)
            else:
                response = client.chat.completions.create(**request_params)
        except KeyboardInterrupt:
            raise
        finally:
            timer_running.clear()
            timer_thread.join(timeout=0.5)
            if context.router:
                context.router.clear_temp_status()

        elapsed = time.time() - start_time

        # Extract response content
        if api_endpoint == "responses":
            content = self._extract_responses_content(response, context)
            usage = self._extract_responses_usage(response)
        else:
            content = self._extract_completions_content(response)
            usage = self._extract_completions_usage(response)

        # Strip markdown fences if present
        content = self._strip_markdown_fences(content)

        # Save response
        logger.save_response(call_ctx, response, usage)

        # Warn if usage is 0 (helps diagnose token extraction issues)
        if usage.get("total_tokens", 0) == 0:
            context.logger.warning(
                f"[TOKEN_WARNING] API call completed but usage is 0! Model={model}. "
                f"This may indicate the response did not include usage data."
            )

        # Store token usage to database
        self._store_token_usage(model, usage, context)

        # Log full response body
        cached_tokens = usage.get("cached_tokens", 0)
        context.logger.info(f"[AI RESPONSE] OpenAI - elapsed={elapsed:.1f}s, tokens={usage['total_tokens']} (prompt={usage['prompt_tokens']}, completion={usage['completion_tokens']}, cached={cached_tokens})")
        context.logger.info(f"[AI RESPONSE BODY]\n{content}")

        # Parse JSON if schema was provided
        parsed_content = content
        if output_schema:
            try:
                parsed_content = json.loads(content)
            except json.JSONDecodeError:
                context.logger.warning("Failed to parse JSON response, returning as string")

        return {
            "content": parsed_content,
            "content_text": content,  # Always keep original string
            "usage": usage,
            "model": getattr(response, 'model', model),
            "raw_response": response
        }

    def call_streaming(
        self,
        model: str,
        messages: List[Message],
        context: Any,
        cancel_event=None,
        progress_callback=None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        output_schema: Optional[Dict] = None,
        metadata: Optional[Dict] = None,
        api_key: Optional[str] = None,
        api_endpoint: Optional[str] = None,
        cache_system_message: bool = False,
        cache_user_prefix: bool = False,
        reasoning_effort: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Make a streaming API call to OpenAI with cancellation support.

        Args:
            model: Model identifier
            messages: List of Message objects
            context: Execution context
            cancel_event: threading.Event or asyncio.Event to signal cancellation
            progress_callback: Optional callback(tokens, elapsed) for progress updates
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens in response
            output_schema: JSON schema for structured output
            metadata: Request metadata for logging
            api_key: OpenAI API key (defaults to OPENAI_API_KEY env var)
            api_endpoint: API endpoint override ("responses" or "completions")
            cache_system_message: Enable prompt caching for system message
            cache_user_prefix: Enable prompt caching for user prefix
            reasoning_effort: Reasoning effort for o-series models ("low", "medium", "high")

        Returns:
            Dict with content, usage, and raw_response
        """
        try:
            from openai import OpenAI
        except ImportError:
            raise RuntimeError("openai library not installed. Install with: pip install openai")

        # Build kwargs dict from explicit parameters for validation
        kwargs = {}
        if temperature is not None:
            kwargs['temperature'] = temperature
        if max_tokens is not None:
            kwargs['max_tokens'] = max_tokens
        if reasoning_effort is not None:
            kwargs['reasoning_effort'] = reasoning_effort

        # Get capabilities and validate kwargs
        capabilities = self.get_model_capabilities(model)
        validated_kwargs = self.validate_kwargs(kwargs, capabilities, context)
        supports = capabilities.get("supports", {})

        # Check vision support
        has_images = self._messages_contain_images(messages)
        if has_images and not supports.get("vision", False):
            raise RuntimeError(f"Model '{model}' does not support vision/image inputs.")

        # Get API key
        api_key = api_key or os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise RuntimeError("OpenAI API key not provided and OPENAI_API_KEY env var not set")

        # Initialize client
        client = OpenAI(api_key=api_key)

        # Convert messages to OpenAI format
        api_messages = self._convert_messages(messages, context)

        # Determine API endpoint
        api_endpoint = api_endpoint or capabilities.get("api_endpoint", "responses")

        # Build request parameters with stream=True
        if api_endpoint == "responses":
            request_params = self._build_responses_request(
                model, api_messages, validated_kwargs, output_schema, supports,
                cache_system_message, cache_user_prefix, context
            )
            request_params["stream"] = True
        else:
            request_params = self._build_completions_request(
                model, api_messages, validated_kwargs, output_schema, supports, context
            )
            request_params["stream"] = True
            # Include usage in streaming response - required for chat completions API
            request_params["stream_options"] = {"include_usage": True}

        # Log request
        logger = get_api_call_logger()
        sanitized_params = logger._sanitize_for_logging(request_params)
        context.logger.info(f"[AI REQUEST STREAMING] OpenAI {api_endpoint} - model={model}")
        context.logger.info(f"[AI REQUEST BODY]\n{json.dumps(sanitized_params, indent=2)}")

        step_id = require_step_id_from_metadata(metadata)
        call_ctx = logger.save_request(context, step_id, 'openai', model, request_params, output_schema, metadata)

        start_time = time.time()

        # Make streaming API call
        if api_endpoint == "responses":
            stream = client.responses.create(**request_params)
        else:
            stream = client.chat.completions.create(**request_params)

        # Use base class helper to process stream with cancellation support
        content_chunks, usage, was_cancelled = self._process_stream_with_cancellation(
            stream_iterator=stream,
            cancel_event=cancel_event,
            context=context,
            extract_content=lambda chunk: self._extract_stream_chunk_content(chunk, api_endpoint),
            extract_usage=lambda chunk: self._extract_stream_chunk_usage(chunk, api_endpoint, context),
            progress_callback=progress_callback,
            close_stream=lambda: stream.close() if hasattr(stream, 'close') else None,
            provider_name="OpenAI"
        )

        if was_cancelled:
            self._store_token_usage(model, usage, context)
            raise InterruptedError("Request cancelled by user")

        elapsed = time.time() - start_time

        # Assemble complete content
        content = "".join(content_chunks)

        # Strip markdown fences if present
        content = self._strip_markdown_fences(content)

        # Save response to file (streaming assembles response dict since no single response object)
        response_data = {
            "model": model,
            "streaming": True,
            "elapsed_seconds": elapsed,
            "output": [
                {
                    "role": "assistant",
                    "type": "message",
                    "content": [
                        {
                            "type": "output_text",
                            "text": content
                        }
                    ]
                }
            ]
        }
        logger.save_response(call_ctx, response_data, usage)

        # Warn if usage is 0 after streaming (helps diagnose token extraction issues)
        if usage.get("total_tokens", 0) == 0:
            context.logger.warning(
                f"[TOKEN_WARNING] Streaming completed but usage is 0! "
                f"Model={model}, was_cancelled={was_cancelled}. "
                f"This may indicate the response.completed event was not received or processed correctly."
            )

        # Store token usage
        self._store_token_usage(model, usage, context)

        # Log response
        cached_tokens = usage.get("cached_tokens", 0)
        context.logger.info(f"[AI RESPONSE STREAMING] OpenAI - elapsed={elapsed:.1f}s, tokens={usage['total_tokens']} (prompt={usage['prompt_tokens']}, completion={usage['completion_tokens']}, cached={cached_tokens})")
        context.logger.info(f"[AI RESPONSE BODY]\n{content}")

        # Parse JSON if schema was provided
        parsed_content = content
        if output_schema:
            try:
                parsed_content = json.loads(content)
            except json.JSONDecodeError:
                context.logger.warning("Failed to parse JSON response, returning as string")

        return {
            "content": parsed_content,
            "content_text": content,
            "usage": usage,
            "model": model,
            "raw_response": None  # No single response object for streaming
        }

    def _extract_stream_chunk_content(self, chunk, api_endpoint: str) -> str:
        """Extract text content from a streaming chunk."""
        if api_endpoint == "responses":
            # Responses API streaming format
            if hasattr(chunk, 'type'):
                if chunk.type == 'content_part.delta':
                    if hasattr(chunk, 'delta') and hasattr(chunk.delta, 'text'):
                        return chunk.delta.text
                elif chunk.type == 'response.output_text.delta':
                    if hasattr(chunk, 'delta'):
                        return chunk.delta
            return ""
        else:
            # Chat completions streaming format
            if hasattr(chunk, 'choices') and chunk.choices:
                delta = chunk.choices[0].delta
                if hasattr(delta, 'content') and delta.content:
                    return delta.content
            return ""

    def _extract_stream_chunk_usage(self, chunk, api_endpoint: str, context=None) -> Optional[Dict]:
        """Extract usage info from a streaming chunk (usually final chunk)."""
        if api_endpoint == "responses":
            # Debug: log all chunk types to understand the stream structure
            chunk_type = getattr(chunk, 'type', None)
            if context and hasattr(context, 'logger') and chunk_type:
                # Only log significant events, not content deltas
                if chunk_type not in ('response.output_text.delta', 'response.content_part.delta'):
                    context.logger.debug(f"[STREAM_DEBUG] chunk.type={chunk_type}")

            # Check for response.completed event (primary)
            if hasattr(chunk, 'type') and chunk.type == 'response.completed':
                if hasattr(chunk, 'response') and hasattr(chunk.response, 'usage'):
                    usage = chunk.response.usage
                    result = {
                        "prompt_tokens": getattr(usage, 'input_tokens', 0),
                        "completion_tokens": getattr(usage, 'output_tokens', 0),
                        "total_tokens": getattr(usage, 'total_tokens', 0),
                        "cached_tokens": 0
                    }
                    if hasattr(usage, 'input_tokens_details'):
                        result["cached_tokens"] = getattr(usage.input_tokens_details, 'cached_tokens', 0)
                    if context and hasattr(context, 'logger'):
                        context.logger.info(f"[STREAM_DEBUG] Extracted usage from response.completed: {result}")
                    return result
                else:
                    # Debug: response.completed but no usage
                    if context and hasattr(context, 'logger'):
                        has_response = hasattr(chunk, 'response')
                        has_usage = hasattr(chunk.response, 'usage') if has_response else False
                        context.logger.warning(f"[STREAM_DEBUG] response.completed but no usage! has_response={has_response}, has_usage={has_usage}")

            # Fallback: check for response.done event (alternative event type)
            if hasattr(chunk, 'type') and chunk.type == 'response.done':
                if hasattr(chunk, 'response') and hasattr(chunk.response, 'usage'):
                    usage = chunk.response.usage
                    result = {
                        "prompt_tokens": getattr(usage, 'input_tokens', 0),
                        "completion_tokens": getattr(usage, 'output_tokens', 0),
                        "total_tokens": getattr(usage, 'total_tokens', 0),
                        "cached_tokens": 0
                    }
                    if hasattr(usage, 'input_tokens_details'):
                        result["cached_tokens"] = getattr(usage.input_tokens_details, 'cached_tokens', 0)
                    if context and hasattr(context, 'logger'):
                        context.logger.info(f"[STREAM_DEBUG] Extracted usage from response.done: {result}")
                    return result

            # Fallback: check for direct usage attribute on chunk (some SDK versions)
            if hasattr(chunk, 'usage') and chunk.usage:
                usage = chunk.usage
                result = {
                    "prompt_tokens": getattr(usage, 'input_tokens', getattr(usage, 'prompt_tokens', 0)),
                    "completion_tokens": getattr(usage, 'output_tokens', getattr(usage, 'completion_tokens', 0)),
                    "total_tokens": getattr(usage, 'total_tokens', 0),
                    "cached_tokens": 0
                }
                if hasattr(usage, 'input_tokens_details'):
                    result["cached_tokens"] = getattr(usage.input_tokens_details, 'cached_tokens', 0)
                if context and hasattr(context, 'logger'):
                    context.logger.info(f"[STREAM_DEBUG] Extracted usage from chunk.usage directly: {result}")
                return result
        else:
            # Chat completions - usage in final chunk
            if hasattr(chunk, 'usage') and chunk.usage:
                return {
                    "prompt_tokens": chunk.usage.prompt_tokens,
                    "completion_tokens": chunk.usage.completion_tokens,
                    "total_tokens": chunk.usage.total_tokens,
                    "cached_tokens": getattr(chunk.usage, 'cached_tokens', 0)
                }
        return None

    def _convert_messages(self, messages: List[Message], context) -> List[Dict]:
        """Convert Message objects to OpenAI API format."""
        result = []

        for msg in messages:
            # Check if single text content - can use simple format
            if len(msg.content) == 1 and msg.content[0].type == ContentType.TEXT:
                result.append({
                    "role": msg.role,
                    "content": msg.content[0].value
                })
            else:
                # Multimodal content - use array format
                content_parts = []
                for part in msg.content:
                    if part.type == ContentType.TEXT:
                        content_parts.append({
                            "type": "text",
                            "text": part.value
                        })
                    elif part.type == ContentType.IMAGE_PATH:
                        # Encode local image
                        image_data = self._encode_image(part.value, context)
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_data}",
                                "detail": part.detail or "auto"
                            }
                        })
                    elif part.type == ContentType.IMAGE_URL:
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {
                                "url": part.value,
                                "detail": part.detail or "auto"
                            }
                        })
                    elif part.type == ContentType.IMAGE_BASE64:
                        content_parts.append({
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{part.value}",
                                "detail": part.detail or "auto"
                            }
                        })

                result.append({
                    "role": msg.role,
                    "content": content_parts
                })

        return result

    def _build_responses_request(
        self,
        model: str,
        messages: List[Dict],
        kwargs: Dict,
        output_schema: Optional[Dict],
        supports: Dict,
        cache_system_message: bool,
        cache_user_prefix: bool,
        context
    ) -> Dict:
        """Build request for /responses API endpoint."""
        # Convert messages to responses API format
        converted_input = self._convert_to_responses_format(messages)

        request = {
            "model": model,
            "input": converted_input
        }

        # Add max_tokens
        if "max_tokens" in kwargs:
            request["max_completion_tokens"] = int(kwargs["max_tokens"])

        # Add reasoning_effort if supported
        if "reasoning_effort" in kwargs and supports.get("reasoning_effort"):
            request["reasoning_effort"] = kwargs["reasoning_effort"]

        # Add temperature if supported
        if "temperature" in kwargs and supports.get("temperature") is not False:
            request["temperature"] = kwargs["temperature"]

        # Add prompt caching if requested
        if cache_system_message or cache_user_prefix:
            request["prompt_cache_retention"] = "24h"
            context.logger.debug(
                f"Prompt caching enabled: system={cache_system_message}, user_prefix={cache_user_prefix}"
            )

        # Handle structured output via text.format
        if output_schema:
            request["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": "output_schema",
                    "schema": output_schema,
                    "strict": True
                }
            }
            context.logger.debug("Using strict JSON schema enforcement via text.format")

        return request

    def _build_completions_request(
        self,
        model: str,
        messages: List[Dict],
        kwargs: Dict,
        output_schema: Optional[Dict],
        supports: Dict,
        context
    ) -> Dict:
        """Build request for /chat/completions API endpoint."""
        request = {
            "model": model,
            "messages": messages
        }

        # Add temperature if supported
        if "temperature" in kwargs and supports.get("temperature") is not False:
            request["temperature"] = kwargs["temperature"]

        # Add max_tokens
        if "max_tokens" in kwargs:
            request["max_tokens"] = int(kwargs["max_tokens"])

        # Handle output schema - add to prompt and enable JSON mode
        if output_schema:
            # Find last user message and append schema
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    schema_text = f"\n\nPlease respond with JSON matching this schema:\n```json\n{json.dumps(output_schema, indent=2)}\n```"
                    content = messages[i]["content"]
                    if isinstance(content, str):
                        messages[i]["content"] = content + schema_text
                    elif isinstance(content, list):
                        for item in content:
                            if item.get("type") == "text":
                                item["text"] = item["text"] + schema_text
                                break
                    break
            request["response_format"] = {"type": "json_object"}

        return request

    def _convert_to_responses_format(self, messages: List[Dict]) -> List[Dict]:
        """Convert chat completions format to responses API format."""
        converted = []

        for msg in messages:
            role = msg["role"]
            content = msg["content"]

            # Map system -> developer
            if role == "system":
                role = "developer"

            # Determine content type based on role
            text_type = "output_text" if role == "assistant" else "input_text"
            image_type = "output_image" if role == "assistant" else "input_image"

            # Convert content
            if isinstance(content, str):
                converted_content = [{"type": text_type, "text": content}]
            elif isinstance(content, list):
                converted_content = []
                for item in content:
                    item_type = item.get("type")
                    if item_type == "text":
                        converted_content.append({
                            "type": text_type,
                            "text": item.get("text", "")
                        })
                    elif item_type == "image_url":
                        image_url_data = item.get("image_url", {})
                        url = image_url_data.get("url", "") if isinstance(image_url_data, dict) else image_url_data
                        converted_content.append({
                            "type": image_type,
                            "image_url": url
                        })
            else:
                converted_content = [{"type": text_type, "text": str(content)}]

            converted.append({
                "role": role,
                "content": converted_content
            })

        return converted

    def _extract_responses_content(self, response, context) -> str:
        """Extract text content from responses API response."""
        if hasattr(response, 'output') and response.output:
            last_message = response.output[-1] if isinstance(response.output, list) else response.output

            # Check for tool call (function response)
            if hasattr(last_message, 'arguments') and last_message.arguments and last_message.arguments != '{}':
                return last_message.arguments

            if hasattr(last_message, 'content'):
                content_items = last_message.content if isinstance(last_message.content, list) else [last_message.content]

                text_parts = []
                for item in content_items:
                    if hasattr(item, 'arguments') and item.arguments:
                        return item.arguments
                    elif hasattr(item, 'text'):
                        text_parts.append(item.text)
                    elif isinstance(item, dict):
                        if 'arguments' in item:
                            return item['arguments']
                        elif 'text' in item:
                            text_parts.append(item['text'])

                if text_parts:
                    return '\n'.join(text_parts)

            return str(last_message)

        return str(response)

    def _extract_completions_content(self, response) -> str:
        """Extract text content from completions API response."""
        return response.choices[0].message.content

    def _extract_responses_usage(self, response) -> Dict:
        """Extract usage info from responses API response."""
        usage = {
            "prompt_tokens": getattr(response.usage, 'input_tokens', 0) if hasattr(response, 'usage') else 0,
            "completion_tokens": getattr(response.usage, 'output_tokens', 0) if hasattr(response, 'usage') else 0,
            "total_tokens": getattr(response.usage, 'total_tokens', 0) if hasattr(response, 'usage') else 0,
            "cached_tokens": 0
        }

        if hasattr(response, 'usage') and hasattr(response.usage, 'input_tokens_details'):
            details = response.usage.input_tokens_details
            usage["cached_tokens"] = getattr(details, 'cached_tokens', 0)

        return usage

    def _extract_completions_usage(self, response) -> Dict:
        """Extract usage info from completions API response."""
        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
            "cached_tokens": 0
        }

        if hasattr(response.usage, 'prompt_tokens_details'):
            details = response.usage.prompt_tokens_details
            usage["cached_tokens"] = getattr(details, 'cached_tokens', 0)

        return usage

    def _encode_image(self, image_path: str, context) -> str:
        """Encode local image file to base64."""
        # Resolve relative path
        if not os.path.isabs(image_path):
            project_folder = context.services.get('project_folder', '.')
            image_path = os.path.join(project_folder, image_path)

        try:
            with open(image_path, "rb") as f:
                return base64.b64encode(f.read()).decode('utf-8')
        except FileNotFoundError:
            raise RuntimeError(f"Image file not found: {image_path}")
        except Exception as e:
            raise RuntimeError(f"Failed to encode image: {str(e)}")

    def _messages_contain_images(self, messages: List[Message]) -> bool:
        """Check if any message contains image content."""
        for msg in messages:
            for content in msg.content:
                if content.type in (ContentType.IMAGE_PATH, ContentType.IMAGE_URL, ContentType.IMAGE_BASE64):
                    return True
        return False

    def _strip_markdown_fences(self, text: str) -> str:
        """Strip markdown code fences from response."""
        pattern = r'```(?:json)?\s*\n([\s\S]*?)\n```'
        match = re.search(pattern, text, re.DOTALL)
        if match:
            return match.group(1).strip()
        return text

    def _store_token_usage(self, model: str, usage: Dict, context):
        """Store token usage to database."""
        try:
            # Get step info from context (required)
            step_id = require_step_id(context)
            step_config = context.state.get_step_config() if hasattr(context, 'state') else {}
            step_name = step_config.get('name', step_id)
            module_name = require_module_name(context)
            module_index = getattr(context, 'current_module_index', 0)

            # Store to database
            has_db = hasattr(context, 'db') and context.db is not None
            context.logger.info(f"[TOKEN] Storing token usage: has_db={has_db}, workflow_run_id={getattr(context, 'workflow_run_id', None)}")
            if has_db:
                context.db.token_repo.store_token_usage(
                    workflow_run_id=context.workflow_run_id,
                    step_id=step_id,
                    step_name=step_name,
                    module_name=module_name,
                    module_index=module_index,
                    model=model,
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    cached_tokens=usage.get("cached_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0)
                )
        except Exception as e:
            context.logger.warning(f"Failed to store token usage: {e}")
