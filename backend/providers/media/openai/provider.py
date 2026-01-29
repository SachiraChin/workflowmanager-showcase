"""
OpenAI Image and Video Generation Provider.

Supports GPT Image models for text-to-image generation and image editing,
and Sora 2 models for video generation.

Available image models:
- gpt-image-1.5: Latest, fastest, best quality (recommended)
- gpt-image-1: Original model
- gpt-image-1-mini: Budget option for high volume

Available video models:
- sora-2: Fast, ideal for experimentation and quick iterations
- sora-2-pro: Higher quality, best for production output

API Documentation:
- Images: https://platform.openai.com/docs/api-reference/images
- Videos: https://platform.openai.com/docs/guides/video-generation
"""

import os
import base64
import logging
import time
import requests
from typing import Any, Dict, Optional, Union

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
VIDEO_POLL_INTERVAL_SECONDS = 10  # Polling interval for video generation
VIDEO_MAX_POLL_ATTEMPTS = 180  # Max ~30 minutes for video generation

# Available image models
SUPPORTED_IMAGE_MODELS = [
    "gpt-image-1.5",
    "chatgpt-image-latest",
    "gpt-image-1",
    "gpt-image-1-mini",
]

# Available video models (Sora 2)
SUPPORTED_VIDEO_MODELS = [
    "sora-2",      # Fast, ideal for experimentation
    "sora-2-pro",  # Higher quality, production use
]

# Available image sizes (only these 3 supported by GPT Image models)
SUPPORTED_IMAGE_SIZES = [
    "1024x1024",  # Square (1:1)
    "1024x1536",  # Portrait (2:3)
    "1536x1024",  # Landscape (3:2)
]

# Available video sizes (Sora 2)
# Per OpenAI pricing: 720p and HD (1792x1024)
SUPPORTED_VIDEO_SIZES = [
    # 720p (sora-2 and sora-2-pro)
    "1280x720",   # Landscape 16:9 (720p)
    "720x1280",   # Portrait 9:16 (720p)
    "720x720",    # Square 1:1 (720p)
    # HD - only sora-2-pro
    "1792x1024",  # Landscape ~16:9 (HD)
    "1024x1792",  # Portrait ~9:16 (HD)
    "1024x1024",  # Square 1:1 (HD)
]

# Video duration options (seconds) - Sora supports 4, 8, and 12 seconds
SUPPORTED_VIDEO_DURATIONS = [4, 8, 12]

# Quality levels
QUALITY_LEVELS = ["low", "medium", "high"]

# Aspect ratio to image size mapping
ASPECT_RATIO_TO_IMAGE_SIZE = {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
}

