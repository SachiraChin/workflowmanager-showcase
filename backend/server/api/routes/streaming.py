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

from ..dependencies import get_db, get_processor, get_current_user_id, get_verified_workflow
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
    CancelRequest,
)
from backend.db import DbEventType

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/workflow", tags=["streaming"])


@router.get("/{workflow_run_id}/stream")
async def stream_workflow(
    workflow_run_id: str,
    workflow: dict = Depends(get_verified_workflow),
    processor = Depends(get_processor),
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
    workflow: dict = Depends(get_verified_workflow),
    processor = Depends(get_processor),
):
    """
    Respond to an interaction and stream the resulting execution.

    Combines respond + stream into a single SSE connection.
    Returns SSE stream with execution events.
    """

    logger.info(f"[SSE] Stream respond for workflow {workflow_run_id[:8]}..., interaction={request.interaction_id}")
    logger.info(f"[SSE] Response data: value={request.response.value}, selected_indices={request.response.selected_indices}, form_data={request.response.form_data}")
    if request.ai_config:
        logger.info(f"[SSE] ai_config override: {request.ai_config}")

    cancel_event = threading.Event()
    active_streams[workflow_run_id] = cancel_event

    async def event_generator():
        try:
            async for event in processor.respond_stream(
                workflow_run_id=workflow_run_id,
                interaction_id=request.interaction_id,
                response=request.response,
                ai_config=request.ai_config,
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
    request: CancelRequest = CancelRequest(),
    workflow: dict = Depends(get_verified_workflow),
):
    """
    Cancel an active workflow execution.

    If the workflow has an active streaming connection, this will
    signal cancellation to abort any in-progress API calls.
    
    Request body is optional and accepts ai_config for API consistency.
    """
    # Request body is optional - ai_config not used for cancel but accepted for consistency
    # workflow is verified by get_verified_workflow dependency
    if workflow_run_id in active_streams:
        active_streams[workflow_run_id].set()
        logger.info(f"[SSE] Cancellation requested for workflow {workflow_run_id[:8]}...")
        return {"message": "Cancellation requested", "workflow_run_id": workflow_run_id}
    else:
        return {"message": "No active stream found", "workflow_run_id": workflow_run_id}


@router.post("/{workflow_run_id}/sub-action")
async def execute_sub_action(
    workflow_run_id: str,
    request: SubActionRequest,
    workflow: dict = Depends(get_verified_workflow),
    processor = Depends(get_processor),
):
    """
    Execute a sub-action via SSE streaming.

    Sub-actions allow triggering operations from within an interactive module
    without completing the interaction. The sub_action_id references a sub_action
    definition in the module's schema.

    Two sub-action types:
    - target_sub_action: Execute a chain of modules as a child workflow
    - self_sub_action: Invoke the module's own sub_action() method

    Returns SSE stream with progress and completion events.
    """
    logger.info(
        f"[SubAction] Request for workflow {workflow_run_id[:8]}..., "
        f"sub_action_id={request.sub_action_id}, interaction={request.interaction_id}"
    )
    if request.ai_config:
        logger.info(f"[SubAction] ai_config override: {request.ai_config}")

    async def event_generator():
        try:
            async for event in processor.sub_action_handler.execute_sub_action(
                workflow_run_id=workflow_run_id,
                interaction_id=request.interaction_id,
                sub_action_id=request.sub_action_id,
                params=request.params,
                ai_config=request.ai_config,
            ):
                yield {"event": event.type.value, "data": json.dumps(event.data)}
        except Exception as e:
            logger.error(f"[SubAction] Error for workflow {workflow_run_id[:8]}: {e}")
            yield {"event": "error", "data": json.dumps({"message": sanitize_error_message(str(e))})}

    return EventSourceResponse(event_generator(), send_timeout=30)


@router.get("/{workflow_run_id}/interaction/{interaction_id}/generations")
async def get_interaction_generations(
    workflow_run_id: str,
    interaction_id: str,
    content_type: str = Query(..., description="Content type to filter by (e.g., 'image', 'video')"),
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Get all generations for an interaction.

    Used to restore previously generated content when returning to
    a media generation interaction.

    Args:
        content_type: Required filter for content type (e.g., "image", "video").
                     Each step declares what it wants.

    Returns:
        List of generations with their content items, formatted for
        the MediaGeneration component.
    """

    # Get generations from content repository, filtered by content_type
    generations = db.content_repo.get_generations_for_interaction(
        interaction_id, content_type=content_type
    )

    # Transform to frontend format
    result = []
    for gen in generations:
        raw_content_items = gen.get("content_items", [])
        # Only include completed generations with content
        if gen.get("status") == "completed" and raw_content_items:
            # Build URLs - prefer server path if downloaded, fallback to provider URL
            urls = []
            content_items = []

            for item in raw_content_items:
                content_id = item.get("generated_content_id")

                if item.get("local_path") and item.get("extension"):
                    # Return relative path - client will prepend API_URL
                    extension = item.get("extension")
                    url = f"/workflow/{workflow_run_id}/media/{content_id}.{extension}"
                    urls.append(url)

                    # Build content item with resolved preview
                    content_item = {
                        "content_id": content_id,
                        "url": url,
                        "content_type": item.get("content_type"),
                    }

                    # Resolve preview if present
                    preview_id = item.get("preview_content_id")
                    if preview_id:
                        preview = db.content_repo.get_content_by_id(preview_id)
                        if preview:
                            content_item["preview"] = {
                                "content_id": preview.get("generated_content_id"),
                                "url": f"/workflow/{workflow_run_id}/media/{preview.get('generated_content_id')}.{preview.get('extension')}",
                                "content_type": preview.get("content_type"),
                            }

                    content_items.append(content_item)
                else:
                    # Fallback to provider URL for non-downloaded content
                    urls.append(item.get("provider_url"))
                    content_items.append({
                        "content_id": content_id,
                        "url": item.get("provider_url"),
                        "content_type": item.get("content_type"),
                    })

            result.append({
                "urls": urls,
                "metadata_id": gen.get("content_generation_metadata_id"),
                "content_ids": [item.get("generated_content_id") for item in raw_content_items],
                "content_items": content_items,
                "prompt_id": gen.get("prompt_id"),
                "provider": gen.get("provider"),
                "request_params": gen.get("request_params"),
            })

    return {"generations": result}
