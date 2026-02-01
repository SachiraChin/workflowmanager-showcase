"""
Media Module - Server-side media generation functionality.

This module provides:
- MediaGenerateModule: The workflow module for media generation interactions
- Re-exports from providers.media for backwards compatibility

The provider implementations live in the backend/providers/
package, which is shared between server and worker processes.
"""

# Re-export from providers.media (the canonical source)
from backend.providers.media import (
    # Provider classes
    MidAPIProvider,
    LeonardoProvider,
    # Registry
    MediaProviderRegistry,
    # Base class and types
    MediaProviderBase,
    GenerationResult,
    ProgressCallback,
    ResolutionInfo,
    CreditInfo,
    PreviewInfo,
    # Exceptions
    ProviderError,
    AuthenticationError,
    InsufficientCreditsError,
    RateLimitError,
    GenerationError,
    TimeoutError,
    # Download
    download_media,
    DownloadResult,
    DownloadError,
)

# Server-specific modules
from .generate import MediaGenerateModule

__all__ = [
    # Server module
    'MediaGenerateModule',
    # Re-exports from providers.media
    'MidAPIProvider',
    'LeonardoProvider',
    'MediaProviderRegistry',
    'MediaProviderBase',
    'GenerationResult',
    'ProgressCallback',
    'ResolutionInfo',
    'CreditInfo',
    'PreviewInfo',
    'ProviderError',
    'AuthenticationError',
    'InsufficientCreditsError',
    'RateLimitError',
    'GenerationError',
    'TimeoutError',
    'download_media',
    'DownloadResult',
    'DownloadError',
]
