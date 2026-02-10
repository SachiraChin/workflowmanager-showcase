"""
Virtual Workflow Execution API routes.

Provides endpoints for running modules in virtual context using mongomock.
These endpoints mirror the real workflow endpoints for exact parity:

    Real                        Virtual
    POST /workflow/start    →   POST /workflow/virtual/start
    POST /workflow/respond  →   POST /workflow/virtual/respond

The virtual database state is transferred as a gzip-compressed, base64-encoded
string to minimize bandwidth usage.
"""

import hashlib
import json
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.db.virtual import VIRTUAL_USER_ID, VirtualDatabase
from models import (
    ExecutionTarget,
    InteractionResponseData,
    VirtualWorkflowResponse,
    WorkflowResponse,
    WorkflowStatus,
)
from workflow import WorkflowProcessor

from ..dependencies import get_current_user_id

logger = logging.getLogger("workflow.virtual")

router = APIRouter(prefix="/workflow/virtual", tags=["virtual"])

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

        # Call processor.start_workflow (same as real /start)
        # This creates workflow_run, branch, and executes up to target
        result = processor.start_workflow(
            version_id=version_id,
            project_name="virtual_project",
            workflow_template_name=workflow_template_name,
            user_id=VIRTUAL_USER_ID,
            ai_config=VIRTUAL_AI_CONFIG,
            force_new=True,  # Always fresh for virtual
            target=target,
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
