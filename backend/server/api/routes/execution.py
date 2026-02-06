"""
Workflow Execution API routes.

Provides endpoints for starting, responding to, and retrying workflows.
"""

import os
import json
import time
import asyncio
import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import Response

from ..dependencies import get_db, get_processor, get_current_user_id
from ..api_utils import resolve_workflow_from_content, summarize_response, set_api_keys_from_config
from ..workflow_diff_utils import compute_workflow_diff
from models import (
    StartWorkflowRequest,
    StartWorkflowByVersionRequest,
    RespondRequest,
    RetryRequest,
    WorkflowResponse,
    WorkflowStatus,
)

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/workflow", tags=["execution"])


@router.post("/start", response_model=WorkflowResponse)
async def start_workflow(
    request: StartWorkflowRequest,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Start a new workflow with uploaded content.

    Accepts workflow content as:
    - dict: Pre-resolved workflow JSON (all $refs already expanded)
    - str: Base64-encoded zip file containing workflow folder

    For zip content, workflow_entry_point specifies the main workflow file.

    If a different version already exists for this template, returns requires_confirmation
    with a diff. Use /start/confirm to proceed with the new version.

    For starting with an existing stored version, use POST /start/{version_id} instead.
    """
    start_time = time.time()
    logger.info(f"[API REQUEST] POST /workflow/start - project={request.project_name}, force_new={request.force_new}, user_id={user_id}, capabilities={request.capabilities}")

    # 1. Resolve workflow content (zip or JSON)
    try:
        resolved_workflow, content_hash, source_type = resolve_workflow_from_content(
            request.workflow_content,
            request.workflow_entry_point
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 2. Extract workflow_template_name from resolved workflow
    workflow_template_name = resolved_workflow.get('workflow_id')
    if not workflow_template_name:
        raise HTTPException(
            status_code=400,
            detail="Workflow JSON missing 'workflow_id' field"
        )

    logger.debug(f"[WORKFLOW] Resolved workflow: template={workflow_template_name}, hash={content_hash[:20]}..., source={source_type}")

    # 3. Check for existing source version (raw or unresolved) with different hash
    existing_version = db.version_repo.get_latest_source_version(workflow_template_name, user_id)
    if existing_version:
        if existing_version.get("content_hash") == content_hash:
            # Same version exists - use it (no diff needed)
            version_id = existing_version.get("workflow_version_id")
            logger.debug(f"[WORKFLOW] Found existing version with same hash: {version_id}")
        else:
            # Different version exists - compute diff and return for confirmation
            old_workflow = existing_version.get("resolved_workflow", {})
            diff = compute_workflow_diff(old_workflow, resolved_workflow)

            logger.debug(f"[WORKFLOW] Version change detected: {diff['summary']}")

            return WorkflowResponse(
                workflow_run_id="",
                status=WorkflowStatus.CREATED,
                message="Workflow version changed - confirmation required",
                result={
                    "requires_confirmation": True,
                    "version_diff": diff,
                    "old_hash": existing_version.get("content_hash"),
                    "new_hash": content_hash
                }
            )
    else:
        # No existing version - create source version and resolve execution groups
        version_id, template_id, is_new = db.version_repo.process_and_store_workflow_versions(
            resolved_workflow=resolved_workflow,
            content_hash=content_hash,
            source_type=source_type,
            workflow_template_name=workflow_template_name,
            user_id=user_id
        )
        logger.debug(f"[WORKFLOW] Created new version: {version_id}")

    # 4. Set API keys in environment
    ai_config = request.ai_config or {}
    set_api_keys_from_config(ai_config)

    # 5. Call processor with version_id
    result = await asyncio.to_thread(
        processor.start_workflow,
        version_id=version_id,
        project_name=request.project_name,
        workflow_template_name=workflow_template_name,
        user_id=user_id,
        ai_config=ai_config,
        force_new=request.force_new,
        capabilities=request.capabilities
    )

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"[API RESPONSE] POST /workflow/start - status={result.status}, workflow_run_id={result.workflow_run_id}, elapsed={elapsed_ms:.0f}ms")

    return result


@router.post("/start/confirm", response_model=WorkflowResponse)
async def confirm_workflow_start(
    request: StartWorkflowRequest,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Confirm and start a workflow after version change was detected.

    This is called after /start returns requires_confirmation=True.
    The workflow will be started with the new version (user confirmed the diff).
    """
    start_time = time.time()
    logger.info(f"[API REQUEST] POST /workflow/start/confirm - project={request.project_name}, force_new={request.force_new}, user_id={user_id}")

    # 1. Resolve workflow content
    try:
        resolved_workflow, content_hash, source_type = resolve_workflow_from_content(
            request.workflow_content,
            request.workflow_entry_point
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    workflow_template_name = resolved_workflow.get('workflow_id')
    if not workflow_template_name:
        raise HTTPException(status_code=400, detail="Workflow JSON missing 'workflow_id' field")

    # 2. Create source version and resolve execution groups
    version_id, template_id, is_new = db.version_repo.process_and_store_workflow_versions(
        resolved_workflow=resolved_workflow,
        content_hash=content_hash,
        source_type=source_type,
        workflow_template_name=workflow_template_name,
        user_id=user_id
    )
    logger.debug(f"[WORKFLOW] Confirmed version: {version_id}, is_new={is_new}")

    # 3. Set API keys in environment
    ai_config = request.ai_config or {}
    set_api_keys_from_config(ai_config)

    # 4. Call processor with version_id
    result = await asyncio.to_thread(
        processor.start_workflow,
        version_id=version_id,
        project_name=request.project_name,
        workflow_template_name=workflow_template_name,
        user_id=user_id,
        ai_config=ai_config,
        force_new=request.force_new,
        capabilities=request.capabilities
    )

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"[API RESPONSE] POST /workflow/start/confirm - status={result.status}, workflow_run_id={result.workflow_run_id}, elapsed={elapsed_ms:.0f}ms")

    return result


@router.post("/start/{workflow_version_id:non_reserved}", response_model=WorkflowResponse)
async def start_workflow_by_version(
    workflow_version_id: str,
    request: StartWorkflowByVersionRequest,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Start a workflow with an existing version.

    This endpoint is used when starting from a stored version (e.g., from template selection).
    The version_id should be a source version (raw or unresolved), not a resolved version.

    The processor will:
    1. If version has execution groups (unresolved), select best resolved version based on capabilities
    2. If version is raw (no execution groups), use directly
    3. Create or resume workflow run
    4. Execute

    Use POST /start (with content) for uploading new workflow content.
    """
    start_time = time.time()
    logger.info(f"[API REQUEST] POST /workflow/start/{workflow_version_id} - project={request.project_name}, user_id={user_id}")

    # 1. Validate version exists
    version = db.version_repo.get_workflow_version_by_id(workflow_version_id)
    if not version:
        raise HTTPException(status_code=404, detail=f"Workflow version not found: {workflow_version_id}")

    # 2. Validate version_type is source (raw or unresolved), not resolved
    version_type = version.get("version_type")
    if version_type == "resolved":
        raise HTTPException(
            status_code=400,
            detail="Cannot start with a resolved version. Use the source version (raw or unresolved) from /workflow-templates."
        )

    # 3. Get workflow_template_name and template scope
    template = db.version_repo.get_template_by_id(version.get("workflow_template_id"))
    if not template:
        raise HTTPException(status_code=500, detail="Could not find template for this version")

    template_scope = template.get("scope") or "user"
    template_owner = template.get("user_id")
    if template_scope != "global" and template_owner != user_id:
        raise HTTPException(status_code=403, detail="Access denied")

    resolved_workflow = version.get("resolved_workflow") or {}
    workflow_template_name = resolved_workflow.get("workflow_id") or template.get(
        "workflow_template_name"
    )

    # 4. Validate version has content
    if not resolved_workflow:
        raise HTTPException(status_code=500, detail="Version is missing resolved_workflow content")

    selected_version_id = workflow_version_id
    if template_scope == "global":
        global_template_id = template.get("workflow_template_id")
        hidden_template_id, _, _ = db.version_repo.get_or_create_hidden_template(
            global_template_id=global_template_id,
            user_id=user_id,
        )
        db.version_repo.sync_template_versions(
            source_template_id=global_template_id,
            target_template_id=hidden_template_id,
        )
        content_hash = version.get("content_hash")
        if not content_hash:
            raise HTTPException(
                status_code=500,
                detail="Global version missing content hash",
            )
        hidden_version = db.version_repo.get_version_by_content_hash(
            template_id=hidden_template_id,
            content_hash=content_hash,
        )
        if not hidden_version:
            raise HTTPException(
                status_code=500,
                detail="Failed to sync global version for user",
            )
        selected_version_id = hidden_version.get("workflow_version_id")

    # 5. Set API keys in environment
    ai_config = request.ai_config or {}
    set_api_keys_from_config(ai_config)

    # 6. Call processor with version_id
    result = await asyncio.to_thread(
        processor.start_workflow,
        version_id=selected_version_id,
        project_name=request.project_name,
        workflow_template_name=workflow_template_name,
        user_id=user_id,
        ai_config=ai_config,
        force_new=request.force_new,
        capabilities=request.capabilities,
    )

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"[API RESPONSE] POST /workflow/start/{workflow_version_id} - status={result.status}, "
               f"workflow_run_id={result.workflow_run_id}, elapsed={elapsed_ms:.0f}ms")

    return result


@router.get("/check")
async def check_existing_workflow(
    project_name: str = Query(..., description="Project name to check"),
    workflow_template_name: str = Query(..., description="Workflow template name (workflow_run_id from JSON)"),
    workflow_template_id: str = Query(None, description="Workflow template ID"),
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Check if an active workflow exists for user, project, and template.

    Unique key: user_id + workflow_template_name + project_name

    Returns:
    - exists: True if an active workflow exists
    - workflow_run_id: ID of the existing workflow (if exists)
    - status: Current status of the workflow (if exists)
    - current_step: Current step name (if exists)
    - current_module: Current module name (if exists)
    """
    workflow = db.workflow_repo.get_workflow_by_project(
        user_id,
        project_name,
        workflow_template_name,
        workflow_template_id=workflow_template_id,
    )
    if workflow:
        return {
            "exists": True,
            "workflow_run_id": workflow.get("workflow_run_id"),
            "status": workflow.get("status"),
            "current_step": workflow.get("current_step"),
            "current_module": workflow.get("current_module"),
            "created_at": workflow.get("created_at"),
            "updated_at": workflow.get("updated_at")
        }
    return {"exists": False}


@router.post("/respond")
async def respond_to_interaction(
    request: RespondRequest,
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Respond to a pending interaction.

    The interaction_id must match the pending interaction's ID.

    Returns the next workflow state (may be another interaction or completion).
    """
    start_time = time.time()

    # Log request - summarize response content
    response_summary = summarize_response(request.response)
    logger.info(f"[API REQUEST] POST /workflow/respond - workflow={request.workflow_run_id[:8]}..., interaction={request.interaction_id}, response={response_summary}")

    result = await asyncio.to_thread(
        processor.respond,
        workflow_run_id=request.workflow_run_id,
        interaction_id=request.interaction_id,
        response=request.response,
        ai_config=request.ai_config
    )

    # Convert to dict and serialize
    response_dict = result.model_dump()
    json_str = json.dumps(response_dict)

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"[API RESPONSE] POST /workflow/respond - status={result.status}, elapsed={elapsed_ms:.0f}ms")

    return Response(content=json_str, media_type="application/json")


@router.post("/retry", response_model=WorkflowResponse)
async def retry_module(
    request: RetryRequest,
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Retry a specific module with optional feedback.

    The target_module should be the module name (from 'name' field in workflow config).
    Feedback will be included in the API call to guide regeneration.
    """
    start_time = time.time()
    feedback_summary = request.feedback[:50] + "..." if request.feedback and len(request.feedback) > 50 else request.feedback
    logger.info(f"[API REQUEST] POST /workflow/retry - workflow={request.workflow_run_id[:8]}..., target={request.target_module}, feedback={feedback_summary}")
    if request.ai_config:
        logger.info(f"[API REQUEST] ai_config override: {request.ai_config}")

    result = await asyncio.to_thread(
        processor.retry,
        workflow_run_id=request.workflow_run_id,
        target_module=request.target_module,
        feedback=request.feedback,
        ai_config=request.ai_config
    )

    elapsed_ms = (time.time() - start_time) * 1000
    logger.info(f"[API RESPONSE] POST /workflow/retry - status={result.status}, elapsed={elapsed_ms:.0f}ms")

    return result
