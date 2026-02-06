"""
Shared dependencies for FastAPI routes.

Provides dependency injection functions for database access, authentication, etc.
"""

import os
from typing import Optional, Dict, Any
from fastapi import Request, Header, HTTPException, Depends, Path

from .auth import verify_access_token

# Module-level references set by workflow_api on startup
_db = None
_processor = None
_media_base_path = None
_server_base_url = None


def set_db(db):
    """Set the database provider instance. Called during app startup."""
    global _db
    _db = db


def set_processor(processor):
    """Set the workflow processor instance. Called during app startup."""
    global _processor
    _processor = processor


def set_media_base_path(base_path: Optional[str]):
    """Set the media base path. Called during app startup."""
    global _media_base_path
    _media_base_path = base_path


def set_server_base_url(base_url: Optional[str]):
    """Set the server base URL. Called during app startup."""
    global _server_base_url
    _server_base_url = base_url


def get_db():
    """
    Dependency that returns the database provider.

    Raises HTTPException if database is not initialized.
    """
    if not _db:
        raise HTTPException(status_code=503, detail="Service not initialized")
    return _db


def get_processor():
    """
    Dependency that returns the workflow processor.

    Raises HTTPException if processor is not initialized.
    """
    if not _processor:
        raise HTTPException(status_code=503, detail="Service not initialized")
    return _processor


def get_media_base_path() -> Optional[str]:
    """Get the configured media base path."""
    return _media_base_path


def get_media_images_path() -> Optional[str]:
    """Get the media images storage path (base_path/images)."""
    if not _media_base_path:
        return None
    return os.path.join(_media_base_path, "images")


def get_media_videos_path() -> Optional[str]:
    """Get the media videos storage path (base_path/videos)."""
    if not _media_base_path:
        return None
    return os.path.join(_media_base_path, "videos")


def get_media_audio_path() -> Optional[str]:
    """Get the media audio storage path (base_path/audio)."""
    if not _media_base_path:
        return None
    return os.path.join(_media_base_path, "audio")


def get_server_base_url() -> Optional[str]:
    """Get the configured server base URL."""
    return _server_base_url


async def get_current_user_id(
    request: Request,
    x_access_key: Optional[str] = Header(None, alias="X-Access-Key")
) -> str:
    """
    Get user_id from either:
    1. httpOnly cookie (access_token) - for web UI
    2. X-Access-Key header - for CLI/API

    Args:
        request: FastAPI Request object
        x_access_key: Access key from X-Access-Key header

    Returns:
        user_id

    Raises:
        HTTPException: If authentication fails
    """
    db = get_db()

    # Option 1: Check for access token cookie (web UI)
    access_token = request.cookies.get("access_token")
    if access_token:
        try:
            payload = verify_access_token(access_token)
            return payload["user_id"]
        except HTTPException:
            # Token invalid/expired - fall through to check access key
            pass

    # Option 2: Check for X-Access-Key header (CLI/API)
    if x_access_key:
        user = db.user_repo.get_user_by_access_key(x_access_key)
        if user:
            return user["user_id"]

    # Neither method worked
    raise HTTPException(
        status_code=401,
        detail="Unauthorized - provide access_token cookie or X-Access-Key header"
    )


async def get_current_user(
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """
    Get current user document after authentication.

    Returns:
        User document

    Raises:
        HTTPException 401: User not found or inactive
    """
    db = get_db()
    user = db.user_repo.get_user(user_id)
    if not user or not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


async def require_admin_user(
    user: Dict[str, Any] = Depends(get_current_user),
) -> Dict[str, Any]:
    """Require admin role for access."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


async def get_verified_workflow(
    workflow_run_id: str = Path(..., description="Workflow run ID"),
    user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """
    Get workflow after verifying user ownership.

    This dependency combines authentication with authorization:
    1. Authenticates the user via get_current_user_id
    2. Verifies the workflow exists
    3. Verifies the authenticated user owns the workflow

    Args:
        workflow_run_id: The workflow run ID from the path
        user_id: The authenticated user's ID (injected via dependency)

    Returns:
        The workflow document if access is granted

    Raises:
        HTTPException 401: User not authenticated
        HTTPException 403: Access denied (user doesn't own workflow)
        HTTPException 404: Workflow not found
    """
    db = get_db()

    user_owns, exists = db.workflow_repo.workflow_run_exists(user_id, workflow_run_id)

    if not exists:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if not user_owns:
        raise HTTPException(status_code=403, detail="Access denied")

    return db.workflow_repo.get_workflow(workflow_run_id)
