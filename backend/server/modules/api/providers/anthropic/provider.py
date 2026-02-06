"""
Anthropic Provider - Self-contained Anthropic Claude API implementation

This provider handles all Anthropic-specific logic:
- Message format conversion
- Image encoding and formatting
- System message handling (separate parameter)
- Token usage extraction
- Cache control (Anthropic-specific)
- Extended thinking for Claude models
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


@register("anthropic")
class AnthropicProvider(LLMProviderBase):
    """
    Anthropic Claude API provider implementation.

    Supports:
    - Claude 3 family (Opus, Sonnet, Haiku)
    - Claude 3.5 Sonnet
    - Claude 4 Sonnet
    - Vision (images in messages)
    - Structured output (JSON mode via tool use)
    - Cache control (for supported models)
    - Extended thinking (for supported models)
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
                    "api_endpoint": "messages",
                    "supports": {
                        "temperature": {"min": 0, "max": 1, "default": 1},
                        "max_tokens": {"max": 8192, "required": True},
                        "vision": True,
                        "structured_output": True,
                        "extended_thinking": False,
                        "cache_control": True
                    }
                }
            }

    @property
    def provider_id(self) -> str:
        return "anthropic"

    def get_model_capabilities(self, model: str) -> Dict[str, Any]:
        """Get capabilities for a specific model."""
        # Try exact match first
        if model in self._models:
            return self._models[model]

        # Try prefix matching (e.g., "claude-sonnet-4-20250514" matches "claude-sonnet-4")
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
        Make an API call to Anthropic Claude.

        Args:
            model: Model identifier (e.g., "claude-sonnet-4-20250514")
            messages: List of Message objects
            context: Execution context
            temperature: Sampling temperature (0-1)
            max_tokens: Maximum tokens in response
            output_schema: JSON schema for structured output
            metadata: Request metadata for logging
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
            api_endpoint: API endpoint override (not used for Anthropic, always "messages")
            cache_system_message: Enable prompt caching for system message
            cache_user_prefix: Enable prompt caching for first user message
            reasoning_effort: Extended thinking budget ("low", "medium", "high")

        Returns:
            Dict with content, usage, and raw_response
        """
        
        try:
            from anthropic import Anthropic
        except ImportError:
            raise RuntimeError(
                "anthropic library not installed. Install with: pip install anthropic"
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
                f"Use a vision-capable model like claude-sonnet-4, claude-3-5-sonnet, or claude-3-opus."
            )

        # Get API key
        api_key = api_key or os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise RuntimeError(
                "Anthropic API key not provided and ANTHROPIC_API_KEY env var not set"
            )

        # Initialize client
        client = Anthropic(api_key=api_key)

        # Separate system message from other messages (Anthropic uses separate param)
        system_content, api_messages = self._convert_messages(
            messages, context, cache_system_message, cache_user_prefix
        )

        # Build request parameters
        request_params = self._build_request(
            model, system_content, api_messages, validated_kwargs, output_schema,
            supports, cache_system_message, cache_user_prefix, context
        )

        # Log and save request
        logger = get_api_call_logger()
        context.logger.info(f"[AI REQUEST] Anthropic messages - model={model}")

        step_id = require_step_id_from_metadata(metadata)
        call_ctx = logger.save_request(context, step_id, 'anthropic', model, request_params, output_schema, metadata)

        # Start timer display
        start_time = time.time()
        timer_running = threading.Event()
        timer_running.set()

        def show_timer():
            while timer_running.is_set():
                elapsed = time.time() - start_time
                if context.router:
                    context.router.update_temp_status(f"Calling Anthropic API ({model})... {elapsed:.1f}s")
                time.sleep(0.1)

        timer_thread = threading.Thread(target=show_timer, daemon=True)
        timer_thread.start()

        try:
            response = client.messages.create(**request_params)
        except KeyboardInterrupt:
            raise
        finally:
            timer_running.clear()
            timer_thread.join(timeout=0.5)
            if context.router:
                context.router.clear_temp_status()

        elapsed = time.time() - start_time

        # Extract response content
        content = self._extract_content(response, context)
        usage = self._extract_usage(response)

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

        # Log response summary
        cached_tokens = usage.get("cached_tokens", 0)
        context.logger.info(f"[AI RESPONSE] Anthropic - elapsed={elapsed:.1f}s, tokens={usage['total_tokens']} (prompt={usage['prompt_tokens']}, completion={usage['completion_tokens']}, cached={cached_tokens})")

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
        Make a streaming API call to Anthropic with cancellation support.

        Args:
            model: Model identifier
            messages: List of Message objects
            context: Execution context
            cancel_event: threading.Event or asyncio.Event to signal cancellation
            progress_callback: Optional callback(tokens, elapsed) for progress updates
            temperature: Sampling temperature (0-1)
            max_tokens: Maximum tokens in response
            output_schema: JSON schema for structured output
            metadata: Request metadata for logging
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
            api_endpoint: API endpoint override (not used for Anthropic)
            cache_system_message: Enable prompt caching for system message
            cache_user_prefix: Enable prompt caching for first user message
            reasoning_effort: Extended thinking budget ("low", "medium", "high")

        Returns:
            Dict with content, usage, and raw_response
        """
        try:
            from anthropic import Anthropic
        except ImportError:
            raise RuntimeError("anthropic library not installed. Install with: pip install anthropic")

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
        api_key = api_key or os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise RuntimeError("Anthropic API key not provided and ANTHROPIC_API_KEY env var not set")

        # Initialize client
        client = Anthropic(api_key=api_key)

        # Separate system message from other messages
        system_content, api_messages = self._convert_messages(
            messages, context, cache_system_message, cache_user_prefix
        )

        # Build request parameters
        request_params = self._build_request(
            model, system_content, api_messages, validated_kwargs, output_schema,
            supports, cache_system_message, cache_user_prefix, context
        )

        # Log request
        logger = get_api_call_logger()
        sanitized_params = logger._sanitize_for_logging(request_params)
        context.logger.info(f"[AI REQUEST STREAMING] Anthropic messages - model={model}")

        step_id = require_step_id_from_metadata(metadata)
        call_ctx = logger.save_request(context, step_id, 'anthropic', model, request_params, output_schema, metadata)

        start_time = time.time()

        # Track usage across the streaming session
        usage_tracker = {"prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0}

        # Make streaming API call
        with client.messages.stream(**request_params) as stream:
            # Use base class helper to process stream with cancellation support
            content_chunks, usage, was_cancelled = self._process_stream_with_cancellation(
                stream_iterator=stream,
                cancel_event=cancel_event,
                context=context,
                extract_content=lambda event: self._extract_stream_event_content(event),
                extract_usage=lambda event: self._extract_stream_event_usage(event, usage_tracker, context),
                progress_callback=progress_callback,
                close_stream=None,  # Context manager handles cleanup
                provider_name="Anthropic"
            )

        if was_cancelled:
            usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
            self._store_token_usage(model, usage, context)
            raise InterruptedError("Request cancelled by user")

        elapsed = time.time() - start_time

        # Assemble complete content
        content = "".join(content_chunks)

        # Strip markdown fences if present
        content = self._strip_markdown_fences(content)

        # Calculate total tokens
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]

        # Save response to file
        response_data = {
            "model": model,
            "streaming": True,
            "elapsed_seconds": elapsed,
            "content": [
                {
                    "type": "text",
                    "text": content
                }
            ]
        }
        logger.save_response(call_ctx, response_data, usage)

        # Warn if usage is 0 after streaming
        if usage.get("total_tokens", 0) == 0:
            context.logger.warning(
                f"[TOKEN_WARNING] Streaming completed but usage is 0! "
                f"Model={model}, was_cancelled={was_cancelled}. "
                f"This may indicate the message_start/message_delta events were not received correctly."
            )

        # Store token usage
        self._store_token_usage(model, usage, context)

        # Log response summary
        cached_tokens = usage.get("cached_tokens", 0)
        context.logger.info(f"[AI RESPONSE STREAMING] Anthropic - elapsed={elapsed:.1f}s, tokens={usage['total_tokens']} (prompt={usage['prompt_tokens']}, completion={usage['completion_tokens']}, cached={cached_tokens})")

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

    def _extract_stream_event_content(self, event) -> Optional[str]:
        """Extract text content from a streaming event."""
        if hasattr(event, 'type'):
            if event.type == 'content_block_delta':
                if hasattr(event, 'delta') and hasattr(event.delta, 'text'):
                    return event.delta.text
            # Handle thinking block deltas for extended thinking
            elif event.type == 'content_block_delta':
                if hasattr(event, 'delta') and hasattr(event.delta, 'thinking'):
                    # We could optionally capture thinking, but typically we want just the response
                    pass
        return None

    def _extract_stream_event_usage(self, event, usage_tracker: Dict, context=None) -> Optional[Dict]:
        """
        Extract usage info from a streaming event.

        Anthropic sends usage in multiple events:
        - message_start: input_tokens (prompt)
        - message_delta: output_tokens (completion)

        We track these in usage_tracker and return updated totals.
        """
        if not hasattr(event, 'type'):
            return None

        if event.type == 'message_start':
            if hasattr(event, 'message') and hasattr(event.message, 'usage'):
                usage_tracker["prompt_tokens"] = getattr(event.message.usage, 'input_tokens', 0)
                # Check for cache usage
                if hasattr(event.message.usage, 'cache_read_input_tokens'):
                    usage_tracker["cached_tokens"] = getattr(event.message.usage, 'cache_read_input_tokens', 0)
                if context and hasattr(context, 'logger'):
                    context.logger.debug(f"[STREAM_DEBUG] message_start usage: prompt_tokens={usage_tracker['prompt_tokens']}, cached={usage_tracker['cached_tokens']}")
                return {
                    "prompt_tokens": usage_tracker["prompt_tokens"],
                    "completion_tokens": usage_tracker["completion_tokens"],
                    "total_tokens": usage_tracker["prompt_tokens"] + usage_tracker["completion_tokens"],
                    "cached_tokens": usage_tracker["cached_tokens"]
                }
        elif event.type == 'message_delta':
            if hasattr(event, 'usage'):
                usage_tracker["completion_tokens"] = getattr(event.usage, 'output_tokens', 0)
                if context and hasattr(context, 'logger'):
                    context.logger.debug(f"[STREAM_DEBUG] message_delta usage: completion_tokens={usage_tracker['completion_tokens']}")
                return {
                    "prompt_tokens": usage_tracker["prompt_tokens"],
                    "completion_tokens": usage_tracker["completion_tokens"],
                    "total_tokens": usage_tracker["prompt_tokens"] + usage_tracker["completion_tokens"],
                    "cached_tokens": usage_tracker["cached_tokens"]
                }

        return None

    def _convert_messages(
        self,
        messages: List[Message],
        context,
        cache_system_message: bool = False,
        cache_user_prefix: bool = False
    ) -> tuple:
        """
        Convert Message objects to Anthropic format.

        Anthropic uses system message as separate parameter, not in messages array.

        Returns:
            Tuple of (system_content, api_messages)
        """
        system_content = None
        api_messages = []
        first_user_message = True

        for msg in messages:
            if msg.role == "system":
                # Extract system message content
                if cache_system_message:
                    # Use cache_control for system message
                    system_parts = []
                    for part in msg.content:
                        if part.type == ContentType.TEXT:
                            system_parts.append({
                                "type": "text",
                                "text": part.value,
                                "cache_control": {"type": "ephemeral"}
                            })
                    system_content = system_parts if system_parts else None
                else:
                    # Simple string system message
                    system_parts = []
                    for part in msg.content:
                        if part.type == ContentType.TEXT:
                            system_parts.append(part.value)
                    system_content = "\n".join(system_parts) if system_parts else None
                continue

            # Convert non-system messages
            if len(msg.content) == 1 and msg.content[0].type == ContentType.TEXT:
                # Simple text message
                content = msg.content[0].value

                # Apply cache control to first user message if requested
                if cache_user_prefix and msg.role == "user" and first_user_message:
                    api_messages.append({
                        "role": msg.role,
                        "content": [
                            {
                                "type": "text",
                                "text": content,
                                "cache_control": {"type": "ephemeral"}
                            }
                        ]
                    })
                    first_user_message = False
                else:
                    api_messages.append({
                        "role": msg.role,
                        "content": content
                    })
            else:
                # Multimodal message
                content_parts = []
                for part in msg.content:
                    if part.type == ContentType.TEXT:
                        text_block = {
                            "type": "text",
                            "text": part.value
                        }
                        # Apply cache control to first user message text
                        if cache_user_prefix and msg.role == "user" and first_user_message:
                            text_block["cache_control"] = {"type": "ephemeral"}
                        content_parts.append(text_block)
                    elif part.type == ContentType.IMAGE_PATH:
                        # Encode local image
                        image_data, media_type = self._encode_image(part.value, context)
                        content_parts.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": image_data
                            }
                        })
                    elif part.type == ContentType.IMAGE_URL:
                        # Anthropic supports URL images directly
                        content_parts.append({
                            "type": "image",
                            "source": {
                                "type": "url",
                                "url": part.value
                            }
                        })
                    elif part.type == ContentType.IMAGE_BASE64:
                        content_parts.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/jpeg",  # Assume JPEG if not specified
                                "data": part.value
                            }
                        })

                api_messages.append({
                    "role": msg.role,
                    "content": content_parts
                })

                if msg.role == "user":
                    first_user_message = False

        return system_content, api_messages

    def _build_request(
        self,
        model: str,
        system_content: Any,  # Can be string or list with cache_control
        messages: List[Dict],
        kwargs: Dict,
        output_schema: Optional[Dict],
        supports: Dict,
        cache_system_message: bool,
        cache_user_prefix: bool,
        context
    ) -> Dict:
        """Build Anthropic API request."""
        request = {
            "model": model,
            "messages": messages
        }

        # Add system message if present
        if system_content:
            request["system"] = system_content

        # max_tokens is required for Anthropic
        max_tokens = kwargs.get("max_tokens")
        if max_tokens:
            request["max_tokens"] = int(max_tokens)
        else:
            # Default based on model capabilities
            max_config = supports.get("max_tokens", {})
            request["max_tokens"] = max_config.get("max", 4096)

        # Add temperature if supported (not allowed with extended thinking)
        reasoning_effort = kwargs.get("reasoning_effort")
        if "temperature" in kwargs and supports.get("temperature") is not False:
            # Extended thinking requires temperature to not be set (or set to 1)
            if reasoning_effort and supports.get("extended_thinking"):
                context.logger.debug("Skipping temperature for extended thinking mode")
            else:
                request["temperature"] = kwargs["temperature"]

        # Handle extended thinking (similar to OpenAI's reasoning_effort)
        if reasoning_effort and supports.get("extended_thinking"):
            # Map reasoning effort to budget tokens
            budget_map = {
                "low": 5000,
                "medium": 10000,
                "high": 20000
            }
            budget_tokens = budget_map.get(reasoning_effort, 10000)
            request["thinking"] = {
                "type": "enabled",
                "budget_tokens": budget_tokens
            }
            context.logger.debug(f"Extended thinking enabled with budget: {budget_tokens}")

        # Handle structured output
        if output_schema:
            if supports.get("structured_output"):
                # Sanitize schema for Anthropic (remove unsupported constraints)
                sanitized_schema = self._sanitize_schema_for_anthropic(output_schema)
                # Use native JSON schema enforcement via output_config.format
                # Available for Claude Opus 4.6, Sonnet 4.5, Opus 4.5, Haiku 4.5
                request["output_config"] = {
                    "format": {
                        "type": "json_schema",
                        "schema": sanitized_schema
                    }
                }
                context.logger.debug("Using native JSON schema enforcement via output_config.format")
            else:
                # Fallback for older models: add schema to prompt
                for i in range(len(messages) - 1, -1, -1):
                    if messages[i].get("role") == "user":
                        schema_text = f"\n\nPlease respond with JSON matching this schema:\n```json\n{json.dumps(output_schema, indent=2)}\n```\n\nRespond ONLY with valid JSON, no other text."
                        content = messages[i]["content"]
                        if isinstance(content, str):
                            messages[i]["content"] = content + schema_text
                        elif isinstance(content, list):
                            # Find last text block and append
                            for item in reversed(content):
                                if item.get("type") == "text":
                                    item["text"] = item["text"] + schema_text
                                    break
                        break
                context.logger.debug("Added JSON schema instruction to prompt for structured output (fallback)")

        return request

    def _sanitize_schema_for_anthropic(self, schema: Dict) -> Dict:
        """
        Sanitize JSON schema for Anthropic's structured output.
        
        Removes unsupported constraints and adds them to descriptions.
        Anthropic doesn't support:
        - minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
        - minLength, maxLength, pattern (complex patterns)
        - minItems, maxItems (beyond minItems of 0 or 1)
        - additionalProperties other than false
        
        This method:
        1. Recursively processes the schema
        2. Removes unsupported constraints
        3. Appends constraint info to descriptions
        4. Ensures additionalProperties: false on all objects
        """
        import copy
        return self._sanitize_schema_node(copy.deepcopy(schema))

    def _sanitize_schema_node(self, node: Any) -> Any:
        """Recursively sanitize a schema node."""
        if not isinstance(node, dict):
            return node

        # Constraints to remove and potentially add to description
        numeric_constraints = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']
        string_constraints = ['minLength', 'maxLength']
        array_constraints = ['minItems', 'maxItems']
        
        # Build description additions
        desc_parts = []
        
        # Handle numeric constraints
        for constraint in numeric_constraints:
            if constraint in node:
                value = node.pop(constraint)
                if constraint == 'minimum':
                    desc_parts.append(f"Minimum: {value}")
                elif constraint == 'maximum':
                    desc_parts.append(f"Maximum: {value}")
                elif constraint == 'exclusiveMinimum':
                    desc_parts.append(f"Must be greater than {value}")
                elif constraint == 'exclusiveMaximum':
                    desc_parts.append(f"Must be less than {value}")
                elif constraint == 'multipleOf':
                    desc_parts.append(f"Must be multiple of {value}")
        
        # Handle string constraints
        for constraint in string_constraints:
            if constraint in node:
                value = node.pop(constraint)
                if constraint == 'minLength':
                    desc_parts.append(f"Minimum length: {value}")
                elif constraint == 'maxLength':
                    desc_parts.append(f"Maximum length: {value}")
        
        # Handle array constraints (minItems 0 or 1 is supported, others not)
        if 'minItems' in node:
            value = node['minItems']
            if value > 1:
                node.pop('minItems')
                desc_parts.append(f"Minimum items: {value}")
        
        if 'maxItems' in node:
            value = node.pop('maxItems')
            desc_parts.append(f"Maximum items: {value}")
        
        # Append constraints to description if any were removed
        if desc_parts:
            existing_desc = node.get('description', '')
            constraint_text = ' (' + ', '.join(desc_parts) + ')'
            if existing_desc:
                node['description'] = existing_desc + constraint_text
            else:
                node['description'] = constraint_text.strip(' ()')
        
        # Ensure additionalProperties: false for objects
        if node.get('type') == 'object':
            node['additionalProperties'] = False
        
        # Recursively process nested structures
        if 'properties' in node:
            for key, value in node['properties'].items():
                node['properties'][key] = self._sanitize_schema_node(value)
        
        if 'items' in node:
            node['items'] = self._sanitize_schema_node(node['items'])
        
        if 'anyOf' in node:
            node['anyOf'] = [self._sanitize_schema_node(item) for item in node['anyOf']]
        
        if 'allOf' in node:
            node['allOf'] = [self._sanitize_schema_node(item) for item in node['allOf']]
        
        if 'oneOf' in node:
            node['oneOf'] = [self._sanitize_schema_node(item) for item in node['oneOf']]
        
        if '$defs' in node:
            for key, value in node['$defs'].items():
                node['$defs'][key] = self._sanitize_schema_node(value)
        
        if 'definitions' in node:
            for key, value in node['definitions'].items():
                node['definitions'][key] = self._sanitize_schema_node(value)
        
        return node

    def _extract_content(self, response, context) -> str:
        """Extract text content from Anthropic response."""
        if hasattr(response, 'content') and response.content:
            # content is a list of content blocks
            text_parts = []
            for block in response.content:
                # Skip thinking blocks (from extended thinking)
                if hasattr(block, 'type') and block.type == 'thinking':
                    continue
                if hasattr(block, 'text'):
                    text_parts.append(block.text)
            return "\n".join(text_parts)
        return str(response)

    def _extract_usage(self, response) -> Dict:
        """Extract usage info from Anthropic response."""
        usage = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cached_tokens": 0
        }

        if hasattr(response, 'usage'):
            usage["prompt_tokens"] = getattr(response.usage, 'input_tokens', 0)
            usage["completion_tokens"] = getattr(response.usage, 'output_tokens', 0)
            usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]

            # Check for cache usage
            if hasattr(response.usage, 'cache_creation_input_tokens'):
                usage["cache_creation_tokens"] = response.usage.cache_creation_input_tokens
            if hasattr(response.usage, 'cache_read_input_tokens'):
                usage["cached_tokens"] = response.usage.cache_read_input_tokens

        return usage

    def _encode_image(self, image_path: str, context) -> tuple:
        """
        Encode local image file to base64.

        Returns:
            Tuple of (base64_data, media_type)
        """
        # Resolve relative path
        if not os.path.isabs(image_path):
            project_folder = context.services.get('project_folder', '.')
            image_path = os.path.join(project_folder, image_path)

        # Determine media type from extension
        ext = os.path.splitext(image_path)[1].lower()
        media_types = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        }
        media_type = media_types.get(ext, 'image/jpeg')

        try:
            with open(image_path, "rb") as f:
                data = base64.b64encode(f.read()).decode('utf-8')
            return data, media_type
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
