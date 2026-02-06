"""
Media Provider Base Class - Abstraction for media generation providers

This module defines the base interface for all media generation providers
(MidJourney/MidAPI, Leonardo, ElevenLabs, etc.). Each provider implements the
same interface for text-to-image, image-to-image, image-to-video, and
text-to-audio operations.
"""

from abc import ABC, abstractmethod
from typing import Any, Callable, Dict, List, Optional
from dataclasses import dataclass


# Type alias for progress callback
# (elapsed_ms: int, message: str) -> None
ProgressCallback = Callable[[int, str], None]


@dataclass
class ContentItem:
    """
    A single generated content item from a provider.

    Attributes:
        url: URL to the generated content
        seed: Generation seed (-1 if not available from provider)
    """
    url: str
    seed: int = -1


@dataclass
class UsageInfo:
    """
    Usage/cost information for a media generation.

    This dataclass captures provider-specific usage metrics and costs.
    Different providers use different billing models:
    - OpenAI images: charged per image based on model/quality/size
    - OpenAI video: charged per second of video
    - Leonardo: charged in credits
    - MidJourney: charged in credits
    - ElevenLabs: charged by characters (TTS) or credits (music)

    All fields are optional to accommodate different provider billing models.
    The total_cost field should always be set.

    Attributes:
        provider: Provider identifier (e.g., "openai", "leonardo")
        model: Model used for generation
        action_type: Type of generation (txt2img, img2img, img2vid, txt2audio)
        total_cost: Total cost in USD (always required)

        # Image-specific (OpenAI images)
        image_count: Number of images generated

        # Video-specific (OpenAI Sora)
        duration_seconds: Duration of generated video in seconds

        # Credit-based providers (Leonardo, MidJourney)
        credits: Credits used for this generation

        # Audio/TTS-specific (ElevenLabs)
        audio_type: Type of audio (tts, music, sfx)
        characters: Characters processed (for TTS)
    """
    provider: str
    model: str
    action_type: str
    total_cost: float

    # Provider-specific fields (all optional)
    image_count: Optional[int] = None
    duration_seconds: Optional[int] = None
    credits: Optional[int] = None
    audio_type: Optional[str] = None
    characters: Optional[int] = None


@dataclass
class GenerationResult:
    """
    Result from a media generation operation.

    Attributes:
        content: List of generated content items (url, seed, etc.)
        raw_response: Full response from provider for storage
        provider_task_id: Provider's task/generation ID
        preview_local_path: Local path to preview image (for img2vid, the cropped source)
        usage: Usage/cost information for this generation
    """
    content: List[ContentItem]
    raw_response: Dict[str, Any]
    provider_task_id: Optional[str] = None
    preview_local_path: Optional[str] = None
    usage: Optional[UsageInfo] = None


@dataclass
class ResolutionInfo:
    """
    Expected output resolution for a generation.

    Attributes:
        width: Output width in pixels
        height: Output height in pixels
        megapixels: Total megapixels (width * height / 1_000_000)
    """
    width: int
    height: int
    megapixels: float


@dataclass
class CreditInfo:
    """
    Credit/cost information for a generation.

    Attributes:
        credits: Total credits/tokens this generation will cost
        cost_per_credit: USD cost per credit (provider-specific)
        total_cost_usd: Total estimated cost in USD
        num_images: Number of images in this generation
        credits_per_image: Credits per individual image
        cost_per_image_usd: USD cost per individual image
    """
    credits: float
    cost_per_credit: float
    total_cost_usd: float
    num_images: int
    credits_per_image: float
    cost_per_image_usd: float


@dataclass
class PreviewInfo:
    """
    Combined preview information for a generation configuration.

    Attributes:
        resolution: Expected output resolution
        credits: Credit/cost information
    """
    resolution: ResolutionInfo
    credits: CreditInfo


