"""
Migration 12: Add invitation code collection and indexes.

Creates invitation_codes indexes used for invite-only account creation.
"""

from pymongo.database import Database

from . import ensure_index

MIGRATION_ID = 12
DESCRIPTION = "Create invitation_codes collection and indexes"


def apply(db: Database) -> None:
    """Create invitation code indexes."""

    ensure_index(
        db.invitation_codes,
        "code",
        unique=True,
        name="invitation_codes_code_unique",
    )
    print("  Created index: invitation_codes(code) unique")

    ensure_index(
        db.invitation_codes,
        "expires_at",
        expireAfterSeconds=0,
        name="invitation_codes_expires_ttl",
    )
    print("  Created index: invitation_codes(expires_at) ttl")

    ensure_index(
        db.invitation_codes,
        [("is_active", 1), ("code", 1)],
        name="invitation_codes_active_code",
    )
    print("  Created index: invitation_codes(is_active, code)")

    print("  Migration 12 complete: invitation code schema ready")
