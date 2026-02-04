"""
Workflow Files API routes.

Provides endpoints for accessing workflow files and API call logs.
Used by TUI debug mode for file synchronization.
Also serves downloaded media files (images/videos).
Includes bulk download as ZIP functionality.
"""

import io
import json
import os
import zipfile
from typing import Dict, Any, Optional, List
from fastapi import APIRouter, HTTPException, Query, Depends, Request
from fastapi.responses import FileResponse, StreamingResponse

from ..dependencies import get_db, get_current_user_id, get_verified_workflow
from backend.db.path_utils import resolve_local_path

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
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
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
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
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
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
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
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
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
    # Images
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    # Videos
    "mp4": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
    # Audio
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "m4a": "audio/mp4",
    "aac": "audio/aac",
}


@router.options("/{workflow_run_id}/media/{content_id}.{extension}")
async def media_file_options(
    request: Request,
):
    """Handle CORS preflight for media files."""
    origin = request.headers.get("origin", "")
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
    }
    if origin:
        headers["Access-Control-Allow-Origin"] = origin
    from fastapi.responses import Response
    return Response(status_code=204, headers=headers)


@router.get("/{workflow_run_id}/media/{content_id}.{extension}")
async def get_media_file(
    workflow_run_id: str,
    content_id: str,
    extension: str,
    request: Request,
    download: bool = Query(False, description="Force download with Content-Disposition: attachment"),
    workflow: dict = Depends(get_verified_workflow),
    db = Depends(get_db),
):
    """
    Serve a downloaded media file.

    Validates that:
    - Content exists in database
    - Content belongs to the specified workflow
    - Extension matches stored extension
    - Local file exists

    Returns the file with appropriate Content-Type and cache headers.
    Use ?download=true to force browser download instead of inline display.
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

    # Get local path and resolve to full path
    relative_path = content.get("local_path")
    if not relative_path:
        raise HTTPException(status_code=404, detail="Content not downloaded")

    local_path = resolve_local_path(relative_path)

    # Verify file exists
    if not os.path.exists(local_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Determine content type
    content_type = MEDIA_CONTENT_TYPES.get(extension.lower(), "application/octet-stream")

    # Return file with cache headers (1 year - content is immutable)
    # Include CORS headers explicitly for cross-origin requests with credentials
    # (needed for WaveSurfer audio waveform decoding via Web Audio API)
    origin = request.headers.get("origin", "")
    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Credentials": "true",
    }
    if origin:
        headers["Access-Control-Allow-Origin"] = origin

    # Add Content-Disposition: attachment when download=true
    if download:
        filename = f"{content_id}.{extension}"
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'

    return FileResponse(
        path=local_path,
        media_type=content_type,
        headers=headers
    )


# =============================================================================
# Bulk Download as ZIP - Helper Functions
# =============================================================================

def _add_workflow_file_to_zip(
    zf: zipfile.ZipFile,
    file_doc: Dict[str, Any],
    base_path: str
) -> None:
    """Add a workflow file (from workflow_files collection) to the zip."""
    filename = file_doc.get("filename", "unknown")
    content = file_doc.get("content")
    content_type = file_doc.get("content_type", "text")

    # Build the path in the zip
    zip_path = f"{base_path}/{filename}" if base_path else filename

    # Serialize content based on type
    if content_type == "json" and isinstance(content, (dict, list)):
        data = json.dumps(content, indent=2).encode("utf-8")
    elif isinstance(content, str):
        data = content.encode("utf-8")
    elif isinstance(content, bytes):
        data = content
    else:
        data = str(content).encode("utf-8")

    zf.writestr(zip_path, data)


def _add_media_file_to_zip(
    zf: zipfile.ZipFile,
    content_doc: Dict[str, Any],
    base_path: str
) -> bool:
    """Add a media file (from generated_content) to the zip. Returns True if added."""
    content_id = content_doc.get("generated_content_id")
    extension = content_doc.get("extension", "")
    local_path = content_doc.get("local_path")

    if not local_path:
        return False

    full_path = resolve_local_path(local_path)
    if not os.path.exists(full_path):
        return False

    filename = f"{content_id}.{extension}" if extension else content_id
    zip_path = f"{base_path}/{filename}" if base_path else filename

    zf.write(full_path, zip_path)
    return True


def _create_zip_response(
    zf_buffer: io.BytesIO,
    filename: str
) -> StreamingResponse:
    """Create a ZIP streaming response, raising 404 if empty."""
    zf_buffer.seek(0)
    if zf_buffer.getbuffer().nbytes <= 22:  # Empty ZIP is 22 bytes
        raise HTTPException(status_code=404, detail="No files to download")

    return StreamingResponse(
        zf_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


# =============================================================================
# Workflow Files Download Endpoints
# =============================================================================

@router.get("/{workflow_run_id}/files/download")
async def download_all_workflow_files(
    workflow_run_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all workflow files as ZIP."""
    files = db.file_repo.get_workflow_files(workflow_run_id)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_doc in files:
            category = file_doc.get("category", "")
            step_id = file_doc.get("metadata", {}).get("step_id", "")
            # Organize in zip: category/step_id/filename
            if step_id:
                base_path = f"{category}/{step_id}"
            elif category:
                base_path = category
            else:
                base_path = ""
            _add_workflow_file_to_zip(zf, file_doc, base_path)

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_files.zip")


