"""
Authentication API routes.

Endpoints:
- POST /auth/login    - Login with username/email + password
- POST /auth/register - Create account using invitation code
- GET  /auth/invitation/{invitation_code} - Check invitation status
- POST /auth/logout   - Logout (clear cookies, revoke token)
- POST /auth/refresh  - Refresh access token
- GET  /auth/me       - Get current user info
"""

import re
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..auth import (
    TOKEN_ROTATION_GRACE_SECONDS,
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    set_auth_cookies,
    verify_access_token,
    verify_password,
    verify_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["authentication"])

# Database instance - will be set by main app
db = None

# Generic login failure response to avoid user enumeration
INVALID_LOGIN_MESSAGE = "Invalid username/email or password"


def set_database(database):
    """Set the database instance for auth routes."""
    global db
    db = database


# =============================================================================
# Request/Response Models
# =============================================================================


class LoginRequest(BaseModel):
    """Login request body."""

    identifier: str
    password: str


class LoginResponse(BaseModel):
    """Login response (user info only, tokens in cookies)."""

    user_id: str
    email: Optional[str] = None
    username: str
    message: str = "Login successful"


class RegisterRequest(BaseModel):
    """Invite-only account creation request."""

    invitation_code: str
    username: str
    password: str
    email: Optional[EmailStr] = None


class RegisterResponse(LoginResponse):
    """Register response (user info only, tokens in cookies)."""

    message: str = "Account created successfully"


class UserResponse(BaseModel):
    """User info response."""

    user_id: str
    email: Optional[str] = None
    username: str


class InvitationStatusResponse(BaseModel):
    """Invitation code status response."""

    invitation_code: str
    remaining_uses: int
    expires_at: Optional[datetime] = None


class MessageResponse(BaseModel):
    """Simple message response."""

    message: str


# =============================================================================
# Helper Functions
# =============================================================================


def get_invitation_collection():
    """Return invitation collection from Database wrapper."""
    if hasattr(db, "invitation_codes"):
        return db.invitation_codes
    return db.db.invitation_codes


def normalize_email(email: Optional[str]) -> Optional[str]:
    """Normalize email for storage and lookup."""
    if email is None:
        return None
    normalized = email.strip().lower()
    return normalized or None


def validate_username(username: str) -> str:
    """
    Validate username according to business rules.

    Rules:
    - required
    - no whitespace
    - no '@'
    - no special keyboard characters (letters + digits only)
    """
    trimmed = username.strip()
    if not trimmed:
        raise HTTPException(status_code=400, detail="Username is required")

    if any(char.isspace() for char in trimmed):
        raise HTTPException(status_code=400, detail="Username cannot contain whitespace")

    if "@" in trimmed:
        raise HTTPException(status_code=400, detail="Username cannot contain '@'")

    if not re.fullmatch(r"[A-Za-z0-9]+", trimmed):
        raise HTTPException(
            status_code=400,
            detail="Username can only contain letters and numbers",
        )

    return trimmed


def get_display_username(user: Dict[str, Any]) -> str:
    """Return best available username for response payloads."""
    return user.get("username") or user.get("email") or user["user_id"]


def get_remaining_invitation_uses(invitation: Dict[str, Any]) -> int:
    """Compute remaining uses from invitation doc."""
    max_uses = int(invitation.get("max_uses", 0) or 0)
    used_count = int(invitation.get("used_count", 0) or 0)
    return max(max_uses - used_count, 0)


def get_valid_invitation(invitation_code: str) -> Optional[Dict[str, Any]]:
    """Get invitation if active, not expired, and not exhausted."""
    invitation = get_invitation_collection().find_one({"code": invitation_code})
    if not invitation:
        return None

    if invitation.get("is_active") is False:
        return None

    expires_at = invitation.get("expires_at")
    if expires_at and expires_at <= datetime.utcnow():
        return None

    if get_remaining_invitation_uses(invitation) <= 0:
        return None

    return invitation


def consume_invitation_code(
    invitation_code: str,
    user_id: str,
    ip_address: Optional[str],
) -> bool:
    """
    Consume a single invitation use atomically.

    Returns True if consumption succeeded.
    """
    now = datetime.utcnow()
    invitation = get_invitation_collection().find_one_and_update(
        {
            "code": invitation_code,
            "is_active": {"$ne": False},
            "$or": [
                {"expires_at": {"$exists": False}},
                {"expires_at": None},
                {"expires_at": {"$gt": now}},
            ],
            "$expr": {
                "$lt": [
                    {"$ifNull": ["$used_count", 0]},
                    {"$ifNull": ["$max_uses", 0]},
                ]
            },
        },
        {
            "$inc": {"used_count": 1},
            "$set": {"updated_at": now},
            "$push": {
                "usage_history": {
                    "user_id": user_id,
                    "used_at": now,
                    "ip_address": ip_address,
                }
            },
        },
        return_document=ReturnDocument.AFTER,
    )
    return invitation is not None


