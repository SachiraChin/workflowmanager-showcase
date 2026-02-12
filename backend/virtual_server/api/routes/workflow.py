"""
Virtual Workflow Execution API routes.

Provides endpoints for running modules in virtual context using mongomock.
These endpoints mirror the real workflow endpoints:

    Virtual Server              Production Server
    POST /workflow/start    →   POST /workflow/start
    POST /workflow/respond  →   POST /workflow/respond
    POST /workflow/sub-action → POST /workflow/{id}/sub-action

The virtual database state is transferred as a gzip-compressed, base64-encoded
string to minimize bandwidth usage.
"""

import hashlib
import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from backend.db.virtual import VIRTUAL_USER_ID, VirtualDatabase
from backend.providers.media.base import GenerationError
from backend.workflow_engine.models import (
    ExecutionTarget,
    InteractionResponseData,
    VirtualWorkflowResponse,
    WorkflowResponse,
    WorkflowStatus,
)
from backend.workflow_engine.modules.media import MediaProviderRegistry
from backend.workflow_engine.utils import sanitize_error_message
from backend.workflow_engine import WorkflowProcessor

from ..dependencies import get_current_user_id

logger = logging.getLogger("workflow.virtual")

# Use /workflow prefix - mirrors production endpoint structure
router = APIRouter(prefix="/workflow", tags=["workflow"])

# Fixed AI config for virtual execution - always use OpenAI gpt-4o-mini
VIRTUAL_AI_CONFIG = {
    "provider": "openai",
    "model": "gpt-4o-mini",
}


class VirtualStartRequest(BaseModel):
    """Request to start virtual module execution."""

    workflow: Dict[str, Any] = Field(
        ..., description="Full resolved workflow JSON"
    )
    virtual_db: Optional[str] = Field(
        default=None,
        description="Base64-encoded gzip of virtual database JSON. "
        "If null, creates fresh state.",
    )
    target_step_id: str = Field(
        ..., description="Step ID containing target module"
    )
    target_module_name: str = Field(
        ..., description="Module name to execute"
    )
    mock: bool = Field(
        default=True,
        description="If true, modules return mock data instead of making real API calls. "
        "Used for preview mode in the editor."
    )


class VirtualRespondRequest(BaseModel):
    """Request to respond to virtual interaction."""

    workflow: Dict[str, Any] = Field(
        ..., description="Full resolved workflow JSON"
    )
    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON from start response",
    )
    virtual_run_id: str = Field(
        ..., description="Virtual run ID from start response"
    )
    target_step_id: str = Field(
        ..., description="Step ID containing target module"
    )
    target_module_name: str = Field(..., description="Module name")
    interaction_id: str = Field(
        ..., description="Interaction ID from start response"
    )
    response: InteractionResponseData = Field(
        ..., description="User's response to the interaction"
    )
    mock: bool = Field(
        default=True,
        description="If true, modules return mock data instead of making real API calls."
    )