class MediaProviderBase(ABC):
    """
    Base interface for all media generation providers.

    Each provider implementation:
    - Lives in its own folder under providers/media/{provider}/
    - Handles all provider-specific logic (auth, API format, polling)
    - Returns standardized GenerationResult

    Providers must implement:
    - provider_id: Unique identifier string
    - txt2img: Generate images from text prompt
    - img2img: Generate variations from existing image
    - img2vid: Generate video from image (if supported)
    - txt2audio: Generate audio from text prompt (if supported)
    """

    @property
    @abstractmethod
    def provider_id(self) -> str:
        """
        Unique identifier for this provider.

        Examples: "midjourney", "leonardo"
        """
        pass

    @abstractmethod
    def txt2img(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate images from a text prompt.

        Args:
            prompt: Text description of desired image
            params: Provider-specific parameters (aspect_ratio, style, etc.)
            progress_callback: Optional callback for progress updates
                Called with (elapsed_ms, message) during polling

        Returns:
            GenerationResult with URLs and metadata

        Raises:
            ProviderError: On API errors (auth, rate limit, etc.)
        """
        pass

    @abstractmethod
    def img2img(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate image variations from an existing image.

        Args:
            source_image: URL or ID of source image
            prompt: Text description for variation guidance
            params: Provider-specific parameters
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with URLs and metadata

        Raises:
            ProviderError: On API errors
            NotImplementedError: If provider doesn't support this operation
        """
        pass

    @abstractmethod
    def img2vid(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate video from an image.

        Args:
            source_image: URL or ID of source image
            prompt: Text description for video motion
            params: Provider-specific parameters
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with video URLs and metadata

        Raises:
            ProviderError: On API errors
            NotImplementedError: If provider doesn't support this operation
        """
        pass

    @abstractmethod
    def txt2audio(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate audio from a text prompt.

        Args:
            prompt: Text description (for music/SFX) or text content (for TTS)
            params: Provider-specific parameters including:
                - audio_type: str ("music", "tts", "sfx")
                - Additional type-specific params
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with audio URLs/data URIs in content list

        Raises:
            NotImplementedError: If provider doesn't support audio generation
            ProviderError: On API errors
        """
        pass

    @abstractmethod
    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information (resolution and credits) for a generation configuration.

        This method calculates the expected output resolution and credit cost
        without actually performing the generation. Used for UI preview.

        Args:
            action_type: Type of generation ("txt2img", "img2img", "img2vid",
                "txt2audio")
            params: Generation parameters (same as would be passed to generation
                methods)

        Returns:
            PreviewInfo with resolution and credit information

        Raises:
            ProviderError: If preview calculation fails
        """
        pass

    def get_metadata(self, action_type: str) -> Dict[str, Any]:
        """
        Get provider metadata for UI rendering (models, styles, presets, etc.).

        This method returns metadata that the UI needs to render provider-specific
        options like model selection dropdowns, style options, etc. The structure
        varies by provider and action type.

        Args:
            action_type: Type of generation action. One of:
                - "txt2img": Text to image generation
                - "img2img": Image to image generation
                - "img2vid": Image to video generation
                - "txt2audio": Text to audio generation

        Returns:
            Dict with provider-specific metadata structure for the given action.
            Default implementation returns empty dict.
        """
        return {}

    def format_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Format/transform generation parameters before execution.

        This method allows providers to modify generation parameters before
        they are used for generation. Use cases include:
        - Applying category-specific prompt enforcement
        - Normalizing parameter formats
        - Adding provider-specific defaults

        Args:
            params: Generation parameters dict

        Returns:
            Transformed parameters dict. Default implementation returns
            params unchanged.
        """
        return params


class ProviderError(Exception):
    """
    Base exception for provider errors.

    Attributes:
        message: Human-readable error message
        error_code: Provider-specific error code
        retry_after: Seconds to wait before retry (for rate limits)
    """

    def __init__(
        self,
        message: str,
        error_code: Optional[str] = None,
        retry_after: Optional[int] = None
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.retry_after = retry_after


class AuthenticationError(ProviderError):
    """Raised when API authentication fails (invalid/missing API key)."""
    pass


class InsufficientCreditsError(ProviderError):
    """Raised when account has insufficient credits."""
    pass


class RateLimitError(ProviderError):
    """Raised when rate limit is exceeded."""
    pass


class GenerationError(ProviderError):
    """Raised when generation fails (content policy, invalid params, etc.)."""
    pass


class TimeoutError(ProviderError):
    """Raised when generation times out."""
    pass