def find_user_by_identifier(identifier: str) -> Optional[Dict[str, Any]]:
    """Find user by email (case-insensitive) or username."""
    trimmed = identifier.strip()
    if not trimmed:
        return None

    if "@" in trimmed:
        return db.users.find_one(
            {
                "email": {
                    "$regex": f"^{re.escape(trimmed)}$",
                    "$options": "i",
                }
            }
        )

    return db.users.find_one({"username": trimmed})


def get_client_info(request: Request) -> tuple[Optional[str], Optional[str]]:
    """Extract user agent and IP from request."""
    user_agent = request.headers.get("user-agent")
    # Handle proxied requests
    ip_address = request.headers.get("x-forwarded-for", request.client.host if request.client else None)
    if ip_address and "," in ip_address:
        ip_address = ip_address.split(",")[0].strip()
    return user_agent, ip_address


# =============================================================================
# Auth Endpoints
# =============================================================================


@router.post("/login", response_model=LoginResponse)
async def login(
    request: Request,
    response: Response,
    body: LoginRequest,
):
    """
    Login with username/email and password.

    Sets httpOnly cookies for access_token and refresh_token.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    user = find_user_by_identifier(body.identifier)
    if not user:
        raise HTTPException(status_code=401, detail=INVALID_LOGIN_MESSAGE)

    # Check if user has a password set
    if not user.get("password_hash"):
        raise HTTPException(
            status_code=401,
            detail="Password login not enabled for this account",
        )

    # Verify password
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail=INVALID_LOGIN_MESSAGE)

    # Check if user is active
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Create tokens
    access_token = create_access_token(user["user_id"], user.get("email"))
    refresh_token, token_id, expires_at = create_refresh_token(user["user_id"])

    # Store refresh token in database
    user_agent, ip_address = get_client_info(request)
    db.user_repo.store_refresh_token(
        token_id=token_id,
        user_id=user["user_id"],
        token_hash=hash_refresh_token(refresh_token),
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )

    # Set cookies
    set_auth_cookies(response, access_token, refresh_token)

    return LoginResponse(
        user_id=user["user_id"],
        email=user.get("email"),
        username=get_display_username(user),
    )


@router.get("/invitation/{invitation_code}", response_model=InvitationStatusResponse)
async def get_invitation_status(invitation_code: str):
    """Validate and return invitation status."""
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    code = invitation_code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Invitation code is required")

    invitation = get_valid_invitation(code)
    if not invitation:
        raise HTTPException(
            status_code=404,
            detail="Invitation code is invalid, expired, or exhausted",
        )

    return InvitationStatusResponse(
        invitation_code=code,
        remaining_uses=get_remaining_invitation_uses(invitation),
        expires_at=invitation.get("expires_at"),
    )


@router.post("/register", response_model=RegisterResponse, status_code=201)
async def register(
    request: Request,
    response: Response,
    body: RegisterRequest,
):
    """Create account with invitation code and start authenticated session."""
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    invitation_code = body.invitation_code.strip()
    if not invitation_code:
        raise HTTPException(status_code=400, detail="Invitation code is required")

    username = validate_username(body.username)
    email = normalize_email(str(body.email)) if body.email else None

    if not body.password:
        raise HTTPException(status_code=400, detail="Password is required")

    # Validate invite before creating user document.
    if not get_valid_invitation(invitation_code):
        raise HTTPException(
            status_code=400,
            detail="Invitation code is invalid, expired, or exhausted",
        )

    # Pre-checks for clearer conflict errors.
    if db.users.find_one({"username": username}):
        raise HTTPException(status_code=409, detail="Username already exists")

    if email and db.users.find_one(
        {
            "email": {
                "$regex": f"^{re.escape(email)}$",
                "$options": "i",
            }
        }
    ):
        raise HTTPException(status_code=409, detail="Email already exists")

    now = datetime.utcnow()
    user_id = f"usr_{uuid.uuid4().hex[:12]}"
    user_doc: Dict[str, Any] = {
        "user_id": user_id,
        "username": username,
        "password_hash": hash_password(body.password),
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "auth_providers": [],
    }
    if email:
        user_doc["email"] = email

    try:
        db.users.insert_one(user_doc)
    except DuplicateKeyError as exc:
        error_text = str(exc).lower()
        if "username" in error_text:
            raise HTTPException(status_code=409, detail="Username already exists")
        if "email" in error_text:
            raise HTTPException(status_code=409, detail="Email already exists")
        raise HTTPException(status_code=409, detail="User already exists")

    _, ip_address = get_client_info(request)
    if not consume_invitation_code(invitation_code, user_id, ip_address):
        # Invitation became invalid or exhausted during race.
        db.users.delete_one({"user_id": user_id})
        raise HTTPException(
            status_code=400,
            detail="Invitation code is invalid, expired, or exhausted",
        )

    access_token = create_access_token(user_id, email)
    refresh_token, token_id, expires_at = create_refresh_token(user_id)

    user_agent, ip_address = get_client_info(request)
    db.user_repo.store_refresh_token(
        token_id=token_id,
        user_id=user_id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )

    set_auth_cookies(response, access_token, refresh_token)

    return RegisterResponse(
        user_id=user_id,
        email=email,
        username=username,
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response,
):
    """
    Logout - clear cookies and revoke refresh token.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Get refresh token from cookie and revoke it
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        try:
            payload = verify_refresh_token(refresh_token)
            db.user_repo.revoke_refresh_token(payload["token_id"])
        except HTTPException:
            # Token already invalid, just clear cookies
            pass

    # Clear cookies
    clear_auth_cookies(response)

    return MessageResponse(message="Logged out successfully")


