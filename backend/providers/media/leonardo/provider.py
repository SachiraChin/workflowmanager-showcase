"""
Leonardo Provider - Leonardo AI image and video generation

Leonardo AI provides image and video generation with various models.
API Documentation: https://docs.leonardo.ai/

Supported operations:
- txt2img: Text-to-image generation with multiple models (SDXL, Phoenix, Flux)
- img2img: Image-to-image with init_image_id and strength
- img2vid: Generate video from image
"""

import os
import time
import logging
import requests
from typing import Any, Dict, List, Optional

from ..base import (
    MediaProviderBase,
    ContentItem,
    GenerationResult,
    ProgressCallback,
    AuthenticationError,
    InsufficientCreditsError,
    RateLimitError,
    GenerationError,
    TimeoutError,
    ResolutionInfo,
    CreditInfo,
    PreviewInfo,
)
from ..registry import register

logger = logging.getLogger(__name__)

# API Configuration
LEONARDO_BASE_URL = "https://cloud.leonardo.ai/api/rest/v1"
POLL_INTERVAL_SECONDS = 2
MAX_POLL_TIMEOUT_SECONDS = 300  # 5 minutes
MAX_POLL_ATTEMPTS = MAX_POLL_TIMEOUT_SECONDS // POLL_INTERVAL_SECONDS

# Available base models (sd_version)
# These are the primary model selectors
BASE_MODELS = [
    "v1_5",           # SD 1.5
    "v2",             # SD 2.x
    "v3",             # SD 3.x
    "SDXL_0_8",       # SDXL 0.8
    "SDXL_0_9",       # SDXL 0.9
    "SDXL_1_0",       # SDXL 1.0
    "SDXL_LIGHTNING", # SDXL Lightning (fast)
    "PHOENIX",        # Leonardo Phoenix
    "FLUX",           # Flux base
    "FLUX_DEV",       # Flux Dev
    "KINO_2_0",       # Kino 2.0
]

# Available style presets
STYLE_PRESETS = [
    "ANIME", "BOKEH", "CINEMATIC", "CREATIVE", "DYNAMIC",
    "ENVIRONMENT", "FASHION", "FILM", "FOOD", "GENERAL",
    "HDR", "ILLUSTRATION", "LEONARDO", "LONG_EXPOSURE",
    "MACRO", "MINIMALISTIC", "MONOCHROME", "MOODY", "NONE",
    "NEUTRAL", "PHOTOGRAPHY", "PORTRAIT", "RAYTRACED",
    "RENDER_3D", "RETRO", "SKETCH_BW", "SKETCH_COLOR",
    "STOCK_PHOTO", "VIBRANT", "UNPROCESSED"
]

# Video models
VIDEO_MODELS = [
    "MOTION2",       # Motion 2.0
    "MOTION2FAST",   # Motion 2.0 Fast
    "VEO3",          # VEO 3
    "VEO3FAST",      # VEO 3 Fast
    "KLING2_1",      # Kling 2.1
    "KLING2_5",      # Kling 2.5
]

# Model type classification by model_id
# Used for pricing API to determine isSDXL and isPhoenix flags
PHOENIX_MODEL_IDS = {
    "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",  # Leonardo Phoenix 1.0
    "6b645e3a-d64f-4341-a6d8-7a3690fbf042",  # Leonardo Phoenix 0.9
}

SDXL_MODEL_IDS = {
    "e71a1c2f-4f80-4800-934f-2c68979d8cc8",  # Leonardo Anime XL
    "b24e16ff-06e3-43eb-8d33-4416c2d75876",  # Leonardo Lightning XL
    "aa77f04e-3eec-4034-9c07-d0f619684628",  # Leonardo Kino XL
    "5c232a9e-9061-4777-980a-ddc8e65647c6",  # Leonardo Vision XL
    "1e60896f-3c26-4296-8ecc-53e2afecc132",  # Leonardo Diffusion XL
    "16e7060a-803e-4df3-97ee-edcfa5dc9cc8",  # SDXL 1.0
    "b63f7119-31dc-4540-969b-2a9df997e173",  # SDXL 0.9
    "2067ae52-33fd-4a82-bb92-c2c55e7d2786",  # AlbedoBase XL
}


