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
    UsageInfo,
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

# Model display names for UI and usage tracking
MODEL_DISPLAY_NAMES = {
    # Image models (UUIDs)
    "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3": "Leonardo Phoenix 1.0",
    "6b645e3a-d64f-4341-a6d8-7a3690fbf042": "Leonardo Phoenix 0.9",
    "7b592283-e8a7-4c5a-9ba6-d18c31f258b9": "Leonardo Lucid Origin",
    "05ce0082-2d80-4a2d-8653-4d1c85e2418e": "Leonardo Lucid Realism",
    "b2614463-296c-462a-9586-aafdb8f00e36": "Leonardo Flux Dev",
    "1dd50843-d653-4516-a8e3-f0238ee453ff": "Leonardo Flux Schnell",
    "28aeddf8-bd19-4803-80fc-79602d1a9989": "Leonardo FLUX.1 Kontext",
    "e71a1c2f-4f80-4800-934f-2c68979d8cc8": "Leonardo Anime XL",
    "b24e16ff-06e3-43eb-8d33-4416c2d75876": "Leonardo Lightning XL",
    "aa77f04e-3eec-4034-9c07-d0f619684628": "Leonardo Kino XL",
    "5c232a9e-9061-4777-980a-ddc8e65647c6": "Leonardo Vision XL",
    "1e60896f-3c26-4296-8ecc-53e2afecc132": "Leonardo Diffusion XL",
    "16e7060a-803e-4df3-97ee-edcfa5dc9cc8": "Leonardo SDXL 1.0",
    "b63f7119-31dc-4540-969b-2a9df997e173": "Leonardo SDXL 0.9",
    "2067ae52-33fd-4a82-bb92-c2c55e7d2786": "Leonardo AlbedoBase XL",
    # Video models
    "MOTION2": "Leonardo Motion 2.0",
    "MOTION2FAST": "Leonardo Motion 2.0 Fast",
    "VEO3": "Leonardo VEO 3",
    "VEO3FAST": "Leonardo VEO 3 Fast",
    "KLING2_1": "Leonardo Kling 2.1",
    "KLING2_5": "Leonardo Kling 2.5",
}

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

        # Calculate credits/cost
        preview_info = self.get_preview_info("txt2img", params)
        model_id = params.get("model_id", params.get("model", "unknown"))
        usage = UsageInfo(
            provider="leonardo",
            model=model_id,
            display_name=MODEL_DISPLAY_NAMES.get(model_id, f"Leonardo {model_id}"),
            action_type="txt2img",
            total_cost=preview_info.credits.total_cost_usd,
            credits=int(preview_info.credits.credits),
        )

        return GenerationResult(
            content=content,
            raw_response=generation_data,
            provider_task_id=generation_id,
            usage=usage,
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

        # Calculate credits/cost
        preview_info = self.get_preview_info("img2img", params)
        model_id = params.get("model_id", params.get("model", "unknown"))
        usage = UsageInfo(
            provider="leonardo",
            model=model_id,
            display_name=MODEL_DISPLAY_NAMES.get(model_id, f"Leonardo {model_id}"),
            action_type="img2img",
            total_cost=preview_info.credits.total_cost_usd,
            credits=int(preview_info.credits.credits),
        )

        return GenerationResult(
            content=content,
            raw_response=generation_data,
            provider_task_id=generation_id,
            usage=usage,
        )

    def _upload_init_image(self, file_path: str) -> str:
        """
        Upload a local image to Leonardo for use as init image.

        Uses Leonardo's presigned URL flow:
        1. Request presigned URL from /init-image endpoint
        2. Upload file to S3 using presigned URL
        3. Return the image ID for use in generation

        Args:
            file_path: Local path to the image file

        Returns:
            Leonardo image ID

        Raises:
            GenerationError: If upload fails
        """
        import os
        import mimetypes

        # Validate file exists
        if not os.path.exists(file_path):
            raise GenerationError(f"Image file not found: {file_path}")

        # Get file extension
        _, ext = os.path.splitext(file_path)
        ext = ext.lower().lstrip('.')
        if ext not in ('png', 'jpg', 'jpeg', 'webp'):
            raise GenerationError(f"Unsupported image format: {ext}")

        # Step 1: Get presigned URL
        logger.info(f"[Leonardo] Requesting presigned URL for upload...")
        response = requests.post(
            f"{LEONARDO_BASE_URL}/init-image",
            json={"extension": ext},
            headers=self._get_headers()
        )
        self._handle_response_error(response)
        result = response.json()

        upload_data = result.get("uploadInitImage", {})
        image_id = upload_data.get("id")
        presigned_url = upload_data.get("url")
        presigned_fields = upload_data.get("fields")

        # Handle fields being a JSON string (from some API versions)
        if isinstance(presigned_fields, str):
            import json as json_module
            try:
                presigned_fields = json_module.loads(presigned_fields)
            except json_module.JSONDecodeError:
                logger.warning(f"[Leonardo] Could not parse presigned_fields as JSON: {presigned_fields}")
                presigned_fields = {}

        if not image_id or not presigned_url:
            raise GenerationError("Failed to get presigned URL from Leonardo")

        # Step 2: Upload to S3 using presigned URL
        logger.info(f"[Leonardo] Uploading image to S3 (id={image_id})...")

        # Read file content
        with open(file_path, 'rb') as f:
            file_content = f.read()

        # Build multipart form data with presigned fields
        # The presigned fields must come before the file
        files = {}
        for key, value in (presigned_fields or {}).items():
            files[key] = (None, value)

        # Add the file last
        content_type = mimetypes.guess_type(file_path)[0] or 'image/png'
        files['file'] = (os.path.basename(file_path), file_content, content_type)

        # Upload to S3 (no auth header - presigned URL handles auth)
        upload_response = requests.post(presigned_url, files=files)

        if upload_response.status_code not in (200, 201, 204):
            raise GenerationError(
                f"S3 upload failed: {upload_response.status_code} - {upload_response.text}"
            )

        logger.info(f"[Leonardo] Image uploaded successfully: {image_id}")
        return image_id

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
        source_image: str | Dict[str, Any],
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate video from an image using Leonardo AI.

        Args:
            source_image: Either:
                - Leonardo image ID string (from a previous generation)
                - Dict with 'local_path' key (will be uploaded automatically)
            prompt: Text description for video motion
            params: Video parameters:
                - image_type: str ("GENERATED" or "UPLOADED") - auto-set if uploading
                - model: str (MOTION2, VEO3, etc.)
                - resolution: str (RESOLUTION_480, RESOLUTION_720, RESOLUTION_1080)
                - negative_prompt: str
                - seed: int
                - duration: int - video length in seconds
                - frame_interpolation: bool
                - crop_region: dict - Optional crop region {x, y, width, height}
                - images_path: str - Directory for saving cropped images
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with video URLs
        """
        # Handle source_image - can be Leonardo ID string or dict with local_path
        image_id: str
        image_type: str
        cropped_image_path: Optional[str] = None

        if isinstance(source_image, dict):
            # Source image from workflow - has local_path, url, content_id, etc.
            local_path = source_image.get('local_path')
            if local_path:
                # Check if cropping is needed
                crop_region = params.get("crop_region")
                if crop_region:
                    logger.info(f"[Leonardo] Crop region received: {crop_region}")
                    # Use the source image's directory for output
                    output_dir = os.path.dirname(local_path)
                    # Import here to avoid circular dependency
                    from ..image_utils import crop_image
                    try:
                        if progress_callback:
                            progress_callback(0, "Cropping image...")
                        local_path = crop_image(local_path, crop_region, output_dir)
                        cropped_image_path = local_path  # Track for preview
                        logger.info(f"[Leonardo] Cropped image: {local_path}")
                    except Exception as e:
                        logger.error(f"[Leonardo] Failed to crop image: {e}")
                        raise GenerationError(f"Failed to crop image: {e}")

                # Upload the local image to Leonardo
                if progress_callback:
                    progress_callback(0, "Uploading source image...")
                image_id = self._upload_init_image(local_path)
                image_type = "UPLOADED"
            else:
                raise GenerationError(
                    "source_image dict must contain 'local_path' for upload"
                )
        else:
            # Assume it's a Leonardo image ID
            image_id = source_image
            image_type = params.get("image_type", "GENERATED")

        # Build request payload
        payload = {
            "imageId": image_id,
            "imageType": image_type,
            "prompt": prompt or "",
        }

        # Models that support variable duration (MOTION models have fixed 5s duration)
        MODELS_WITH_DURATION = {"VEO3", "VEO3FAST", "KLING2_1", "KLING2_5"}

        # Optional parameters
        model = params.get("model")
        if model:
            payload["model"] = model
        if "resolution" in params:
            payload["resolution"] = params["resolution"]
        if "negative_prompt" in params:
            payload["negativePrompt"] = params["negative_prompt"]
        if "seed" in params:
            payload["seed"] = params["seed"]
        # Only send duration for models that support variable duration
        if "duration" in params and model in MODELS_WITH_DURATION:
            # Convert string to int if needed
            duration_val = params["duration"]
            if isinstance(duration_val, str):
                duration_val = int(duration_val)
            payload["duration"] = duration_val
        if "frame_interpolation" in params:
            # Convert string "true"/"false" to boolean
            fi_value = params["frame_interpolation"]
            if isinstance(fi_value, str):
                fi_value = fi_value.lower() == "true"
            payload["frameInterpolation"] = fi_value

        logger.info(f"[Leonardo] Starting img2vid generation from image_id={image_id}")

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

        # Calculate credits/cost
        preview_info = self.get_preview_info("img2vid", params)
        model_id = params.get("model", "MOTION2")
        usage = UsageInfo(
            provider="leonardo",
            model=model_id,
            display_name=MODEL_DISPLAY_NAMES.get(model_id, f"Leonardo {model_id}"),
            action_type="img2vid",
            total_cost=preview_info.credits.total_cost_usd,
            credits=int(preview_info.credits.credits),
        )

        return GenerationResult(
            content=content,
            raw_response=generation_data,
            provider_task_id=generation_id,
            preview_local_path=cropped_image_path,
            usage=usage,
        )

    def txt2audio(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """Audio generation not supported by Leonardo."""
        raise NotImplementedError(
            "Leonardo does not support audio generation"
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
        """Calculate expected output resolution for given parameters."""
        match action_type:
            case "img2vid":
                return self._calculate_video_resolution(params)
            case "txt2img" | "img2img":
                return self._calculate_image_resolution(params)
            case _:
                return self._calculate_image_resolution(params)

    def _calculate_video_resolution(self, params: Dict[str, Any]) -> ResolutionInfo:
        """Calculate video output resolution from resolution param."""
        resolution = params.get("resolution", "RESOLUTION_720")
        video_resolutions = {
            "RESOLUTION_480": (854, 480),
            "RESOLUTION_720": (1280, 720),
            "RESOLUTION_1080": (1920, 1080),
        }
        width, height = video_resolutions.get(resolution, (1280, 720))
        megapixels = round((width * height) / 1_000_000, 2)
        return ResolutionInfo(width=width, height=height, megapixels=megapixels)

    def _calculate_image_resolution(self, params: Dict[str, Any]) -> ResolutionInfo:
        """Calculate image output resolution from aspect_ratio, size, and mode."""
        aspect_ratio = params.get("aspect_ratio", "1:1")

        # Support both "size" (preferred) and "quality" (legacy) parameters
        size = params.get("size")
        if not size:
            quality = params.get("quality", "medium")
            size = QUALITY_TO_SIZE_MAP.get(quality, quality)

        if aspect_ratio in BASE_DIMENSIONS:
            base_width, base_height = get_dimensions(aspect_ratio, size)
        else:
            base_width = params.get("width", 1024)
            base_height = params.get("height", 1024)

        # Apply generation mode output multiplier
        generation_mode = params.get("generation_mode", "fast")
        output_multiplier = OUTPUT_MULTIPLIERS.get(generation_mode, 1.0)

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
        """Calculate credit cost using Leonardo pricing API."""
        match action_type:
            case "img2vid":
                return self._calculate_video_credits(params)
            case "txt2img" | "img2img":
                return self._calculate_image_credits(params)
            case _:
                return self._calculate_image_credits(params)

    def _calculate_video_credits(self, params: Dict[str, Any]) -> CreditInfo:
        """Calculate video generation credits using Leonardo pricing API."""
        credits = 0.0

        # Map our model names to Leonardo's service types
        MODEL_TO_SERVICE = {
            "MOTION2": "MOTION_VIDEO_GENERATION",
            "MOTION2FAST": "MOTION_VIDEO_GENERATION",
            "VEO3": "VEO3_MOTION_VIDEO_GENERATION",
            "VEO3FAST": "VEO3_1_FAST_MOTION_VIDEO_GENERATION",
            "KLING2_1": "KLING2_1_MOTION_VIDEO_GENERATION",
            "KLING2_5": "KLING2_5_MOTION_VIDEO_GENERATION",
        }

        try:
            model = params.get("model", "MOTION2")
            resolution = params.get("resolution", "RESOLUTION_720")

            # Get the correct service type for this model
            service_type = MODEL_TO_SERVICE.get(model, "MOTION_VIDEO_GENERATION")

            # Build video service params - pricing API only needs resolution
            # Duration is not accepted by the pricing calculator API
            service_params: Dict[str, Any] = {
                "resolution": resolution,
            }

            payload: Dict[str, Any] = {
                "service": service_type,
                "serviceParams": {
                    service_type: service_params
                }
            }

            response = requests.post(
                f"{LEONARDO_BASE_URL}/pricing-calculator",
                json=payload,
                headers=self._get_headers(),
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                credits = result.get("calculateProductionApiServiceCost", {}).get("cost", 0)
            else:
                logger.warning(
                    f"[Leonardo] Video pricing API returned {response.status_code}: {response.text}"
                )

        except Exception as e:
            logger.warning(f"[Leonardo] Failed to get video pricing: {e}")

        total_cost = credits * COST_PER_CREDIT_USD

        return CreditInfo(
            credits=credits,
            cost_per_credit=COST_PER_CREDIT_USD,
            total_cost_usd=round(total_cost, 4),
            num_images=1,
            credits_per_image=credits,
            cost_per_image_usd=round(total_cost, 4)
        )

    def get_metadata(self, action_type: str) -> Dict[str, Any]:
        """
        Get Leonardo model metadata for UI rendering.

        Args:
            action_type: "txt2img", "img2img", or "img2vid"

        Returns:
            Dict with all UI params for the specified action type.
        """
        if action_type == "img2vid":
            return self._get_img2vid_metadata()
        elif action_type in ("txt2img", "img2img"):
            return self._get_txt2img_metadata()
        else:
            return {}

    def _get_img2vid_metadata(self) -> Dict[str, Any]:
        """Get metadata for img2vid (video generation)."""
        return {
            # Video model options
            "models": [
                {"key": "MOTION2", "label": "Motion 2.0"},
                {"key": "MOTION2FAST", "label": "Motion 2.0 Fast"},
                {"key": "VEO3", "label": "VEO 3"},
                {"key": "VEO3FAST", "label": "VEO 3 Fast"},
                {"key": "KLING2_1", "label": "Kling 2.1"},
                {"key": "KLING2_5", "label": "Kling 2.5"},
            ],

            # Resolution options
            "resolution": [
                {"key": "RESOLUTION_480", "label": "480p"},
                {"key": "RESOLUTION_720", "label": "720p"},
                {"key": "RESOLUTION_1080", "label": "1080p"},
            ],

            # Duration options (for models that support variable duration)
            "duration": [
                {"key": "5", "label": "5 seconds"},
                {"key": "10", "label": "10 seconds"},
            ],

            # Frame interpolation
            "frame_interpolation": [
                {"key": "true", "label": "Enabled"},
                {"key": "false", "label": "Disabled"},
            ],
        }

    def _get_txt2img_metadata(self) -> Dict[str, Any]:
        """Get metadata for txt2img/img2img (image generation)."""
        # Common styles for Phoenix, Lucid, and Flux models
        phoenix_styles: List[Dict[str, str]] = [
            {"key": "556c1ee5-ec38-42e8-955a-1e82dad0ffa1", "label": "None"},
            {"key": "a5632c7c-ddbb-4e2f-ba34-8456ab3ac436", "label": "Cinematic"},
            {"key": "33abbb99-03b9-4dd7-9761-ee98650b2c88", "label": "Cinematic Concept"},
            {"key": "6fedbf1f-4a17-45ec-84fb-92fe524a29ef", "label": "Creative"},
            {"key": "111dc692-d470-4eec-b791-3475abac4c46", "label": "Dynamic"},
            {"key": "594c4a08-a522-4e0e-b7ff-e4dac4b6b622", "label": "Fashion"},
            {"key": "97c20e5c-1af6-4d42-b227-54d03d8f0727", "label": "HDR"},
            {"key": "645e4195-f63d-4715-a3f2-3fb1e6eb8c70", "label": "Illustration"},
            {"key": "9fdc5e8c-4d13-49b4-9ce6-5a74cbb19177", "label": "Bokeh"},
            {"key": "30c1d34f-e3a9-479a-b56f-c018bbc9c02a", "label": "Macro"},
            {"key": "cadc8cd6-7838-4c99-b645-df76be8ba8d8", "label": "Minimalist"},
            {"key": "621e1c9a-6319-4bee-a12d-ae40659162fa", "label": "Moody"},
            {"key": "8e2bc543-6ee2-45f9-bcd9-594b6ce84dcd", "label": "Portrait"},
            {"key": "0d34f8e1-46d4-428f-8ddd-4b11811fa7c9", "label": "Portrait Fashion"},
            {"key": "22a9a7d2-2166-4d86-80ff-22e2643adbcf", "label": "Pro B&W Photography"},
            {"key": "7c3f932b-a572-47cb-9b9b-f20211e63b5b", "label": "Pro Color Photography"},
            {"key": "581ba6d6-5aac-4492-bebe-54c424a0d46e", "label": "Pro Film Photography"},
            {"key": "debdf72a-91a4-467b-bf61-cc02bdeb69c6", "label": "3D Render"},
            {"key": "b504f83c-3326-4947-82e1-7fe9e839ec0f", "label": "Ray Traced"},
            {"key": "be8c6b58-739c-4d44-b9c1-b032ed308b61", "label": "Sketch (B&W)"},
            {"key": "093accc3-7633-4ffd-82da-d34000dfc0d6", "label": "Sketch (Color)"},
            {"key": "5bdc3f2a-1be6-4d1c-8e77-992a30824a2c", "label": "Stock Photo"},
            {"key": "dee282d3-891f-4f73-ba02-7f8131e5541b", "label": "Vibrant"},
            {"key": "2e74ec31-f3a4-4825-b08b-2894f6d13941", "label": "Graphic Design Pop Art"},
            {"key": "1fbb6a68-9319-44d2-8d56-2957ca0ece6a", "label": "Graphic Design Vector"},
        ]

        # Common presets for XL models
        xl_presets = [
            {"key": "NONE", "label": "None"},
            {"key": "BOKEH", "label": "Bokeh"},
            {"key": "CINEMATIC", "label": "Cinematic"},
            {"key": "CINEMATIC_CLOSEUP", "label": "Cinematic Closeup"},
            {"key": "CREATIVE", "label": "Creative"},
            {"key": "FASHION", "label": "Fashion"},
            {"key": "FILM", "label": "Film"},
            {"key": "FOOD", "label": "Food"},
            {"key": "HDR", "label": "HDR"},
            {"key": "LONG_EXPOSURE", "label": "Long Exposure"},
            {"key": "MACRO", "label": "Macro"},
        ]

        models = [
            # Phoenix models (with styles)
            {
                "key": "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3",
                "label": "Leonardo Phoenix 1.0",
                "styles": phoenix_styles,
            },
            {
                "key": "6b645e3a-d64f-4341-a6d8-7a3690fbf042",
                "label": "Leonardo Phoenix 0.9",
                "styles": phoenix_styles,
            },
            # Lucid models (with styles)
            {
                "key": "7b592283-e8a7-4c5a-9ba6-d18c31f258b9",
                "label": "Lucid Origin",
                "styles": phoenix_styles,
            },
            {
                "key": "05ce0082-2d80-4a2d-8653-4d1c85e2418e",
                "label": "Lucid Realism",
                "styles": phoenix_styles,
            },
            # Flux models (with styles)
            {
                "key": "b2614463-296c-462a-9586-aafdb8f00e36",
                "label": "Flux Dev",
                "styles": phoenix_styles,
            },
            {
                "key": "1dd50843-d653-4516-a8e3-f0238ee453ff",
                "label": "Flux Schnell",
                "styles": phoenix_styles,
            },
            {
                "key": "28aeddf8-bd19-4803-80fc-79602d1a9989",
                "label": "FLUX.1 Kontext",
                "styles": phoenix_styles,
            },
            # XL models (with presets)
            {
                "key": "e71a1c2f-4f80-4800-934f-2c68979d8cc8",
                "label": "Leonardo Anime XL",
                "presets": xl_presets,
            },
            {
                "key": "b24e16ff-06e3-43eb-8d33-4416c2d75876",
                "label": "Leonardo Lightning XL",
                "presets": xl_presets,
            },
            {
                "key": "aa77f04e-3eec-4034-9c07-d0f619684628",
                "label": "Leonardo Kino XL",
                "presets": xl_presets,
            },
            {
                "key": "5c232a9e-9061-4777-980a-ddc8e65647c6",
                "label": "Leonardo Vision XL",
                "presets": xl_presets,
            },
            {
                "key": "1e60896f-3c26-4296-8ecc-53e2afecc132",
                "label": "Leonardo Diffusion XL",
                "presets": xl_presets,
            },
            {
                "key": "16e7060a-803e-4df3-97ee-edcfa5dc9cc8",
                "label": "SDXL 1.0",
                "presets": xl_presets,
            },
            {
                "key": "b63f7119-31dc-4540-969b-2a9df997e173",
                "label": "SDXL 0.9",
                "presets": xl_presets,
            },
            {
                "key": "2067ae52-33fd-4a82-bb92-c2c55e7d2786",
                "label": "AlbedoBase XL",
                "presets": xl_presets,
            },
            {
                "key": "f1929ea3-b169-4c18-a16c-5d58b4292c69",
                "label": "RPG v5",
                "presets": xl_presets,
            },
            {
                "key": "d69c8273-6b17-4a30-a13e-d6637ae1c644",
                "label": "3D Animation Style",
                "presets": xl_presets,
            },
            {
                "key": "ac614f96-1082-45bf-be9d-757f2d31c17",
                "label": "DreamShaper v7",
                "presets": xl_presets,
            },
        ]

        return {
            # Models with nested styles/presets for cascading selection
            "models": models,

            # Aspect ratio options
            "aspect_ratio": [
                {"key": "1:1", "label": "1:1 (Square)"},
                {"key": "16:9", "label": "16:9 (Landscape)"},
                {"key": "9:16", "label": "9:16 (Portrait)"},
                {"key": "4:3", "label": "4:3"},
                {"key": "3:4", "label": "3:4"},
                {"key": "3:2", "label": "3:2"},
                {"key": "2:3", "label": "2:3"},
            ],

            # Size tier options
            "size": [
                {"key": "small", "label": "Small (Fast)"},
                {"key": "medium", "label": "Medium"},
                {"key": "large", "label": "Large"},
            ],

            # Generation mode options
            "generation_mode": [
                {"key": "fast", "label": "Fast"},
                {"key": "quality", "label": "Quality (~1.5x)"},
                {"key": "ultra", "label": "Ultra (~2x)"},
            ],

            # Number of images options
            "num_images": [
                {"key": "1", "label": "1"},
                {"key": "2", "label": "2"},
                {"key": "4", "label": "4"},
            ],

            # Contrast level options (for Phoenix/Flux models)
            "contrast": [
                {"key": "1.0", "label": "1.0 (Low)"},
                {"key": "1.3", "label": "1.3"},
                {"key": "1.8", "label": "1.8"},
                {"key": "2.5", "label": "2.5"},
                {"key": "3.0", "label": "3.0 (Default)"},
                {"key": "3.5", "label": "3.5"},
                {"key": "4.0", "label": "4.0"},
                {"key": "4.5", "label": "4.5 (High)"},
            ],

            # Scheduler options
            "scheduler": [
                {"key": "EULER_DISCRETE", "label": "Euler Discrete"},
                {"key": "EULER_ANCESTRAL_DISCRETE", "label": "Euler Ancestral"},
                {"key": "LEONARDO", "label": "Leonardo"},
                {"key": "DPM_SOLVER", "label": "DPM Solver"},
                {"key": "DDIM", "label": "DDIM"},
                {"key": "KLMS", "label": "KLMS"},
                {"key": "PNDM", "label": "PNDM"},
            ],

            # Slider params (min, max, default, step)
            "guidance_scale": {
                "min": 1,
                "max": 20,
                "default": 7,
                "step": 1,
            },

            "num_inference_steps": {
                "min": 10,
                "max": 60,
                "default": 15,
                "step": 1,
            },
        }

    def _calculate_image_credits(self, params: Dict[str, Any]) -> CreditInfo:
        """Calculate image generation credits using Leonardo pricing API."""
        credits = 0.0
        num_images = params.get("num_images", 4)
        if isinstance(num_images, str):
            num_images = int(num_images)

        try:
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

            generation_mode = params.get("generation_mode", "fast")

            inference_steps = params.get("num_inference_steps", 15)
            if isinstance(inference_steps, str):
                inference_steps = int(inference_steps)

            prompt_magic = params.get("prompt_magic", False)
            if isinstance(prompt_magic, str):
                prompt_magic = prompt_magic.lower() == "true"
            prompt_magic_strength = params.get("prompt_magic_strength", 0.3)
            if isinstance(prompt_magic_strength, str):
                prompt_magic_strength = float(prompt_magic_strength)
            prompt_magic_version = params.get("prompt_magic_version", "v3")

            is_alchemy = generation_mode in ("quality", "ultra")
            is_ultra = generation_mode == "ultra"

            model_id = params.get("model_id", "")
            is_phoenix = model_id in PHOENIX_MODEL_IDS
            is_sdxl = model_id in SDXL_MODEL_IDS

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

            if prompt_magic:
                service_params["promptMagicStrength"] = prompt_magic_strength
                service_params["promptMagicVersion"] = prompt_magic_version

            payload: Dict[str, Any] = {
                "service": "IMAGE_GENERATION",
                "serviceParams": {
                    "IMAGE_GENERATION": service_params
                }
            }

            response = requests.post(
                f"{LEONARDO_BASE_URL}/pricing-calculator",
                json=payload,
                headers=self._get_headers(),
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
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

    def get_data_schema(self, action_type: str) -> Dict[str, Any]:
        return self.__class__.get_data_schema_for_action(action_type)

    @classmethod
    def get_data_schema_for_action(cls, action_type: str) -> Dict[str, Any]:
        if action_type == "txt2img":
            return {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "Leonardo Phoenix optimized prompt",
                    },
                    "style_notes": {
                        "type": "string",
                        "description": "Brief note on the style/quality targeted",
                    },
                },
                "required": ["prompt", "style_notes"],
                "additionalProperties": False,
            }

        if action_type == "img2vid":
            return {
                "type": "object",
                "properties": {
                    "positive_prompt": {
                        "type": "string",
                        "description": "Main motion prompt describing what should happen",
                    },
                    "negative_prompt": {
                        "type": "string",
                        "description": "Artifacts and unwanted elements to avoid",
                    },
                    "motion_strength": {
                        "type": "string",
                        "enum": ["subtle", "moderate", "dynamic"],
                        "description": "Recommended motion intensity level",
                    },
                    "motion_notes": {
                        "type": "string",
                        "description": "Brief notes on motion emphasis",
                    },
                },
                "required": [
                    "positive_prompt",
                    "negative_prompt",
                    "motion_strength",
                    "motion_notes",
                ],
                "additionalProperties": False,
            }

        return {}
