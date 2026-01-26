"""
OpenAI Image Generation Provider.

Supports GPT Image models for text-to-image generation and image editing.

Available models:
- gpt-image-1.5: Latest, fastest, best quality (recommended)
- gpt-image-1: Original model
- gpt-image-1-mini: Budget option for high volume

API Documentation: https://platform.openai.com/docs/api-reference/images
"""

import os
import base64
import logging
import requests
from typing import Any, Dict, Optional

from ..base import (
    MediaProviderBase,
    ContentItem,
    GenerationResult,
    ProgressCallback,
    AuthenticationError,
    RateLimitError,
    GenerationError,
    ResolutionInfo,
    CreditInfo,
    PreviewInfo,
)
from ..registry import register

logger = logging.getLogger(__name__)

# API Configuration
OPENAI_BASE_URL = "https://api.openai.com/v1"
REQUEST_TIMEOUT_SECONDS = 120  # Long timeout for generation

# Available models
SUPPORTED_MODELS = [
    "gpt-image-1.5",
    "chatgpt-image-latest",
    "gpt-image-1",
    "gpt-image-1-mini",
]

# Available sizes (only these 3 supported by GPT Image models)
SUPPORTED_SIZES = [
    "1024x1024",  # Square (1:1)
    "1024x1536",  # Portrait (2:3)
    "1536x1024",  # Landscape (3:2)
]

# Quality levels
QUALITY_LEVELS = ["low", "medium", "high"]

# Aspect ratio to size mapping
ASPECT_RATIO_TO_SIZE = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
}

# Pricing lookup table (model, quality, size) -> USD per image
# Source: OpenAI Official Pricing Page (January 2026)
OPENAI_IMAGE_COSTS = {
    # gpt-image-1.5 (and chatgpt-image-latest)
    ("gpt-image-1.5", "low", "1024x1024"): 0.009,
    ("gpt-image-1.5", "low", "1024x1536"): 0.013,
    ("gpt-image-1.5", "low", "1536x1024"): 0.013,
    ("gpt-image-1.5", "medium", "1024x1024"): 0.034,
    ("gpt-image-1.5", "medium", "1024x1536"): 0.05,
    ("gpt-image-1.5", "medium", "1536x1024"): 0.05,
    ("gpt-image-1.5", "high", "1024x1024"): 0.133,
    ("gpt-image-1.5", "high", "1024x1536"): 0.2,
    ("gpt-image-1.5", "high", "1536x1024"): 0.2,

    # chatgpt-image-latest (same as gpt-image-1.5)
    ("chatgpt-image-latest", "low", "1024x1024"): 0.009,
    ("chatgpt-image-latest", "low", "1024x1536"): 0.013,
    ("chatgpt-image-latest", "low", "1536x1024"): 0.013,
    ("chatgpt-image-latest", "medium", "1024x1024"): 0.034,
    ("chatgpt-image-latest", "medium", "1024x1536"): 0.05,
    ("chatgpt-image-latest", "medium", "1536x1024"): 0.05,
    ("chatgpt-image-latest", "high", "1024x1024"): 0.133,
    ("chatgpt-image-latest", "high", "1024x1536"): 0.2,
    ("chatgpt-image-latest", "high", "1536x1024"): 0.2,

    # gpt-image-1
    ("gpt-image-1", "low", "1024x1024"): 0.011,
    ("gpt-image-1", "low", "1024x1536"): 0.016,
    ("gpt-image-1", "low", "1536x1024"): 0.016,
    ("gpt-image-1", "medium", "1024x1024"): 0.042,
    ("gpt-image-1", "medium", "1024x1536"): 0.063,
    ("gpt-image-1", "medium", "1536x1024"): 0.063,
    ("gpt-image-1", "high", "1024x1024"): 0.167,
    ("gpt-image-1", "high", "1024x1536"): 0.25,
    ("gpt-image-1", "high", "1536x1024"): 0.25,

    # gpt-image-1-mini
    ("gpt-image-1-mini", "low", "1024x1024"): 0.005,
    ("gpt-image-1-mini", "low", "1024x1536"): 0.006,
    ("gpt-image-1-mini", "low", "1536x1024"): 0.006,
    ("gpt-image-1-mini", "medium", "1024x1024"): 0.011,
    ("gpt-image-1-mini", "medium", "1024x1536"): 0.015,
    ("gpt-image-1-mini", "medium", "1536x1024"): 0.015,
    ("gpt-image-1-mini", "high", "1024x1024"): 0.036,
    ("gpt-image-1-mini", "high", "1024x1536"): 0.052,
    ("gpt-image-1-mini", "high", "1536x1024"): 0.052,
}


