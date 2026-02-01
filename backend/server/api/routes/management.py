"""
Workflow Management API routes.

Provides endpoints for workflow status, resume, events, history, delete, reset.
"""

import os
import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends

from backend.db import DbEventType
from ..dependencies import get_db, get_processor, get_current_user_id
from ..api_utils import resolve_workflow_from_content, set_api_keys_from_config
from ..workflow_diff_utils import compute_workflow_diff
from models import (
    ResumeWorkflowRequest,
    WorkflowResponse,
    WorkflowStatusResponse,
    WorkflowStatus,
    WorkflowProgress,
    EventsResponse,
    EventResponse,
    InteractionHistoryResponse,
    CompletedInteraction,
    ApiInteractionRequest,
    ApiInteractionType,
)

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/workflow", tags=["management"])


@router.get("/{workflow_run_id}/status", response_model=WorkflowStatusResponse)
async def get_workflow_status(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """Get current status of a workflow"""
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    position = db.state_repo.get_workflow_position(workflow_run_id)
    status = WorkflowStatus(workflow.get("status", "created"))

    interaction_request = None
    if status == WorkflowStatus.AWAITING_INPUT:
        events = db.event_repo.get_events(
            workflow_run_id=workflow_run_id,
            event_type="interaction_requested",
            limit=1
        )
        if events:
            interaction_data = events[0].get("data", {})
            if interaction_data:
                interaction_request = interaction_data

    return WorkflowStatusResponse(
        workflow_run_id=workflow_run_id,
        project_name=workflow.get("project_name", ""),
        workflow_template_name=workflow.get("workflow_template_name", "default"),
        status=status,
        progress=WorkflowProgress(
            current_step=position.get("current_step"),
            completed_steps=position.get("completed_steps", []),
            total_steps=0,
            step_index=len(position.get("completed_steps", []))
        ),
        interaction_request=interaction_request,
        created_at=workflow.get("created_at"),
        updated_at=workflow.get("updated_at")
    )


@router.post("/{workflow_run_id}/resume", response_model=WorkflowResponse)
async def resume_workflow(
    workflow_run_id: str,
    request: Optional[ResumeWorkflowRequest] = None,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Resume an existing workflow by ID.

    Supports two modes:
    1. Simple resume: No workflow_content, loads stored definition
    2. Resume with update: Provide workflow_content to update before resuming
       - If version changed, returns requires_confirmation with version diff
       - Use /resume/confirm endpoint to confirm the update

    Returns:
    - If awaiting_input: Returns pending interaction
    - If processing: Returns processing status (client should connect to SSE)
    - If completed: Returns completed status
    - If error: Returns error status with message
    - If version changed: Returns requires_confirmation with diff
    """
    try:
        user_owns, workflow_exists = db.workflow_repo.workflow_run_exists(user_id, workflow_run_id)
        if not workflow_exists:
            raise HTTPException(status_code=404, detail="Workflow not found")
        if not user_owns:
            raise HTTPException(status_code=403, detail="Access denied")

        recovery = db.recover_workflow(workflow_run_id)
        if recovery:
            logger.info(f"[RESUME] Applied recovery: {recovery['reason']}")

        workflow = db.workflow_repo.get_workflow(workflow_run_id)

        current_version_id = workflow.get("current_workflow_version_id")
        if not current_version_id:
            logger.error(f"[RESUME] No current_workflow_version_id for workflow {workflow_run_id}")
            raise HTTPException(status_code=500, detail="Workflow version not found - no version ID")

        current_version = db.version_repo.get_workflow_version_by_id(current_version_id)
        if not current_version:
            logger.error(f"[RESUME] Version not found for version_id {current_version_id}")
            raise HTTPException(status_code=500, detail="Workflow version not found")

        stored_workflow = current_version.get("resolved_workflow", {})

        if request and request.workflow_content:
            logger.debug(f"[RESUME] Resume with update requested for workflow {workflow_run_id}")
            try:
                new_workflow, new_hash, source_type = resolve_workflow_from_content(
                    request.workflow_content,
                    request.workflow_entry_point
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

            current_version_type = current_version.get("version_type")
            if current_version_type == "resolved":
                parent_id = current_version.get("parent_workflow_version_id")
                source_version = db.version_repo.get_workflow_version_by_id(parent_id) if parent_id else current_version
            else:
                source_version = current_version

            source_hash = source_version.get("content_hash", "") if source_version else ""
            source_workflow = source_version.get("resolved_workflow", {}) if source_version else {}

            if new_hash != source_hash:
                diff = compute_workflow_diff(source_workflow, new_workflow)
                logger.debug(f"[RESUME] Version change detected: {diff['summary']}")

                return WorkflowResponse(
                    workflow_run_id=workflow_run_id,
                    status=WorkflowStatus.CREATED,
                    message="Workflow version changed - confirmation required",
                    result={
                        "requires_confirmation": True,
                        "version_diff": diff,
                        "old_hash": source_hash,
                        "new_hash": new_hash
                    }
                )

            logger.debug(f"[RESUME] No version change, continuing with resume")

        steps = stored_workflow.get("steps", [])

        position = db.state_repo.get_workflow_position(workflow_run_id)
        current_status = WorkflowStatus(workflow.get("status", "created"))

        progress = WorkflowProgress(
            current_step=position.get("current_step"),
            completed_steps=position.get("completed_steps", []),
            total_steps=len(steps),
            step_index=len(position.get("completed_steps", []))
        )

        pending_interaction = position.get("pending_interaction")
        logger.debug(f"[RESUME] workflow={workflow_run_id}, status={current_status}, has_pending={pending_interaction is not None}")
        if pending_interaction:
            logger.debug(f"[RESUME] Returning pending interaction type={pending_interaction.get('interaction_type')}")
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.AWAITING_INPUT,
                message="Pending interaction",
                interaction_request=pending_interaction,
                progress=progress
            )

        if current_status == WorkflowStatus.COMPLETED:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.COMPLETED,
                message="Workflow completed",
                progress=progress
            )

        if current_status == WorkflowStatus.ERROR:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                message="Workflow in error state",
                error=workflow.get("error_message"),
                progress=progress
            )

        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=current_status,
            message="Workflow is processing" if current_status == WorkflowStatus.PROCESSING else "Workflow ready",
            progress=progress
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[RESUME] Unexpected error resuming workflow {workflow_run_id}")
        raise HTTPException(status_code=500, detail=f"Failed to resume workflow: {str(e)}")


@router.post("/{workflow_run_id}/resume/confirm", response_model=WorkflowResponse)
async def confirm_resume_with_update(
    workflow_run_id: str,
    request: ResumeWorkflowRequest,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Confirm resume with updated workflow after version change was detected.

    Called after /resume returns requires_confirmation=True.
    Creates new version and resumes execution with it.
    """
    try:
        workflow = db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            raise HTTPException(status_code=404, detail="Workflow not found")

        if workflow.get("user_id") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")

        if not request.workflow_content:
            raise HTTPException(status_code=400, detail="workflow_content is required for confirm")

        try:
            new_workflow, new_hash, source_type = resolve_workflow_from_content(
                request.workflow_content,
                request.workflow_entry_point
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        workflow_template_name = new_workflow.get("workflow_id")
        if not workflow_template_name:
            raise HTTPException(status_code=400, detail="Workflow JSON missing 'workflow_id' field")

        version_id, template_id, is_new = db.version_repo.process_and_store_workflow_versions(
            resolved_workflow=new_workflow,
            content_hash=new_hash,
            source_type=source_type,
            workflow_template_name=workflow_template_name,
            user_id=user_id
        )
        logger.debug(f"[RESUME CONFIRM] Created/got version: {version_id}, is_new={is_new}")

        ai_config = request.ai_config or {}
        if 'openai_api_key' in ai_config:
            os.environ['OPENAI_API_KEY'] = ai_config['openai_api_key']
        if 'anthropic_api_key' in ai_config:
            os.environ['ANTHROPIC_API_KEY'] = ai_config['anthropic_api_key']

        result = await asyncio.to_thread(
            processor.resume_workflow_with_update,
            workflow_run_id=workflow_run_id,
            version_id=version_id,
            user_id=user_id,
            ai_config=ai_config,
            capabilities=request.capabilities
        )

        logger.debug(f"[RESUME CONFIRM] Updated workflow {workflow_run_id} with new version {version_id}")
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"[RESUME CONFIRM] Unexpected error confirming resume for {workflow_run_id}")
        raise HTTPException(status_code=500, detail=f"Failed to confirm resume: {str(e)}")


@router.get("/{workflow_run_id}/events", response_model=EventsResponse)
async def get_workflow_events(
    workflow_run_id: str,
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    module_name: Optional[str] = Query(None, description="Filter by module name"),
    limit: Optional[int] = Query(None, description="Limit number of events"),
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get events for a workflow.

    Events are returned in chronological order.
    Use filters to narrow down results.
    """
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    events = db.event_repo.get_events(
        workflow_run_id=workflow_run_id,
        event_type=event_type,
        module_name=module_name,
        limit=limit
    )

    return EventsResponse(
        workflow_run_id=workflow_run_id,
        events=[
            EventResponse(
                event_id=e.get("event_id", ""),
                event_type=e.get("event_type", ""),
                timestamp=e.get("timestamp"),
                step_id=e.get("step_id"),
                module_name=e.get("module_name"),
                data=e.get("data", {})
            )
            for e in events
        ],
        total_count=len(events)
    )


@router.get("/{workflow_run_id}/interaction-history", response_model=InteractionHistoryResponse)
async def get_interaction_history(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get interaction history for a workflow.

    Returns all completed interactions (request + response pairs) in chronological order.
    Also includes the current pending interaction if one exists.

    Used by WebUI to display scrollable interaction history.
    """
    user_owns, exists = db.workflow_repo.workflow_run_exists(user_id, workflow_run_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not user_owns:
        raise HTTPException(status_code=403, detail="Access denied")

    interactions = db.state_repo.get_interaction_history(workflow_run_id)

    position = db.state_repo.get_workflow_position(workflow_run_id)
    pending_data = position.get("pending_interaction")

    pending_interaction = None
    if pending_data:
        try:
            pending_interaction = ApiInteractionRequest(
                interaction_id=pending_data.get("interaction_id", ""),
                interaction_type=ApiInteractionType(pending_data.get("interaction_type", "text_input")),
                title=pending_data.get("title", ""),
                prompt=pending_data.get("prompt", ""),
                description=pending_data.get("description", ""),
                options=pending_data.get("options", []),
                min_selections=pending_data.get("min_selections", 1),
                max_selections=pending_data.get("max_selections", 1),
                groups=pending_data.get("groups", {}),
                display_data=pending_data.get("display_data", {}),
                multiline=pending_data.get("multiline", False),
                placeholder=pending_data.get("placeholder", ""),
                default_value=pending_data.get("default_value", ""),
                context=pending_data.get("context", {}),
            )
        except Exception:
            pass

    return InteractionHistoryResponse(
        workflow_run_id=workflow_run_id,
        interactions=[
            CompletedInteraction(
                interaction_id=i.get("interaction_id", ""),
                request=i.get("request", {}),
                response=i.get("response", {}),
                timestamp=i.get("timestamp"),
                step_id=i.get("step_id"),
                module_name=i.get("module_name"),
            )
            for i in interactions
        ],
        pending_interaction=pending_interaction,
    )


@router.get("/{workflow_run_id}/interaction/{interaction_id}/data")
async def get_interaction_data(
    workflow_run_id: str,
    interaction_id: str,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get resolved display_data for an interaction using current workflow state.

    This endpoint re-resolves the module's inputs against the current state,
    ensuring the returned display_data includes any updates from sub-actions.

    Used by WebUI:
    - On page load after getting pending interaction
    - After sub-action completes to refresh the view

    Returns:
        display_data dict with resolved data from current state
    """
    from workflow.workflow_utils import get_workflow_def, rebuild_services

    # Verify access
    user_owns, exists = db.workflow_repo.workflow_run_exists(user_id, workflow_run_id)
    if not exists:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not user_owns:
        raise HTTPException(status_code=403, detail="Access denied")

    # Find the interaction_requested event
    interaction_event = db.events.find_one({
        "workflow_run_id": workflow_run_id,
        "event_type": "interaction_requested",
        "data.interaction_id": interaction_id,
    })
    if not interaction_event:
        raise HTTPException(status_code=404, detail="Interaction not found")

    step_id = interaction_event.get("step_id")
    module_name = interaction_event.get("module_name")
    event_data = interaction_event.get("data", {})
    module_id = event_data.get("module_id")

    if not module_id:
        raise HTTPException(status_code=400, detail="Interaction missing module_id")

    # Get workflow and definition
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    workflow_def = get_workflow_def(workflow, db, logger)

    # Find module config in workflow definition
    module_config = None
    for step in workflow_def.get("steps", []):
        if step.get("step_id") == step_id:
            for mod in step.get("modules", []):
                if mod.get("name") == module_name:
                    module_config = mod
                    break
            break

    if not module_config:
        raise HTTPException(status_code=404, detail=f"Module config not found: {step_id}/{module_name}")

    # Rebuild services for resolution
    services = rebuild_services(workflow, workflow_def, db, logger)

    try:
        # Use executor helper to resolve display_data
        display_data = processor.executor.resolve_interaction_display_data(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            module_name=module_name,
            module_id=module_id,
            module_config=module_config,
            workflow_def=workflow_def,
            services=services,
            user_id=user_id,
        )
        return {"display_data": display_data}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{workflow_run_id}")
async def delete_workflow(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """Delete a workflow and all its events"""
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Delete from all related collections
    db.event_repo.delete_workflow_events(workflow_run_id)
    db.branch_repo.delete_workflow_branches(workflow_run_id)
    db.token_repo.delete_workflow_tokens(workflow_run_id)
    db.workflow_repo.delete_workflow(workflow_run_id)
    return {"message": "Workflow deleted", "workflow_run_id": workflow_run_id}


@router.post("/{workflow_run_id}/reset")
async def reset_workflow(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """Reset a workflow - clear all events but keep workflow record"""
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Delete all events for this workflow
    db.event_repo.delete_workflow_events(workflow_run_id)

    # Reset workflow status
    db.workflow_repo.reset_workflow(workflow_run_id)

    # Store WORKFLOW_CREATED event with reset flag
    branch_id = workflow.get("current_branch_id")
    version_id = workflow.get("current_workflow_version_id")
    db.event_repo.store_event(
        workflow_run_id=workflow_run_id,
        event_type=DbEventType.WORKFLOW_CREATED,
        data={
            "project_name": workflow.get("project_name"),
            "workflow_template_name": workflow.get("workflow_template_name"),
            "workflow_template_id": workflow.get("workflow_template_id"),
            "version_id": version_id,
            "reset": True,
        },
        branch_id=branch_id,
        workflow_version_id=version_id,
    )

    return {"message": "Workflow reset", "workflow_run_id": workflow_run_id}


@router.get("/{workflow_run_id}/tokens")
async def get_workflow_tokens(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get all token usage records for a workflow.

    Returns array of token usage events with step/module context.
    """
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    tokens = db.token_repo.get_token_usage(workflow_run_id)
    return {"workflow_run_id": workflow_run_id, "tokens": tokens}


@router.get("/{workflow_run_id}/status-display")
async def get_workflow_status_display(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get status display data for a workflow.

    Returns:
    - Workflow metadata (id, project_name, status, timestamps)
    - Dynamic fields resolved from workflow's status_display config
    - Layout for display arrangement
    """
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    workflow_path = workflow.get("workflow_path")

    module_outputs = db.state_repo.get_module_outputs(workflow_run_id)

    display_fields = []
    layout = []

    if workflow_path:
        try:
            import json
            from jinja2 import Environment, BaseLoader, UndefinedError

            if os.path.exists(workflow_path):
                with open(workflow_path, 'r', encoding='utf-8') as f:
                    workflow_config = json.load(f)

                status_display_config = workflow_config.get('status_display', {})
                fields_config = status_display_config.get('fields', [])
                layout = status_display_config.get('layout', [])

                position = db.state_repo.get_workflow_position(workflow_run_id)
                current_step_name = position.get('current_step', '')

                env = Environment(loader=BaseLoader())

                for field in fields_config:
                    field_id = field.get('id')
                    label = field.get('label', field_id)
                    template_str = field.get('value', '')

                    try:
                        template = env.from_string(template_str)
                        value = template.render(
                            state=module_outputs,
                            current_step_name=current_step_name
                        )
                        if value and value.strip() and value.strip() != 'None':
                            display_fields.append({
                                'id': field_id,
                                'label': label,
                                'value': value.strip()
                            })
                    except (UndefinedError, Exception):
                        pass
        except Exception:
            pass

    # Remove MongoDB _id before returning
    workflow_data = {k: v for k, v in workflow.items() if k != "_id"}
    return {
        **workflow_data,
        "display_fields": display_fields,
        "layout": layout
    }
