"""
ElevenLabs Audio Generation Provider.

Supports:
- Music generation (Eleven Music API)
- [Future] Text-to-Speech (TTS)
- [Future] Sound Effects (SFX)

API Documentation:
- Music: https://elevenlabs.io/docs/api-reference/music/compose

Requires ELEVENLABS_API_KEY environment variable.
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
    UsageInfo,
    ProgressCallback,
    AuthenticationError,
    InsufficientCreditsError,
    RateLimitError,
    GenerationError,
    ResolutionInfo,
    CreditInfo,
    PreviewInfo,
)
from ..registry import register

logger = logging.getLogger(__name__)

# API Configuration
ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1"
REQUEST_TIMEOUT_SECONDS = 300  # 5 min for long tracks

# Pricing constants (Creator tier)
MUSIC_COST_PER_MINUTE_USD = 0.80

# Supported output formats
MUSIC_OUTPUT_FORMATS = [
    "mp3_22050_32",
    "mp3_44100_64",
    "mp3_44100_128",
    "mp3_44100_192",  # Creator+ only
]

DEFAULT_MUSIC_OUTPUT_FORMAT = "mp3_44100_128"


@register("elevenlabs", concurrency=2)
class ElevenLabsProvider(MediaProviderBase):
    """
    ElevenLabs provider for audio generation.

    Currently supports:
    - Music generation via Eleven Music API

    Future support planned:
    - Text-to-Speech (TTS)
    - Sound Effects (SFX)

    Requires ELEVENLABS_API_KEY environment variable.
    """

    def __init__(self):
        self.api_key = os.environ.get("ELEVENLABS_API_KEY")
        if not self.api_key:
            logger.warning(
                "[ElevenLabs] ELEVENLABS_API_KEY not set in environment"
            )

    @property
    def provider_id(self) -> str:
        return "elevenlabs"

    # =========================================================================
    # Authentication & Request Helpers
    # =========================================================================

    def _get_headers(self) -> Dict[str, str]:
        """Get authorization headers for API requests."""
        if not self.api_key:
            raise AuthenticationError("ELEVENLABS_API_KEY not configured")
        return {
            "xi-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def _assemble_prompt(self, base_prompt: str, params: Dict[str, Any]) -> str:
        """
        Assemble final prompt with user-adjusted parameters.

        Appends BPM, instruments, and mood to the base prompt.
        Note: duration_ms and force_instrumental are API parameters, not prompt text.

        Args:
            base_prompt: Base prompt text from LLM
            params: User-adjusted parameters (bpm, instruments, mood)

        Returns:
            Assembled prompt string ready for ElevenLabs API

        Example output:
            "Warm cozy acoustic with gentle fingerpicked guitar over soft pads.
            Target BPM: 72. Instruments: felt piano, warm acoustic guitar.
            Mood: gentle, cozy, loving."
        """
        parts = [base_prompt.rstrip('.')]

        if params.get('bpm'):
            parts.append(f"Target BPM: {params['bpm']}")

        if params.get('instruments'):
            instruments = params['instruments']
            if isinstance(instruments, list):
                instruments = ', '.join(instruments)
            parts.append(f"Instruments: {instruments}")

        if params.get('mood'):
            mood = params['mood']
            if isinstance(mood, list):
                mood = ', '.join(mood)
            parts.append(f"Mood: {mood}")

        return '. '.join(parts) + '.'

    def _handle_response_error(self, response: requests.Response) -> None:
        """
        Handle HTTP error responses from ElevenLabs API.

        ElevenLabs can return errors in two formats:
        1. {"detail": {"status": "...", "message": "..."}}
        2. {"error": "...", "message": "..."}
        """
        if response.status_code == 200:
            return

        error_msg = response.text

        try:
            error_data = response.json()

            # Format 1: {"detail": {"status": "...", "message": "..."}}
            if "detail" in error_data:
                detail = error_data["detail"]
                if isinstance(detail, dict):
                    error_msg = detail.get("message", str(detail))
                else:
                    error_msg = str(detail)

            # Format 2: {"error": "...", "message": "..."}
            elif "error" in error_data:
                error_msg = error_data.get("message", error_data.get("error"))

        except Exception:
            pass  # Keep response.text as error_msg

        if response.status_code == 401:
            raise AuthenticationError(f"Invalid API key: {error_msg}")
        elif response.status_code == 429:
            raise RateLimitError(f"Rate limited: {error_msg}", retry_after=60)
        elif response.status_code == 402:
            raise InsufficientCreditsError(
                f"Insufficient credits: {error_msg}"
            )
        elif response.status_code == 422:
            raise GenerationError(f"Validation error: {error_msg}")
        else:
            raise GenerationError(
                f"API error ({response.status_code}): {error_msg}"
            )

    # =========================================================================
    # Image/Video Methods (Not Supported)
    # =========================================================================

    def txt2img(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """Image generation not supported by ElevenLabs."""
        raise NotImplementedError(
            "ElevenLabs does not support image generation"
        )

    def img2img(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """Image-to-image not supported by ElevenLabs."""
        raise NotImplementedError(
            "ElevenLabs does not support image generation"
        )

    def img2vid(
        self,
        source_image: str,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """Video generation not supported by ElevenLabs."""
        raise NotImplementedError(
            "ElevenLabs does not support video generation"
        )

    # =========================================================================
    # Audio Generation
    # =========================================================================

    def txt2audio(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate audio from text prompt.

        Args:
            prompt: Text description for music generation
            params: Generation parameters:
                - audio_type: str ("music") - default "music"
                - duration_ms: int (3000-600000)
                - force_instrumental: bool
                - output_format: str
                - composition_plan: dict (alternative to prompt)
                - model_id: str (default "music_v1")
                - respect_sections_durations: bool

        Returns:
            GenerationResult with audio data URI
        """
        audio_type = params.get("audio_type", "music")

        if audio_type == "music":
            return self._generate_music(prompt, params, progress_callback)
        elif audio_type == "tts":
            raise NotImplementedError("TTS generation not yet implemented")
        elif audio_type == "sfx":
            raise NotImplementedError("SFX generation not yet implemented")
        else:
            raise GenerationError(f"Unknown audio_type: {audio_type}")

    def _generate_music(
        self,
        prompt: str,
        params: Dict[str, Any],
        progress_callback: Optional[ProgressCallback] = None
    ) -> GenerationResult:
        """
        Generate music using Eleven Music API.

        The API returns a streaming binary response. We read the full audio
        and return it as a data URI for the download utility to save.

        Args:
            prompt: Base prompt text (will be assembled with params)
            params: Generation parameters including bpm, instruments, mood,
                    duration_ms, force_instrumental, output_format, etc.
        """
        # Build request payload
        payload = {}

        # Use composition_plan if provided, otherwise assemble prompt
        composition_plan = params.get("composition_plan")
        if composition_plan:
            payload["composition_plan"] = composition_plan
        else:
            # Assemble final prompt with user-adjusted parameters
            assembled_prompt = self._assemble_prompt(prompt, params)
            logger.info(f"[ElevenLabs] Assembled prompt: {assembled_prompt[:300]}...")
            payload["prompt"] = assembled_prompt[:4100]  # Max prompt length

        # Optional parameters - duration in seconds from UI
        if "duration_seconds" in params:
            duration_ms = int(params["duration_seconds"]) * 1000
            # Clamp to valid range (3s - 10min)
            duration_ms = max(3000, min(600000, duration_ms))
            payload["music_length_ms"] = duration_ms

        if params.get("force_instrumental"):
            payload["force_instrumental"] = True

        if "model_id" in params:
            payload["model_id"] = params["model_id"]

        if "respect_sections_durations" in params:
            payload["respect_sections_durations"] = params[
                "respect_sections_durations"
            ]

        # Output format as query parameter
        output_format = params.get("output_format", DEFAULT_MUSIC_OUTPUT_FORMAT)
        if output_format not in MUSIC_OUTPUT_FORMATS:
            output_format = DEFAULT_MUSIC_OUTPUT_FORMAT

        logger.info(
            f"[ElevenLabs] Starting music generation: "
            f"duration={payload.get('music_length_ms', 'auto')}ms, "
            f"format={output_format}"
        )

        if progress_callback:
            progress_callback(0, "Generating music with ElevenLabs...")

        # Make request with streaming to handle large audio files
        try:
            response = requests.post(
                f"{ELEVENLABS_BASE_URL}/music",
                json=payload,
                headers=self._get_headers(),
                params={"output_format": output_format},
                timeout=REQUEST_TIMEOUT_SECONDS,
                stream=True
            )
        except requests.RequestException as e:
            raise GenerationError(f"Request failed: {e}")

        self._handle_response_error(response)

        # Get song ID from response header
        song_id = response.headers.get("song-id")

        # Read streaming response
        audio_chunks = []
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                audio_chunks.append(chunk)

        audio_data = b"".join(audio_chunks)

        if progress_callback:
            progress_callback(100, "Complete!")

        # Convert to data URI (download utility will save to filesystem)
        audio_b64 = base64.b64encode(audio_data).decode("utf-8")
        mime_type = "audio/mpeg"
        data_uri = f"data:{mime_type};base64,{audio_b64}"

        logger.info(
            f"[ElevenLabs] Music generation complete: "
            f"song_id={song_id}, size={len(audio_data)} bytes"
        )

        # Calculate cost
        preview_info = self.get_preview_info("txt2audio", params)
        usage = UsageInfo(
            provider="elevenlabs",
            model="eleven_music",
            action_type="txt2audio",
            total_cost=preview_info.credits.total_cost_usd,
            audio_type="music",
        )

        return GenerationResult(
            content=[ContentItem(url=data_uri, seed=-1)],
            raw_response={
                "song_id": song_id,
                "format": output_format,
                "size_bytes": len(audio_data),
                "audio_type": "music",
            },
            provider_task_id=song_id,
            usage=usage,
        )

    # =========================================================================
    # Preview Info (Cost Estimation)
    # =========================================================================

    def get_preview_info(
        self,
        action_type: str,
        params: Dict[str, Any]
    ) -> PreviewInfo:
        """
        Get preview information for audio generation.

        Returns cost estimates based on Creator tier pricing.
        """
        if action_type != "txt2audio":
            raise NotImplementedError(
                f"Preview not available for {action_type}"
            )

        audio_type = params.get("audio_type", "music")

        if audio_type == "music":
            return self._get_music_preview_info(params)
        else:
            raise NotImplementedError(
                f"Preview not available for audio_type: {audio_type}"
            )

    def _get_music_preview_info(self, params: Dict[str, Any]) -> PreviewInfo:
        """Calculate cost estimate for music generation."""
        # Get duration in seconds (default to 60 seconds if not specified)
        duration_seconds = int(params.get("duration_seconds", 60))
        duration_minutes = duration_seconds / 60

        total_cost = duration_minutes * MUSIC_COST_PER_MINUTE_USD

        # Resolution doesn't apply to audio - use placeholder values
        resolution = ResolutionInfo(width=0, height=0, megapixels=0)

        # Approximate credit calculation (100k credits / 31 min included)
        credits_per_minute = 100000 / 31  # ~3225 credits/min

        credits = CreditInfo(
            credits=round(duration_minutes * credits_per_minute),
            cost_per_credit=MUSIC_COST_PER_MINUTE_USD / credits_per_minute,
            total_cost_usd=round(total_cost, 2),
            num_images=1,  # 1 audio file
            credits_per_image=round(duration_minutes * credits_per_minute),
            cost_per_image_usd=round(total_cost, 2)
        )

        return PreviewInfo(resolution=resolution, credits=credits)
