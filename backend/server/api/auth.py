"""
Authentication utilities for the workflow API.

Supports two authentication methods:
1. httpOnly cookie with JWT (for web UI)
2. X-Access-Key header (for CLI/API)
"""

import os
import uuid
import hashlib
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, Tuple

import bcrypt
import jwt
from fastapi import Request, HTTPException, Header, Response

# =============================================================================
# Configuration
# =============================================================================

# Secret key for JWT signing - should be set via environment variable in production
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"

# Token expiration times
ACCESS_TOKEN_EXPIRE_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 14

# Grace period for token rotation (seconds)
# Old tokens remain valid briefly after rotation to handle multi-tab scenarios
TOKEN_ROTATION_GRACE_SECONDS = 60

# Cookie settings
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"  # Set True in production (HTTPS)
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax")  # "lax" for dev (cross-port), "strict" for prod
COOKIE_DOMAIN = os.environ.get("COOKIE_DOMAIN", None)  # None = current domain only


# =============================================================================
# Password Hashing
# =============================================================================

def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.

    Salt is automatically generated and embedded in the hash.

    Args:
        password: Plain text password

    Returns:
        Hashed password string (includes salt)
    """
    salt = bcrypt.gensalt(rounds=12)
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """
    Verify a password against its hash.

    Args:
        password: Plain text password to verify
        password_hash: Stored bcrypt hash

    Returns:
        True if password matches, False otherwise
    """
    try:
        return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
    except Exception:
        return False


# =============================================================================
# JWT Token Creation
# =============================================================================

def create_access_token(user_id: str, email: str) -> str:
    """
    Create a short-lived access token (JWT).

    Args:
        user_id: User's unique identifier
        email: User's email

    Returns:
        Encoded JWT string
    """
    expires_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    payload = {
        "user_id": user_id,
        "email": email,
        "type": "access",
        "exp": expires_at,
        "iat": datetime.utcnow(),
    }

    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> Tuple[str, str, datetime]:
    """
    Create a long-lived refresh token.

    Args:
        user_id: User's unique identifier

    Returns:
        Tuple of (token_string, token_id, expires_at)
    """
    token_id = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    payload = {
        "user_id": user_id,
        "token_id": token_id,
        "type": "refresh",
        "exp": expires_at,
        "iat": datetime.utcnow(),
    }

    token = jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return token, token_id, expires_at


def hash_refresh_token(token: str) -> str:
    """
    Hash a refresh token for storage.

    We don't store refresh tokens in plaintext - only their hash.

    Args:
        token: The refresh token string

    Returns:
        SHA256 hash of the token
    """
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


# =============================================================================
# JWT Token Verification
# =============================================================================

def verify_access_token(token: str) -> Dict[str, Any]:
    """
    Verify and decode an access token.

    Args:
        token: JWT access token string

    Returns:
        Decoded payload with user_id, email, etc.

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])

        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")

        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def verify_refresh_token(token: str) -> Dict[str, Any]:
    """
    Verify and decode a refresh token.

    Note: This only validates the JWT structure and expiration.
    The caller must also check if the token_id exists in the database
    and hasn't been revoked.

    Args:
        token: JWT refresh token string

    Returns:
        Decoded payload with user_id, token_id, etc.

    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])

        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")

        return payload

    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid refresh token: {str(e)}")


# =============================================================================
# Cookie Helpers
# =============================================================================

def set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: str
) -> None:
    """
    Set httpOnly cookies for authentication.

    Args:
        response: FastAPI Response object
        access_token: JWT access token
        refresh_token: JWT refresh token
    """
    # Access token cookie - sent with all requests
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
        domain=COOKIE_DOMAIN,
    )

    # Refresh token cookie - only sent to /auth/* paths
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        path="/auth",
        domain=COOKIE_DOMAIN,
    )


def clear_auth_cookies(response: Response) -> None:
    """
    Clear authentication cookies (logout).

    Args:
        response: FastAPI Response object
    """
    response.delete_cookie(
        key="access_token",
        path="/",
        domain=COOKIE_DOMAIN,
    )
    response.delete_cookie(
        key="refresh_token",
        path="/auth",
        domain=COOKIE_DOMAIN,
    )