def compute_content_hash(workflow: Dict[str, Any]) -> str:
    """Compute content hash for workflow."""
    content = json.dumps(workflow, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(content.encode()).hexdigest()


def to_virtual_response(
    response: WorkflowResponse,
    vdb: VirtualDatabase,
    virtual_run_id: str,
) -> VirtualWorkflowResponse:
    """Convert WorkflowResponse to VirtualWorkflowResponse with virtual fields.
    
    Adds virtual-specific fields at root level:
    - virtual_run_id: The workflow run ID for subsequent requests
    - virtual_db: Compressed database state (opaque, for sending back)
    - state: Current module outputs as plain dict (for UI to read)
    """
    return VirtualWorkflowResponse(
        # Copy all base WorkflowResponse fields
        workflow_run_id=response.workflow_run_id,
        status=response.status,
        message=response.message,
        progress=response.progress,
        interaction_request=response.interaction_request,
        result=response.result,
        error=response.error,
        validation_errors=response.validation_errors,
        validation_warnings=response.validation_warnings,
        # Add virtual-specific fields
        virtual_run_id=virtual_run_id,
        virtual_db=vdb.export_state(),
        state=vdb.state_repo.get_module_outputs(virtual_run_id),
    )


@router.post("/start", response_model=VirtualWorkflowResponse)
async def start_virtual_module(
    request: VirtualStartRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Start virtual execution of a module.

    Mirrors POST /workflow/start for real workflows.

    The virtual_db in the response contains the database state
    that must be sent back in the respond request.
    """
    vdb: Optional[VirtualDatabase] = None
    virtual_run_id = ""

    try:
        # Create virtual database
        vdb = VirtualDatabase(request.virtual_db)

        # Store workflow as version in virtual DB (same as real /start)
        workflow_template_name = request.workflow.get("workflow_id", "virtual")
        content_hash = compute_content_hash(request.workflow)

        version_id, template_id, _ = vdb.version_repo.process_and_store_workflow_versions(
            resolved_workflow=request.workflow,
            content_hash=content_hash,
            source_type="json",
            workflow_template_name=workflow_template_name,
            user_id=VIRTUAL_USER_ID,
        )

        # Create processor with virtual DB
        processor = WorkflowProcessor(vdb)

        # Create execution target
        target = ExecutionTarget(
            step_id=request.target_step_id,
            module_name=request.target_module_name,
        )
        
        # Determine if this is a fresh start or resume
        # If virtual_db is provided, we're resuming from existing state
        is_fresh_start = request.virtual_db is None
        
        logger.info(
            "Virtual start - target: step_id=%s, module_name=%s, fresh=%s",
            request.target_step_id,
            request.target_module_name,
            is_fresh_start,
        )

        # Call processor.start_workflow (same as real /start)
        # This creates workflow_run, branch, and executes up to target
        # force_new=True only for fresh starts, otherwise preserve events from virtual_db
        result = processor.start_workflow(
            version_id=version_id,
            project_name="virtual_project",
            workflow_template_name=workflow_template_name,
            user_id=VIRTUAL_USER_ID,
            ai_config=VIRTUAL_AI_CONFIG,
            force_new=is_fresh_start,
            target=target,
            mock_mode=request.mock,
        )

        virtual_run_id = result.workflow_run_id
        return to_virtual_response(result, vdb, virtual_run_id)

    except Exception as e:
        logger.exception("Virtual start failed: %s", e)
        return VirtualWorkflowResponse(
            workflow_run_id=virtual_run_id,
            status=WorkflowStatus.ERROR,
            error=str(e),
            result={
                "error_type": "execution_failed",
                "details": {"exception": str(e)},
            },
            virtual_run_id=virtual_run_id,
            virtual_db=vdb.export_state() if vdb else None,
            state=vdb.state_repo.get_module_outputs(virtual_run_id) if vdb and virtual_run_id else None,
        )


@router.post("/respond", response_model=VirtualWorkflowResponse)
async def respond_virtual_module(
    request: VirtualRespondRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Process response to a virtual interaction.

    Mirrors POST /workflow/respond for real workflows.

    Requires virtual_db from the start response to reconstruct state.
    Returns module outputs and updated virtual_db.
    """
    virtual_run_id = request.virtual_run_id
    vdb: Optional[VirtualDatabase] = None

    try:
        # Create virtual database from provided state
        vdb = VirtualDatabase(request.virtual_db)

        # Store (potentially updated) workflow as version and update workflow run
        # This allows editor to modify workflow between interactions
        workflow_template_name = request.workflow.get("workflow_id", "virtual")
        content_hash = compute_content_hash(request.workflow)

        version_id, _, _ = vdb.version_repo.process_and_store_workflow_versions(
            resolved_workflow=request.workflow,
            content_hash=content_hash,
            source_type="json",
            workflow_template_name=workflow_template_name,
            user_id=VIRTUAL_USER_ID,
        )

        # Update workflow run to use this version
        vdb.workflow_runs.update_one(
            {"workflow_run_id": virtual_run_id},
            {"$set": {"current_workflow_version_id": version_id}},
        )

        # Track version history (same as resume_workflow_with_update)
        vdb.workflow_repo.add_version_history_entry(
            workflow_run_id=virtual_run_id,
            workflow_version_id=version_id,
        )

        # Create processor with virtual DB
        processor = WorkflowProcessor(vdb)

        # Create execution target
        target = ExecutionTarget(
            step_id=request.target_step_id,
            module_name=request.target_module_name,
        )

        # Call processor.respond (same as real /respond)
        result = processor.respond(
            workflow_run_id=virtual_run_id,
            interaction_id=request.interaction_id,
            response=request.response,
            ai_config=VIRTUAL_AI_CONFIG,
            target=target,
            mock_mode=request.mock,
        )

        return to_virtual_response(result, vdb, virtual_run_id)

    except Exception as e:
        logger.exception("Virtual respond failed: %s", e)
        return VirtualWorkflowResponse(
            workflow_run_id=virtual_run_id,
            status=WorkflowStatus.ERROR,
            error=str(e),
            result={
                "error_type": "execution_failed",
                "details": {"exception": str(e)},
            },
            virtual_run_id=virtual_run_id,
            virtual_db=vdb.export_state() if vdb else None,
            state=vdb.state_repo.get_module_outputs(virtual_run_id) if vdb else None,
        )


# =============================================================================
# Resume/Confirm Endpoint
# =============================================================================


class VirtualResumeConfirmRequest(BaseModel):
    """Request to resume virtual workflow with updated workflow and execute to target."""

    workflow: Dict[str, Any] = Field(
        ..., description="Full resolved workflow JSON (potentially updated)"
    )
    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON from previous response",
    )
    target_step_id: str = Field(
        ..., description="Step ID containing target module"
    )
    target_module_name: str = Field(
        ..., description="Module name to execute up to"
    )
    mock: bool = Field(
        default=True,
        description="If true, modules return mock data instead of making real API calls."
    )


@router.post("/resume/confirm", response_model=VirtualWorkflowResponse)
async def resume_confirm_virtual(
    request: VirtualResumeConfirmRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Resume virtual workflow with updated workflow and execute to target.

    Mirrors POST /workflow/{id}/resume/confirm for real workflows.

    This endpoint:
    1. Imports the virtual_db state (preserving existing events)
    2. Stores the (potentially updated) workflow as a new version
    3. Resumes execution from current position to the target module

    Use this when:
    - User clicks on a module that hasn't been executed yet
    - Workflow may have been edited since last execution
    """
    vdb: Optional[VirtualDatabase] = None
    virtual_run_id = ""

    try:
        # Create virtual database from provided state
        vdb = VirtualDatabase(request.virtual_db)
        
        # Debug: Log what collections were imported
        collection_names = vdb.db.list_collection_names()
        workflow_runs_count = vdb.workflow_runs.count_documents({})
        logger.info(
            "Virtual resume/confirm - imported db has collections=%s, workflow_runs_count=%d",
            collection_names,
            workflow_runs_count,
        )

        # Store workflow as version
        workflow_template_name = request.workflow.get("workflow_id", "virtual")
        content_hash = compute_content_hash(request.workflow)

        version_id, _, _ = vdb.version_repo.process_and_store_workflow_versions(
            resolved_workflow=request.workflow,
            content_hash=content_hash,
            source_type="json",
            workflow_template_name=workflow_template_name,
            user_id=VIRTUAL_USER_ID,
        )

        # Find existing workflow run from imported db
        existing_run = vdb.workflow_runs.find_one({})
        if not existing_run:
            logger.warning(
                "Virtual resume/confirm - no workflow run found after import! collections=%s",
                collection_names,
            )
            return VirtualWorkflowResponse(
                workflow_run_id="",
                status=WorkflowStatus.ERROR,
                error="No workflow run found in virtual_db",
                virtual_run_id="",
                virtual_db=vdb.export_state(),
                state=None,
            )

        virtual_run_id = existing_run.get("workflow_run_id", "")

        # Update workflow run to use new version
        vdb.workflow_runs.update_one(
            {"workflow_run_id": virtual_run_id},
            {"$set": {"current_workflow_version_id": version_id}},
        )

        # Track version history
        vdb.workflow_repo.add_version_history_entry(
            workflow_run_id=virtual_run_id,
            workflow_version_id=version_id,
        )

        # Create execution target
        target = ExecutionTarget(
            step_id=request.target_step_id,
            module_name=request.target_module_name,
        )

        logger.info(
            "Virtual resume/confirm - target: step_id=%s, module_name=%s",
            request.target_step_id,
            request.target_module_name,
        )

        # Create processor and resume with update
        processor = WorkflowProcessor(vdb)
        result = processor.resume_workflow_with_update(
            workflow_run_id=virtual_run_id,
            version_id=version_id,
            user_id=VIRTUAL_USER_ID,
            ai_config=VIRTUAL_AI_CONFIG,
            target=target,
            mock_mode=request.mock,
        )

        return to_virtual_response(result, vdb, virtual_run_id)

    except Exception as e:
        logger.exception("Virtual resume/confirm failed: %s", e)
        return VirtualWorkflowResponse(
            workflow_run_id=virtual_run_id,
            status=WorkflowStatus.ERROR,
            error=str(e),
            result={
                "error_type": "execution_failed",
                "details": {"exception": str(e)},
            },
            virtual_run_id=virtual_run_id,
            virtual_db=vdb.export_state() if vdb else None,
            state=vdb.state_repo.get_module_outputs(virtual_run_id)
            if vdb and virtual_run_id
            else None,
        )


# =============================================================================
# State Endpoint
# =============================================================================


class VirtualStateRequest(BaseModel):
    """Request to get state from virtual database."""

    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON",
    )
    virtual_run_id: str = Field(
        ..., description="Virtual run ID"
    )


class VirtualStateResponse(BaseModel):
    """Response containing workflow state."""

    steps: Dict[str, Any] = Field(
        default_factory=dict,
        description="Hierarchical module state by step/module",
    )
    state_mapped: Dict[str, Any] = Field(
        default_factory=dict,
        description="State-mapped values (flat dict)",
    )
    files: list = Field(
        default_factory=list,
        description="File tree structure",
    )


@router.post("/state", response_model=VirtualStateResponse)
async def get_virtual_state(
    request: VirtualStateRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get workflow state from virtual database.

    Mirrors GET /workflow/{id}/state/v2 for real workflows.

    Returns the full workflow state without executing anything.
    Used by editor to display state panel.
    """
    try:
        # Create virtual database from provided state
        vdb = VirtualDatabase(request.virtual_db)

        # Get full workflow state (same as state/v2 endpoint)
        state = vdb.state_repo.get_full_workflow_state(request.virtual_run_id)

        return VirtualStateResponse(
            steps=state.get("steps", {}),
            state_mapped=state.get("state_mapped", {}),
            files=state.get("files", []),
        )

    except Exception as e:
        logger.exception("Virtual state failed: %s", e)
        return VirtualStateResponse(
            steps={},
            state_mapped={},
            files=[],
        )


# =============================================================================
# Interaction History Endpoint
# =============================================================================


class VirtualInteractionHistoryRequest(BaseModel):
    """Request to get interaction history from virtual database."""

    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON",
    )
    virtual_run_id: str = Field(
        ..., description="Virtual run ID"
    )


class CompletedInteraction(BaseModel):
    """A completed interaction with request and response."""

    interaction_id: str
    request: Dict[str, Any] = Field(
        description="Full InteractionRequest data for rendering"
    )
    response: Dict[str, Any] = Field(
        description="User's response data"
    )
    step_id: Optional[str] = None
    module_name: Optional[str] = None
    timestamp: Optional[str] = None


class VirtualInteractionHistoryResponse(BaseModel):
    """Response containing interaction history."""

    interactions: list[CompletedInteraction] = Field(
        default_factory=list,
        description="List of completed interactions",
    )
    pending_interaction: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Current pending interaction if any",
    )


