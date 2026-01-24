"""
User Repository - User, access key, and session management.

Handles:
- User CRUD operations
- Access key management (API keys)
- Refresh token management (web sessions)
"""

import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

from pymongo.database import Database
from pymongo.collection import Collection

from backend.db.base import BaseRepository


class UserRepository(BaseRepository):
    """
    Repository for user-related database operations.

    Collections:
    - users: User accounts
    - access_keys: API access keys
    - refresh_tokens: Web session tokens
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.users: Collection = db.users
        self.access_keys: Collection = db.access_keys
        self.refresh_tokens: Collection = db.refresh_tokens

    # =========================================================================
    # User Management
    # =========================================================================

    def get_or_create_user(self, username: str, email: str = None) -> str:
        """
        Get existing user or create new one.

        Args:
            username: Unique username
            email: Optional email address

        Returns:
            user_id
        """
        existing = self.users.find_one({"username": username})
        if existing:
            return existing["user_id"]

        user_id = f"usr_{uuid.uuid4().hex[:12]}"
        self.users.insert_one(
            {
                "user_id": user_id,
                "username": username,
                "email": email,
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
        )
        return user_id

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Get user by ID."""
        return self.users.find_one({"user_id": user_id})

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Get user by username."""
        return self.users.find_one({"username": username})

    def get_user_by_access_key(self, access_key: str) -> Optional[Dict[str, Any]]:
        """
        Get user by access key.

        Args:
            access_key: The access key

        Returns:
            User document or None if not found/inactive
        """
        # Find the access key
        key_doc = self.access_keys.find_one(
            {"access_key": access_key, "is_active": True}
        )
        if not key_doc:
            return None

        # Update last_used_at
        self.access_keys.update_one(
            {"access_key_id": key_doc["access_key_id"]},
            {"$set": {"last_used_at": datetime.utcnow()}},
        )

        # Get the user
        return self.users.find_one({"user_id": key_doc["user_id"]})

    # =========================================================================
    # Access Key Management
    # =========================================================================

    def create_access_key(
        self, user_id: str, name: str = "default", expires_at: datetime = None
    ) -> Dict[str, Any]:
        """
        Create a new access key for a user.

        Args:
            user_id: User ID
            name: Optional name/description for the key
            expires_at: Optional expiration datetime

        Returns:
            Access key document (includes the key value)
        """
        import secrets

        access_key_id = f"key_{uuid.uuid4().hex[:12]}"
        access_key = f"wfk_{secrets.token_urlsafe(32)}"

        doc = {
            "access_key_id": access_key_id,
            "user_id": user_id,
            "access_key": access_key,
            "name": name,
            "is_active": True,
            "created_at": datetime.utcnow(),
            "last_used_at": None,
            "expires_at": expires_at,
        }
        self.access_keys.insert_one(doc)
        return doc

    def get_user_access_keys(
        self, user_id: str, include_inactive: bool = False
    ) -> List[Dict[str, Any]]:
        """Get all access keys for a user."""
        query = {"user_id": user_id}
        if not include_inactive:
            query["is_active"] = True
        return list(
            self.access_keys.find(query, {"access_key": 0})
        )  # Don't return actual key

    def revoke_access_key(self, access_key_id: str) -> bool:
        """Revoke an access key."""
        result = self.access_keys.update_one(
            {"access_key_id": access_key_id},
            {"$set": {"is_active": False, "revoked_at": datetime.utcnow()}},
        )
        return result.modified_count > 0

    def get_access_key(self, access_key_id: str) -> Optional[Dict[str, Any]]:
        """Get access key by ID (without the actual key value)."""
        return self.access_keys.find_one(
            {"access_key_id": access_key_id}, {"access_key": 0}
        )

    # =========================================================================
    # Refresh Token Management (Web Sessions)
    # =========================================================================

    def store_refresh_token(
        self,
        token_id: str,
        user_id: str,
        token_hash: str,
        expires_at: datetime,
        user_agent: str = None,
        ip_address: str = None,
    ) -> Dict[str, Any]:
        """
        Store a refresh token in the database.

        Args:
            token_id: Unique identifier for this token (from JWT)
            user_id: User this token belongs to
            token_hash: SHA256 hash of the token (not plaintext)
            expires_at: When the token expires
            user_agent: Optional browser/client info
            ip_address: Optional client IP

        Returns:
            The stored document
        """
        doc = {
            "token_id": token_id,
            "user_id": user_id,
            "token_hash": token_hash,
            "expires_at": expires_at,
            "created_at": datetime.utcnow(),
            "last_used_at": datetime.utcnow(),
            "revoked_at": None,
            "user_agent": user_agent,
            "ip_address": ip_address,
        }
        self.refresh_tokens.insert_one(doc)
        return doc

    def get_refresh_token(self, token_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a refresh token by its ID.

        Only returns active (non-revoked, non-expired) tokens.

        Args:
            token_id: The token ID from the JWT

        Returns:
            Token document or None
        """
        return self.refresh_tokens.find_one(
            {
                "token_id": token_id,
                "revoked_at": None,
                "expires_at": {"$gt": datetime.utcnow()},
            }
        )

    def update_refresh_token_usage(self, token_id: str) -> bool:
        """Update the last_used_at timestamp for a refresh token."""
        result = self.refresh_tokens.update_one(
            {"token_id": token_id}, {"$set": {"last_used_at": datetime.utcnow()}}
        )
        return result.modified_count > 0

    def revoke_refresh_token(self, token_id: str) -> bool:
        """
        Revoke a refresh token (logout).

        Args:
            token_id: The token ID to revoke

        Returns:
            True if token was revoked, False if not found
        """
        result = self.refresh_tokens.update_one(
            {"token_id": token_id}, {"$set": {"revoked_at": datetime.utcnow()}}
        )
        return result.modified_count > 0

    def revoke_all_user_refresh_tokens(self, user_id: str) -> int:
        """
        Revoke all refresh tokens for a user (logout everywhere).

        Args:
            user_id: The user ID

        Returns:
            Number of tokens revoked
        """
        result = self.refresh_tokens.update_many(
            {"user_id": user_id, "revoked_at": None},
            {"$set": {"revoked_at": datetime.utcnow()}},
        )
        return result.modified_count

    def get_user_active_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        """
        Get all active sessions for a user.

        Args:
            user_id: The user ID

        Returns:
            List of active session info (without token hashes)
        """
        return list(
            self.refresh_tokens.find(
                {
                    "user_id": user_id,
                    "revoked_at": None,
                    "expires_at": {"$gt": datetime.utcnow()},
                },
                {"token_hash": 0},  # Don't return hash
            )
        )
