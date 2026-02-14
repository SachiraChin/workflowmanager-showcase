"""
Stable Diffusion Provider - Local SD WebUI Forge image generation via Remote API.

This provider connects to a locally running Stable Diffusion WebUI Forge instance
with the sd-webui-forge-remote-api extension installed.

Supported operations:
- txt2img: Text-to-image generation
- img2img: Image-to-image generation with init image
- img2vid: Not supported (raises NotImplementedError)

API Documentation: See sd-webui-forge-remote-api extension README.
"""

import os
import time
import base64
import logging
import requests
import threading
from typing import Any, Dict, Optional

from ..base import (
    MediaProviderBase,
    ContentItem,
    GenerationResult,
    ProgressCallback,
    GenerationError,
    TimeoutError,
    ResolutionInfo,
    CreditInfo,
    PreviewInfo,
)
from ..registry import register

logger = logging.getLogger(__name__)

# API Configuration
POLL_INTERVAL_SECONDS = 2
MAX_POLL_TIMEOUT_SECONDS = 600  # 10 minutes (local generation can be slow)
MAX_POLL_ATTEMPTS = MAX_POLL_TIMEOUT_SECONDS // POLL_INTERVAL_SECONDS


@register("stable_diffusion", concurrency=1)
class StableDiffusionProvider(MediaProviderBase):
    """
    Stable Diffusion provider via local WebUI Forge Remote API.

    Requires SD_FORGE_API_URL environment variable for base URL.
    Example: SD_FORGE_API_URL=http://192.168.1.100:7860

    No authentication required (local API).
    """

    # Thread-safe metadata cache (class-level, shared across instances)
    _metadata_cache_lock = threading.Lock()
    _metadata_cache: Optional[Dict[str, Any]] = None
    _metadata_cache_timestamp: float = 0.0
    _category_enforcement_data: Dict[str, Dict[str, str]] = {}
    _METADATA_CACHE_TTL_SECONDS = 15 * 60  # 15 minutes

    def __init__(self):
        self.base_url = os.environ.get("SD_FORGE_API_URL")
        if not self.base_url:
            raise GenerationError("SD_FORGE_API_URL environment variable is required for Stable Diffusion provider")
        self.base_url = self.base_url.rstrip("/")
        self.api_url = f"{self.base_url}/wm-api"

    @property
    def provider_id(self) -> str:
        return "stable_diffusion"

    def _handle_response_error(self, response: requests.Response) -> None:
        """Handle HTTP error responses from Forge API."""
        if response.status_code >= 400:
            try:
                error_data = response.json()
                error_msg = error_data.get("error", response.text)
            except Exception:
                error_msg = response.text

            raise GenerationError(f"API error ({response.status_code}): {error_msg}")

    def _poll_for_result(
        self,
        task_id: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> Dict[str, Any]:
        """
        Poll for generation result until complete or timeout.

        Args:
            task_id: Forge task ID to poll
            progress_callback: Optional callback for progress updates

        Returns:
            Complete task result data

        Raises:
            TimeoutError: If polling exceeds MAX_POLL_TIMEOUT_SECONDS
            GenerationError: If generation fails
        """
        start_time = time.time()
        poll_count = 0

        while poll_count < MAX_POLL_ATTEMPTS:
            elapsed_ms = int((time.time() - start_time) * 1000)

            # Make status request
            try:
                response = requests.get(
                    f"{self.api_url}/task/{task_id}",
                    timeout=30
                )
            except requests.RequestException as e:
                raise GenerationError(f"Failed to poll task status: {e}")

            self._handle_response_error(response)
            result = response.json()

            if not result.get("success"):
                raise GenerationError(f"Task polling failed: {result.get('error')}")

            task = result.get("task", {})
            status = task.get("status")
            progress = task.get("progress", 0)

            # Call progress callback
            if progress_callback:
                progress_callback(
                    elapsed_ms,
                    f"Generating... {progress}% ({poll_count * POLL_INTERVAL_SECONDS}s)"
                )

            if status == "completed":
                if progress_callback:
                    progress_callback(elapsed_ms, "Complete!")
                return task
            elif status == "failed":
                error_msg = task.get("error") or "Generation failed"
                raise GenerationError(error_msg)
            elif status == "cancelled":
                raise GenerationError("Generation was cancelled")
            # else: pending or running, continue polling

            time.sleep(POLL_INTERVAL_SECONDS)
            poll_count += 1

        # Timeout
        raise TimeoutError(
            f"Generation timed out after {MAX_POLL_TIMEOUT_SECONDS} seconds"
        )

    def _build_image_url(self, image_id: str) -> str:
        """Build full URL for downloading an image."""
        return f"{self.api_url}/image/{image_id}"

    def _parse_sampler_combo(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse sampler_combo object and extract individual settings.

        sampler_combo format: {steps, sampler, scheduler, cfg_scale}
        Returns dict with extracted values to merge into params.
        """
        sampler_combo = params.get("sampler_combo")
        if not sampler_combo:
            return {}

        # Handle both dict and JSON string
        if isinstance(sampler_combo, str):
            try:
                import json
                sampler_combo = json.loads(sampler_combo)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"[StableDiffusion] Invalid sampler_combo string: {sampler_combo}")
                return {}

        if not isinstance(sampler_combo, dict):
            return {}

        extracted = {}
        if "steps" in sampler_combo:
            extracted["steps"] = int(sampler_combo["steps"])
        if "sampler" in sampler_combo:
            extracted["sampler_name"] = sampler_combo["sampler"]
        if "scheduler" in sampler_combo:
            extracted["scheduler"] = sampler_combo["scheduler"]
        if "cfg_scale" in sampler_combo:
            extracted["cfg_scale"] = float(sampler_combo["cfg_scale"])

        return extracted

    def _parse_resolution(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse resolution and extract width/height.

        Supports two formats:
        1. String format: "1024x1024" or "832x1216" (legacy)
        2. Object format: { "text": "1024x1024", "width": 1024, "height": 1024 } (new)

        Returns dict with width and height.
        """
        resolution = params.get("resolution")
        if not resolution:
            return {}

        # Handle object format: { text: "...", width: N, height: N }
        if isinstance(resolution, dict):
            width = resolution.get("width")
            height = resolution.get("height")
            if width is not None and height is not None:
                return {
                    "width": int(width),
                    "height": int(height),
                }
            # Fallback to parsing text field if width/height not present
            resolution = resolution.get("text", "")

        # Handle string format: "1024x1024"
        if not isinstance(resolution, str):
            return {}

        try:
            parts = resolution.lower().split("x")
            if len(parts) == 2:
                return {
                    "width": int(parts[0]),
                    "height": int(parts[1]),
                }
        except (ValueError, IndexError):
            logger.warning(f"[StableDiffusion] Invalid resolution format: {resolution}")

        return {}

    def _parse_vae(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse vae parameter.

        vae format from UI: array like ["sdxlVAE_sdxlVAE"]
        API expects: "vae": ["sdxlVAE_sdxlVAE"]
        """
        vae = params.get("vae")
        if not vae:
            return {}

        # Handle JSON string (from UI)
        if isinstance(vae, str):
            try:
                import json
                vae = json.loads(vae)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"[StableDiffusion] Invalid vae string: {vae}")
                return {}

        # If it's an array, pass it through
        if isinstance(vae, list):
            return {"vae": vae}

        return {}

    def _parse_hires(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse hires parameter and convert to hires_fix format.

        hires format from UI: {"upscaler": "...", "upscale": 1.5, "steps": 10, "denoising": 0.4}
        API expects: {"hires_fix": {"enable": true, ...all other fields}}

        Note: Values may come as strings from extracted params, so we convert types.
        """
        hires = params.get("hires")
        if not hires:
            return {}

        # Handle JSON string (from UI)
        if isinstance(hires, str):
            try:
                import json
                hires = json.loads(hires)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"[StableDiffusion] Invalid hires string: {hires}")
                return {}

        if not isinstance(hires, dict):
            return {}

        # Build hires_fix with proper types (values may be strings from extracted data)
        hires_fix: Dict[str, Any] = {"enable": True}

        if "upscaler" in hires:
            hires_fix["upscaler"] = hires["upscaler"]

        if "upscale" in hires and hires["upscale"] is not None:
            hires_fix["upscale"] = float(hires["upscale"])

        if "steps" in hires and hires["steps"] is not None:
            hires_fix["steps"] = int(hires["steps"])

        if "denoising" in hires and hires["denoising"] is not None:
            hires_fix["denoising"] = float(hires["denoising"])

        return {"hires_fix": hires_fix}

    def _parse_adetailer(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parse adetailer parameter and convert to API format.

        adetailer format from UI: {"model": "...", "confidence": 0.3, "denoising_strength": 0.4, ...}
        API expects: "adetailer": [{"model": "...", ...}]  (array of configs)

        Note: Values may come as strings from extracted params, so we convert types.
        """
        adetailer = params.get("adetailer")
        if not adetailer:
            return {}

        # Handle JSON string (from UI)
        if isinstance(adetailer, str):
            try:
                import json
                adetailer = json.loads(adetailer)
            except (json.JSONDecodeError, TypeError):
                logger.warning(f"[StableDiffusion] Invalid adetailer string: {adetailer}")
                return {}

        def convert_adetailer_config(config: Dict[str, Any]) -> Dict[str, Any]:
            """Convert adetailer config values to proper types."""
            result: Dict[str, Any] = {}
            if "model" in config:
                result["model"] = config["model"]
            if "confidence" in config and config["confidence"] is not None:
                result["confidence"] = float(config["confidence"])
            if "denoising_strength" in config and config["denoising_strength"] is not None:
                result["denoising_strength"] = float(config["denoising_strength"])
            if "dilate_erode" in config and config["dilate_erode"] is not None:
                result["dilate_erode"] = int(config["dilate_erode"])
            if "mask_blur" in config and config["mask_blur"] is not None:
                result["mask_blur"] = int(config["mask_blur"])
            if "inpaint_only_masked" in config:
                result["inpaint_only_masked"] = bool(config["inpaint_only_masked"])
            if "inpaint_padding" in config and config["inpaint_padding"] is not None:
                result["inpaint_padding"] = int(config["inpaint_padding"])
            return result

        # If already an array, convert each config
        if isinstance(adetailer, list):
            return {"adetailer": [convert_adetailer_config(c) for c in adetailer if isinstance(c, dict)]}

        # If a single dict, convert and wrap in array
        if isinstance(adetailer, dict):
            return {"adetailer": [convert_adetailer_config(adetailer)]}

        return {}

    def txt2img(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate images from a text prompt using Stable Diffusion.

        Args:
            prompt: Text description of desired image
            params: Generation parameters:
                - negative_prompt: str
                - width: int (default 512)
                - height: int (default 512)
                - steps: int (default 20)
                - cfg_scale: float (default 7.0)
                - sampler_name: str (default "Euler")
                - scheduler: str (default "automatic")
                - batch_size: int (default 1)
                - batch_count: int (default 1)
                - seed: int (default -1 for random)
                - checkpoint: str (model to use)
                - restore_faces: bool
                - tiling: bool
                - hires_fix: dict (enable, upscaler, steps, denoising_strength, upscale_by)
                - adetailer: dict or list (model, confidence, denoising_strength, etc.) - parsed automatically
                - sampler_combo: dict (steps, sampler, scheduler, cfg_scale) - parsed automatically
                - resolution: str or dict - "WxH" string or {"text": "WxH", "width": N, "height": N}
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with image URLs
        """
        # Parse composite parameters first
        sampler_settings = self._parse_sampler_combo(params)
        resolution_settings = self._parse_resolution(params)
        vae_settings = self._parse_vae(params)
        hires_settings = self._parse_hires(params)
        adetailer_settings = self._parse_adetailer(params)

        # Merge parsed settings (explicit params override parsed ones)
        effective_params = {**sampler_settings, **resolution_settings, **vae_settings, **hires_settings, **adetailer_settings, **params}

        # Build request payload
        payload: Dict[str, Any] = {
            "prompt": prompt,
        }

        # Map parameters
        if "negative_prompt" in effective_params:
            payload["negative_prompt"] = effective_params["negative_prompt"]

        # Dimensions (from resolution or explicit)
        payload["width"] = effective_params.get("width", 512)
        payload["height"] = effective_params.get("height", 512)

        # Generation settings (from sampler_combo or explicit)
        if "steps" in effective_params:
            payload["steps"] = effective_params["steps"]
        if "cfg_scale" in effective_params:
            payload["cfg_scale"] = effective_params["cfg_scale"]
        if "sampler_name" in effective_params:
            payload["sampler_name"] = effective_params["sampler_name"]
        if "scheduler" in effective_params:
            payload["scheduler"] = effective_params["scheduler"]

        # Batch settings
        if "batch_size" in effective_params:
            payload["batch_size"] = effective_params["batch_size"]
        if "batch_count" in effective_params:
            payload["batch_count"] = effective_params["batch_count"]

        # Seed
        if "seed" in effective_params:
            payload["seed"] = effective_params["seed"]

        # Model
        if "checkpoint" in effective_params:
            payload["checkpoint"] = effective_params["checkpoint"]

        # VAE
        if "vae" in effective_params and effective_params["vae"]:
            payload["vae"] = effective_params["vae"]

        # Optional features
        if "restore_faces" in effective_params:
            payload["restore_faces"] = effective_params["restore_faces"]
        if "tiling" in effective_params:
            payload["tiling"] = effective_params["tiling"]

        # Hires fix
        if "hires_fix" in effective_params and effective_params["hires_fix"]:
            payload["hires_fix"] = effective_params["hires_fix"]

        # ADetailer
        if "adetailer" in effective_params and effective_params["adetailer"]:
            payload["adetailer"] = effective_params["adetailer"]

        logger.info(
            f"[StableDiffusion] Starting txt2img: "
            f"{payload.get('width')}x{payload.get('height')}, "
            f"steps={payload.get('steps', 20)}"
        )

        # Make generation request
        try:
            response = requests.post(
                f"{self.api_url}/txt2img",
                json=payload,
                timeout=30
            )
        except requests.RequestException as e:
            raise GenerationError(f"Failed to submit generation: {e}")

        self._handle_response_error(response)
        result = response.json()

        if not result.get("success"):
            raise GenerationError(f"Generation request failed: {result.get('error')}")

        task_id = result.get("task_id")
        if not task_id:
            raise GenerationError("No task ID returned from API")

        logger.info(f"[StableDiffusion] Task created: {task_id}")

        # Poll for result
        task_result = self._poll_for_result(task_id, progress_callback)

        # Extract content items with seeds
        # Stable Diffusion provides seeds array that matches 1:1 with images
        result_data = task_result.get("result", {})
        image_ids = result_data.get("images", [])
        seeds = result_data.get("seeds", [])

        content = []
        for i, img_id in enumerate(image_ids):
            seed = seeds[i] if i < len(seeds) else -1
            content.append(ContentItem(url=self._build_image_url(img_id), seed=seed))

        logger.info(f"[StableDiffusion] Generation complete: {len(content)} images")

        return GenerationResult(
            content=content,
            raw_response=task_result,
            provider_task_id=task_id
        )

    def img2img(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate images from an existing image using Stable Diffusion.

        Args:
            source_image: URL or file path of source image
            prompt: Text description to guide the transformation
            params: Generation parameters:
                - denoising_strength: float (default 0.75)
                - mask_image: str (base64 or URL for inpainting)
                - resize_mode: int (0=resize, 1=crop, 2=fill, 3=latent upscale)
                - Plus all txt2img parameters
                - adetailer: dict or list (model, confidence, denoising_strength, etc.) - parsed automatically
                - sampler_combo: dict (steps, sampler, scheduler, cfg_scale) - parsed automatically
                - resolution: str or dict - "WxH" string or {"text": "WxH", "width": N, "height": N}
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with image URLs
        """
        # Parse composite parameters first
        sampler_settings = self._parse_sampler_combo(params)
        resolution_settings = self._parse_resolution(params)
        vae_settings = self._parse_vae(params)
        hires_settings = self._parse_hires(params)
        adetailer_settings = self._parse_adetailer(params)

        # Merge parsed settings (explicit params override parsed ones)
        effective_params = {**sampler_settings, **resolution_settings, **vae_settings, **hires_settings, **adetailer_settings, **params}

        # Get init image as base64
        init_image_b64 = self._get_image_as_base64(source_image)

        # Build request payload
        payload: Dict[str, Any] = {
            "prompt": prompt,
            "init_image": init_image_b64,
        }

        # Map parameters
        if "negative_prompt" in effective_params:
            payload["negative_prompt"] = effective_params["negative_prompt"]

        # Denoising strength (key parameter for img2img)
        payload["denoising_strength"] = effective_params.get("denoising_strength", 0.75)

        # Mask for inpainting
        if "mask_image" in effective_params and effective_params["mask_image"]:
            mask_b64 = self._get_image_as_base64(effective_params["mask_image"])
            payload["mask_image"] = mask_b64

        # Resize mode
        if "resize_mode" in effective_params:
            payload["resize_mode"] = effective_params["resize_mode"]

        # Dimensions (from resolution or explicit)
        payload["width"] = effective_params.get("width", 512)
        payload["height"] = effective_params.get("height", 512)

        # Generation settings (from sampler_combo or explicit)
        if "steps" in effective_params:
            payload["steps"] = effective_params["steps"]
        if "cfg_scale" in effective_params:
            payload["cfg_scale"] = effective_params["cfg_scale"]
        if "sampler_name" in effective_params:
            payload["sampler_name"] = effective_params["sampler_name"]
        if "scheduler" in effective_params:
            payload["scheduler"] = effective_params["scheduler"]

        # Batch settings
        if "batch_size" in effective_params:
            payload["batch_size"] = effective_params["batch_size"]
        if "batch_count" in effective_params:
            payload["batch_count"] = effective_params["batch_count"]

        # Seed
        if "seed" in effective_params:
            payload["seed"] = effective_params["seed"]

        # Model
        if "checkpoint" in effective_params:
            payload["checkpoint"] = effective_params["checkpoint"]

        # VAE
        if "vae" in effective_params and effective_params["vae"]:
            payload["vae"] = effective_params["vae"]

        # ADetailer
        if "adetailer" in effective_params and effective_params["adetailer"]:
            payload["adetailer"] = effective_params["adetailer"]

        logger.info(
            f"[StableDiffusion] Starting img2img: "
            f"{payload.get('width')}x{payload.get('height')}, "
            f"denoising={payload.get('denoising_strength')}"
        )

        # Make generation request
        try:
            response = requests.post(
                f"{self.api_url}/img2img",
                json=payload,
                timeout=30
            )
        except requests.RequestException as e:
            raise GenerationError(f"Failed to submit generation: {e}")

        self._handle_response_error(response)
        result = response.json()

        if not result.get("success"):
            raise GenerationError(f"Generation request failed: {result.get('error')}")

        task_id = result.get("task_id")
        if not task_id:
            raise GenerationError("No task ID returned from API")

        logger.info(f"[StableDiffusion] img2img task created: {task_id}")

        # Poll for result
        task_result = self._poll_for_result(task_id, progress_callback)

        # Extract content items with seeds
        # Stable Diffusion provides seeds array that matches 1:1 with images
        result_data = task_result.get("result", {})
        image_ids = result_data.get("images", [])
        seeds = result_data.get("seeds", [])

        content = []
        for i, img_id in enumerate(image_ids):
            seed = seeds[i] if i < len(seeds) else -1
            content.append(ContentItem(url=self._build_image_url(img_id), seed=seed))

        logger.info(f"[StableDiffusion] img2img complete: {len(content)} images")

        return GenerationResult(
            content=content,
            raw_response=task_result,
            provider_task_id=task_id
        )

    def _get_image_as_base64(self, source: str) -> str:
        """
        Get image as base64 string from URL or file path.

        Args:
            source: URL or local file path

        Returns:
            Base64 encoded image string
        """
        # Check if already base64
        if source.startswith("data:image"):
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
            raise GenerationError(f"Invalid source image: {source}")

        # Encode to base64
        return base64.b64encode(image_data).decode("utf-8")

    def img2vid(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Not supported by Stable Diffusion WebUI Forge Remote API.

        Raises:
            NotImplementedError: Always
        """
        raise NotImplementedError(
            "Stable Diffusion WebUI Forge does not support image-to-video generation. "
            "Use a video-capable provider like Leonardo."
        )

    def txt2audio(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """Audio generation not supported by Stable Diffusion."""
        raise NotImplementedError(
            "Stable Diffusion does not support audio generation"
        )

    def get_metadata(self, action_type: str) -> Dict[str, Any]:
        """
        Get Stable Diffusion model metadata from the local WebUI Forge API.

        Fetches model categories with nested checkpoints and their params
        (sampler_combo, resolution, vae, hires, adetailer options).

        Results are cached for 15 minutes to avoid repeated API calls.
        Also builds category_enforcement_data for prompt enforcement.

        Args:
            action_type: "txt2img" or "img2img" (both supported, same params)

        Returns:
            Dict with "categories" key containing the model hierarchy.
            Returns empty dict if API call fails or action not supported.
        """
        # SD only supports txt2img and img2img
        if action_type not in ("txt2img", "img2img"):
            return {}

        current_time = time.time()

        # Check cache validity under lock
        with StableDiffusionProvider._metadata_cache_lock:
            cache_age = current_time - StableDiffusionProvider._metadata_cache_timestamp
            if (StableDiffusionProvider._metadata_cache is not None and
                    cache_age < StableDiffusionProvider._METADATA_CACHE_TTL_SECONDS):
                logger.debug(
                    f"[StableDiffusion] Returning cached metadata "
                    f"(age: {cache_age:.1f}s)"
                )
                return StableDiffusionProvider._metadata_cache

        # Cache miss or expired - fetch from API (outside lock to avoid blocking)
        try:
            response = requests.get(
                f"{self.api_url}/models/by_category",
                timeout=30
            )
            response.raise_for_status()
            data = response.json()

            # Extract categories from response
            categories = data.get("categories", [])
            result = {"categories": categories}

            # Build category enforcement data
            enforcement_data: Dict[str, Dict[str, str]] = {}
            for category in categories:
                category_id = category.get("id")
                if category_id:
                    enforcement_data[category_id] = {
                        "positive_prompt_enforcement": category.get(
                            "positive_prompt_enforcement", ""
                        ),
                        "negative_prompt_enforcement": category.get(
                            "negative_prompt_enforcement", ""
                        ),
                    }

            # Update cache under lock
            with StableDiffusionProvider._metadata_cache_lock:
                StableDiffusionProvider._metadata_cache = result
                StableDiffusionProvider._metadata_cache_timestamp = current_time
                StableDiffusionProvider._category_enforcement_data = enforcement_data

            logger.info(
                f"[StableDiffusion] Cached metadata with "
                f"{len(enforcement_data)} categories"
            )
            return result

        except requests.RequestException as e:
            logger.warning(f"[StableDiffusion] Failed to fetch model metadata: {e}")
            return {}
        except Exception as e:
            logger.warning(f"[StableDiffusion] Error parsing model metadata: {e}")
            return {}

    def format_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Apply prompt selection and category-specific enforcement.

        First selects the correct prompt based on prompt_type:
        - "tag": Uses tag_prompt field
        - "natural": Uses natural_prompt field
        - If neither, uses existing prompt field

        Then applies category-specific enforcement:
        - Prepends positive_prompt_enforcement to prompt
        - Appends negative_prompt_enforcement to negative_prompt

        Args:
            params: Generation parameters dict containing:
                - prompt_type: "tag" or "natural" for prompt selection
                - tag_prompt: Tag-based prompt text
                - natural_prompt: Natural language prompt text
                - category: Category ID for enforcement lookup
                - negative_prompt: User's negative prompt text

        Returns:
            Modified params dict with prompt selected and enforcement applied.
        """
        # Create a copy to avoid mutating the original
        result = params.copy()

        # Step 1: Select prompt based on prompt_type
        prompt_type = result.get("prompt_type")
        if prompt_type == "tag" and "tag_prompt" in result:
            result["prompt"] = result["tag_prompt"]
            logger.debug("[StableDiffusion] Using tag_prompt as prompt")
        elif prompt_type == "natural" and "natural_prompt" in result:
            result["prompt"] = result["natural_prompt"]
            logger.debug("[StableDiffusion] Using natural_prompt as prompt")
        # else: keep existing prompt (if any)

        # Step 2: Apply category enforcement
        category = result.get("category")
        if not category:
            return result

        # Get enforcement data (thread-safe read)
        with StableDiffusionProvider._metadata_cache_lock:
            enforcement = StableDiffusionProvider._category_enforcement_data.get(
                category
            )

        if not enforcement:
            logger.debug(
                f"[StableDiffusion] No enforcement data for category: {category}"
            )
            return result

        # Apply positive prompt enforcement (prepend)
        positive_enforcement = enforcement.get("positive_prompt_enforcement", "")
        if positive_enforcement:
            current_prompt = result.get("prompt", "")
            result["prompt"] = f"{positive_enforcement},{current_prompt}"
            logger.debug(
                f"[StableDiffusion] Applied positive enforcement for {category}"
            )

        # Apply negative prompt enforcement (append)
        negative_enforcement = enforcement.get("negative_prompt_enforcement", "")
        if negative_enforcement:
            current_negative = result.get("negative_prompt", "")
            result["negative_prompt"] = f"{current_negative},{negative_enforcement}"
            logger.debug(
                f"[StableDiffusion] Applied negative enforcement for {category}"
            )

        return result

    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information for a Stable Diffusion generation configuration.

        Since this is a local provider, credits are always 0.

        Args:
            action_type: "txt2img" or "img2img"
            params: Generation parameters

        Returns:
            PreviewInfo with resolution and zero credits
        """
        logger.debug(f"[StableDiffusion] get_preview_info params: {params}")

        # Parse resolution string if provided
        resolution_settings = self._parse_resolution(params)

        # Calculate resolution from params (resolution string takes precedence)
        width = resolution_settings.get("width") or params.get("width", 512)
        height = resolution_settings.get("height") or params.get("height", 512)

        # Parse hires parameter from dropdown if provided
        hires_settings = self._parse_hires(params)
        hires_fix = hires_settings.get("hires_fix") or params.get("hires_fix", {})
        logger.debug(f"[StableDiffusion] hires_settings={hires_settings}, hires_fix={hires_fix}")

        # Apply hires fix if enabled
        if hires_fix and hires_fix.get("enable"):
            # Support both "upscale" (new format) and "upscale_by" (legacy format)
            # Convert to float since values may come as strings from extracted params
            upscale_raw = hires_fix.get("upscale") or hires_fix.get("upscale_by") or 1.0
            upscale_by = float(upscale_raw) if upscale_raw else 1.0
            width = int(width * upscale_by)
            height = int(height * upscale_by)

        megapixels = round((width * height) / 1_000_000, 2)
        logger.debug(f"[StableDiffusion] preview resolution: {width}x{height} ({megapixels}MP)")

        resolution = ResolutionInfo(
            width=width,
            height=height,
            megapixels=megapixels
        )

        # Calculate number of images
        batch_size = params.get("batch_size", 1)
        batch_count = params.get("batch_count", 1)
        num_images = batch_size * batch_count

        # Local provider - no credits
        credits = CreditInfo(
            credits=0,
            cost_per_credit=0,
            total_cost_usd=0,
            num_images=num_images,
            credits_per_image=0,
            cost_per_image_usd=0
        )

        return PreviewInfo(resolution=resolution, credits=credits)

    def get_data_schema(self, action_type: str) -> Dict[str, Any]:
        return self.__class__.get_data_schema_for_action(action_type)

    @classmethod
    def get_data_schema_for_action(cls, action_type: str) -> Dict[str, Any]:
        if action_type != "txt2img":
            return {}

        return {
            "type": "object",
            "properties": {
                "tag_prompt": {
                    "type": "string",
                    "description": "Token-based SD prompt with comma-separated keywords and optional weights",
                },
                "natural_prompt": {
                    "type": "string",
                    "description": "Natural language SD prompt with flowing descriptive sentences",
                },
                "negative_prompt": {
                    "type": "string",
                    "description": "Token-based negative prompt to avoid artifacts and quality problems",
                },
                "style_notes": {
                    "type": "string",
                    "description": "Brief note on the visual style and quality targeted",
                },
            },
            "required": [
                "tag_prompt",
                "natural_prompt",
                "negative_prompt",
                "style_notes",
            ],
            "additionalProperties": False,
        }