@router.post("/interaction-history", response_model=VirtualInteractionHistoryResponse)
async def get_virtual_interaction_history(
    request: VirtualInteractionHistoryRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get interaction history from virtual database.

    Mirrors GET /workflow/{id}/interaction-history for real workflows.

    Returns all completed interactions (request + response pairs) and
    the current pending interaction if any.
    """
    try:
        # Create virtual database from provided state
        vdb = VirtualDatabase(request.virtual_db)

        # Get interaction history
        interactions = vdb.state_repo.get_interaction_history(request.virtual_run_id)

        # Get pending interaction from position
        position = vdb.state_repo.get_workflow_position(request.virtual_run_id)
        pending_data = position.get("pending_interaction")

        # Convert to response format
        completed = [
            CompletedInteraction(
                interaction_id=i.get("interaction_id", ""),
                request=i.get("request", {}),
                response=i.get("response", {}),
                step_id=i.get("step_id"),
                module_name=i.get("module_name"),
                timestamp=str(i.get("timestamp")) if i.get("timestamp") else None,
            )
            for i in interactions
        ]

        return VirtualInteractionHistoryResponse(
            interactions=completed,
            pending_interaction=pending_data,
        )

    except Exception as e:
        logger.exception("Virtual interaction-history failed: %s", e)
        return VirtualInteractionHistoryResponse(
            interactions=[],
            pending_interaction=None,
        )


# =============================================================================
# Sub-Action Endpoint
# =============================================================================


class VirtualSubActionRequest(BaseModel):
    """Request to execute a sub-action in virtual context."""

    workflow: Dict[str, Any] = Field(
        ..., description="Full resolved workflow JSON"
    )
    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON",
    )
    virtual_run_id: str = Field(
        ..., description="Virtual workflow run ID"
    )
    interaction_id: str = Field(
        ..., description="ID of the current interaction"
    )
    sub_action_id: str = Field(
        ..., description="References sub_action.id in module schema"
    )
    params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Action-specific params"
    )
    ai_config: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Runtime override for AI configuration"
    )
    mock: bool = Field(
        default=True,
        description="If true, return mock data instead of real API calls"
    )


@router.post("/sub-action")
async def execute_virtual_sub_action(
    request: VirtualSubActionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Execute a sub-action in virtual context via SSE streaming.

    Mirrors POST /workflow/{id}/sub-action for real workflows.

    The virtual_db in the final completion event contains the updated
    database state that should be sent back in subsequent requests.
    """
    vdb: Optional[VirtualDatabase] = None
    virtual_run_id = request.virtual_run_id

    logger.info(
        "Virtual sub-action - run_id=%s, sub_action_id=%s, interaction=%s",
        virtual_run_id[:8] if virtual_run_id else "none",
        request.sub_action_id,
        request.interaction_id,
    )

    async def event_generator():
        nonlocal vdb

        try:
            # Create virtual database from provided state
            vdb = VirtualDatabase(request.virtual_db)

            # Store (potentially updated) workflow as version
            workflow_template_name = request.workflow.get("workflow_id", "virtual")
            content_hash = compute_content_hash(request.workflow)

            version_id, _, _ = vdb.version_repo.process_and_store_workflow_versions(
                resolved_workflow=request.workflow,
                content_hash=content_hash,
                source_type="json",
                workflow_template_name=workflow_template_name,
                user_id=VIRTUAL_USER_ID,
            )

            # Update workflow run to use this version
            vdb.workflow_runs.update_one(
                {"workflow_run_id": virtual_run_id},
                {"$set": {"current_workflow_version_id": version_id}},
            )

            # Create processor with virtual DB
            processor = WorkflowProcessor(vdb)

            # Merge ai_config: request override takes precedence
            ai_config = {**VIRTUAL_AI_CONFIG}
            if request.ai_config:
                ai_config.update(request.ai_config)

            # Execute sub-action and stream events
            async for event in processor.sub_action_handler.execute_sub_action(
                workflow_run_id=virtual_run_id,
                interaction_id=request.interaction_id,
                sub_action_id=request.sub_action_id,
                params=request.params,
                ai_config=ai_config,
                mock_mode=request.mock,
            ):
                # For completion event, include virtual_db state
                if event.type.value == "complete":
                    event.data["virtual_db"] = vdb.export_state()
                    event.data["state"] = vdb.state_repo.get_module_outputs(
                        virtual_run_id
                    )

                yield {
                    "event": event.type.value,
                    "data": json.dumps(event.data)
                }

            logger.info(
                "Virtual sub-action completed - run_id=%s",
                virtual_run_id[:8] if virtual_run_id else "none",
            )

        except Exception as e:
            logger.exception("Virtual sub-action failed: %s", e)
            error_data = {"message": sanitize_error_message(str(e))}
            if vdb:
                error_data["virtual_db"] = vdb.export_state()
            yield {
                "event": "error",
                "data": json.dumps(error_data)
            }

    return EventSourceResponse(
        event_generator(),
        send_timeout=5,
        headers={"X-Accel-Buffering": "no"}
    )


# =============================================================================
# Generations Endpoint
# =============================================================================


class VirtualGenerationsRequest(BaseModel):
    """Request to get generations in virtual context."""

    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON",
    )
    virtual_run_id: str = Field(
        ..., description="Virtual workflow run ID"
    )
    interaction_id: str = Field(
        ..., description="ID of the interaction"
    )
    content_type: str = Field(
        ..., description="Content type to filter by (e.g., 'image', 'video')"
    )


