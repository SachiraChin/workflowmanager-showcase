"""
Media API routes.

Provides endpoints for media generation utilities like preview calculations.
These are non-streaming endpoints for getting resolution and credit information.
"""

import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..dependencies import get_db, get_current_user_id, get_verified_workflow
from models import MediaPreviewRequest
from modules.media import MediaProviderRegistry
from backend.providers.media.base import GenerationError

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/workflow", tags=["media"])


class ResolutionResponse(BaseModel):
    """Resolution information in response."""
    width: int
    height: int
    megapixels: float


class CreditsResponse(BaseModel):
    """Credit information in response."""
    credits: float
    cost_per_credit: float
    total_cost_usd: float
    num_images: int
    credits_per_image: float
    cost_per_image_usd: float


class MediaPreviewResponse(BaseModel):
    """Response body for media preview endpoint."""
    resolution: ResolutionResponse
    credits: CreditsResponse


@router.post("/{workflow_run_id}/media/preview", response_model=MediaPreviewResponse)
async def get_media_preview(
    workflow_run_id: str,
    request: MediaPreviewRequest,
    workflow: dict = Depends(get_verified_workflow),
):
    """
    Get preview information for a media generation configuration.

    Returns expected output resolution and credit cost without performing
    the actual generation. Used for UI preview when user changes options.

    Args:
        workflow_run_id: The workflow run ID (for auth context)
        request: Preview request with provider, action_type, and params

    Returns:
        MediaPreviewResponse with resolution and credit information
    """

    # Get provider
    try:
        provider = MediaProviderRegistry.get(request.provider)
    except (ValueError, GenerationError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Get preview info
    try:
        preview_info = provider.get_preview_info(
            action_type=request.action_type,
            params=request.params
        )
    except Exception as e:
        logger.error(f"[Media] Preview calculation failed: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate preview: {str(e)}"
        )

    return MediaPreviewResponse(
        resolution=ResolutionResponse(
            width=preview_info.resolution.width,
            height=preview_info.resolution.height,
            megapixels=preview_info.resolution.megapixels
        ),
        credits=CreditsResponse(
            credits=preview_info.credits.credits,
            cost_per_credit=preview_info.credits.cost_per_credit,
            total_cost_usd=preview_info.credits.total_cost_usd,
            num_images=preview_info.credits.num_images,
            credits_per_image=preview_info.credits.credits_per_image,
            cost_per_image_usd=preview_info.credits.cost_per_image_usd
        )
    )
