"""
API Modules Package

This package provides LLM API integrations with a pluggable provider architecture.

Architecture:
- base.py: Base classes (LLMProviderBase, Message, MessageContent)
- registry.py: Provider registration and lookup
- llm_call.py: Unified module for workflows (uses any provider)
- providers/: Provider implementations
  - openai/: OpenAI provider with models.json
  - anthropic/: Anthropic provider with models.json

Usage in workflows:
    {
        "module": "api.llm",
        "inputs": {
            "provider": "openai",
            "model": "gpt-4o",
            "input": "Hello, world!",
            "system": "You are a helpful assistant."
        }
    }

Legacy modules (deprecated, use api.llm instead):
- api.openai: Direct OpenAI calls
- api.anthropic: Direct Anthropic calls
"""

# Base classes (siblings - relative imports OK)
from .base import LLMProviderBase, Message, MessageContent, ContentType

# Registry (sibling - relative import OK)
from .registry import ProviderRegistry, register

# Providers - import to trigger registration (children - absolute imports)
from backend.server.modules.api.providers.openai.provider import OpenAIProvider
from backend.server.modules.api.providers.anthropic.provider import AnthropicProvider

# Unified module (sibling - relative import OK)
from .llm_call import LLMCallModule

# HTTP fetch module (sibling - relative import OK)
from .fetch import APIFetchModule

__all__ = [
    # Base classes
    'LLMProviderBase',
    'Message',
    'MessageContent',
    'ContentType',
    # Registry
    'ProviderRegistry',
    'register',
    # Providers
    'OpenAIProvider',
    'AnthropicProvider',
    # Modules
    'LLMCallModule',
    'APIFetchModule',
]