class VirtualGenerationsResponse(BaseModel):
    """Response containing generations for an interaction."""

    generations: list = Field(
        default_factory=list,
        description="List of generation results"
    )


@router.post("/generations", response_model=VirtualGenerationsResponse)
async def get_virtual_generations(
    request: VirtualGenerationsRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get generations for an interaction in virtual context.

    Mirrors GET /workflow/{id}/interaction/{id}/generations for real workflows.

    In virtual/preview mode, this typically returns an empty list since
    there are no persisted generations. Any generations during the current
    session are handled by the frontend state.
    """
    try:
        # Create virtual database from provided state
        vdb = VirtualDatabase(request.virtual_db)

        # Get generations from virtual content repository
        generations = vdb.content_repo.get_generations_for_interaction(
            request.interaction_id, content_type=request.content_type
        )

        # Transform to frontend format (same as real endpoint)
        result = []
        for gen in generations:
            raw_content_items = gen.get("content_items", [])
            if gen.get("status") == "completed" and raw_content_items:
                urls = []
                content_items = []

                for item in raw_content_items:
                    content_id = item.get("generated_content_id")
                    # In virtual mode, we use provider URLs directly
                    # (no local storage for virtual runs)
                    url = item.get("provider_url", "")
                    urls.append(url)
                    content_items.append({
                        "content_id": content_id,
                        "url": url,
                        "content_type": item.get("content_type"),
                    })

                result.append({
                    "urls": urls,
                    "metadata_id": gen.get("content_generation_metadata_id"),
                    "content_ids": [
                        item.get("generated_content_id")
                        for item in raw_content_items
                    ],
                    "content_items": content_items,
                    "prompt_id": gen.get("prompt_id"),
                    "provider": gen.get("provider"),
                    "request_params": gen.get("request_params", {}),
                })

        return VirtualGenerationsResponse(generations=result)

    except Exception as e:
        logger.exception("Virtual generations failed: %s", e)
        return VirtualGenerationsResponse(generations=[])


# =============================================================================
# Media Preview Endpoint
# =============================================================================


class VirtualMediaPreviewRequest(BaseModel):
    """Request for media preview in virtual context."""

    provider: str = Field(
        ..., description="Media provider name (e.g., 'ideogram')"
    )
    action_type: str = Field(
        ..., description="Action type (e.g., 'txt2img')"
    )
    params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Generation parameters for preview calculation"
    )


class VirtualResolutionResponse(BaseModel):
    """Resolution information."""

    width: int
    height: int
    megapixels: float


class VirtualCreditsResponse(BaseModel):
    """Credit information."""

    credits: float
    cost_per_credit: float
    total_cost_usd: float
    num_images: int
    credits_per_image: float
    cost_per_image_usd: float


class VirtualMediaPreviewResponse(BaseModel):
    """Response for media preview."""

    resolution: VirtualResolutionResponse
    credits: VirtualCreditsResponse


@router.post("/media/preview", response_model=VirtualMediaPreviewResponse)
async def get_virtual_media_preview(
    request: VirtualMediaPreviewRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get preview information for a media generation in virtual context.

    Mirrors POST /workflow/{id}/media/preview for real workflows.

    This endpoint doesn't require virtual_db since it only calculates
    resolution and credits based on the provider and params.
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
        logger.exception("Virtual media preview failed: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to calculate preview: {str(e)}"
        )

    return VirtualMediaPreviewResponse(
        resolution=VirtualResolutionResponse(
            width=preview_info.resolution.width,
            height=preview_info.resolution.height,
            megapixels=preview_info.resolution.megapixels
        ),
        credits=VirtualCreditsResponse(
            credits=preview_info.credits.credits,
            cost_per_credit=preview_info.credits.cost_per_credit,
            total_cost_usd=preview_info.credits.total_cost_usd,
            num_images=preview_info.credits.num_images,
            credits_per_image=preview_info.credits.credits_per_image,
            cost_per_image_usd=preview_info.credits.cost_per_image_usd
        )
    )