@register("openai", concurrency=3)
class OpenAIProvider(MediaProviderBase):
    """
    OpenAI provider for image generation using GPT Image models.

    Requires OPENAI_API_KEY environment variable.

    Model Selection:
    - gpt-image-1.5: Latest flagship, fastest, best quality (recommended)
    - gpt-image-1: Original model, good balance
    - gpt-image-1-mini: Budget option for high volume
    """

    def __init__(self):
        self.api_key = os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            logger.warning("[OpenAI] OPENAI_API_KEY not set in environment")

    @property
    def provider_id(self) -> str:
        return "openai"

    def _get_headers(self) -> Dict[str, str]:
        """Get authorization headers for API requests."""
        if not self.api_key:
            raise AuthenticationError("OPENAI_API_KEY not configured")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _handle_response_error(self, response: requests.Response) -> None:
        """Handle HTTP error responses from OpenAI API."""
        if response.status_code == 200:
            return

        try:
            error_data = response.json()
            error_msg = error_data.get("error", {}).get("message", response.text)
        except Exception:
            error_msg = response.text

        if response.status_code == 401:
            raise AuthenticationError(f"Invalid API key: {error_msg}")
        elif response.status_code == 429:
            raise RateLimitError(f"Rate limited: {error_msg}", retry_after=60)
        elif response.status_code == 400:
            raise GenerationError(f"Bad request: {error_msg}")
        else:
            raise GenerationError(
                f"API error ({response.status_code}): {error_msg}"
            )

    def _resolve_size(self, params: Dict[str, Any]) -> str:
        """
        Resolve image size from params.

        Supports:
        - Direct size: "1024x1024"
        - Aspect ratio mapping: "1:1" -> "1024x1024"
        - Resolution dict: {"width": 1024, "height": 1024}
        """
        # Check for direct size
        if "size" in params and params["size"] in SUPPORTED_SIZES:
            return params["size"]

        # Check for resolution dict (from workflow params)
        resolution = params.get("resolution")
        if isinstance(resolution, dict):
            width = resolution.get("width")
            height = resolution.get("height")
            if width and height:
                size_str = f"{width}x{height}"
                if size_str in SUPPORTED_SIZES:
                    return size_str

        # Check for aspect ratio
        aspect_ratio = params.get("aspect_ratio", "1:1")
        return ASPECT_RATIO_TO_SIZE.get(aspect_ratio, "1024x1024")

    def _get_image_as_base64(self, source: str) -> str:
        """
        Get image as base64 string from URL or file path.

        Args:
            source: URL, local file path, or already base64 string

        Returns:
            Base64 encoded image string (without data URI prefix)
        """
        # Check if already base64 data URI
        if source.startswith("data:image"):
            # Extract just the base64 part
            if "," in source:
                return source.split(",", 1)[1]
            return source

        # Check if it's a URL
        if source.startswith(("http://", "https://")):
            try:
                response = requests.get(source, timeout=60)
                response.raise_for_status()
                image_data = response.content
            except requests.RequestException as e:
                raise GenerationError(f"Failed to download source image: {e}")
        elif os.path.isfile(source):
            # Local file
            try:
                with open(source, "rb") as f:
                    image_data = f.read()
            except IOError as e:
                raise GenerationError(f"Failed to read source image: {e}")
        else:
            # Assume it's already base64
            return source

        return base64.b64encode(image_data).decode("utf-8")

    def txt2img(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate images from a text prompt using OpenAI GPT Image models.

        Args:
            prompt: Text description (max 32,000 chars)
            params: Generation parameters:
                - model: str (default "gpt-image-1.5")
                - size: str ("1024x1024", "1024x1536", "1536x1024")
                - aspect_ratio: str (alternative: "1:1", "2:3", "3:2")
                - quality: str ("low", "medium", "high")
                - n / num_images: int (1-10)
                - background: str ("transparent", "opaque", "auto")
                - output_format: str ("png", "jpeg", "webp")
                - moderation: str ("auto", "low")
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with image data URIs
        """
        # Resolve parameters
        model = params.get("model", "gpt-image-1.5")
        size = self._resolve_size(params)
        quality = params.get("quality", "high")
        n = params.get("n") or params.get("num_images", 1)
        if isinstance(n, str):
            n = int(n)

        # Get output format (needed for mime type)
        output_format = params.get("output_format", "png")

        # Build request payload
        # Note: GPT Image models don't support response_format parameter
        # They always return base64-encoded images in the b64_json field
        payload = {
            "model": model,
            "prompt": prompt[:32000],  # Max prompt length
            "n": n,
            "size": size,
            "quality": quality,
            "output_format": output_format,
        }

        # Optional parameters
        if "background" in params:
            payload["background"] = params["background"]
        if "moderation" in params:
            payload["moderation"] = params["moderation"]

        logger.info(
            f"[OpenAI] Starting txt2img: model={model}, size={size}, "
            f"quality={quality}, n={n}"
        )

        # Call progress callback before request
        if progress_callback:
            progress_callback(0, "Generating with OpenAI...")

        # Make generation request (synchronous - no polling needed)
        try:
            response = requests.post(
                f"{OPENAI_BASE_URL}/images/generations",
                json=payload,
                headers=self._get_headers(),
                timeout=REQUEST_TIMEOUT_SECONDS
            )
        except requests.RequestException as e:
            raise GenerationError(f"Request failed: {e}")

        self._handle_response_error(response)
        result = response.json()

        # Extract images from response
        # GPT Image models always return base64 in b64_json field
        content = []
        mime_type = f"image/{output_format}"

        for img_data in result.get("data", []):
            b64_json = img_data.get("b64_json")
            if b64_json:
                url = f"data:{mime_type};base64,{b64_json}"
                content.append(ContentItem(url=url, seed=-1))

        if progress_callback:
            progress_callback(0, "Complete!")

        logger.info(f"[OpenAI] Generation complete: {len(content)} images")

        return GenerationResult(
            content=content,
            raw_response=result,
            provider_task_id=None  # No task ID for sync API
        )

    def img2img(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Edit an image using OpenAI's image edit endpoint (inpainting).

        Args:
            source_image: URL, file path, or base64 of source image
            prompt: Description of desired edit
            params: Edit parameters:
                - mask: str (URL, file path, or base64 of mask image)
                - model: str (default "gpt-image-1.5")
                - size: str ("1024x1024", "1024x1536", "1536x1024")
                - quality: str ("low", "medium", "high")
                - n / num_images: int (1-10)
            progress_callback: Optional callback

        Returns:
            GenerationResult with edited image data URIs
        """
        # Get image as base64
        image_b64 = self._get_image_as_base64(source_image)

        # Resolve parameters
        model = params.get("model", "gpt-image-1.5")
        size = self._resolve_size(params)
        quality = params.get("quality", "high")
        n = params.get("n") or params.get("num_images", 1)
        if isinstance(n, str):
            n = int(n)

        logger.info(
            f"[OpenAI] Starting img2img edit: model={model}, size={size}"
        )

        if progress_callback:
            progress_callback(0, "Editing with OpenAI...")

        # Build multipart form data (edit endpoint requires multipart, not JSON)
        # Decode base64 to bytes for file upload
        image_bytes = base64.b64decode(image_b64)

        files = {
            "image": ("image.png", image_bytes, "image/png"),
        }

        output_format = params.get("output_format", "png")

        data = {
            "model": model,
            "prompt": prompt[:32000],
            "n": str(n),
            "size": size,
            "quality": quality,
            "output_format": output_format,
        }

        # Add mask if provided
        if "mask" in params and params["mask"]:
            mask_b64 = self._get_image_as_base64(params["mask"])
            mask_bytes = base64.b64decode(mask_b64)
            files["mask"] = ("mask.png", mask_bytes, "image/png")

        # Make edit request (no Content-Type header for multipart)
        headers = {"Authorization": f"Bearer {self.api_key}"}

        try:
            response = requests.post(
                f"{OPENAI_BASE_URL}/images/edits",
                data=data,
                files=files,
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS
            )
        except requests.RequestException as e:
            raise GenerationError(f"Request failed: {e}")

        self._handle_response_error(response)
        result = response.json()

        # Extract images (GPT Image models return base64)
        content = []
        mime_type = f"image/{output_format}"

        for img_data in result.get("data", []):
            b64_json = img_data.get("b64_json")
            if b64_json:
                url = f"data:{mime_type};base64,{b64_json}"
                content.append(ContentItem(url=url, seed=-1))

        if progress_callback:
            progress_callback(0, "Complete!")

        logger.info(f"[OpenAI] Edit complete: {len(content)} images")

        return GenerationResult(
            content=content,
            raw_response=result,
            provider_task_id=None
        )

    def img2vid(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Not supported by OpenAI Image API.

        Note: OpenAI has Sora for video generation, but it's a separate API.

        Raises:
            NotImplementedError: Always
        """
        raise NotImplementedError(
            "OpenAI Image API does not support image-to-video generation. "
            "Use Leonardo or MidJourney for video generation."
        )

    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information (resolution and cost) for generation config.

        Uses static pricing table - no API call needed.
        """
        # Resolve parameters
        model = params.get("model", "gpt-image-1.5")
        size = self._resolve_size(params)
        quality = params.get("quality", "high")
        n = params.get("n") or params.get("num_images", 1)
        if isinstance(n, str):
            n = int(n)

        # Parse size for resolution
        parts = size.split("x")
        width = int(parts[0])
        height = int(parts[1])
        megapixels = round((width * height) / 1_000_000, 2)

        resolution = ResolutionInfo(
            width=width,
            height=height,
            megapixels=megapixels
        )

        # Look up cost from pricing table
        cost_per_image = OPENAI_IMAGE_COSTS.get(
            (model, quality, size),
            0.10  # Fallback if not found
        )
        total_cost = cost_per_image * n

        credits = CreditInfo(
            credits=0,  # OpenAI uses USD, not credits
            cost_per_credit=0,
            total_cost_usd=round(total_cost, 4),
            num_images=n,
            credits_per_image=0,
            cost_per_image_usd=round(cost_per_image, 4)
        )

        return PreviewInfo(resolution=resolution, credits=credits)