# Aspect ratio + quality to video size mapping
# Format: (aspect_ratio, quality) -> size
# Note: HD (1792x1024) only available for sora-2-pro
VIDEO_SIZE_MAP = {
    # 720p variants (sora-2 and sora-2-pro)
    ("16:9", "720p"): "1280x720",
    ("9:16", "720p"): "720x1280",
    ("1:1", "720p"): "720x720",
    # HD variants (sora-2-pro only)
    ("16:9", "HD"): "1792x1024",
    ("9:16", "HD"): "1024x1792",
    ("1:1", "HD"): "1024x1024",
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

# Video pricing - price per SECOND (model, quality) -> USD/second
# Source: OpenAI Official Pricing Page (January 2026)
# Note: HD quality only available for sora-2-pro
OPENAI_VIDEO_COSTS_PER_SECOND = {
    # sora-2 (only supports 720p)
    ("sora-2", "720p"): 0.10,
    # sora-2-pro
    ("sora-2-pro", "720p"): 0.30,
    ("sora-2-pro", "HD"): 0.50,
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
        if "size" in params and params["size"] in SUPPORTED_IMAGE_SIZES:
            return params["size"]

        # Check for resolution dict (from workflow params)
        resolution = params.get("resolution")
        if isinstance(resolution, dict):
            width = resolution.get("width")
            height = resolution.get("height")
            if width and height:
                size_str = f"{width}x{height}"
                if size_str in SUPPORTED_IMAGE_SIZES:
                    return size_str

        # Check for aspect ratio
        aspect_ratio = params.get("aspect_ratio", "1:1")
        return ASPECT_RATIO_TO_IMAGE_SIZE.get(aspect_ratio, "1024x1024")

    def _resolve_video_size(self, params: Dict[str, Any]) -> str:
        """
        Resolve video size from params.

        Supports:
        - Direct size: "1280x720"
        - Aspect ratio + quality: "16:9" + "HD" -> "1792x1024"

        Args:
            params: Should contain 'aspect_ratio' and 'quality' (720p/HD)

        Returns:
            Video size string (e.g., "1792x1024")
        """
        # Check for direct size
        if "size" in params and params["size"] in SUPPORTED_VIDEO_SIZES:
            return params["size"]

        # Get aspect ratio and quality
        aspect_ratio = params.get("aspect_ratio", "9:16")
        quality = params.get("quality", "720p")

        # Normalize quality value
        if quality not in ("720p", "HD"):
            quality = "720p"

        # Look up size from mapping
        size = VIDEO_SIZE_MAP.get((aspect_ratio, quality))
        if size:
            return size

        # Fallback to 720p portrait if not found
        return "720x1280"

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
        source_image: Union[str, Dict[str, Any]],
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate video from image using Sora 2.

        The source image acts as the first frame of the generated video.

        Args:
            source_image: URL, file path, or dict with 'local_path' key
            prompt: Text description of the desired video
            params: Generation parameters:
                - model: str ("sora-2" or "sora-2-pro", default "sora-2")
                - aspect_ratio: str ("16:9", "9:16", "1:1")
                - quality: str ("720p" or "1080p", default "720p")
                - duration: int (4, 8, or 12 seconds)
                - size: str (direct size, e.g., "1280x720" - overrides ratio+quality)
                - crop_region: dict - Optional crop region {x, y, width, height}
                - images_path: str - Directory for saving processed images
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with video URL
        """
        # Resolve source image path
        if isinstance(source_image, dict):
            local_path = source_image.get('local_path')
            if not local_path:
                # Fall back to URL if local_path not available
                local_path = source_image.get('url')
            if not local_path:
                raise GenerationError("source_image dict must have 'local_path' or 'url'")
        else:
            local_path = source_image

        # Track cropped image path for preview
        cropped_image_path: Optional[str] = None

        # Resolve parameters
        model = params.get("model", "sora-2")
        if model not in SUPPORTED_VIDEO_MODELS:
            model = "sora-2"

        size = self._resolve_video_size(params)

        # Handle crop + resize for Sora (requires specific input dimensions)
        crop_region = params.get("crop_region")
        if crop_region:
            logger.info(f"[OpenAI/Sora] Crop region received: {crop_region}")
        if crop_region and os.path.isfile(local_path):
            # Parse target size from video size
            size_parts = size.split("x")
            target_width = int(size_parts[0])
            target_height = int(size_parts[1])

            # Use the source image's directory for output
            output_dir = os.path.dirname(local_path)

            # Import here to avoid circular dependency
            from ..image_utils import crop_and_resize
            try:
                if progress_callback:
                    progress_callback(0, "Cropping and resizing image...")
                local_path = crop_and_resize(
                    local_path,
                    crop_region,
                    (target_width, target_height),
                    output_dir
                )
                cropped_image_path = local_path  # Track for preview
                logger.info(
                    f"[OpenAI/Sora] Cropped and resized image to {target_width}x{target_height}: "
                    f"{local_path}"
                )
            except Exception as e:
                logger.error(f"[OpenAI/Sora] Failed to crop/resize image: {e}")
                raise GenerationError(f"Failed to crop/resize image: {e}")

        # Duration - convert string to int if needed
        duration = params.get("duration", 4)
        if isinstance(duration, str):
            duration = int(duration)
        if duration not in SUPPORTED_VIDEO_DURATIONS:
            duration = 4

        logger.info(
            f"[OpenAI/Sora] Starting img2vid: model={model}, size={size}, "
            f"duration={duration}s"
        )

        if progress_callback:
            progress_callback(0, "Starting video generation...")

        # Read image file for upload
        image_data, mime_type = self._read_image_for_upload(local_path)

        # Create video generation job (multipart/form-data)
        headers = {"Authorization": f"Bearer {self.api_key}"}

        # Determine file extension from mime type
        ext_map = {"image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp"}
        extension = ext_map.get(mime_type, "jpeg")

        files = {
            "input_reference": (
                f"source.{extension}",
                image_data,
                mime_type
            ),
        }

        data = {
            "prompt": prompt[:32000],
            "model": model,
            "size": size,
            "seconds": str(duration),
        }

        try:
            response = requests.post(
                f"{OPENAI_BASE_URL}/videos",
                data=data,
                files=files,
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS
            )
        except requests.RequestException as e:
            raise GenerationError(f"Video creation request failed: {e}")

        self._handle_response_error(response)
        job_result = response.json()

        video_id = job_result.get("id")
        if not video_id:
            raise GenerationError("No video ID returned from API")

        logger.info(f"[OpenAI/Sora] Video job created: {video_id}")

        # Poll for completion
        video_url = self._poll_video_completion(
            video_id, progress_callback
        )

        if progress_callback:
            progress_callback(100, "Complete!")

        logger.info(f"[OpenAI/Sora] Video generation complete: {video_id}")

        return GenerationResult(
            content=[ContentItem(url=video_url, seed=-1)],
            raw_response=job_result,
            provider_task_id=video_id,
            preview_local_path=cropped_image_path
        )

    def _read_image_for_upload(self, source: str) -> tuple:
        """
        Read image file for multipart upload.

        Args:
            source: URL, file path, or base64 data URI

        Returns:
            Tuple of (bytes, mime_type)
        """
        # Check if data URI
        if source.startswith("data:image"):
            # Parse data URI: data:image/jpeg;base64,<data>
            if "," in source:
                header, b64_data = source.split(",", 1)
                mime_type = header.split(";")[0].replace("data:", "")
                return base64.b64decode(b64_data), mime_type
            raise GenerationError("Invalid data URI format")

        # Check if URL
        if source.startswith(("http://", "https://")):
            try:
                response = requests.get(source, timeout=60)
                response.raise_for_status()
                # Get mime type from content-type header
                content_type = response.headers.get("content-type", "image/jpeg")
                mime_type = content_type.split(";")[0].strip()
                return response.content, mime_type
            except requests.RequestException as e:
                raise GenerationError(f"Failed to download source image: {e}")

        # Assume local file path
        if os.path.isfile(source):
            try:
                with open(source, "rb") as f:
                    image_data = f.read()

                # Determine mime type from extension
                ext = os.path.splitext(source)[1].lower()
                mime_map = {
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".png": "image/png",
                    ".webp": "image/webp",
                }
                mime_type = mime_map.get(ext, "image/jpeg")
                return image_data, mime_type
            except IOError as e:
                raise GenerationError(f"Failed to read source image: {e}")

        raise GenerationError(f"Cannot read source image: {source}")

    def _poll_video_completion(
        self,
        video_id: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> str:
        """
        Poll video generation status until completion.

        Args:
            video_id: The video job ID
            progress_callback: Optional callback for progress updates

        Returns:
            URL of the generated video

        Raises:
            GenerationError: If generation fails or times out
        """
        headers = self._get_headers()
        poll_count = 0

        while poll_count < VIDEO_MAX_POLL_ATTEMPTS:
            poll_count += 1

            try:
                response = requests.get(
                    f"{OPENAI_BASE_URL}/videos/{video_id}",
                    headers=headers,
                    timeout=60
                )
            except requests.RequestException as e:
                logger.warning(f"[OpenAI/Sora] Poll request failed: {e}")
                time.sleep(VIDEO_POLL_INTERVAL_SECONDS)
                continue

            if response.status_code != 200:
                logger.warning(
                    f"[OpenAI/Sora] Poll returned {response.status_code}"
                )
                time.sleep(VIDEO_POLL_INTERVAL_SECONDS)
                continue

            status_data = response.json()
            status = status_data.get("status")
            progress = status_data.get("progress", 0)

            logger.debug(
                f"[OpenAI/Sora] Poll #{poll_count}: status={status}, "
                f"progress={progress}%"
            )

            if progress_callback:
                status_msg = f"Generating video... {progress}%"
                if status == "queued":
                    status_msg = "Queued, waiting to start..."
                elif status == "in_progress":
                    status_msg = f"Rendering video... {progress}%"
                progress_callback(progress, status_msg)

            if status == "completed":
                # Download the video content
                return self._download_video_content(video_id)
            elif status == "failed":
                error_msg = status_data.get("error", "Unknown error")
                raise GenerationError(f"Video generation failed: {error_msg}")

            time.sleep(VIDEO_POLL_INTERVAL_SECONDS)

        raise GenerationError(
            f"Video generation timed out after {VIDEO_MAX_POLL_ATTEMPTS} polls"
        )

    def _download_video_content(self, video_id: str) -> str:
        """
        Download generated video and return the URL.

        The Sora API returns video content via GET /videos/{id}/content.
        We return this URL directly for the worker to download.

        Args:
            video_id: The completed video ID

        Returns:
            URL to download the video content
        """
        # The content endpoint requires auth, so we need to fetch it
        # and return a data URI or temporary URL
        # For now, return the authenticated URL pattern
        # The worker's download_media will need the auth header

        # Actually, let's download and return as data URI for consistency
        # with how images work, but videos are large so let's return the
        # direct URL and let the worker handle download with auth

        # Return the content URL - the download utility will need to handle auth
        content_url = f"{OPENAI_BASE_URL}/videos/{video_id}/content"

        # Fetch the actual video to get a direct URL or binary
        headers = self._get_headers()

        try:
            # Use streaming to handle large video files
            response = requests.get(
                content_url,
                headers=headers,
                timeout=300,  # 5 min timeout for video download
                stream=True
            )
        except requests.RequestException as e:
            raise GenerationError(f"Failed to download video: {e}")

        self._handle_response_error(response)

        # Convert to data URI for consistency with provider interface
        # Note: This may use significant memory for long videos
        video_data = response.content
        content_type = response.headers.get("content-type", "video/mp4")

        video_b64 = base64.b64encode(video_data).decode("utf-8")
        return f"data:{content_type};base64,{video_b64}"

    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information (resolution and cost) for generation config.

        Uses static pricing table - no API call needed.

        For video (img2vid):
        - Pricing is per second of video
        - HD quality only available for sora-2-pro
        """
        # Handle video generation
        if action_type == "img2vid":
            return self._get_video_preview_info(params)

        # Image generation (txt2img, img2img)
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

    def _get_video_preview_info(self, params: Dict[str, Any]) -> PreviewInfo:
        """
        Get preview info for video generation (Sora 2).

        Pricing is per second:
        - sora-2 @ 720p: $0.10/sec
        - sora-2-pro @ 720p: $0.30/sec
        - sora-2-pro @ HD: $0.50/sec
        """
        model = params.get("model", "sora-2")
        if model not in SUPPORTED_VIDEO_MODELS:
            model = "sora-2"

        quality = params.get("quality", "720p")

        # sora-2 only supports 720p, force it if needed
        if model == "sora-2" and quality != "720p":
            quality = "720p"

        # Normalize quality
        if quality not in ("720p", "HD"):
            quality = "720p"

        # Get duration
        duration = params.get("duration", 4)
        if isinstance(duration, str):
            duration = int(duration)
        if duration not in SUPPORTED_VIDEO_DURATIONS:
            duration = 4

        # Get video size for resolution info
        size = self._resolve_video_size(params)
        parts = size.split("x")
        width = int(parts[0])
        height = int(parts[1])
        megapixels = round((width * height) / 1_000_000, 2)

        resolution = ResolutionInfo(
            width=width,
            height=height,
            megapixels=megapixels
        )

        # Look up cost per second
        cost_per_second = OPENAI_VIDEO_COSTS_PER_SECOND.get(
            (model, quality),
            0.10  # Fallback to sora-2 720p rate
        )
        total_cost = cost_per_second * duration

        credits = CreditInfo(
            credits=0,  # OpenAI uses USD, not credits
            cost_per_credit=0,
            total_cost_usd=round(total_cost, 2),
            num_images=1,  # 1 video
            credits_per_image=0,
            cost_per_image_usd=round(total_cost, 2)  # Total cost for 1 video
        )

        return PreviewInfo(resolution=resolution, credits=credits)
