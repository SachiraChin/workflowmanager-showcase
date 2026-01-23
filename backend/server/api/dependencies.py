"""
Shared dependencies for FastAPI routes.

Provides dependency injection functions for database access, authentication, etc.
"""

from typing import Optional
from fastapi import Request, Header, HTTPException

from .auth import verify_access_token

# Module-level references set by workflow_api on startup
_db = None
_processor = None
_media_images_path = None
_media_videos_path = None
_server_base_url = None


def set_db(db):
    """Set the database provider instance. Called during app startup."""
    global _db
    _db = db


def set_processor(processor):
    """Set the workflow processor instance. Called during app startup."""
    global _processor
    _processor = processor


def set_media_paths(images_path: Optional[str], videos_path: Optional[str]):
    """Set the media storage paths. Called during app startup."""
    global _media_images_path, _media_videos_path
    _media_images_path = images_path
    _media_videos_path = videos_path


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


def get_media_images_path() -> Optional[str]:
    """Get the configured media images storage path."""
    return _media_images_path


def get_media_videos_path() -> Optional[str]:
    """Get the configured media videos storage path."""
    return _media_videos_path


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