@router.get("/{workflow_run_id}/files/{category}/download")
async def download_category_files(
    workflow_run_id: str,
    category: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all files in a category as ZIP."""
    files = db.file_repo.get_workflow_files(workflow_run_id, category=category)
    if not files:
        raise HTTPException(status_code=404, detail="Category not found or empty")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_doc in files:
            step_id = file_doc.get("metadata", {}).get("step_id", "")
            base_path = step_id if step_id else ""
            _add_workflow_file_to_zip(zf, file_doc, base_path)

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_{category}.zip")


@router.get("/{workflow_run_id}/files/{category}/{step_id}/download")
async def download_step_files(
    workflow_run_id: str,
    category: str,
    step_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all files in a step as ZIP."""
    files = db.file_repo.get_workflow_files(
        workflow_run_id, category=category, step_id=step_id
    )
    if not files:
        raise HTTPException(status_code=404, detail="Step not found or empty")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_doc in files:
            _add_workflow_file_to_zip(zf, file_doc, "")

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_{category}_{step_id}.zip")


@router.get("/{workflow_run_id}/files/{category}/{step_id}/{group_id}/download")
async def download_group_files(
    workflow_run_id: str,
    category: str,
    step_id: str,
    group_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all files in a group as ZIP."""
    files = db.file_repo.get_workflow_files(workflow_run_id, group_id=group_id)
    if not files:
        raise HTTPException(status_code=404, detail="Group not found or empty")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_doc in files:
            _add_workflow_file_to_zip(zf, file_doc, "")

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_{group_id[:12]}.zip")


# =============================================================================
# Media Download Endpoints
# =============================================================================

@router.get("/{workflow_run_id}/media/download")
async def download_all_media(
    workflow_run_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all media files as ZIP."""
    # Get all completed generations
    metadata_list = list(db.content_repo.metadata.find(
        {"workflow_run_id": workflow_run_id, "status": "completed"},
        {"_id": 0}
    ))

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for meta in metadata_list:
            provider = meta.get("provider", "unknown")
            meta_id = meta.get("content_generation_metadata_id")
            content_items = list(db.content_repo.content.find(
                {"content_generation_metadata_id": meta_id},
                {"_id": 0}
            ))
            for item in content_items:
                if item.get("content_type") == "video.preview":
                    continue
                _add_media_file_to_zip(zf, item, provider)

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_media.zip")


@router.get("/{workflow_run_id}/media/{provider}/download")
async def download_provider_media(
    workflow_run_id: str,
    provider: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all media from a provider as ZIP."""
    metadata_list = list(db.content_repo.metadata.find(
        {
            "workflow_run_id": workflow_run_id,
            "provider": provider,
            "status": "completed"
        },
        {"_id": 0}
    ))
    if not metadata_list:
        raise HTTPException(status_code=404, detail=f"No media for provider: {provider}")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for meta in metadata_list:
            meta_id = meta.get("content_generation_metadata_id")
            content_items = list(db.content_repo.content.find(
                {"content_generation_metadata_id": meta_id},
                {"_id": 0}
            ))
            for item in content_items:
                if item.get("content_type") == "video.preview":
                    continue
                _add_media_file_to_zip(zf, item, "")

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_{provider}.zip")


@router.get("/{workflow_run_id}/media/{provider}/{metadata_id}/download")
async def download_generation_media(
    workflow_run_id: str,
    provider: str,
    metadata_id: str,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download all media from a generation as ZIP."""
    content_items = list(db.content_repo.content.find(
        {
            "content_generation_metadata_id": metadata_id,
            "workflow_run_id": workflow_run_id
        },
        {"_id": 0}
    ))
    if not content_items:
        raise HTTPException(status_code=404, detail="Generation not found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in content_items:
            if item.get("content_type") == "video.preview":
                continue
            _add_media_file_to_zip(zf, item, "")

    return _create_zip_response(zip_buffer, f"{workflow_run_id}_{metadata_id[:12]}.zip")


@router.get("/{workflow_run_id}/media/{provider}/{metadata_id}/{content_id}")
async def download_single_media(
    workflow_run_id: str,
    provider: str,
    metadata_id: str,
    content_id: str,
    request: Request,
    workflow: dict = Depends(get_verified_workflow),
    db=Depends(get_db),
):
    """Download a single media file."""
    content = db.content_repo.get_content_by_id(content_id)

    if not content:
        raise HTTPException(status_code=404, detail="Content not found")

    if content.get("workflow_run_id") != workflow_run_id:
        raise HTTPException(status_code=404, detail="Content not found")

    relative_path = content.get("local_path")
    if not relative_path:
        raise HTTPException(status_code=404, detail="Content not downloaded")

    local_path = resolve_local_path(relative_path)
    if not os.path.exists(local_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    extension = content.get("extension", "")
    content_type = MEDIA_CONTENT_TYPES.get(extension.lower(), "application/octet-stream")
    filename = f"{content_id}.{extension}" if extension else content_id

    return FileResponse(
        path=local_path,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )
