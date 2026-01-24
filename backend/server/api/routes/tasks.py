"""
Task Queue API routes.

Provides endpoints for creating tasks, getting task status,
and streaming task progress via SSE.
"""

import json
import asyncio
import logging
from typing import Dict, Any, Optional, List

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..dependencies import get_db, get_current_user_id

# Import TaskQueue from shared db package
from backend.db import TaskQueue

logger = logging.getLogger('workflow.api')

router = APIRouter(prefix="/api/task", tags=["tasks"])


# =============================================================================
# Request/Response Models
# =============================================================================

class CreateTaskRequest(BaseModel):
    """Request body for creating a task."""
    actor: str
    payload: Dict[str, Any]
    priority: int = 0


class CreateTaskResponse(BaseModel):
    """Response body for task creation."""
    task_id: str


class ProgressInfo(BaseModel):
    """Progress information."""
    elapsed_ms: int
    message: str
    updated_at: Optional[str] = None


class ErrorInfo(BaseModel):
    """Error information."""
    type: str
    message: str
    details: Dict[str, Any] = {}
    stack_trace: str = ""


class TaskResponse(BaseModel):
    """Full task response."""
    task_id: str
    actor: str
    status: str
    priority: int
    payload: Dict[str, Any]
    result: Optional[Dict[str, Any]] = None
    error: Optional[ErrorInfo] = None
    progress: Optional[ProgressInfo] = None
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    worker_id: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3


class TaskListResponse(BaseModel):
    """Response for listing tasks."""
    tasks: List[TaskResponse]


# =============================================================================
# Singleton TaskQueue (reuse connection)
# =============================================================================

_task_queue: Optional[TaskQueue] = None


def get_task_queue() -> TaskQueue:
    """Get singleton TaskQueue instance."""
    global _task_queue
    if _task_queue is None:
        _task_queue = TaskQueue()
    return _task_queue


# =============================================================================
# Task Endpoints
# =============================================================================

@router.post("", response_model=CreateTaskResponse)
async def create_task(
    request: CreateTaskRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    Create a new task in the queue.

    The task will be picked up and processed by the worker process.

    Args:
        request: Task creation request with actor, payload, and priority

    Returns:
        CreateTaskResponse with the new task_id
    """
    queue = get_task_queue()

    task_id = queue.enqueue(
        actor=request.actor,
        payload=request.payload,
        priority=request.priority,
    )

    logger.info(f"[Task] Created task {task_id} for actor={request.actor}")

    return CreateTaskResponse(task_id=task_id)


@router.get("/{task_id}")
async def get_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    Get task status and details.

    Args:
        task_id: The task ID to query

    Returns:
        Full task document including status, progress, result, and error
    """
    queue = get_task_queue()

    task = queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Convert datetime objects to strings for JSON serialization
    def serialize_datetime(obj):
        if obj is None:
            return None
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return str(obj)

    # Serialize datetime fields
    if task.get("progress") and task["progress"].get("updated_at"):
        task["progress"]["updated_at"] = serialize_datetime(task["progress"]["updated_at"])
    if task.get("created_at"):
        task["created_at"] = serialize_datetime(task["created_at"])
    if task.get("started_at"):
        task["started_at"] = serialize_datetime(task["started_at"])
    if task.get("completed_at"):
        task["completed_at"] = serialize_datetime(task["completed_at"])

    return task


@router.get("/{task_id}/stream")
async def stream_task(
    task_id: str,
    user_id: str = Depends(get_current_user_id)
):
    """
    Stream task progress via Server-Sent Events (SSE).

    Events:
    - progress: Status and progress update
    - complete: Task completed successfully (includes result)
    - error: Task failed (includes error details)

    The stream closes automatically when the task completes or fails.
    """
    queue = get_task_queue()

    # Verify task exists
    task = queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    logger.info(f"[Task] SSE stream started for task {task_id}")

    async def event_generator():
        last_progress_hash = None
        poll_interval = 1.0  # seconds

        try:
            while True:
                task = queue.get_task(task_id)

                if not task:
                    yield {
                        "event": "error",
                        "data": json.dumps({"message": "Task not found"})
                    }
                    return

                # Calculate progress hash to detect changes
                progress = task.get("progress", {})
                current_hash = f"{task['status']}:{progress.get('elapsed_ms', 0)}:{progress.get('message', '')}"

                # Emit progress if changed
                if current_hash != last_progress_hash:
                    # Serialize datetime in progress
                    progress_data = {
                        "elapsed_ms": progress.get("elapsed_ms", 0),
                        "message": progress.get("message", ""),
                    }
                    if progress.get("updated_at"):
                        updated_at = progress["updated_at"]
                        if hasattr(updated_at, 'isoformat'):
                            progress_data["updated_at"] = updated_at.isoformat()
                        else:
                            progress_data["updated_at"] = str(updated_at)

                    yield {
                        "event": "progress",
                        "data": json.dumps({
                            "status": task["status"],
                            "progress": progress_data,
                        })
                    }
                    last_progress_hash = current_hash

                # Check for completion
                if task["status"] == "completed":
                    result = task.get("result", {})

                    # Transform filenames to URLs for media tasks
                    if "filenames" in result and "workflow_run_id" in result:
                        workflow_run_id = result["workflow_run_id"]
                        urls = [
                            f"/workflow/{workflow_run_id}/media/{filename}"
                            for filename in result["filenames"]
                        ]
                        # Replace filenames with urls in the result
                        result = {
                            "metadata_id": result.get("metadata_id"),
                            "content_ids": result.get("content_ids", []),
                            "urls": urls,
                        }

                    yield {
                        "event": "complete",
                        "data": json.dumps({"result": result})
                    }
                    logger.info(f"[Task] SSE stream completed for task {task_id}")
                    return

                # Check for failure
                if task["status"] == "failed":
                    yield {
                        "event": "error",
                        "data": json.dumps({
                            "error": task.get("error", {})
                        })
                    }
                    logger.info(f"[Task] SSE stream ended (failed) for task {task_id}")
                    return

                # Wait before next poll
                await asyncio.sleep(poll_interval)

        except asyncio.CancelledError:
            logger.info(f"[Task] SSE stream cancelled for task {task_id}")
        except Exception as e:
            logger.error(f"[Task] SSE stream error for task {task_id}: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"message": str(e)})
            }

    return EventSourceResponse(
        event_generator(),
        send_timeout=5
    )


@router.get("/workflow/{workflow_run_id}")
async def get_tasks_for_workflow(
    workflow_run_id: str,
    limit: int = 100,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get all tasks for a workflow.

    Used to check for in-progress or completed tasks when reconnecting
    after a page refresh.

    Args:
        workflow_run_id: The workflow run ID
        limit: Maximum number of tasks to return (default 100)

    Returns:
        List of tasks for the workflow
    """
    # Verify workflow exists
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    queue = get_task_queue()
    tasks = queue.get_tasks_for_workflow(workflow_run_id, limit=limit)

    # Serialize datetime fields
    def serialize_datetime(obj):
        if obj is None:
            return None
        if hasattr(obj, 'isoformat'):
            return obj.isoformat()
        return str(obj)

    for task in tasks:
        if task.get("progress") and task["progress"].get("updated_at"):
            task["progress"]["updated_at"] = serialize_datetime(task["progress"]["updated_at"])
        if task.get("created_at"):
            task["created_at"] = serialize_datetime(task["created_at"])
        if task.get("started_at"):
            task["started_at"] = serialize_datetime(task["started_at"])
        if task.get("completed_at"):
            task["completed_at"] = serialize_datetime(task["completed_at"])

    return {"tasks": tasks}
