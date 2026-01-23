"""
Migration 0: Create schema_migrations collection

This migration bootstraps the migration system by creating the
schema_migrations collection with a unique index on migration_id.

This is the foundation for all future migrations.
"""

from datetime import datetime
from pymongo.database import Database

MIGRATION_ID = 0
DESCRIPTION = "Create schema_migrations collection with unique index"


def apply(db: Database) -> None:
    """
    Create schema_migrations collection and index.

    The schema_migrations collection tracks which migrations have been applied:
    - migration_id: int (unique) - The migration number
    - description: str - Human-readable description
    - applied_at: datetime - When migration was applied
    """
    # Create collection if not exists (MongoDB creates on first insert,
    # but we want to ensure the index exists)
    schema_migrations = db.schema_migrations

    # Create unique index on migration_id
    schema_migrations.create_index("migration_id", unique=True)
