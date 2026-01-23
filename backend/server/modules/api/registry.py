"""
LLM Provider Registry - Registration and lookup for providers

This module provides a central registry for LLM providers. Providers register
themselves using the @register decorator, and the registry handles lookup
and instantiation.
"""

from typing import Dict, Type, Optional
from .base import LLMProviderBase


class ProviderRegistry:
    """
    Central registry for LLM providers.

    Providers register themselves at import time using the @register decorator.
    The registry stores classes and creates fresh instances on each get() call
    to avoid state leakage between different API calls.

    Usage:
        # In provider file:
        @register("openai")
        class OpenAIProvider(LLMProviderBase):
            ...

        # To get a provider:
        provider = ProviderRegistry.get("openai")
    """

    _providers: Dict[str, Type[LLMProviderBase]] = {}

    @classmethod
    def register(cls, provider_id: str, provider_class: Type[LLMProviderBase]) -> None:
        """
        Register a provider class.

        Args:
            provider_id: Unique identifier (e.g., "openai", "anthropic")
            provider_class: The provider class to register
        """
        if provider_id in cls._providers:
            # Allow re-registration (useful for testing/reloading)
            pass
        cls._providers[provider_id] = provider_class

    @classmethod
    def get(cls, provider_id: str) -> LLMProviderBase:
        """
        Get a fresh provider instance by ID.

        Creates a new instance each time to avoid state leakage between calls.

        Args:
            provider_id: Provider identifier

        Returns:
            Fresh provider instance

        Raises:
            ValueError: If provider_id is not registered
        """
        if provider_id not in cls._providers:
            available = list(cls._providers.keys())
            raise ValueError(
                f"Unknown provider: '{provider_id}'. "
                f"Available providers: {available}"
            )

        # Create fresh instance each time to avoid state leakage
        return cls._providers[provider_id]()

    @classmethod
    def get_optional(cls, provider_id: str) -> Optional[LLMProviderBase]:
        """
        Get a provider instance, returning None if not found.

        Args:
            provider_id: Provider identifier

        Returns:
            Provider instance or None
        """
        try:
            return cls.get(provider_id)
        except ValueError:
            return None

    @classmethod
    def list_providers(cls) -> list:
        """
        List all registered provider IDs.

        Returns:
            List of provider ID strings
        """
        return list(cls._providers.keys())

    @classmethod
    def is_registered(cls, provider_id: str) -> bool:
        """
        Check if a provider is registered.

        Args:
            provider_id: Provider identifier

        Returns:
            True if registered
        """
        return provider_id in cls._providers

    @classmethod
    def clear(cls) -> None:
        """
        Clear all registered providers (useful for testing).
        """
        cls._providers.clear()


def register(provider_id: str):
    """
    Decorator to register a provider class.

    Usage:
        @register("openai")
        class OpenAIProvider(LLMProviderBase):
            ...

    Args:
        provider_id: Unique identifier for the provider

    Returns:
        Decorator function
    """
    def decorator(cls: Type[LLMProviderBase]) -> Type[LLMProviderBase]:
        ProviderRegistry.register(provider_id, cls)
        return cls
    return decorator
