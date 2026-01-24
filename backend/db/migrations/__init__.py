"""
Database Schema Migration System

Provides versioned, forward-only migrations stored in the database.
Each migration is a Python file in this folder (m_0.py, m_1.py, etc.)
that defines:
- MIGRATION_ID: int - Unique migration number
- DESCRIPTION: str - Human-readable description
- apply(db) -> None - Function to apply the migration

Utility functions available for migrations:
- ensure_index(collection, keys, **kwargs) - Create index, drop/recreate if conflict
- backup_database(db) - Clone entire database to {db_name}_backup_{timestamp}
"""

import importlib
import logging
from pathlib import Path
from typing import List, Dict, Any, Callable, Union
from datetime import datetime

from pymongo.database import Database
from pymongo.collection import Collection
from pymongo.errors import OperationFailure

logger = logging.getLogger("workflow.db.migrations")


# =============================================================================
# Utility Functions for Migrations
# =============================================================================

def ensure_index(collection: Collection, keys: Union[str, List], **kwargs) -> str:
    """
    Ensure an index exists with the given specification.

    Behavior:
    - If index doesn't exist: creates it
    - If index exists with same keys: no-op, returns existing name
    - If index name exists with different keys: drops old, creates new

    Args:
        collection: MongoDB collection
        keys: Index key specification (field name or list of tuples)
        **kwargs: Additional index options (unique, sparse, expireAfterSeconds, etc.)

    Returns:
        Index name

    Example:
        from backend.db.migrations import ensure_index
        ensure_index(db.users, "user_id", unique=True)
        ensure_index(db.events, [("workflow_run_id", 1), ("event_id", 1)])
    """
    try:
        return collection.create_index(keys, **kwargs)
    except OperationFailure as e:
        error_msg = str(e).lower()
        # Check if it's a "same name, different keys" error
        if "already exists with" in error_msg or "different options" in error_msg:
            # Generate the index name that MongoDB would use
            index_name = _generate_index_name(keys)

            logger.warning(
                f"Index {collection.name}.{index_name} exists with different spec, "
                f"dropping and recreating"
            )
            try:
                collection.drop_index(index_name)
            except OperationFailure:
                pass  # Index might not exist with that exact name

            return collection.create_index(keys, **kwargs)
        else:
            raise


def _generate_index_name(keys: Union[str, List]) -> str:
    """
    Generate the default index name MongoDB would use for given keys.

    Args:
        keys: Index key specification

    Returns:
        Index name string (e.g., "user_id_1" or "workflow_run_id_1_event_id_-1")
    """
    if isinstance(keys, str):
        return f"{keys}_1"
    elif isinstance(keys, list):
        parts = []
        for key in keys:
            if isinstance(key, tuple):
                field, direction = key
                parts.append(f"{field}_{direction}")
            else:
                parts.append(f"{key}_1")
        return "_".join(parts)
    else:
        raise ValueError(f"Invalid keys type: {type(keys)}")


def backup_database(db: Database) -> str:
    """
    Create a full backup of the database to a separate database.

    Clones all collections to {db_name}_backup_{timestamp}.
    Verifies document counts match after backup.

    Args:
        db: MongoDB database to backup

    Returns:
        Name of the backup database

    Raises:
        RuntimeError: If backup fails or verification fails

    Example:
        from backend.db.migrations import backup_database
        backup_db_name = backup_database(db)
    """
    db_name = db.name
    client = db.client
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_db_name = f"{db_name}_backup_{timestamp}"

    logger.info(f"Creating database backup: {db_name} -> {backup_db_name}")

    collections = db.list_collection_names()

    for coll_name in collections:
        try:
            # Use $merge to copy to backup database
            pipeline = [
                {"$match": {}},
                {"$merge": {
                    "into": {"db": backup_db_name, "coll": coll_name},
                    "whenMatched": "replace",
                    "whenNotMatched": "insert"
                }}
            ]

            list(db[coll_name].aggregate(pipeline))

            # Verify backup
            source_count = db[coll_name].count_documents({})
            backup_count = client[backup_db_name][coll_name].count_documents({})

            if source_count != backup_count:
                raise RuntimeError(
                    f"Backup verification failed for {coll_name}: "
                    f"source={source_count}, backup={backup_count}"
                )

            logger.info(f"Backed up {coll_name}: {source_count} documents")

        except Exception as e:
            logger.error(f"Failed to backup {coll_name}: {e}")
            raise RuntimeError(f"Database backup failed at {coll_name}") from e

    logger.info(f"Database backup complete: {backup_db_name}")
    return backup_db_name


