"""
Dependencies for virtual server FastAPI routes.

Provides dependency injection for authentication.
Virtual server connects to the same user database as the main server for auth.
"""

import os
from typing import Optional

from fastapi import Request, Header, HTTPException

from backend.db import Database
from .auth import verify_access_token

# Module-level database for auth (shared with main server)
_auth_db: Optional[Database] = None


def set_auth_db(db: Database):
    """Set the auth database. Called during app startup."""
    global _auth_db
    _auth_db = db


def get_auth_db() -> Database:
    """Get the auth database."""
    if not _auth_db:
        raise HTTPException(status_code=503, detail="Auth database not initialized")
    return _auth_db


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
    db = get_auth_db()

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
