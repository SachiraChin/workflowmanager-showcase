"""
LLM Providers Package

This package contains provider implementations. Each provider lives in its own
subfolder with:
- provider.py: The provider implementation
- models.json: Model capabilities configuration

Providers are auto-registered when imported via the @register decorator.
"""

# Import providers to trigger registration
from .openai.provider import OpenAIProvider
from .anthropic.provider import AnthropicProvider

__all__ = ['OpenAIProvider', 'AnthropicProvider']
