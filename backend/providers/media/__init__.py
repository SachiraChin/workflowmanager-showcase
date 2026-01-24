"""
Media Providers Package - Media generation provider implementations.

This package provides:
    - MediaProviderBase: Abstract base class for media providers
    - MediaProviderRegistry: Registry for provider instances with concurrency config
    - Provider implementations: Leonardo, MidJourney (midapi)
    - download_media: Utility for downloading generated media

Usage:
    from providers.media import MediaProviderRegistry

    # Get a provider instance
    provider = MediaProviderRegistry.get("leonardo")

    # Get concurrency limit for task queue
    concurrency = MediaProviderRegistry.get_concurrency("leonardo")  # Returns 3

    # Generate an image
    result = provider.txt2img(prompt, params, progress_callback)
"""

# Base class, types, and exceptions
from .base import (
    MediaProviderBase,
    ContentItem,
    GenerationResult,
    ProgressCallback,
    ResolutionInfo,
    CreditInfo,
    PreviewInfo,
    ProviderError,
    AuthenticationError,
    InsufficientCreditsError,
    RateLimitError,
    GenerationError,
    TimeoutError,
)

# Registry (import before providers to avoid circular import)
from .registry import MediaProviderRegistry, register

# Import providers to trigger registration
from .leonardo.provider import LeonardoProvider
from .midapi.provider import MidAPIProvider
from .stable_diffusion.provider import StableDiffusionProvider

# Download utility
from .download import download_media, DownloadResult, DownloadError

__all__ = [
    # Base class and types
    'MediaProviderBase',
    'ContentItem',
    'GenerationResult',
    'ProgressCallback',
    'ResolutionInfo',
    'CreditInfo',
    'PreviewInfo',
    # Exceptions
    'ProviderError',
    'AuthenticationError',
    'InsufficientCreditsError',
    'RateLimitError',
    'GenerationError',
    'TimeoutError',
    # Registry
    'MediaProviderRegistry',
    'register',
    # Provider classes
    'LeonardoProvider',
    'MidAPIProvider',
    'StableDiffusionProvider',
    # Download
    'download_media',
    'DownloadResult',
    'DownloadError',
]
