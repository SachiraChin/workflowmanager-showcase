"""
Authentication utilities for virtual server.

Shares the same JWT verification logic as the main server,
reading from the same user database.
"""

import os
from typing import Optional, Dict, Any

import jwt
from fastapi import Request, HTTPException, Header

# =============================================================================
# Configuration (same as main server)
# =============================================================================

JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"


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
