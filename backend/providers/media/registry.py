"""
Media Provider Registry - Registration and lookup for media providers

This module provides a central registry for media generation providers.
Providers register themselves using the @register decorator, and the
registry handles lookup, instantiation, and concurrency configuration.
"""

from typing import Dict, Type, Optional, NamedTuple
from .base import MediaProviderBase


class ProviderConfig(NamedTuple):
    """Configuration for a registered provider."""
    provider_class: Type[MediaProviderBase]
    concurrency: int


class MediaProviderRegistry:
    """
    Central registry for media generation providers.

    Providers register themselves at import time using the @register decorator.
    The registry stores classes and creates fresh instances on each get() call
    to avoid state leakage between different generation requests.

    Concurrency configuration is stored per-provider and can be queried via
    get_concurrency() for task queue management.

    Usage:
        # In provider file:
        @register("midjourney", concurrency=1)
        class MidAPIProvider(MediaProviderBase):
            ...

        @register("leonardo", concurrency=3)
        class LeonardoProvider(MediaProviderBase):
            ...

        # To get a provider:
        provider = MediaProviderRegistry.get("midjourney")

        # To get concurrency limit:
        limit = MediaProviderRegistry.get_concurrency("leonardo")  # Returns 3
    """

    _providers: Dict[str, ProviderConfig] = {}

    @classmethod
    def register(
        cls,
        provider_id: str,
        provider_class: Type[MediaProviderBase],
        concurrency: int = 1
    ) -> None:
        """
        Register a provider class.

        Args:
            provider_id: Unique identifier (e.g., "midjourney", "leonardo")
            provider_class: The provider class to register
            concurrency: Maximum concurrent tasks for this provider (default: 1)
        """
        if provider_id in cls._providers:
            # Allow re-registration (useful for testing/reloading)
            pass
        cls._providers[provider_id] = ProviderConfig(
            provider_class=provider_class,
            concurrency=concurrency
        )

    @classmethod
    def get(cls, provider_id: str) -> MediaProviderBase:
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
                f"Unknown media provider: '{provider_id}'. "
                f"Available providers: {available}"
            )

        # Create fresh instance each time to avoid state leakage
        return cls._providers[provider_id].provider_class()

    @classmethod
    def get_class(cls, provider_id: str) -> Type[MediaProviderBase]:
        """
        Get registered provider class without instantiation.

        Useful for static metadata/schema access when provider construction may
        require environment credentials that are not available.
        """
        if provider_id not in cls._providers:
            available = list(cls._providers.keys())
            raise ValueError(
                f"Unknown media provider: '{provider_id}'. "
                f"Available providers: {available}"
            )
        return cls._providers[provider_id].provider_class

    @classmethod
    def get_concurrency(cls, provider_id: str) -> int:
        """
        Get the maximum concurrency for a provider.

        Args:
            provider_id: Provider identifier

        Returns:
            Maximum concurrent tasks allowed for this provider.
            Returns 1 (default) if provider is not registered.
        """
        config = cls._providers.get(provider_id)
        if config is None:
            return 1  # Default to 1 for unknown providers
        return config.concurrency

    @classmethod
    def get_optional(cls, provider_id: str) -> Optional[MediaProviderBase]:
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


def register(provider_id: str, concurrency: int = 1):
    """
    Decorator to register a provider class.

    Usage:
        @register("midjourney", concurrency=1)
        class MidAPIProvider(MediaProviderBase):
            ...

        @register("leonardo", concurrency=3)
        class LeonardoProvider(MediaProviderBase):
            ...

    Args:
        provider_id: Unique identifier for the provider
        concurrency: Maximum concurrent tasks for this provider (default: 1)

    Returns:
        Decorator function
    """
    def decorator(cls: Type[MediaProviderBase]) -> Type[MediaProviderBase]:
        MediaProviderRegistry.register(provider_id, cls, concurrency)
        return cls
    return decorator
