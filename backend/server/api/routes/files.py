"""
Workflow Files API routes.

Provides endpoints for accessing workflow files and API call logs.
Used by TUI debug mode for file synchronization.
Also serves downloaded media files (images/videos).
"""

import os
from typing import Dict, Any, Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from fastapi.responses import FileResponse

from backend.server.api.dependencies import get_db, get_current_user_id

router = APIRouter(prefix="/workflow", tags=["files"])


def _serialize_file_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Serialize MongoDB file document for JSON response."""
    result = {}
    for key, value in doc.items():
        if key == '_id':
            result['_id'] = str(value)
        elif hasattr(value, 'isoformat'):
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result


@router.get("/{workflow_run_id}/files")
async def get_workflow_files(
    workflow_run_id: str,
    category: Optional[str] = Query(None, description="Filter by category: api_calls, outputs, root"),
    step_id: Optional[str] = Query(None, description="Filter by step_id"),
    since: Optional[str] = Query(None, description="ISO timestamp to fetch files created after"),
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get all files for a workflow run.

    Used by TUI FileManager to sync files to local filesystem.
    Supports incremental sync via 'since' parameter.

    Response includes workflow_state for FileManager to know when to stop polling.
    """
    files = db.file_repo.get_workflow_files(
        workflow_run_id, category=category, since=since, step_id=step_id
    )

    serialized_files = [_serialize_file_doc(f) for f in files]

    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    workflow_state = None
    if workflow:
        status = workflow.get("status", "running")
        workflow_state = {
            "status": status,
            "current_step": workflow.get("current_step", ""),
            "current_step_name": workflow.get("current_step_name", "")
        }

    return {
        "files": serialized_files,
        "count": len(serialized_files),
        "workflow_state": workflow_state
    }


@router.get("/{workflow_run_id}/files/{file_id}")
async def get_workflow_file(
    workflow_run_id: str,
    file_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get a specific file by ID.
    """
    file_doc = db.file_repo.get_workflow_file(file_id)

    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")

    if file_doc.get('workflow_run_id') != workflow_run_id:
        raise HTTPException(status_code=404, detail="File not found")

    return _serialize_file_doc(file_doc)


@router.get("/{workflow_run_id}/api-calls")
async def list_api_calls(
    workflow_run_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    List all API calls for a workflow run (grouped by group_id).
    """
    api_calls = db.file_repo.list_api_calls(workflow_run_id)
    return {"api_calls": api_calls, "count": len(api_calls)}


@router.get("/{workflow_run_id}/api-calls/{group_id}")
async def get_api_call_files(
    workflow_run_id: str,
    group_id: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get all files for a specific API call.
    """
    files = db.file_repo.get_api_call_files(workflow_run_id, group_id)
    return {"files": list(files.values()), "count": len(files)}


# =============================================================================
# Media File Serving
# =============================================================================

# Content-Type mapping for media files
MEDIA_CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
}


@router.get("/{workflow_run_id}/media/{content_id}.{extension}")
async def get_media_file(
    workflow_run_id: str,
    content_id: str,
    extension: str,
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Serve a downloaded media file.

    Validates that:
    - Content exists in database
    - Content belongs to the specified workflow
    - Extension matches stored extension
    - Local file exists

    Returns the file with appropriate Content-Type and cache headers.
    """
    # Look up content in database
    content = db.content_repo.get_content_by_id(content_id)

    if not content:
        raise HTTPException(status_code=404, detail="Content not found")

    # Verify workflow ownership
    if content.get("workflow_run_id") != workflow_run_id:
        raise HTTPException(status_code=404, detail="Content not found")

    # Verify extension matches
    stored_extension = content.get("extension")
    if stored_extension != extension:
        raise HTTPException(status_code=404, detail="Content not found")

    # Get local path
    local_path = content.get("local_path")
    if not local_path:
        raise HTTPException(status_code=404, detail="Content not downloaded")

    # Verify file exists
    if not os.path.exists(local_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Determine content type
    content_type = MEDIA_CONTENT_TYPES.get(extension.lower(), "application/octet-stream")

    # Return file with cache headers (1 year - content is immutable)
    return FileResponse(
        path=local_path,
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
        }
    )
