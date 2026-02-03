"""
Authentication API routes.

Endpoints:
- POST /auth/login    - Login with email/password
- POST /auth/logout   - Logout (clear cookies, revoke token)
- POST /auth/refresh  - Refresh access token
- GET  /auth/me       - Get current user info
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Response, Depends
from pydantic import BaseModel, EmailStr

from ..auth import (
    verify_password,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
    verify_access_token,
    verify_refresh_token,
    set_auth_cookies,
    clear_auth_cookies,
    TOKEN_ROTATION_GRACE_SECONDS,
)

router = APIRouter(prefix="/auth", tags=["authentication"])

# Database instance - will be set by main app
db = None


def set_database(database):
    """Set the database instance for auth routes."""
    global db
    db = database


# =============================================================================
# Request/Response Models
# =============================================================================

class LoginRequest(BaseModel):
    """Login request body."""
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    """Login response (user info only, tokens in cookies)."""
    user_id: str
    email: str
    username: str
    message: str = "Login successful"


class UserResponse(BaseModel):
    """User info response."""
    user_id: str
    email: str
    username: str


class MessageResponse(BaseModel):
    """Simple message response."""
    message: str


# =============================================================================
# Helper Functions
# =============================================================================

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
    body: LoginRequest
):
    """
    Login with email and password.

    Sets httpOnly cookies for access_token and refresh_token.
    """
    if not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # Find user by email
    user = db.users.find_one({"email": body.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check if user has a password set
    if not user.get("password_hash"):
        raise HTTPException(
            status_code=401,
            detail="Password login not enabled for this account"
        )

    # Verify password
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check if user is active
    if not user.get("is_active", True):
        raise HTTPException(status_code=401, detail="Account is disabled")

    # Create tokens
    access_token = create_access_token(user["user_id"], user["email"])
    refresh_token, token_id, expires_at = create_refresh_token(user["user_id"])

    # Store refresh token in database
    user_agent, ip_address = get_client_info(request)
    db.user_repo.store_refresh_token(
        token_id=token_id,
        user_id=user["user_id"],
        token_hash=hash_refresh_token(refresh_token),
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address
    )

    # Set cookies
    set_auth_cookies(response, access_token, refresh_token)

    return LoginResponse(
        user_id=user["user_id"],
        email=user["email"],
        username=user.get("username", user["email"])
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(
    request: Request,
    response: Response
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
    response: Response
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
        payload["token_id"], include_rotated=True
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
        access_token = create_access_token(user["user_id"], user["email"])
        new_refresh_token, token_id, expires_at = create_refresh_token(user["user_id"])

        # Store new refresh token
        user_agent, ip_address = get_client_info(request)
        db.user_repo.store_refresh_token(
            token_id=token_id,
            user_id=user["user_id"],
            token_hash=hash_refresh_token(new_refresh_token),
            expires_at=expires_at,
            user_agent=user_agent,
            ip_address=ip_address
        )

        set_auth_cookies(response, access_token, new_refresh_token)
        return MessageResponse(message="Token refreshed (grace period)")

    # Get user
    user = db.user_repo.get_user(payload["user_id"])
    if not user or not user.get("is_active", True):
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="User not found or disabled")

    # Create new tokens
    access_token = create_access_token(user["user_id"], user["email"])
    new_refresh_token, token_id, expires_at = create_refresh_token(user["user_id"])

    # Store new refresh token
    user_agent, ip_address = get_client_info(request)
    db.user_repo.store_refresh_token(
        token_id=token_id,
        user_id=user["user_id"],
        token_hash=hash_refresh_token(new_refresh_token),
        expires_at=expires_at,
        user_agent=user_agent,
        ip_address=ip_address
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
        email=user["email"],
        username=user.get("username", user["email"])
    )


@router.post("/logout-all", response_model=MessageResponse)
async def logout_all_sessions(
    request: Request,
    response: Response
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