# Base dimensions for each aspect ratio (size="small")
# Format: aspect_ratio -> (width, height)
# All dimensions are multiples of 8 as required by Leonardo API
#
# Size multipliers (calculated from base):
# - small: 1.0x (base dimensions)
# - medium: 1.5x
# - large: 2.0x
#
# Generation modes (applied by Leonardo API on output):
# - Fast: base dimensions (alchemy=false)
# - Quality/Alchemy V2: ~1.5x output (alchemy=true)
# - Ultra: ~2x output (ultra=true)
#
# Reference: 2:3 ratio from Leonardo UI (small): 736x1120
BASE_DIMENSIONS: Dict[str, tuple] = {
    "1:1": (896, 896),
    "16:9": (1184, 672),
    "9:16": (672, 1184),
    "4:3": (1024, 768),
    "3:4": (768, 1024),
    "3:2": (1120, 736),
    "2:3": (736, 1120),
}

# Size multipliers
SIZE_MULTIPLIERS = {
    "small": 1.0,
    "medium": 1.5,
    "large": 2.0,
}

# Legacy mapping for backwards compatibility
# Maps old quality values to new size values
QUALITY_TO_SIZE_MAP = {
    "low": "small",
    "balanced": "medium",
    "high": "large",
}

# Output resolution multipliers for generation modes
# These are applied by Leonardo API to the input dimensions
# - Fast: 1.0x (no upscale, returns input dimensions)
# - Quality/Alchemy: ~1.5x output
# - Ultra: ~2.0x output
OUTPUT_MULTIPLIERS = {
    "fast": 1.0,
    "quality": 1.5,
    "ultra": 2.0,
}

# Cost per API credit in USD (placeholder - update with actual value)
COST_PER_CREDIT_USD = 9 / 3500


def _round_to_multiple(value: int, multiple: int = 8) -> int:
    """Round a value to the nearest multiple (default 8 for Leonardo API)."""
    return round(value / multiple) * multiple


def get_dimensions(aspect_ratio: str, size: str) -> tuple:
    """
    Calculate dimensions for given aspect ratio and size.

    Args:
        aspect_ratio: Aspect ratio string (e.g., "16:9", "2:3")
        size: Size tier ("small", "medium", "large")

    Returns:
        Tuple of (width, height) rounded to multiples of 8
    """
    if aspect_ratio not in BASE_DIMENSIONS:
        # Default to 1:1 if unknown aspect ratio
        aspect_ratio = "1:1"

    base_width, base_height = BASE_DIMENSIONS[aspect_ratio]
    multiplier = SIZE_MULTIPLIERS.get(size, 1.0)

    width = _round_to_multiple(int(base_width * multiplier))
    height = _round_to_multiple(int(base_height * multiplier))

    return width, height


