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

# Base classes
from .base import LLMProviderBase, Message, MessageContent, ContentType

# Registry
from .registry import ProviderRegistry, register

# Providers - import package to trigger registration via providers/__init__.py
from . import providers

# Unified module
from .llm_call import LLMCallModule

# HTTP fetch module
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
    # Modules
    'LLMCallModule',
    'APIFetchModule',
]
