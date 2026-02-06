"""
MidAPI Provider - MidJourney image generation via MidAPI service

MidAPI provides access to MidJourney's image generation capabilities.
API Documentation: https://docs.midapi.ai/

Supported operations:
- txt2img: Text-to-image generation
- vary: Create variations of existing MidJourney images
- img2vid: Generate video from MidJourney image (mj_video)

Note: img2img is not currently supported. MidAPI's vary feature
works only with images generated through MidAPI.
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
import math

logger = logging.getLogger(__name__)

# API Configuration
MIDAPI_BASE_URL = "https://api.midapi.ai/api/v1/mj"
POLL_INTERVAL_SECONDS = 2
MAX_POLL_TIMEOUT_SECONDS = 300  # 5 minutes
MAX_POLL_ATTEMPTS = MAX_POLL_TIMEOUT_SECONDS // POLL_INTERVAL_SECONDS

# MidJourney base resolution is approximately 1 megapixel (1024x1024 for 1:1)
# For other aspect ratios, total pixels stays around 1MP
BASE_MEGAPIXELS = 1.0  # ~1,048,576 pixels
BASE_PIXELS = 1_048_576

# Credit costs by (task_type, speed) combination
# Values are placeholders - update with actual costs
CREDIT_COSTS = {
    # txt2img
    ("mj_txt2img", "relaxed"): 3,
    ("mj_txt2img", "fast"): 8,
    ("mj_txt2img", "turbo"): 16,
    # video
    ("mj_video", "relaxed"): 15,
    ("mj_video", "fast"): 30,
    ("mj_video", "turbo"): 60,
    # video HD
    ("mj_video_hd", "relaxed"): 45,
    ("mj_video_hd", "fast"): 90,
    ("mj_video_hd", "turbo"): 180,
}

# Cost per credit in USD (placeholder - update with actual value)
COST_PER_CREDIT_USD = 5 / 1000

# Version display names for UI and usage tracking
VERSION_DISPLAY_NAMES = {
    "7": "MidJourney V7",
    "6.1": "MidJourney V6.1",
    "6": "MidJourney V6",
    "5.2": "MidJourney V5.2",
    "niji6": "MidJourney Niji 6",
}


@register("midjourney", concurrency=1)
class MidAPIProvider(MediaProviderBase):
    """
    MidJourney provider via MidAPI service.

    Requires MIDAPI_API_KEY environment variable.
    """

    def __init__(self):
        self.api_key = os.environ.get("MIDAPI_API_KEY")
        if not self.api_key:
            logger.warning("MIDAPI_API_KEY not set in environment")

    @property
    def provider_id(self) -> str:
        return "midjourney"

    def _get_headers(self) -> Dict[str, str]:
        """Get authorization headers for API requests."""
        if not self.api_key:
            raise AuthenticationError("MIDAPI_API_KEY not configured")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def _handle_response_error(self, response: requests.Response) -> None:
        """Handle HTTP error responses from MidAPI."""
        status_code = response.status_code

        try:
            error_data = response.json()
            error_msg = error_data.get("msg", response.text)
        except Exception:
            error_msg = response.text

        if status_code == 401:
            raise AuthenticationError(f"Invalid API key: {error_msg}")
        elif status_code == 402:
            raise InsufficientCreditsError(f"Insufficient credits: {error_msg}")
        elif status_code == 429:
            raise RateLimitError(f"Rate limited: {error_msg}", retry_after=60)
        elif status_code == 455:
            raise GenerationError(f"Service maintenance: {error_msg}")
        elif status_code >= 400:
            raise GenerationError(f"API error ({status_code}): {error_msg}")

    def _poll_for_result(
        self,
        task_id: str,
        progress_callback: Optional[ProgressCallback] = None
    ) -> Dict[str, Any]:
        """
        Poll for generation result until complete or timeout.

        Args:
            task_id: MidAPI task ID to poll
            progress_callback: Optional callback for progress updates

        Returns:
            Complete task result data

        Raises:
            TimeoutError: If polling exceeds MAX_POLL_TIMEOUT_SECONDS
            GenerationError: If generation fails
        """
        start_time = time.time()
        poll_count = 0

        logger.debug(
            f"[MidAPI] Starting poll for task {task_id} "
            f"(interval={POLL_INTERVAL_SECONDS}s, timeout={MAX_POLL_TIMEOUT_SECONDS}s, "
            f"max_attempts={MAX_POLL_ATTEMPTS})"
        )

        while poll_count < MAX_POLL_ATTEMPTS:
            elapsed_ms = int((time.time() - start_time) * 1000)
            elapsed_s = elapsed_ms / 1000

            # Call progress callback
            if progress_callback:
                progress_callback(elapsed_ms, f"Generating... ({poll_count * POLL_INTERVAL_SECONDS}s)")

            logger.debug(
                f"[MidAPI] Poll #{poll_count + 1}/{MAX_POLL_ATTEMPTS} for task {task_id} "
                f"(elapsed: {elapsed_s:.1f}s)"
            )

            # Make status request
            response = requests.get(
                f"{MIDAPI_BASE_URL}/record-info",
                params={"taskId": task_id},
                headers=self._get_headers()
            )

            self._handle_response_error(response)
            result = response.json()

            logger.debug(
                f"[MidAPI] Poll #{poll_count + 1} response: {result}"
            )

            if result.get("code") != 200:
                raise GenerationError(f"Status check failed: {result.get('msg')}")

            data = result.get("data", {})
            success_flag = data.get("successFlag")

            # Check status
            # 0 = generating, 1 = success, 2 = failed, 3 = generation failed
            if success_flag == 1:
                # Success
                logger.debug(f"[MidAPI] Task {task_id} completed after {elapsed_s:.1f}s ({poll_count + 1} polls)")
                if progress_callback:
                    progress_callback(elapsed_ms, "Complete!")
                return data
            elif success_flag in (2, 3):
                # Failed
                error_msg = data.get("errorMessage") or "Generation failed"
                logger.debug(f"[MidAPI] Task {task_id} failed: {error_msg}")
                raise GenerationError(error_msg)
            # else: still generating, continue polling

            time.sleep(POLL_INTERVAL_SECONDS)
            poll_count += 1

        # Timeout
        logger.debug(
            f"[MidAPI] Task {task_id} timed out after {MAX_POLL_TIMEOUT_SECONDS}s "
            f"({poll_count} polls)"
        )
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
        Generate images from a text prompt using MidJourney.

        Args:
            prompt: Text description of desired image
            params: Generation parameters:
                - aspect_ratio: str (e.g., "16:9", "1:1")
                - speed: str ("relaxed", "fast", "turbo")
                - version: str (e.g., "7", "6.1", "niji6")
                - stylization: int (0-1000, multiples of 50)
                - weirdness: int (0-3000, multiples of 100)
                - variety: int (0-100, increment by 5) - diversity control
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with image URLs
        """
        # Build request payload
        payload = {
            "taskType": "mj_txt2img",
            "prompt": prompt[:2000],  # Max 2000 chars
        }

        # Map params to MidAPI format
        if "aspect_ratio" in params:
            payload["aspectRatio"] = params["aspect_ratio"]
        if "speed" in params:
            payload["speed"] = params["speed"]
        if "version" in params:
            payload["version"] = str(params["version"])
        if "stylization" in params:
            payload["stylization"] = params["stylization"]
        if "weirdness" in params:
            payload["weirdness"] = params["weirdness"]
        if "variety" in params:
            payload["variety"] = params["variety"]

        logger.info(f"[MidAPI] Starting txt2img generation")

        # Make generation request
        response = requests.post(
            f"{MIDAPI_BASE_URL}/generate",
            json=payload,
            headers=self._get_headers()
        )

        self._handle_response_error(response)
        result = response.json()

        if result.get("code") != 200:
            raise GenerationError(f"Generation request failed: {result.get('msg')}")

        task_id = result.get("data", {}).get("taskId")
        if not task_id:
            raise GenerationError("No task ID returned from API")

        logger.info(f"[MidAPI] Task created: {task_id}")

        # Poll for result
        task_result = self._poll_for_result(task_id, progress_callback)

        # Extract content items from result
        # MidJourney does not provide seed information, use -1
        result_info = task_result.get("resultInfoJson", {})
        result_urls = result_info.get("resultUrls", [])
        content = [
            ContentItem(url=item.get("resultUrl"), seed=-1)
            for item in result_urls
            if item.get("resultUrl")
        ]

        logger.info(f"[MidAPI] Generation complete: {len(content)} images")

        # Calculate credits/cost
        preview_info = self.get_preview_info("txt2img", params)
        version = params.get("version", "7")
        usage = UsageInfo(
            provider="midjourney",
            model=f"midjourney-v{version}",
            display_name=VERSION_DISPLAY_NAMES.get(version, f"MidJourney V{version}"),
            action_type="txt2img",
            total_cost=preview_info.credits.total_cost_usd,
            credits=int(preview_info.credits.credits),
        )

        return GenerationResult(
            content=content,
            raw_response=task_result,
            provider_task_id=task_id,
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
        Not supported by MidAPI in the traditional sense.

        For image variations, use the vary() method instead.

        Raises:
            NotImplementedError: Always
        """
        raise NotImplementedError(
            "MidAPI does not support traditional img2img. "
            "Use vary() to create variations of MidJourney-generated images."
        )

    def vary(
        self,
        task_id: str,
        image_index: int,
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Create variations of a previously generated MidJourney image.

        This uses MidAPI's generateVary endpoint to create variations
        of an existing MidJourney generation.

        Args:
            task_id: Previous MidAPI task ID to vary from
            image_index: Which image from the grid to vary (0-3)
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with variation URLs
        """
        # Build request payload
        payload = {
            "taskId": task_id,
            "imageIndex": image_index
        }

        logger.info(f"[MidAPI] Starting variation for task {task_id}, index {image_index}")

        # Make variation request
        response = requests.post(
            f"{MIDAPI_BASE_URL}/generateVary",
            json=payload,
            headers=self._get_headers()
        )

        self._handle_response_error(response)
        result = response.json()

        if result.get("code") != 200:
            raise GenerationError(f"Variation request failed: {result.get('msg')}")

        new_task_id = result.get("data", {}).get("taskId")
        if not new_task_id:
            raise GenerationError("No task ID returned from API")

        logger.info(f"[MidAPI] Variation task created: {new_task_id}")

        # Poll for result
        task_result = self._poll_for_result(new_task_id, progress_callback)

        # Extract content items from result
        # MidJourney does not provide seed information, use -1
        result_info = task_result.get("resultInfoJson", {})
        result_urls = result_info.get("resultUrls", [])
        content = [
            ContentItem(url=item.get("resultUrl"), seed=-1)
            for item in result_urls
            if item.get("resultUrl")
        ]

        logger.info(f"[MidAPI] Variation complete: {len(content)} images")

        # Use txt2img pricing for vary (same credit cost)
        preview_info = self.get_preview_info("txt2img", {})
        usage = UsageInfo(
            provider="midjourney",
            model="midjourney-vary",
            display_name="MidJourney Vary",
            action_type="vary",
            total_cost=preview_info.credits.total_cost_usd,
            credits=int(preview_info.credits.credits),
        )

        return GenerationResult(
            content=content,
            raw_response=task_result,
            provider_task_id=new_task_id,
            usage=usage,
        )

    def img2vid(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate video from a MidJourney image.

        Note: The source image must be a URL from a previous MidAPI generation.
        External images are not currently supported.

        Args:
            source_image: URL of MidAPI-generated image
            prompt: Text description for video motion
            params: Video parameters:
                - motion: str ("high" or "low") - motion intensity
                - hd: bool - use mj_video_hd for higher quality
                - batch_size: int (1, 2, or 4) - number of videos to generate
            progress_callback: Optional callback for progress updates

        Returns:
            GenerationResult with video URLs
        """
        # Determine task type
        use_hd = params.get("hd", False)
        task_type = "mj_video_hd" if use_hd else "mj_video"

        # Build request payload
        payload = {
            "taskType": task_type,
            "prompt": prompt[:2000] if prompt else "",
            "fileUrl": source_image,
        }

        # Add optional parameters
        if "motion" in params:
            payload["motion"] = params["motion"]
        if "batch_size" in params:
            payload["videoBatchSize"] = params["batch_size"]

        logger.info(f"[MidAPI] Starting {task_type} generation")

        # Make generation request
        response = requests.post(
            f"{MIDAPI_BASE_URL}/generate",
            json=payload,
            headers=self._get_headers()
        )

        self._handle_response_error(response)
        result = response.json()

        if result.get("code") != 200:
            raise GenerationError(f"Video generation request failed: {result.get('msg')}")

        task_id = result.get("data", {}).get("taskId")
        if not task_id:
            raise GenerationError("No task ID returned from API")

        logger.info(f"[MidAPI] Video task created: {task_id}")

        # Poll for result
        task_result = self._poll_for_result(task_id, progress_callback)

        # Extract content items from result
        # MidJourney does not provide seed information, use -1
        result_info = task_result.get("resultInfoJson", {})
        result_urls = result_info.get("resultUrls", [])
        content = [
            ContentItem(url=item.get("resultUrl"), seed=-1)
            for item in result_urls
            if item.get("resultUrl")
        ]

        logger.info(f"[MidAPI] Video generation complete: {len(content)} videos")

        # Calculate credits/cost
        preview_info = self.get_preview_info("img2vid", params)
        is_hd = params.get("hd", False)
        usage = UsageInfo(
            provider="midjourney",
            model="midjourney-video-hd" if is_hd else "midjourney-video",
            display_name="MidJourney Video HD" if is_hd else "MidJourney Video",
            action_type="img2vid",
            total_cost=preview_info.credits.total_cost_usd,
            credits=int(preview_info.credits.credits),
        )

        return GenerationResult(
            content=content,
            raw_response=task_result,
            provider_task_id=task_id,
            usage=usage,
        )

    def txt2audio(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """Audio generation not supported by MidJourney."""
        raise NotImplementedError(
            "MidJourney does not support audio generation"
        )

    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information for a MidJourney generation configuration.

        Calculates expected output resolution and credit cost.

        Args:
            action_type: "txt2img", "img2img", or "img2vid"
            params: Generation parameters

        Returns:
            PreviewInfo with resolution and credit information
        """
        # Calculate resolution
        resolution = self._calculate_resolution(action_type, params)

        # Calculate credits from fixed lookup table
        credits = self._calculate_credits(action_type, params)

        return PreviewInfo(resolution=resolution, credits=credits)

    def _calculate_resolution(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> ResolutionInfo:
        """
        Calculate expected output resolution for MidJourney.

        MidJourney maintains approximately 1 megapixel total for all aspect ratios.
        For ratio w:h with total pixels P:
            width = sqrt(P * w/h)
            height = sqrt(P * h/w)
        """
        aspect_ratio = params.get("aspect_ratio", "1:1")

        # Parse aspect ratio
        try:
            parts = aspect_ratio.split(":")
            ratio_w = int(parts[0])
            ratio_h = int(parts[1])
        except (ValueError, IndexError):
            # Default to 1:1 if parsing fails
            ratio_w, ratio_h = 1, 1

        # Calculate dimensions maintaining ~1MP total
        # width = sqrt(BASE_PIXELS * ratio_w / ratio_h)
        # height = sqrt(BASE_PIXELS * ratio_h / ratio_w)
        width = int(math.sqrt(BASE_PIXELS * ratio_w / ratio_h))
        height = int(math.sqrt(BASE_PIXELS * ratio_h / ratio_w))

        # Round to nearest 8 (common for image generation)
        width = (width // 8) * 8
        height = (height // 8) * 8

        megapixels = round((width * height) / 1_000_000, 2)

        return ResolutionInfo(
            width=width,
            height=height,
            megapixels=megapixels
        )

    def get_metadata(self, action_type: str) -> Dict[str, Any]:
        """
        Get MidJourney/MidAPI model metadata for UI rendering.

        Args:
            action_type: "txt2img" or "img2vid"

        Returns:
            Dict with all UI params for the specified action type.
        """
        if action_type == "img2vid":
            return self._get_img2vid_metadata()
        elif action_type == "txt2img":
            return self._get_txt2img_metadata()
        else:
            return {}

    def _get_txt2img_metadata(self) -> Dict[str, Any]:
        """Get metadata for txt2img (image generation)."""
        return {
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

            # Speed options
            "speed": [
                {"key": "relaxed", "label": "Relaxed"},
                {"key": "fast", "label": "Fast"},
                {"key": "turbo", "label": "Turbo"},
            ],

            # Version options
            "versions": [
                {"key": "7", "label": "V7"},
                {"key": "6.1", "label": "V6.1"},
                {"key": "6", "label": "V6"},
                {"key": "5.2", "label": "V5.2"},
                {"key": "niji6", "label": "Niji 6"},
            ],

            # Slider params (min, max, default, step)
            "stylization": {
                "min": 0,
                "max": 1000,
                "default": 100,
                "step": 10,
            },

            "weirdness": {
                "min": 0,
                "max": 3000,
                "default": 0,
                "step": 50,
            },

            "variety": {
                "min": 0,
                "max": 100,
                "default": 0,
                "step": 5,
            },
        }

    def _get_img2vid_metadata(self) -> Dict[str, Any]:
        """Get metadata for img2vid (MidJourney video generation)."""
        return {
            # Motion intensity options
            "motion": [
                {"key": "low", "label": "Low"},
                {"key": "high", "label": "High"},
            ],

            # Quality options
            "hd": [
                {"key": "false", "label": "Standard"},
                {"key": "true", "label": "HD"},
            ],

            # Speed options (same as txt2img)
            "speed": [
                {"key": "relaxed", "label": "Relaxed"},
                {"key": "fast", "label": "Fast"},
                {"key": "turbo", "label": "Turbo"},
            ],

            # Batch size options
            "batch_size": [
                {"key": "1", "label": "1"},
                {"key": "2", "label": "2"},
                {"key": "4", "label": "4"},
            ],
        }

    def _calculate_credits(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> CreditInfo:
        """
        Calculate credit cost from fixed lookup table.

        Credits are based on task_type and speed parameters.
        MidJourney always generates 4 images per request.
        """
        # MidJourney always generates 4 images
        num_images = 4

        # Determine task type
        if action_type == "txt2img":
            task_type = "mj_txt2img"
        elif action_type == "img2vid":
            use_hd = params.get("hd", False)
            task_type = "mj_video_hd" if use_hd else "mj_video"
            num_images = 1  # Video is single output
        else:
            # Default for unsupported actions
            task_type = "mj_txt2img"

        speed = params.get("speed", "fast")

        # Look up credits from table
        credits = CREDIT_COSTS.get((task_type, speed), 0)

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
