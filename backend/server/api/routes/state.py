"""
Workflow State API routes.

Provides endpoints for querying and streaming workflow state.
"""

import json
import hashlib
import asyncio
import threading
import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from sse_starlette.sse import EventSourceResponse

from ..dependencies import get_db, get_current_user_id, get_verified_workflow
from .streaming import active_state_streams
from utils import sanitize_error_message
from backend.workflow_engine.models import SSEEventType

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/workflow", tags=["state"])


@router.get("/{workflow_run_id}/state")
async def get_workflow_state(
    workflow_run_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Get current workflow state (all module outputs and state-mapped values).

    Returns the complete state as a dictionary.
    """
    state = db.state_repo.get_module_outputs(workflow_run_id)

    return {
        "workflow_run_id": workflow_run_id,
        "state": state
    }


@router.get("/{workflow_run_id}/state/v2")
async def get_workflow_state_v2(
    workflow_run_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Get current workflow state in hierarchical format including files.

    Returns state organized by step -> module -> outputs, plus file tree.

    Response format:
    {
        "workflow_run_id": "...",
        "state": {
            "steps": {
                "step_id": {
                    "module_name": { ...module outputs... }
                }
            },
            "state_mapped": {
                "key": value
            },
            "files": {
                "category": { ... }  # Dynamic structure based on data
            }
        }
    }
    """
    state = db.state_repo.get_full_workflow_state(workflow_run_id)

    return {
        "workflow_run_id": workflow_run_id,
        "state": state
    }


@router.get("/{workflow_run_id}/state/v2/stream")
async def stream_workflow_state_v2(
    workflow_run_id: str,
    poll_interval: float = Query(1.0, description="Polling interval in seconds"),
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Stream workflow state updates via SSE in hierarchical format including files.

    Returns full workflow state with hierarchical structure:
    {
        "steps": { step_id: { module_name: data } },
        "state_mapped": { key: value },
        "files": { ... }
    }
    """

    logger.info(f"[STATE STREAM V2] Client connected for workflow {workflow_run_id[:8]}...")

    cancel_event = threading.Event()
    stream_key = f"state_v2_{workflow_run_id}"
    active_state_streams[stream_key] = {
        "last_state_hash": None,
        "cancel_event": cancel_event
    }

    def _compute_state_hash(state: dict) -> str:
        state_str = json.dumps(state, sort_keys=True, default=str)
        return hashlib.md5(state_str.encode()).hexdigest()

    async def event_generator():
        last_hash = None

        try:
            initial_state = await asyncio.to_thread(db.state_repo.get_full_workflow_state, workflow_run_id)
            last_hash = _compute_state_hash(initial_state)

            yield {
                "event": SSEEventType.STATE_SNAPSHOT.value,
                "data": json.dumps({"state": initial_state})
            }

            while not cancel_event.is_set():
                await asyncio.sleep(poll_interval)

                if cancel_event.is_set():
                    break

                try:
                    current_state = await asyncio.to_thread(db.state_repo.get_full_workflow_state, workflow_run_id)
                    current_hash = _compute_state_hash(current_state)

                    if current_hash != last_hash:
                        yield {
                            "event": SSEEventType.STATE_SNAPSHOT.value,
                            "data": json.dumps({"state": current_state})
                        }
                        last_hash = current_hash

                except Exception as e:
                    logger.error(f"[STATE STREAM V2] Error polling state: {e}")
                    yield {
                        "event": "error",
                        "data": json.dumps({"message": "Error polling state"})
                    }
                    break

        except asyncio.CancelledError:
            logger.info(f"[STATE STREAM V2] Client disconnected for workflow {workflow_run_id[:8]}...")
        finally:
            if stream_key in active_state_streams:
                del active_state_streams[stream_key]

    return EventSourceResponse(
        event_generator(),
        send_timeout=5,
        headers={"X-Accel-Buffering": "no"}  # Disable proxy buffering (nginx, cloudflare)
    )


@router.get("/{workflow_run_id}/definition")
async def get_workflow_definition(
    workflow_run_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Get the resolved workflow definition for a workflow run.

    Returns the full workflow definition including all steps and module configurations.
    If the current version is resolved, also includes the source (parent) definition.
    """
    version_id = workflow.get("current_workflow_version_id")
    if not version_id:
        raise HTTPException(status_code=404, detail="Workflow version not found")

    result = db.version_repo.get_version_with_parent(version_id)
    if not result:
        raise HTTPException(status_code=404, detail="Workflow version not found")

    resolved_workflow = result.get("resolved_workflow")
    if not resolved_workflow:
        raise HTTPException(status_code=404, detail="Resolved workflow not found")

    response = {
        "workflow_run_id": workflow_run_id,
        "version_id": version_id,
        "definition": resolved_workflow,
    }

    parent_version = result.get("parent_version")
    if parent_version:
        response["raw_definition"] = parent_version.get("resolved_workflow")

    return response


@router.get("/{workflow_run_id}/state/stream")
async def stream_workflow_state(
    workflow_run_id: str,
    poll_interval: float = Query(1.0, description="Polling interval in seconds"),
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Stream workflow state updates via Server-Sent Events (SSE).

    On connect: sends full state snapshot (state_snapshot event)
    On changes: sends incremental updates (state_update event) with changed keys

    The client should maintain a local copy of state and apply updates.

    Events:
    - state_snapshot: Full state (on connect and periodically for sync)
    - state_update: Changed keys only (when state changes)
    - error: Error occurred
    """

    logger.info(f"[STATE STREAM] Client connected for workflow {workflow_run_id[:8]}...")

    cancel_event = threading.Event()
    stream_key = f"state_{workflow_run_id}"
    active_state_streams[stream_key] = {
        "last_state_hash": None,
        "cancel_event": cancel_event
    }

    def _compute_state_hash(state: dict) -> str:
        """Compute a hash of state for change detection."""
        state_str = json.dumps(state, sort_keys=True, default=str)
        return hashlib.md5(state_str.encode()).hexdigest()

    def _compute_state_diff(old_state: dict, new_state: dict) -> dict:
        """Compute which keys changed between old and new state."""
        if old_state is None:
            return new_state

        diff = {}
        all_keys = set(old_state.keys()) | set(new_state.keys())

        for key in all_keys:
            old_val = old_state.get(key)
            new_val = new_state.get(key)

            if old_val != new_val:
                diff[key] = new_val

        return diff

    async def event_generator():
        last_state = None
        last_hash = None

        try:
            initial_state = await asyncio.to_thread(db.state_repo.get_module_outputs, workflow_run_id)
            last_state = initial_state
            last_hash = _compute_state_hash(initial_state)

            yield {
                "event": SSEEventType.STATE_SNAPSHOT.value,
                "data": json.dumps({"state": initial_state})
            }

            while not cancel_event.is_set():
                await asyncio.sleep(poll_interval)

                if cancel_event.is_set():
                    break

                try:
                    current_state = await asyncio.to_thread(db.state_repo.get_module_outputs, workflow_run_id)
                    current_hash = _compute_state_hash(current_state)

                    if current_hash != last_hash:
                        diff = _compute_state_diff(last_state, current_state)

                        if diff:
                            yield {
                                "event": SSEEventType.STATE_UPDATE.value,
                                "data": json.dumps({
                                    "changed_keys": list(diff.keys()),
                                    "updates": diff
                                })
                            }

                        last_state = current_state
                        last_hash = current_hash

                except Exception as e:
                    logger.error(f"[STATE STREAM] Error checking state: {e}")

        except asyncio.CancelledError:
            logger.info(f"[STATE STREAM] Client disconnected for workflow {workflow_run_id[:8]}...")
        except Exception as e:
            logger.error(f"[STATE STREAM] Error: {e}")
            yield {"event": "error", "data": json.dumps({"message": sanitize_error_message(str(e))})}
        finally:
            if stream_key in active_state_streams:
                del active_state_streams[stream_key]

    return EventSourceResponse(
        event_generator(),
        send_timeout=5,
        headers={"X-Accel-Buffering": "no"}  # Disable proxy buffering (nginx, cloudflare)
    )

