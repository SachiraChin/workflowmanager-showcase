"""
SSE Streaming API routes.

Provides endpoints for streaming workflow execution and state updates.
"""

import json
import asyncio
import threading
import logging
from typing import Dict
from fastapi import APIRouter, HTTPException, Query, Depends
from sse_starlette.sse import EventSourceResponse

from ..dependencies import get_db, get_processor, get_current_user_id
from utils import sanitize_error_message

# =============================================================================
# Shared Stream State
# =============================================================================

# Active workflow execution streams - for cancellation support
# Maps workflow_run_id -> threading.Event (set when cancelled)
# Using threading.Event because cancellation signal crosses from async to sync threads
active_streams: Dict[str, threading.Event] = {}

# Active state streams - for state polling cancellation
# Maps stream_key -> {last_state_hash, cancel_event}
active_state_streams: Dict[str, Dict] = {}
from models import (
    RespondRequest,
    SubActionRequest,
)
from backend.server.db import DbEventType

# Import TaskQueue for the new task-based flow
from backend.worker.queue import TaskQueue

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/workflow", tags=["streaming"])


@router.get("/{workflow_run_id}/stream")
async def stream_workflow(
    workflow_run_id: str,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Stream workflow execution events via Server-Sent Events (SSE).

    This endpoint streams progress updates and results for an active workflow.
    Client disconnect will trigger cancellation of any in-progress API calls.

    Events:
    - started: Module execution began
    - progress: Token count / elapsed time update
    - interaction: User input needed (contains full InteractionRequest)
    - complete: Workflow/step completed
    - error: Error occurred
    - cancelled: Request was cancelled
    """
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    logger.info(f"[SSE] Client connected for workflow {workflow_run_id[:8]}...")

    # Create cancellation event for this stream
    cancel_event = threading.Event()
    active_streams[workflow_run_id] = cancel_event

    async def event_generator():
        try:
            async for event in processor.execute_stream(workflow_run_id, cancel_event):
                if cancel_event.is_set():
                    yield {"event": "cancelled", "data": json.dumps({})}
                    break
                yield {"event": event.type.value, "data": json.dumps(event.data)}
        except asyncio.CancelledError:
            logger.info(f"[SSE] Client disconnected for workflow {workflow_run_id[:8]}...")
            cancel_event.set()
        except Exception as e:
            logger.error(f"[SSE] Error in stream for workflow {workflow_run_id[:8]}: {e}")
            yield {"event": "error", "data": json.dumps({"message": sanitize_error_message(str(e))})}
        finally:
            if workflow_run_id in active_streams:
                del active_streams[workflow_run_id]

    return EventSourceResponse(
        event_generator(),
        send_timeout=5
    )


@router.post("/{workflow_run_id}/stream/respond")
async def stream_respond(
    workflow_run_id: str,
    request: RespondRequest,
    db = Depends(get_db),
    processor = Depends(get_processor),
    user_id: str = Depends(get_current_user_id)
):
    """
    Respond to an interaction and stream the resulting execution.

    Combines respond + stream into a single SSE connection.
    Returns SSE stream with execution events.
    """
    import time
    t_start = time.time()
    logger.info(f"[SSE TIMING] stream_respond called at t=0ms")

    t_after_processor_check = time.time()
    logger.info(f"[SSE TIMING] processor check: {(t_after_processor_check - t_start)*1000:.0f}ms")

    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    t_after_db = time.time()
    logger.info(f"[SSE TIMING] db.get_workflow: {(t_after_db - t_after_processor_check)*1000:.0f}ms")

    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    logger.info(f"[SSE] Stream respond for workflow {workflow_run_id[:8]}..., interaction={request.interaction_id}")
    logger.info(f"[SSE] Response data: value={request.response.value}, selected_indices={request.response.selected_indices}, form_data={request.response.form_data}")

    cancel_event = threading.Event()
    active_streams[workflow_run_id] = cancel_event

    async def event_generator():
        try:
            async for event in processor.respond_stream(
                workflow_run_id=workflow_run_id,
                interaction_id=request.interaction_id,
                response=request.response,
                cancel_event=cancel_event
            ):
                if cancel_event.is_set():
                    yield {"event": "cancelled", "data": json.dumps({})}
                    break
                logger.info(f"[SSE] Yielding event: {event.type.value}")
                yield {"event": event.type.value, "data": json.dumps(event.data)}
        except asyncio.CancelledError:
            logger.info(f"[SSE] Client disconnected (CancelledError) for workflow {workflow_run_id[:8]}...")
            cancel_event.set()
            logger.info(f"[SSE] cancel_event.set() called, is_set={cancel_event.is_set()}")
        except GeneratorExit:
            logger.info(f"[SSE] Client disconnected (GeneratorExit) for workflow {workflow_run_id[:8]}...")
            cancel_event.set()
            logger.info(f"[SSE] cancel_event.set() called, is_set={cancel_event.is_set()}")
        except Exception as e:
            logger.error(f"[SSE] Error in stream respond for workflow {workflow_run_id[:8]}: {e}")
            yield {"event": "error", "data": json.dumps({"message": sanitize_error_message(str(e))})}
        finally:
            logger.info(f"[SSE] Generator cleanup for workflow {workflow_run_id[:8]}, cancel_event.is_set={cancel_event.is_set()}")
            if workflow_run_id in active_streams:
                del active_streams[workflow_run_id]

    return EventSourceResponse(
        event_generator(),
        send_timeout=5
    )


@router.post("/{workflow_run_id}/cancel")
async def cancel_workflow(
    workflow_run_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    Cancel an active workflow execution.

    If the workflow has an active streaming connection, this will
    signal cancellation to abort any in-progress API calls.
    """
    if workflow_run_id in active_streams:
        active_streams[workflow_run_id].set()
        logger.info(f"[SSE] Cancellation requested for workflow {workflow_run_id[:8]}...")
        return {"message": "Cancellation requested", "workflow_run_id": workflow_run_id}
    else:
        return {"message": "No active stream found", "workflow_run_id": workflow_run_id}


# Singleton TaskQueue for sub-action endpoint
_sub_action_queue = None


def _get_sub_action_queue() -> TaskQueue:
    """Get singleton TaskQueue for sub-actions."""
    global _sub_action_queue
    if _sub_action_queue is None:
        _sub_action_queue = TaskQueue()
    return _sub_action_queue


@router.post("/{workflow_run_id}/sub-action")
async def execute_sub_action(
    workflow_run_id: str,
    request: SubActionRequest,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Create a sub-action task and return the task_id.

    Sub-actions allow triggering operations (like image generation) from
    within an interactive module without completing the interaction.

    The task is processed by a separate worker process. Use the
    /api/task/{task_id}/stream endpoint to get progress updates.

    Returns:
        task_id: The ID of the created task

    The client should then connect to /api/task/{task_id}/stream for SSE updates.
    """
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Look up module_id from interaction event
    interaction_event = db.events.find_one({
        "workflow_run_id": workflow_run_id,
        "event_type": DbEventType.INTERACTION_REQUESTED.value,
        "data.interaction_id": request.interaction_id
    })

    if not interaction_event:
        raise HTTPException(status_code=404, detail="Interaction not found")

    module_id = interaction_event.get("data", {}).get("module_id")
    if not module_id:
        raise HTTPException(status_code=400, detail="Interaction missing module_id")

    logger.info(
        f"[Task] Sub-action request for workflow {workflow_run_id[:8]}..., "
        f"module={module_id}, provider={request.provider}, action={request.action_type}, prompt={request.prompt_id}"
    )

    # Route to appropriate actor based on module_id
    if module_id == "media.generate":
        # Enqueue task for media actor
        queue = _get_sub_action_queue()
        task_id = queue.enqueue(
            actor="media",
            payload={
                "workflow_run_id": workflow_run_id,
                "interaction_id": request.interaction_id,
                "provider": request.provider,
                "action_type": request.action_type,
                "prompt_id": request.prompt_id,
                "params": request.params,
                "source_data": request.source_data,
            }
        )

        logger.info(f"[Task] Created task {task_id} for sub-action")

        return {"task_id": task_id}
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Module '{module_id}' does not support sub-actions"
        )


@router.get("/{workflow_run_id}/interaction/{interaction_id}/generations")
async def get_interaction_generations(
    workflow_run_id: str,
    interaction_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get all generations for an interaction.

    Used to restore previously generated content when returning to
    a media generation interaction.

    Returns:
        List of generations with their content items, formatted for
        the MediaGeneration component.
    """
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Get generations from content repository
    generations = db.content_repo.get_generations_for_interaction(interaction_id)

    # Transform to frontend format
    result = []
    for gen in generations:
        content_items = gen.get("content_items", [])
        # Only include completed generations with content
        if gen.get("status") == "completed" and content_items:
            # Build URLs - prefer server path if downloaded, fallback to provider URL
            urls = []
            for item in content_items:
                if item.get("local_path") and item.get("extension"):
                    # Return relative path - client will prepend API_URL
                    content_id = item.get("generated_content_id")
                    extension = item.get("extension")
                    urls.append(f"/workflow/{workflow_run_id}/media/{content_id}.{extension}")
                else:
                    # Fallback to provider URL for non-downloaded content
                    urls.append(item.get("provider_url"))

            result.append({
                "urls": urls,
                "metadata_id": gen.get("content_generation_metadata_id"),
                "content_ids": [item.get("generated_content_id") for item in content_items],
                "prompt_id": gen.get("prompt_id"),
                "provider": gen.get("provider"),
            })

    return {"generations": result}
