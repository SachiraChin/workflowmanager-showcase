"""
LLM Provider Base Classes - Abstractions for swappable API providers

This module defines the base interfaces and data structures used by all LLM providers.
Each provider (OpenAI, Anthropic, etc.) implements LLMProviderBase and handles all
provider-specific logic internally.
"""

from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
import os
import threading
import time


# Interval for checking cancellation during streaming - read at runtime
def get_cancel_check_interval() -> float:
    return float(os.environ.get("CANCEL_CHECK_INTERVAL", "0.1"))


def get_stream_chunk_timeout() -> float:
    """Max seconds to wait for next streaming chunk before timing out."""
    return float(os.environ.get("LLM_STREAM_CHUNK_TIMEOUT", "180"))


class ContentType(Enum):
    """Types of content that can appear in messages"""
    TEXT = "text"
    IMAGE_PATH = "image_path"      # Local file path to image
    IMAGE_URL = "image_url"        # Remote URL to image
    IMAGE_BASE64 = "image_base64"  # Already base64-encoded image data


@dataclass
class MessageContent:
    """
    Single piece of content within a message.

    Supports text and images. Images can be specified as:
    - Local file path (IMAGE_PATH) - will be encoded by provider
    - Remote URL (IMAGE_URL) - passed directly to API
    - Base64 data (IMAGE_BASE64) - already encoded

    Attributes:
        type: The content type
        value: Text content, file path, URL, or base64 data
        detail: For images, quality level ("auto", "low", "high")
    """
    type: ContentType
    value: str
    detail: Optional[str] = None  # For images: "auto", "low", "high"


@dataclass
class Message:
    """
    A message with role and content (can be multimodal).

    Content is a list of MessageContent items, allowing mixed text and images
    in any order within a single message.

    Attributes:
        role: Message role - "system", "user", or "assistant"
        content: List of content pieces (text, images, etc.)
    """
    role: str  # "system", "user", "assistant"
    content: List[MessageContent] = field(default_factory=list)

    @classmethod
    def text(cls, role: str, text: str) -> 'Message':
        """
        Convenience: create a text-only message.

        Args:
            role: Message role ("system", "user", "assistant")
            text: The text content

        Returns:
            Message with single text content
        """
        return cls(role=role, content=[MessageContent(ContentType.TEXT, text)])

    @classmethod
    def with_image(cls, role: str, text: str, image_path: str, detail: str = "auto") -> 'Message':
        """
        Convenience: create a message with text followed by an image.

        Args:
            role: Message role
            text: Text content
            image_path: Path to local image file
            detail: Image quality ("auto", "low", "high")

        Returns:
            Message with text and image content
        """
        return cls(role=role, content=[
            MessageContent(ContentType.TEXT, text),
            MessageContent(ContentType.IMAGE_PATH, image_path, detail)
        ])

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'Message':
        """
        Create a Message from a dictionary (e.g., from workflow JSON).

        Supports formats:
        - {"role": "user", "content": "text"}  # Simple text
        - {"role": "user", "content": [{"type": "text", "value": "..."}]}  # Array format

        Args:
            data: Dictionary with role and content

        Returns:
            Message object
        """
        role = data.get("role", "user")
        content_data = data.get("content", "")

        # Simple string content
        if isinstance(content_data, str):
            return cls(role=role, content=[MessageContent(ContentType.TEXT, content_data)])

        # Array of content items
        if isinstance(content_data, list):
            content_list = []
            for item in content_data:
                if isinstance(item, str):
                    content_list.append(MessageContent(ContentType.TEXT, item))
                elif isinstance(item, dict):
                    item_type = item.get("type", "text")
                    value = item.get("value", item.get("content", ""))
                    detail = item.get("detail")

                    # Map string type to ContentType enum
                    type_map = {
                        "text": ContentType.TEXT,
                        "image_path": ContentType.IMAGE_PATH,
                        "image_url": ContentType.IMAGE_URL,
                        "image_base64": ContentType.IMAGE_BASE64,
                        # Legacy support
                        "image": ContentType.IMAGE_PATH,
                    }
                    content_type = type_map.get(item_type, ContentType.TEXT)
                    content_list.append(MessageContent(content_type, value, detail))

            return cls(role=role, content=content_list)

        # Fallback: convert to string
        return cls(role=role, content=[MessageContent(ContentType.TEXT, str(content_data))])