@router.post("/refresh", response_model=MessageResponse)
async def refresh_token(
    request: Request,
    response: Response,
):
    """
    Refresh the access token using the refresh token cookie.

    Also rotates the refresh token for security, with a grace period
    for multi-tab scenarios where the same old token may be used by
    multiple browser tabs.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Get refresh token from cookie
    refresh_token_value = request.cookies.get("refresh_token")
    if not refresh_token_value:
        raise HTTPException(status_code=401, detail="No refresh token")

    # Verify the JWT
    try:
        payload = verify_refresh_token(refresh_token_value)
    except HTTPException:
        clear_auth_cookies(response)
        raise

    # Check if token exists in database (include rotated tokens for grace period)
    db_token = db.user_repo.get_refresh_token(
        payload["token_id"], include_rotated=True,
    )
    if not db_token:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Refresh token revoked or expired")

    # Verify token hash matches
    if db_token["token_hash"] != hash_refresh_token(refresh_token_value):
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    # Check if token was already rotated (multi-tab scenario)
    if db_token.get("rotated_at"):
        rotated_at = db_token["rotated_at"]
        seconds_since_rotation = (datetime.utcnow() - rotated_at).total_seconds()

        if seconds_since_rotation > TOKEN_ROTATION_GRACE_SECONDS:
            # Outside grace period - reject
            clear_auth_cookies(response)
            raise HTTPException(status_code=401, detail="Refresh token already used")

        # Within grace period - issue fresh tokens for this tab too
        # This handles multi-tab scenarios where both tabs had the same old token
        user = db.user_repo.get_user(payload["user_id"])
        if not user or not user.get("is_active", True):
            clear_auth_cookies(response)
            raise HTTPException(status_code=401, detail="User not found or disabled")

        # Create new tokens for this tab
        access_token = create_access_token(user["user_id"], user.get("email"))
        new_refresh_token, token_id, expires_at = create_refresh_token(user["user_id"])

        # Store new refresh token
        user_agent, ip_address = get_client_info(request)
        db.user_repo.store_refresh_token(
            token_id=token_id,
            user_id=user["user_id"],
            token_hash=hash_refresh_token(new_refresh_token),
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address,
        )

        set_auth_cookies(response, access_token, new_refresh_token)
        return MessageResponse(message="Token refreshed (grace period)")

    # Get user
    user = db.user_repo.get_user(payload["user_id"])
    if not user or not user.get("is_active", True):
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="User not found or disabled")

    # Create new tokens
    access_token = create_access_token(user["user_id"], user.get("email"))
    new_refresh_token, token_id, expires_at = create_refresh_token(user["user_id"])

    # Store new refresh token
    user_agent, ip_address = get_client_info(request)
    db.user_repo.store_refresh_token(
        token_id=token_id,
        user_id=user["user_id"],
        token_hash=hash_refresh_token(new_refresh_token),
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address,
    )

    # Rotate old refresh token (mark as rotated, not revoked)
    # This allows other tabs to use the old token during grace period
    db.user_repo.rotate_refresh_token(payload["token_id"], token_id)

    # Set new cookies
    set_auth_cookies(response, access_token, new_refresh_token)

    return MessageResponse(message="Token refreshed")


@router.get("/me", response_model=UserResponse)
async def get_current_user(request: Request):
    """
    Get current user info from access token cookie.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Get access token from cookie
    access_token = request.cookies.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Verify token
    try:
        payload = verify_access_token(access_token)
    except HTTPException:
        raise

    # Get user from database
    user = db.user_repo.get_user(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return UserResponse(
        user_id=user["user_id"],
        email=user.get("email"),
        username=get_display_username(user),
    )


@router.post("/logout-all", response_model=MessageResponse)
async def logout_all_sessions(
    request: Request,
    response: Response,
):
    """
    Logout from all sessions (revoke all refresh tokens for this user).
    """
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Get access token to identify user
    access_token = request.cookies.get("access_token")
    if not access_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    try:
        payload = verify_access_token(access_token)
    except HTTPException:
        raise

    # Revoke all refresh tokens for this user
    count = db.user_repo.revoke_all_user_refresh_tokens(payload["user_id"])

    # Clear cookies
    clear_auth_cookies(response)

    return MessageResponse(message=f"Logged out from {count} session(s)")