class Migration:
    """Represents a single migration."""

    def __init__(self, migration_id: int, description: str, apply_fn: Callable[[Database], None]):
        self.id = migration_id
        self.description = description
        self.apply_fn = apply_fn

    def apply(self, db: Database) -> None:
        """Apply this migration to the database."""
        self.apply_fn(db)


def discover_migrations() -> List[Migration]:
    """
    Discover all migration files in this folder.

    Looks for files named m_0.py, m_1.py, etc. and loads their
    MIGRATION_ID, DESCRIPTION, and apply() function.

    Returns:
        List of Migration objects sorted by ID
    """
    migrations = []
    migrations_dir = Path(__file__).parent

    for file_path in migrations_dir.glob("m_*.py"):
        module_name = file_path.stem  # e.g., "m_0"

        try:
            # Import the migration module
            module = importlib.import_module(f".{module_name}", package="backend.db.migrations")

            # Extract required attributes
            migration_id = getattr(module, "MIGRATION_ID", None)
            description = getattr(module, "DESCRIPTION", "")
            apply_fn = getattr(module, "apply", None)

            if migration_id is None:
                logger.warning(f"Migration {module_name} missing MIGRATION_ID, skipping")
                continue

            if apply_fn is None:
                logger.warning(f"Migration {module_name} missing apply() function, skipping")
                continue

            migrations.append(Migration(
                migration_id=migration_id,
                description=description,
                apply_fn=apply_fn
            ))

        except Exception as e:
            logger.error(f"Failed to load migration {module_name}: {e}")
            raise

    # Sort by migration ID
    migrations.sort(key=lambda m: m.id)
    return migrations


def get_applied_migrations(db: Database) -> List[int]:
    """
    Get list of migration IDs that have been applied.

    Args:
        db: MongoDB database

    Returns:
        List of migration IDs (integers) that have been applied
    """
    schema_migrations = db.schema_migrations

    # Check if collection exists
    if "schema_migrations" not in db.list_collection_names():
        return []

    applied = list(schema_migrations.find({}, {"migration_id": 1}).sort("migration_id", 1))
    return [doc["migration_id"] for doc in applied]


def record_migration(db: Database, migration: Migration) -> None:
    """
    Record that a migration has been applied.

    Args:
        db: MongoDB database
        migration: Migration that was applied
    """
    db.schema_migrations.insert_one({
        "migration_id": migration.id,
        "description": migration.description,
        "applied_at": datetime.utcnow()
    })


def run_migrations(db: Database) -> Dict[str, Any]:
    """
    Run all pending migrations.

    Args:
        db: MongoDB database

    Returns:
        Dict with migration statistics:
        {
            "applied": [list of applied migration IDs],
            "already_applied": [list of skipped migration IDs],
            "errors": [list of error messages]
        }
    """
    stats = {
        "applied": [],
        "already_applied": [],
        "errors": []
    }

    # Discover all migrations
    migrations = discover_migrations()
    logger.info(f"Discovered {len(migrations)} migrations")

    # Get already applied migrations
    applied_ids = get_applied_migrations(db)
    logger.info(f"Already applied: {applied_ids}")

    # Apply pending migrations in order
    for migration in migrations:
        if migration.id in applied_ids:
            stats["already_applied"].append(migration.id)
            continue

        try:
            logger.info(f"Applying migration {migration.id}: {migration.description}")
            migration.apply(db)
            record_migration(db, migration)
            stats["applied"].append(migration.id)
            logger.info(f"Migration {migration.id} applied successfully")

        except Exception as e:
            error_msg = f"Migration {migration.id} failed: {e}"
            logger.error(error_msg)
            stats["errors"].append(error_msg)
            # Stop on first error - migrations should be applied in order
            raise RuntimeError(error_msg) from e

    return stats