class LLMProviderBase(ABC):
    """
    Base interface for all LLM providers.

    Each provider implementation:
    - Lives in its own folder under providers/ with models.json
    - Handles all provider-specific logic (message format, images, etc.)
    - Validates parameters against model capabilities
    - Returns a standardized response dict

    Providers must implement:
    - provider_id: Unique identifier string
    - get_model_capabilities(): Load from models.json
    - call(): Make the actual API call
    """

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """
        Unique identifier for this provider.

        Examples: "openai", "anthropic", "google"
        """
        pass

    @abstractmethod
    def get_model_capabilities(self, model: str) -> Dict[str, Any]:
        """
        Get capabilities for a specific model.

        Loads from the provider's models.json file.

        Args:
            model: Model identifier (e.g., "gpt-4o", "claude-sonnet-4-20250514")

        Returns:
            Dict with:
            - api_endpoint: Which API endpoint to use
            - supports: Dict of supported features and their constraints
        """
        pass

    @abstractmethod
    def call(
        self,
        model: str,
        messages: List[Message],
        context: Any,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        api_key: Optional[str] = None,
        **kwargs  # Provider-specific parameters
    ) -> Dict[str, Any]:
        """
        Make an API call to the LLM provider.

        The provider handles:
        - Converting Message objects to provider-specific format
        - Processing images (encoding local files, formatting URLs)
        - Validating parameters against model capabilities
        - Making the actual API call
        - Standardizing the response

        Args:
            model: Model identifier
            messages: List of Message objects
            context: Execution context (has logger, services, router)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            output_schema: JSON schema for structured output
            metadata: Request metadata for logging
            api_key: API key (defaults to env var)
            **kwargs: Provider-specific parameters (e.g., reasoning_effort for OpenAI)

        Returns:
            Dict with:
            - content: str - The generated text response
            - usage: Dict - Token usage info (format varies by provider)
            - raw_response: Any - Original response object for debugging
        """
        pass

    def call_streaming(
        self,
        model: str,
        messages: List[Message],
        context: Any,
        cancel_event=None,
        progress_callback=None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        api_key: Optional[str] = None,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Make a streaming API call with cancellation support.

        Default implementation falls back to non-streaming call().
        Providers can override for true streaming support.

        Args:
            model: Model identifier
            messages: List of Message objects
            context: Execution context
            cancel_event: Event to signal cancellation
            progress_callback: Optional callback(tokens, elapsed) for progress
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            output_schema: JSON schema for structured output
            metadata: Request metadata for logging
            api_key: API key (defaults to env var)
            **kwargs: Provider-specific parameters

        Returns:
            Dict with content, usage, and raw_response
        """
        # Default: fall back to non-streaming call
        return self.call(
            model=model,
            messages=messages,
            context=context,
            temperature=temperature,
            max_tokens=max_tokens,
            output_schema=output_schema,
            metadata=metadata,
            api_key=api_key,
            **kwargs
        )

    def validate_kwargs(
        self,
        kwargs: Dict[str, Any],
        capabilities: Dict[str, Any],
        context: Any
    ) -> Dict[str, Any]:
        """
        Validate and filter kwargs based on model capabilities.

        This is a helper method that providers can use. It:
        - Removes unsupported parameters with a warning
        - Clamps numeric values to valid ranges
        - Validates enum values

        Args:
            kwargs: Parameters to validate
            capabilities: Model capabilities dict
            context: Execution context for logging

        Returns:
            Validated kwargs dict
        """
        supports = capabilities.get("supports", {})
        validated = {}

        for key, value in kwargs.items():
            # Skip None values
            if value is None:
                continue

            cap = supports.get(key)

            if cap is False:
                # Explicitly not supported
                context.logger.warning(f"Model does not support '{key}', ignoring")
                continue
            elif cap is None:
                # Not in supports dict - check if it's a common param
                # Allow through params that aren't feature-specific
                if key in ('output_schema', 'metadata', 'api_key'):
                    validated[key] = value
                else:
                    context.logger.debug(f"Unknown parameter '{key}', passing through")
                    validated[key] = value
            elif cap is True:
                # Supported with no constraints
                validated[key] = value
            elif isinstance(cap, dict):
                # Has constraints
                if "values" in cap:
                    # Enum constraint
                    if value not in cap["values"]:
                        default = cap.get("default")
                        context.logger.warning(
                            f"Invalid {key}={value}, valid values: {cap['values']}. "
                            f"Using default: {default}"
                        )
                        if default is not None:
                            validated[key] = default
                    else:
                        validated[key] = value
                else:
                    # Numeric constraints
                    if "min" in cap and value < cap["min"]:
                        context.logger.warning(
                            f"{key}={value} below min {cap['min']}, clamping"
                        )
                        validated[key] = cap["min"]
                    elif "max" in cap and value > cap["max"]:
                        context.logger.warning(
                            f"{key}={value} above max {cap['max']}, clamping"
                        )
                        validated[key] = cap["max"]
                    else:
                        validated[key] = value

        return validated

    def _process_stream_with_cancellation(
        self,
        stream_iterator: Generator,
        cancel_event,
        context: Any,
        extract_content: Callable[[Any], Optional[str]],
        extract_usage: Callable[[Any], Optional[Dict[str, int]]],
        progress_callback: Optional[Callable[[int, float], None]] = None,
        close_stream: Optional[Callable[[], None]] = None,
        provider_name: str = "API"
    ) -> Tuple[List[str], Dict[str, int], bool]:
        """
        Process a streaming response with cancellation support.

        This is a reusable helper that handles the common streaming loop pattern:
        - Check cancel_event between chunks
        - Use background thread to get next chunk (non-blocking)
        - Extract content and usage from chunks
        - Call progress callback

        Args:
            stream_iterator: Iterator yielding stream chunks/events
            cancel_event: Event to signal cancellation
            context: Execution context for logging
            extract_content: Function to extract content string from chunk (returns None if no content)
            extract_usage: Function to extract usage dict from chunk (returns None if no usage)
            progress_callback: Optional callback(tokens, elapsed) for progress updates
            close_stream: Optional function to close the stream on cancellation
            provider_name: Provider name for logging

        Returns:
            Tuple of (content_chunks, usage_dict, was_cancelled)
        """
        start_time = time.time()
        content_chunks = []
        usage = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cached_tokens": 0
        }
        was_cancelled = False

        stream_iter = iter(stream_iterator)
        stream_done = False

        while not stream_done:
            # Check for cancellation before waiting for next chunk
            if cancel_event and cancel_event.is_set():
                context.logger.info(f"[AI STREAMING] {provider_name} request cancelled by user")
                if close_stream:
                    close_stream()
                    context.logger.info(f"[AI STREAMING] {provider_name} stream closed")
                was_cancelled = True
                break

            # Get next chunk using background thread for non-blocking wait
            chunk_holder = [None]
            stop_iteration = [False]
            exception_holder = [None]

            def get_next_chunk():
                try:
                    chunk_holder[0] = next(stream_iter)
                except StopIteration:
                    stop_iteration[0] = True
                except Exception as e:
                    exception_holder[0] = e

            chunk_thread = threading.Thread(target=get_next_chunk, daemon=True)
            chunk_thread.start()
            chunk_wait_start = time.time()

            # Wait for chunk with periodic cancel checks
            while chunk_thread.is_alive():
                chunk_thread.join(timeout=get_cancel_check_interval())

                # Guard against provider streams that never yield/finish
                if time.time() - chunk_wait_start > get_stream_chunk_timeout():
                    if close_stream:
                        close_stream()
                    raise TimeoutError(
                        f"{provider_name} streaming stalled while waiting "
                        "for next chunk"
                    )

                if cancel_event and cancel_event.is_set():
                    context.logger.info(f"[AI STREAMING] {provider_name} request cancelled while waiting")
                    if close_stream:
                        close_stream()
                        context.logger.info(f"[AI STREAMING] {provider_name} stream closed")
                    was_cancelled = True
                    break

            if was_cancelled:
                break

            # Check for exceptions or end of stream
            if exception_holder[0]:
                raise exception_holder[0]
            if stop_iteration[0]:
                stream_done = True
                continue

            chunk = chunk_holder[0]

            # Debug: log chunk type for troubleshooting vision streaming
            chunk_type = getattr(chunk, 'type', None)
            if chunk_type and chunk_type not in ('response.output_text.delta', 'response.content_part.delta'):
                if hasattr(context, 'logger'):
                    context.logger.debug(f"[STREAM_CHUNK] Processing chunk type: {chunk_type}")

            # Extract content from chunk
            chunk_content = extract_content(chunk)
            if chunk_content:
                content_chunks.append(chunk_content)

            # Extract usage if available (usually in final chunk)
            chunk_usage = extract_usage(chunk)
            if chunk_usage:
                usage.update(chunk_usage)
                if hasattr(context, 'logger'):
                    context.logger.info(f"[STREAM_CHUNK] Usage extracted: {chunk_usage}")

            # Call progress callback if provided
            if progress_callback:
                elapsed = time.time() - start_time
                progress_callback(usage.get("completion_tokens", len(content_chunks)), elapsed)

        # Debug: log final usage before returning
        if hasattr(context, 'logger'):
            context.logger.info(f"[STREAM_DONE] Final usage: {usage}")

        return content_chunks, usage, was_cancelled
