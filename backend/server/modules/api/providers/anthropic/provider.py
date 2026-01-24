"""
Anthropic Provider - Self-contained Anthropic Claude API implementation

This provider handles all Anthropic-specific logic:
- Message format conversion
- Image encoding and formatting
- System message handling (separate parameter)
- Token usage extraction
- Cache control (Anthropic-specific)
"""

import os
import json
import base64
import time
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Cancel check interval - configurable via environment variable
CANCEL_CHECK_INTERVAL = float(os.environ.get("CANCEL_CHECK_INTERVAL", "0.1"))

from backend.server.modules.api.base import LLMProviderBase, Message, MessageContent, ContentType
from backend.server.modules.api.registry import register
from backend.server.modules.api.call_logger import get_api_call_logger
from engine.context_utils import require_step_id_from_metadata


@register("anthropic")
class AnthropicProvider(LLMProviderBase):
    """
    Anthropic Claude API provider implementation.

    Supports:
    - Claude 3 family (Opus, Sonnet, Haiku)
    - Claude 3.5 Sonnet
    - Claude 4 Sonnet
    - Vision (images in messages)
    - Cache control (for supported models)

    Note: Anthropic requires max_tokens to be explicitly set.
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
                        "vision": True
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

        # Try prefix matching
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
        api_key: Optional[str] = None
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

        # Get capabilities and validate kwargs
        capabilities = self.get_model_capabilities(model)
        validated_kwargs = self.validate_kwargs(kwargs, capabilities, context)

        # Get API key
        api_key = api_key or os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise RuntimeError(
                "Anthropic API key not provided and ANTHROPIC_API_KEY env var not set"
            )

        # Initialize client
        client = Anthropic(api_key=api_key)

        # Separate system message from other messages (Anthropic uses separate param)
        system_content, api_messages = self._convert_messages(messages, context)

        # Build request
        supports = capabilities.get("supports", {})
        request_params = self._build_request(
            model, system_content, api_messages, validated_kwargs, supports, context
        )

        # Log and save request
        logger = get_api_call_logger()
        context.logger.info(f"[AI REQUEST] Anthropic messages - model={model}")
        context.logger.info(f"[AI REQUEST BODY]\n{json.dumps(logger._sanitize_for_logging(request_params), indent=2)}")

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

        # Extract response
        content = self._extract_content(response)
        usage = self._extract_usage(response)

        # Save response
        logger.save_response(call_ctx, response, usage)

        # Log full response body
        cached_tokens = usage.get("cached_tokens", 0)
        context.logger.info(f"[AI RESPONSE] Anthropic - elapsed={elapsed:.1f}s, tokens={usage['total_tokens']} (prompt={usage['prompt_tokens']}, completion={usage['completion_tokens']}, cached={cached_tokens})")
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
            "model": response.model,
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
        api_key: Optional[str] = None
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

        # Get capabilities and validate kwargs
        capabilities = self.get_model_capabilities(model)
        validated_kwargs = self.validate_kwargs(kwargs, capabilities, context)

        # Get API key
        api_key = api_key or os.getenv('ANTHROPIC_API_KEY')
        if not api_key:
            raise RuntimeError("Anthropic API key not provided and ANTHROPIC_API_KEY env var not set")

        # Initialize client
        client = Anthropic(api_key=api_key)

        # Separate system message from other messages
        system_content, api_messages = self._convert_messages(messages, context)

        # Build request
        supports = capabilities.get("supports", {})
        request_params = self._build_request(
            model, system_content, api_messages, validated_kwargs, supports, context
        )

        # Log request
        logger = get_api_call_logger()
        context.logger.info(f"[AI REQUEST STREAMING] Anthropic messages - model={model}")
        context.logger.info(f"[AI REQUEST BODY]\n{json.dumps(logger._sanitize_for_logging(request_params), indent=2)}")

        step_id = require_step_id_from_metadata(metadata)
        call_ctx = logger.save_request(context, step_id, 'anthropic', model, request_params, output_schema, metadata)

        start_time = time.time()

        # Track usage across the streaming session
        usage_tracker = {"prompt_tokens": 0, "completion_tokens": 0}

        # Make streaming API call
        with client.messages.stream(**request_params) as stream:
            # Use base class helper to process stream with cancellation support
            content_chunks, usage, was_cancelled = self._process_stream_with_cancellation(
                stream_iterator=stream,
                cancel_event=cancel_event,
                context=context,
                extract_content=lambda event: self._extract_stream_event_content(event),
                extract_usage=lambda event: self._extract_stream_event_usage(event, usage_tracker),
                progress_callback=progress_callback,
                close_stream=None,  # Context manager handles cleanup
                provider_name="Anthropic"
            )

        if was_cancelled:
            usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]
            raise InterruptedError("Request cancelled by user")

        elapsed = time.time() - start_time

        # Assemble complete content
        content = "".join(content_chunks)

        # Calculate total tokens
        usage["total_tokens"] = usage["prompt_tokens"] + usage["completion_tokens"]

        # Save response to file (streaming assembles response dict since no single response object)
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

        # Log response
        cached_tokens = usage.get("cached_tokens", 0)
        context.logger.info(f"[AI RESPONSE STREAMING] Anthropic - elapsed={elapsed:.1f}s, tokens={usage['total_tokens']} (prompt={usage['prompt_tokens']}, completion={usage['completion_tokens']}, cached={cached_tokens})")
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
            "raw_response": None
        }

    def _extract_stream_event_content(self, event) -> Optional[str]:
        """Extract text content from a streaming event."""
        if hasattr(event, 'type'):
            if event.type == 'content_block_delta':
                if hasattr(event, 'delta') and hasattr(event.delta, 'text'):
                    return event.delta.text
        return None

    def _extract_stream_event_usage(self, event, usage_tracker: Dict) -> Optional[Dict]:
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
                return {
                    "prompt_tokens": usage_tracker["prompt_tokens"],
                    "completion_tokens": usage_tracker["completion_tokens"],
                    "total_tokens": usage_tracker["prompt_tokens"] + usage_tracker["completion_tokens"],
                    "cached_tokens": 0
                }
        elif event.type == 'message_delta':
            if hasattr(event, 'usage'):
                usage_tracker["completion_tokens"] = getattr(event.usage, 'output_tokens', 0)
                return {
                    "prompt_tokens": usage_tracker["prompt_tokens"],
                    "completion_tokens": usage_tracker["completion_tokens"],
                    "total_tokens": usage_tracker["prompt_tokens"] + usage_tracker["completion_tokens"],
                    "cached_tokens": 0
                }

        return None

    def _convert_messages(self, messages: List[Message], context) -> tuple:
        """
        Convert Message objects to Anthropic format.

        Anthropic uses system message as separate parameter, not in messages array.

        Returns:
            Tuple of (system_content, api_messages)
        """
        system_content = None
        api_messages = []

        for msg in messages:
            if msg.role == "system":
                # Extract system message content
                system_parts = []
                for part in msg.content:
                    if part.type == ContentType.TEXT:
                        system_parts.append(part.value)
                system_content = "\n".join(system_parts) if system_parts else None
                continue

            # Convert non-system messages
            if len(msg.content) == 1 and msg.content[0].type == ContentType.TEXT:
                # Simple text message
                api_messages.append({
                    "role": msg.role,
                    "content": msg.content[0].value
                })
            else:
                # Multimodal message
                content_parts = []
                for part in msg.content:
                    if part.type == ContentType.TEXT:
                        content_parts.append({
                            "type": "text",
                            "text": part.value
                        })
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

        return system_content, api_messages

    def _build_request(
        self,
        model: str,
        system_content: Optional[str],
        messages: List[Dict],
        kwargs: Dict,
        supports: Dict,
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

        # Add temperature if supported
        if "temperature" in kwargs and supports.get("temperature") is not False:
            request["temperature"] = kwargs["temperature"]

        return request

    def _extract_content(self, response) -> str:
        """Extract text content from Anthropic response."""
        if hasattr(response, 'content') and response.content:
            # content is a list of content blocks
            text_parts = []
            for block in response.content:
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

