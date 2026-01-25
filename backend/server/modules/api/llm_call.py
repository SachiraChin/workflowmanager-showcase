"""
Unified LLM Call Module - Provider-agnostic API call module for workflows

This module provides a single interface for workflows to call any LLM provider.
The provider is selected at runtime based on the 'provider' input parameter.
"""

import json
from typing import Dict, Any, List, Optional
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError
from .base import Message
from .registry import ProviderRegistry


class LLMCallModule(ExecutableModule):
    """
    Unified module for calling LLM APIs.

    This module abstracts away provider-specific details. Workflows specify
    a provider (openai, anthropic, etc.) and the module delegates to the
    appropriate provider implementation.

    Inputs:
        - provider: Provider ID ("openai", "anthropic", etc.)
        - model: Model identifier
        - messages: Array of message objects (role, content)
        - temperature: Generation temperature (optional)
        - max_tokens: Maximum tokens to generate (optional)
        - output_schema: JSON schema for structured output (optional)
        - reasoning_effort: For reasoning models (optional)
        - api_key: API key override (optional)
        - metadata: Optional metadata for logging

    Outputs:
        - response: Generated response (string or parsed JSON)
        - response_text: Raw text response
        - model: Model used
        - usage: Token usage information
    """

    @property
    def module_id(self) -> str:
        return "api.llm"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="provider",
                type="string",
                required=False,
                default="openai",
                description="LLM provider ID (openai, anthropic, etc.)"
            ),
            ModuleInput(
                name="model",
                type="string",
                required=False,
                default=None,
                description="Model identifier (uses ai_config.model if not specified)"
            ),
            ModuleInput(
                name="input",
                type=None,  # Accepts string or array
                required=True,
                description="Input for the API - string or messages array"
            ),
            ModuleInput(
                name="system",
                type="string",
                required=False,
                default=None,
                description="System message (optional)"
            ),
            ModuleInput(
                name="ai_config",
                type="object",
                required=False,
                default=None,
                description="AI configuration (model, temperature, max_tokens, etc.)"
            ),
            ModuleInput(
                name="temperature",
                type="number",
                required=False,
                default=None,
                description="Temperature override (uses ai_config if not specified)"
            ),
            ModuleInput(
                name="max_tokens",
                type="number",
                required=False,
                default=None,
                description="Max tokens override (uses ai_config if not specified)"
            ),
            ModuleInput(
                name="output_schema",
                type="object",
                required=False,
                default=None,
                description="JSON schema for structured output"
            ),
            ModuleInput(
                name="reasoning_effort",
                type="string",
                required=False,
                default=None,
                description="Reasoning effort for reasoning models (low, medium, high)"
            ),
            ModuleInput(
                name="api_key",
                type="string",
                required=False,
                default=None,
                description="API key override (uses environment variable if not specified)"
            ),
            ModuleInput(
                name="metadata",
                type="object",
                required=False,
                default=None,
                description="Optional metadata (e.g., step_id for logging)"
            ),
            ModuleInput(
                name="cache_system_message",
                type="boolean",
                required=False,
                default=None,
                description="Enable prompt caching for system message (OpenAI only)"
            ),
            ModuleInput(
                name="cache_user_prefix",
                type="boolean",
                required=False,
                default=None,
                description="Enable prompt caching for first user message (OpenAI only)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="response",
                type="string",
                description="Generated response (string or parsed JSON if schema provided)"
            ),
            ModuleOutput(
                name="response_text",
                type="string",
                description="Raw text response"
            ),
            ModuleOutput(
                name="model",
                type="string",
                description="Model used"
            ),
            ModuleOutput(
                name="usage",
                type="object",
                description="Token usage information"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute LLM API call via selected provider."""
        try:
            # Get provider
            provider_id = self.get_input_value(inputs, 'provider') or 'openai'
            provider = ProviderRegistry.get(provider_id)

            # Build configuration from ai_config + explicit inputs
            global_ai_config = context.services.get('ai_config', {})
            module_ai_config = self.get_input_value(inputs, 'ai_config') or {}
            merged_config = {**global_ai_config, **module_ai_config}

            # Get model (explicit input > ai_config > default)
            model = self.get_input_value(inputs, 'model')
            if not model:
                model = merged_config.get('model', 'gpt-4o')

            # Build messages from input
            messages = self._build_messages(inputs, context)

            # Build kwargs from merged config and explicit inputs
            kwargs = {}

            # Temperature
            temp = self.get_input_value(inputs, 'temperature')
            if temp is not None:
                kwargs['temperature'] = temp
            elif 'temperature' in merged_config:
                kwargs['temperature'] = merged_config['temperature']

            # Max tokens
            max_tokens = self.get_input_value(inputs, 'max_tokens')
            if max_tokens is not None:
                kwargs['max_tokens'] = max_tokens
            elif 'max_tokens' in merged_config:
                kwargs['max_tokens'] = merged_config['max_tokens']

            # Reasoning effort
            reasoning_effort = self.get_input_value(inputs, 'reasoning_effort')
            if reasoning_effort is not None:
                kwargs['reasoning_effort'] = reasoning_effort
            elif 'reasoning_effort' in merged_config:
                kwargs['reasoning_effort'] = merged_config['reasoning_effort']

            # Output schema
            output_schema = self.get_input_value(inputs, 'output_schema')
            if output_schema:
                kwargs['output_schema'] = output_schema

            # API key (explicit input > ai_config > env var handled by provider)
            api_key = self.get_input_value(inputs, 'api_key')
            if api_key:
                kwargs['api_key'] = api_key
            elif 'api_key' in merged_config:
                kwargs['api_key'] = merged_config['api_key']

            # Metadata
            metadata = self.get_input_value(inputs, 'metadata')
            if metadata:
                kwargs['metadata'] = metadata

            # Caching options (OpenAI specific, but passed through to provider)
            cache_system = self.get_input_value(inputs, 'cache_system_message')
            if cache_system is not None:
                kwargs['cache_system_message'] = cache_system

            cache_user = self.get_input_value(inputs, 'cache_user_prefix')
            if cache_user is not None:
                kwargs['cache_user_prefix'] = cache_user

            # API endpoint override (for choosing completions vs responses API)
            if 'api_endpoint' in merged_config:
                kwargs['api_endpoint'] = merged_config['api_endpoint']

            # Check if we should use streaming for cancellation support
            cancel_event = getattr(context, 'cancel_event', None)
            context.logger.info(f"[LLM] cancel_event = {cancel_event}, has call_streaming = {hasattr(provider, 'call_streaming')}")

            if cancel_event and hasattr(provider, 'call_streaming'):
                # Use streaming API call for cancellation support
                context.logger.info("[LLM] Using streaming API call (cancel_event present)")
                result = provider.call_streaming(
                    model, messages, context,
                    cancel_event=cancel_event,
                    temperature=kwargs.get('temperature'),
                    max_tokens=kwargs.get('max_tokens'),
                    output_schema=kwargs.get('output_schema'),
                    metadata=kwargs.get('metadata'),
                    api_key=kwargs.get('api_key'),
                    api_endpoint=kwargs.get('api_endpoint'),
                    cache_system_message=kwargs.get('cache_system_message', False),
                    cache_user_prefix=kwargs.get('cache_user_prefix', False),
                    reasoning_effort=kwargs.get('reasoning_effort')
                )
            else:
                # Use regular blocking call
                result = provider.call(
                    model, messages, context,
                    temperature=kwargs.get('temperature'),
                    max_tokens=kwargs.get('max_tokens'),
                    output_schema=kwargs.get('output_schema'),
                    metadata=kwargs.get('metadata'),
                    api_key=kwargs.get('api_key'),
                    api_endpoint=kwargs.get('api_endpoint'),
                    cache_system_message=kwargs.get('cache_system_message', False),
                    cache_user_prefix=kwargs.get('cache_user_prefix', False),
                    reasoning_effort=kwargs.get('reasoning_effort')
                )

            # Return standardized output
            return {
                "response": result.get("content"),
                "response_text": result.get("content_text", str(result.get("content", ""))),
                "model": result.get("model", model),
                "usage": result.get("usage", {}),
                "token_usage": result.get("usage", {}).get("total_tokens", 0),
                "token_usage_detailed": {
                    "model_used": model,
                    "prompt_tokens": result.get("usage", {}).get("prompt_tokens", 0),
                    "completion_tokens": result.get("usage", {}).get("completion_tokens", 0),
                    "total_tokens": result.get("usage", {}).get("total_tokens", 0),
                    "cached_tokens": result.get("usage", {}).get("cached_tokens", 0)
                }
            }

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"LLM API call failed: {str(e)}",
                e
            )

    def _build_messages(self, inputs: Dict[str, Any], context) -> List[Message]:
        """
        Build Message objects from input data.

        Supports:
        - String input: becomes single user message
        - Array of dicts: each becomes a Message
        - System message: added as first message (can be string, list, or dict)
        - Retry feedback: added as additional user message if present in state

        After parameter resolution, items may be:
        - Pure strings (from $ref without cache_ttl)
        - Dicts with 'content' key (from $ref with cache_ttl or from state refs)
        - Standard message dicts with 'role' and 'content'
        """
        messages = []

        # Add system message(s) first if provided
        system = self.get_input_value(inputs, 'system')
        if system:
            if isinstance(system, str):
                # Simple string - single system message
                messages.append(Message.text("system", system))
            elif isinstance(system, list):
                # Array of items - each may be string or dict after resolution
                for item in system:
                    msg = self._build_single_message(item, "system", context)
                    if msg:
                        messages.append(msg)
            elif isinstance(system, dict):
                # Single dict
                msg = self._build_single_message(system, "system", context)
                if msg:
                    messages.append(msg)

        # Process input
        input_data = self.get_input_value(inputs, 'input')

        if isinstance(input_data, str):
            # Simple string - single user message
            messages.append(Message.text("user", input_data))

        elif isinstance(input_data, list):
            # Array of items - each may be string or dict after resolution
            for item in input_data:
                msg = self._build_single_message(item, "user", context)
                if msg:
                    messages.append(msg)

        elif isinstance(input_data, dict):
            # Single dict
            msg = self._build_single_message(input_data, "user", context)
            if msg:
                messages.append(msg)

        else:
            # Fallback
            messages.append(Message.text("user", str(input_data)))

        # Check for retry context - injected by workflow processor
        # The processor builds these from database events, keeping API modules stateless
        retry_conversation_history = context.state.get('_retry_conversation_history')
        retry_feedback = context.state.get('_retry_feedback')

        if retry_conversation_history:
            # Add full conversation history (alternating assistant/user messages)
            for turn in retry_conversation_history:
                role = turn.get('role', 'assistant')
                content = turn.get('content', '')
                if content:
                    messages.append(Message.text(role, content))
            context.logger.info(f"Added {len(retry_conversation_history)} messages from retry history")
        elif retry_feedback:
            # Backwards compatibility: just add feedback as user message
            messages.append(Message.text("user", f"FEEDBACK FROM USER: {retry_feedback}"))
            context.logger.info("Added retry feedback to messages")

        return messages

    def _build_single_message(self, item: Any, default_role: str, context) -> Optional[Message]:
        """
        Build a single Message from an item that may be:
        - A string (text content)
        - A dict with 'content' key (from $ref with cache_ttl or state refs)
        - A dict with 'type': 'image' (image content)
        - A standard message dict with 'role' and 'content'

        Args:
            item: The item to convert to a Message
            default_role: Role to use if not specified in the item
            context: Execution context for logging

        Returns:
            Message object, or None if item is empty/invalid
        """
        if item is None:
            return None

        if isinstance(item, str):
            # Plain string - just text content
            if not item.strip():
                return None
            return Message.text(default_role, item)

        if isinstance(item, dict):
            # Check if it's an image type
            item_type = item.get('type', 'text')

            if item_type == 'image':
                # Image reference - content is path, URL, or data URL
                image_value = item.get('content', '')
                if not image_value:
                    return None

                from .base import MessageContent, ContentType

                # Check if it's a data URL (base64-encoded)
                if image_value.startswith('data:'):
                    # Extract base64 data from data URL
                    # Format: data:image/png;base64,{base64_data}
                    try:
                        _, base64_part = image_value.split(';base64,', 1)
                        return Message(
                            role=default_role,
                            content=[MessageContent(ContentType.IMAGE_BASE64, base64_part)]
                        )
                    except ValueError:
                        # Invalid data URL format, treat as path
                        pass

                # Check if it's a remote URL
                if image_value.startswith(('http://', 'https://')):
                    return Message(
                        role=default_role,
                        content=[MessageContent(ContentType.IMAGE_URL, image_value)]
                    )

                # Otherwise treat as local file path
                return Message(
                    role=default_role,
                    content=[MessageContent(ContentType.IMAGE_PATH, image_value)]
                )

            # Text or state type - extract content
            content = item.get('content', '')

            # Handle case where content might still be a complex object
            if isinstance(content, dict):
                # Nested dict - try to get string content
                content = str(content)
            elif not isinstance(content, str):
                content = str(content) if content else ''

            if not content.strip():
                return None

            # Check if there's a role specified
            role = item.get('role', default_role)

            return Message.text(role, content)

        # Fallback for other types
        str_val = str(item)
        if not str_val.strip():
            return None
        return Message.text(default_role, str_val)