@register("leonardo", concurrency=3)
class LeonardoProvider(MediaProviderBase):
    """
    Leonardo AI provider for image and video generation.

    Requires LEONARDO_API_KEY environment variable.

    Model Selection:
    - Use 'model' param with values like "PHOENIX", "FLUX", "SDXL_1_0"
    - These map to Leonardo's sd_version parameter
    - For custom fine-tuned models, use 'model_id' with the UUID
    """

    def __init__(self):
        self.api_key = os.environ.get("LEONARDO_API_KEY")
        if not self.api_key:
            logger.warning("LEONARDO_API_KEY not set in environment")

    @property
    def provider_id(self) -> str:
        return "leonardo"

    def _get_headers(self) -> Dict[str, str]:
        """Get authorization headers for API requests."""
        if not self.api_key:
            raise AuthenticationError("LEONARDO_API_KEY not configured")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def _handle_response_error(self, response: requests.Response) -> None:
        """Handle HTTP error responses from Leonardo API."""
        status_code = response.status_code

        try:
            error_data = response.json()
            # Leonardo returns errors in various formats
            error_msg = (
                error_data.get("error", {}).get("message") or
                error_data.get("message") or
                error_data.get("error") or
                response.text
            )
        except Exception:
            error_msg = response.text

        if status_code == 401:
            raise AuthenticationError(f"Invalid API key: {error_msg}")
        elif status_code == 402:
            raise InsufficientCreditsError(f"Insufficient credits: {error_msg}")
        elif status_code == 429:
            raise RateLimitError(f"Rate limited: {error_msg}", retry_after=60)
        elif status_code >= 400:
            raise GenerationError(f"API error ({status_code}): {error_msg}")

    def _poll_for_generation(
        self,
        generation_id: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> Dict[str, Any]:
        """
        Poll for generation result until complete or timeout.

        Args:
            generation_id: Leonardo generation ID to poll
            progress_callback: Optional callback for progress updates

        Returns:
            Complete generation data

        Raises:
            TimeoutError: If polling exceeds MAX_POLL_TIMEOUT_SECONDS
            GenerationError: If generation fails
        """
        start_time = time.time()
        poll_count = 0

        while poll_count < MAX_POLL_ATTEMPTS:
            elapsed_ms = int((time.time() - start_time) * 1000)

            # Call progress callback
            if progress_callback:
                progress_callback(elapsed_ms, f"Generating... ({poll_count * POLL_INTERVAL_SECONDS}s)")

            # Make status request
            response = requests.get(
                f"{LEONARDO_BASE_URL}/generations/{generation_id}",
                headers=self._get_headers()
            )

            self._handle_response_error(response)
            result = response.json()

            # Leonardo uses nested structure
            generation = result.get("generations_by_pk", {})
            status = generation.get("status")

            if status == "COMPLETE":
                if progress_callback:
                    progress_callback(elapsed_ms, "Complete!")
                return generation
            elif status == "FAILED":
                raise GenerationError("Generation failed")
            # else: PENDING, continue polling

            time.sleep(POLL_INTERVAL_SECONDS)
            poll_count += 1

        # Timeout
        raise TimeoutError(
            f"Generation timed out after {MAX_POLL_TIMEOUT_SECONDS} seconds"
        )

    def txt2img(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate images from a text prompt using Leonardo AI.

        Args:
            prompt: Text description of desired image
            params: Generation parameters:
                - model_id: str - UUID for the model to use (required)
                - model: str - base model name as fallback (PHOENIX, FLUX, SDXL_1_0, etc.)
                - aspect_ratio: str - Combined with size for dimension lookup
                - size: str - "small", "medium", "large" (preferred)
                - quality: str - Legacy alias for size ("low"→"small", "balanced"→"medium", "high"→"large")
                - num_images: int (1-8)
                - width: int (multiple of 8) - Used if no aspect_ratio/size
                - height: int (multiple of 8) - Used if no aspect_ratio/size
                - guidance_scale: float (1-20)
                - num_inference_steps: int (10-60)
                - seed: int
                - preset_style: str - For SDXL/SD1.5 models (CINEMATIC, BOKEH, etc.)
                - style_uuid: str - For Phoenix/Flux/Lucid models (UUID)
                - negative_prompt: str
                - contrast: float - For Phoenix/Flux models (1.0-4.5)
                - generation_mode: str - "fast", "quality", or "ultra" (preferred)
                - alchemy: bool - Legacy: Enable Alchemy V2 (use generation_mode instead)
                - ultra: bool - Legacy: Enable Ultra mode (use generation_mode instead)
                - photo_real: bool
                - photo_real_version: str (v1, v2)
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with image URLs
        """
        # Resolve dimensions from aspect_ratio + size
        aspect_ratio = params.get("aspect_ratio", "1:1")

        # Support both "size" (preferred) and "quality" (legacy) parameters
        size = params.get("size")
        if not size:
            # Map legacy quality values to new size values
            quality = params.get("quality", "medium")
            size = QUALITY_TO_SIZE_MAP.get(quality, quality)

        if aspect_ratio in BASE_DIMENSIONS:
            width, height = get_dimensions(aspect_ratio, size)
        else:
            # Fallback to explicit dimensions or defaults
            width = params.get("width", 1024)
            height = params.get("height", 1024)

        # Build request payload
        # Handle num_images - UI may send as string for Select compatibility
        num_images = params.get("num_images", 4)
        if isinstance(num_images, str):
            num_images = int(num_images)

        payload = {
            "prompt": prompt,
            "num_images": num_images,
            "width": width,
            "height": height,
        }

        # Model selection priority:
        # 1. Explicit model_id (UUID) - highest priority
        # 2. Explicit model (sd_version)
        if "model_id" in params:
            # Custom fine-tuned model by UUID
            payload["modelId"] = params["model_id"]
        elif "model" in params:
            # Base model by name (maps to sd_version)
            payload["sd_version"] = params["model"]

        # Optional parameters
        if "guidance_scale" in params:
            payload["guidance_scale"] = params["guidance_scale"]
        if "num_inference_steps" in params:
            payload["num_inference_steps"] = params["num_inference_steps"]
        if "seed" in params:
            payload["seed"] = params["seed"]
        if "preset_style" in params:
            payload["presetStyle"] = params["preset_style"]
        if "scheduler" in params:
            payload["scheduler"] = params["scheduler"]
        if "negative_prompt" in params:
            payload["negative_prompt"] = params["negative_prompt"]

        # Style UUID - for Phoenix, Flux, and Lucid models
        if "style_uuid" in params and params["style_uuid"]:
            payload["styleUUID"] = params["style_uuid"]

        # Prompt Magic settings - only add strength/version if prompt_magic is enabled
        if "prompt_magic" in params:
            prompt_magic = params["prompt_magic"]
            if isinstance(prompt_magic, str):
                prompt_magic = prompt_magic.lower() == "true"
            payload["promptMagic"] = prompt_magic
            if prompt_magic:
                if "prompt_magic_strength" in params:
                    strength = params["prompt_magic_strength"]
                    if isinstance(strength, str):
                        strength = float(strength)
                    payload["promptMagicStrength"] = strength
                if "prompt_magic_version" in params:
                    payload["promptMagicVersion"] = params["prompt_magic_version"]

        # Contrast - specifically for Phoenix and Flux models
        # Values: [1.0, 1.3, 1.8, 2.5, 3, 3.5, 4, 4.5]
        # UI sends as string (for Select compatibility), convert to float
        if "contrast" in params:
            contrast_value = params["contrast"]
            if isinstance(contrast_value, str):
                contrast_value = float(contrast_value)
            payload["contrast"] = contrast_value

        # Generation Mode - maps to alchemy and ultra API parameters
        # fast: alchemy=false, ultra=false (base dimensions)
        # quality: alchemy=true, ultra=false (~1.5x output)
        # ultra: alchemy=true, ultra=true (~2x output)
        generation_mode = params.get("generation_mode", "fast")
        if generation_mode == "quality":
            payload["alchemy"] = True
        elif generation_mode == "ultra":
            payload["alchemy"] = True
            payload["ultra"] = True

        # Legacy support for direct alchemy parameter
        if "alchemy" in params and "generation_mode" not in params:
            alchemy_value = params["alchemy"]
            if isinstance(alchemy_value, str):
                alchemy_value = alchemy_value.lower() == "true"
            payload["alchemy"] = alchemy_value

        # Ensure contrast is at least 2.5 when alchemy is enabled
        if payload.get("alchemy") and payload.get("contrast", 0) < 2.5:
            payload["contrast"] = 2.5

        if "photo_real" in params:
            payload["photoReal"] = params["photo_real"]
        if "photo_real_version" in params:
            payload["photoRealVersion"] = params["photo_real_version"]

        logger.info(
            f"[Leonardo] Starting txt2img generation: "
            f"{width}x{height} ({aspect_ratio}, {size}), mode={generation_mode}, "
            f"model={'modelId' in payload and 'custom' or payload.get('sd_version', 'default')}, "
            f"contrast={payload.get('contrast', 'not set')}, alchemy={payload.get('alchemy', False)}, ultra={payload.get('ultra', False)}"
        )
        logger.debug(f"[Leonardo] Full payload: {payload}")

        # Make generation request
        response = requests.post(
            f"{LEONARDO_BASE_URL}/generations",
            json=payload,
            headers=self._get_headers()
        )

        self._handle_response_error(response)
        result = response.json()

        generation_job = result.get("sdGenerationJob", {})
        generation_id = generation_job.get("generationId")

        if not generation_id:
            raise GenerationError("No generation ID returned from API")

        logger.info(f"[Leonardo] Generation created: {generation_id}")

        # Poll for result
        generation_data = self._poll_for_generation(generation_id, progress_callback)

        # Extract content items from generated images
        # Leonardo has a single seed for the entire generation
        generation_seed = generation_data.get("seed")
        seed = generation_seed if generation_seed is not None else -1

        generated_images = generation_data.get("generated_images", [])
        content = [
            ContentItem(url=img.get("url"), seed=seed)
            for img in generated_images
            if img.get("url")
        ]

        logger.info(f"[Leonardo] Generation complete: {len(content)} images")

        return GenerationResult(
            content=content,
            raw_response=generation_data,
            provider_task_id=generation_id
        )

    def img2img(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate images from an existing image using Leonardo AI.

        Args:
            source_image: Leonardo image ID (from a previous generation)
            prompt: Text description to guide the transformation
            params: Generation parameters:
                - init_strength: float (0.1-0.9) - how much to preserve original
                - Plus all txt2img parameters
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with image URLs
        """
        # Build request payload (same as txt2img with init image)
        payload = {
            "prompt": prompt,
            "init_generation_image_id": source_image,
            "init_strength": params.get("init_strength", 0.5),
            "num_images": params.get("num_images", 4),
            "width": params.get("width", 1024),
            "height": params.get("height", 768),
        }

        # Model selection
        if "model_id" in params:
            payload["modelId"] = params["model_id"]
        elif "model" in params:
            payload["sd_version"] = params["model"]

        # Optional parameters
        if "guidance_scale" in params:
            payload["guidance_scale"] = params["guidance_scale"]
        if "num_inference_steps" in params:
            payload["num_inference_steps"] = params["num_inference_steps"]
        if "seed" in params:
            payload["seed"] = params["seed"]
        if "preset_style" in params:
            payload["presetStyle"] = params["preset_style"]
        if "scheduler" in params:
            payload["scheduler"] = params["scheduler"]
        if "negative_prompt" in params:
            payload["negative_prompt"] = params["negative_prompt"]

        # Style UUID - for Phoenix, Flux, and Lucid models
        if "style_uuid" in params and params["style_uuid"]:
            payload["styleUUID"] = params["style_uuid"]

        # Prompt Magic settings - only add strength/version if prompt_magic is enabled
        if "prompt_magic" in params:
            prompt_magic = params["prompt_magic"]
            if isinstance(prompt_magic, str):
                prompt_magic = prompt_magic.lower() == "true"
            payload["promptMagic"] = prompt_magic
            if prompt_magic:
                if "prompt_magic_strength" in params:
                    strength = params["prompt_magic_strength"]
                    if isinstance(strength, str):
                        strength = float(strength)
                    payload["promptMagicStrength"] = strength
                if "prompt_magic_version" in params:
                    payload["promptMagicVersion"] = params["prompt_magic_version"]

        logger.info(f"[Leonardo] Starting img2img generation from {source_image}")

        # Make generation request
        response = requests.post(
            f"{LEONARDO_BASE_URL}/generations",
            json=payload,
            headers=self._get_headers()
        )

        self._handle_response_error(response)
        result = response.json()

        generation_job = result.get("sdGenerationJob", {})
        generation_id = generation_job.get("generationId")

        if not generation_id:
            raise GenerationError("No generation ID returned from API")

        logger.info(f"[Leonardo] img2img generation created: {generation_id}")

        # Poll for result
        generation_data = self._poll_for_generation(generation_id, progress_callback)

        # Extract content items from generated images
        # Leonardo has a single seed for the entire generation
        generation_seed = generation_data.get("seed")
        seed = generation_seed if generation_seed is not None else -1

        generated_images = generation_data.get("generated_images", [])
        content = [
            ContentItem(url=img.get("url"), seed=seed)
            for img in generated_images
            if img.get("url")
        ]

        logger.info(f"[Leonardo] img2img complete: {len(content)} images")

        return GenerationResult(
            content=content,
            raw_response=generation_data,
            provider_task_id=generation_id
        )

    def _poll_for_video(
        self,
        generation_id: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> Dict[str, Any]:
        """
        Poll for video generation result until complete or timeout.

        Video generations use a different response structure than images.

        Args:
            generation_id: Leonardo video generation ID
            progress_callback: Optional callback for progress updates

        Returns:
            Complete video generation data

        Raises:
            TimeoutError: If polling exceeds MAX_POLL_TIMEOUT_SECONDS
            GenerationError: If generation fails
        """
        start_time = time.time()
        poll_count = 0

        while poll_count < MAX_POLL_ATTEMPTS:
            elapsed_ms = int((time.time() - start_time) * 1000)

            # Call progress callback
            if progress_callback:
                progress_callback(elapsed_ms, f"Generating video... ({poll_count * POLL_INTERVAL_SECONDS}s)")

            # Make status request
            response = requests.get(
                f"{LEONARDO_BASE_URL}/generations/{generation_id}",
                headers=self._get_headers()
            )

            self._handle_response_error(response)
            result = response.json()

            generation = result.get("generations_by_pk", {})
            status = generation.get("status")

            if status == "COMPLETE":
                if progress_callback:
                    progress_callback(elapsed_ms, "Complete!")
                return generation
            elif status == "FAILED":
                raise GenerationError("Video generation failed")
            # else: PENDING, continue polling

            time.sleep(POLL_INTERVAL_SECONDS)
            poll_count += 1

        # Timeout
        raise TimeoutError(
            f"Video generation timed out after {MAX_POLL_TIMEOUT_SECONDS} seconds"
        )

    def img2vid(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate video from an image using Leonardo AI.

        Args:
            source_image: Leonardo image ID (from a previous generation or upload)
            prompt: Text description for video motion
            params: Video parameters:
                - image_type: str ("GENERATED" or "UPLOADED")
                - model: str (MOTION2, VEO3, etc.)
                - resolution: str (RESOLUTION_480, RESOLUTION_720, RESOLUTION_1080)
                - negative_prompt: str
                - seed: int
                - duration: int - video length in seconds
                - frame_interpolation: bool
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with video URLs
        """
        # Build request payload
        payload = {
            "imageId": source_image,
            "imageType": params.get("image_type", "GENERATED"),
            "prompt": prompt or "",
        }

        # Optional parameters
        if "model" in params:
            payload["model"] = params["model"]
        if "resolution" in params:
            payload["resolution"] = params["resolution"]
        if "negative_prompt" in params:
            payload["negativePrompt"] = params["negative_prompt"]
        if "seed" in params:
            payload["seed"] = params["seed"]
        if "duration" in params:
            payload["duration"] = params["duration"]
        if "frame_interpolation" in params:
            payload["frameInterpolation"] = params["frame_interpolation"]

        logger.info(f"[Leonardo] Starting img2vid generation from {source_image}")

        # Make video generation request
        response = requests.post(
            f"{LEONARDO_BASE_URL}/generations-image-to-video",
            json=payload,
            headers=self._get_headers()
        )

        self._handle_response_error(response)
        result = response.json()

        # Video generations return slightly different structure
        video_job = result.get("motionVideoGenerationJob", {})
        generation_id = video_job.get("generationId")

        if not generation_id:
            raise GenerationError("No generation ID returned from API")

        logger.info(f"[Leonardo] Video generation created: {generation_id}")

        # Poll for result
        generation_data = self._poll_for_video(generation_id, progress_callback)

        # Extract content items - Leonardo returns motion URLs in generated_images
        # Leonardo has a single seed for the entire generation
        generation_seed = generation_data.get("seed")
        seed = generation_seed if generation_seed is not None else -1

        generated_images = generation_data.get("generated_images", [])
        content = []
        for img in generated_images:
            # Video URL is in motionMP4URL field
            video_url = img.get("motionMP4URL")
            if video_url:
                content.append(ContentItem(url=video_url, seed=seed))
            # Fallback to regular URL if no motion URL
            elif img.get("url"):
                content.append(ContentItem(url=img.get("url"), seed=seed))

        logger.info(f"[Leonardo] Video generation complete: {len(content)} videos")

        return GenerationResult(
            content=content,
            raw_response=generation_data,
            provider_task_id=generation_id
        )

    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information for a Leonardo generation configuration.

        Calculates expected output resolution and credit cost.

        Args:
            action_type: "txt2img", "img2img", or "img2vid"
            params: Generation parameters

        Returns:
            PreviewInfo with resolution and credit information
        """
        # Calculate resolution
        resolution = self._calculate_resolution(action_type, params)

        # Calculate credits via pricing API
        credits = self._calculate_credits(action_type, params, resolution)

        return PreviewInfo(resolution=resolution, credits=credits)

    def _calculate_resolution(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> ResolutionInfo:
        """
        Calculate expected output resolution for given parameters.

        Takes into account:
        - aspect_ratio + size -> base input dimensions
        - generation_mode -> output multiplier (quality=1.5x, ultra=2x)
        """
        # Get base dimensions from aspect_ratio + size
        aspect_ratio = params.get("aspect_ratio", "1:1")

        # Support both "size" (preferred) and "quality" (legacy) parameters
        size = params.get("size")
        if not size:
            quality = params.get("quality", "medium")
            size = QUALITY_TO_SIZE_MAP.get(quality, quality)

        if aspect_ratio in BASE_DIMENSIONS:
            base_width, base_height = get_dimensions(aspect_ratio, size)
        else:
            # Fallback to explicit dimensions or defaults
            base_width = params.get("width", 1024)
            base_height = params.get("height", 1024)

        # Apply generation mode output multiplier
        generation_mode = params.get("generation_mode", "fast")
        output_multiplier = OUTPUT_MULTIPLIERS.get(generation_mode, 1.0)

        # Calculate final output dimensions
        output_width = _round_to_multiple(int(base_width * output_multiplier))
        output_height = _round_to_multiple(int(base_height * output_multiplier))

        megapixels = round((output_width * output_height) / 1_000_000, 2)

        return ResolutionInfo(
            width=output_width,
            height=output_height,
            megapixels=megapixels
        )

    def _calculate_credits(
        self,
        action_type: str,
        params: Dict[str, Any],
        resolution: ResolutionInfo
    ) -> CreditInfo:
        """
        Calculate credit cost for generation using Leonardo pricing API.

        Falls back to 0 if API call fails.
        """
        credits = 0.0

        try:
            # Build pricing calculator request
            # Use input dimensions (before output multiplier) for API call
            aspect_ratio = params.get("aspect_ratio", "1:1")
            size = params.get("size")
            if not size:
                quality = params.get("quality", "medium")
                size = QUALITY_TO_SIZE_MAP.get(quality, quality)

            if aspect_ratio in BASE_DIMENSIONS:
                width, height = get_dimensions(aspect_ratio, size)
            else:
                width = params.get("width", 1024)
                height = params.get("height", 1024)

            num_images = params.get("num_images", 4)
            if isinstance(num_images, str):
                num_images = int(num_images)

            generation_mode = params.get("generation_mode", "fast")

            # Determine service type based on action
            if action_type == "img2vid":
                service = "VIDEO_GENERATION"
            else:
                # txt2img and img2img both use IMAGE_GENERATION
                service = "IMAGE_GENERATION"

            # Get inference steps from params or use default
            inference_steps = params.get("num_inference_steps", 15)
            if isinstance(inference_steps, str):
                inference_steps = int(inference_steps)

            # Get prompt magic settings
            prompt_magic = params.get("prompt_magic", False)
            if isinstance(prompt_magic, str):
                prompt_magic = prompt_magic.lower() == "true"
            prompt_magic_strength = params.get("prompt_magic_strength", 0.3)
            if isinstance(prompt_magic_strength, str):
                prompt_magic_strength = float(prompt_magic_strength)
            prompt_magic_version = params.get("prompt_magic_version", "v3")

            # Determine alchemy/ultra mode from generation_mode
            is_alchemy = generation_mode in ("quality", "ultra")
            is_ultra = generation_mode == "ultra"

            # Determine model type from model_id for pricing
            model_id = params.get("model_id", "")
            is_phoenix = model_id in PHOENIX_MODEL_IDS
            is_sdxl = model_id in SDXL_MODEL_IDS

            # Build service params - ALL fields are required by pricing API
            service_params: Dict[str, Any] = {
                "imageWidth": width,
                "imageHeight": height,
                "numImages": num_images,
                "inferenceSteps": inference_steps,
                "promptMagic": prompt_magic,
                "alchemyMode": is_alchemy,
                "isUltra": is_ultra,
                "highResolution": False,
                "isModelCustom": False,
                "isSDXL": is_sdxl,
                "isPhoenix": is_phoenix,
            }

            # Add prompt magic details if enabled
            if prompt_magic:
                service_params["promptMagicStrength"] = prompt_magic_strength
                service_params["promptMagicVersion"] = prompt_magic_version

            payload: Dict[str, Any] = {
                "service": service,
                "serviceParams": {
                    service: service_params
                }
            }

            # Make pricing API request
            response = requests.post(
                f"{LEONARDO_BASE_URL}/pricing-calculator",
                json=payload,
                headers=self._get_headers(),
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                # API returns apiCreditCost in the response
                credits = result.get("calculateProductionApiServiceCost", {}).get("cost", 0)
            else:
                logger.warning(
                    f"[Leonardo] Pricing API returned {response.status_code}: {response.text}"
                )

        except Exception as e:
            logger.warning(f"[Leonardo] Failed to get pricing: {e}")

        total_cost = credits * COST_PER_CREDIT_USD
        credits_per_image = credits / num_images if num_images > 0 else 0
        cost_per_image = total_cost / num_images if num_images > 0 else 0

        return CreditInfo(
            credits=credits,
            cost_per_credit=COST_PER_CREDIT_USD,
            total_cost_usd=round(total_cost, 4),
            num_images=num_images,
            credits_per_image=round(credits_per_image, 2),
            cost_per_image_usd=round(cost_per_image, 4)
        )
