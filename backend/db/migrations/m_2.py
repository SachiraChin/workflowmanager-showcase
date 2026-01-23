"""
Migration 2: Backup Database and Drop Legacy Collections

This migration:
1. Creates a full backup of the database to {db_name}_backup_{timestamp}
2. Drops the legacy 'workflows' collection (replaced by workflow_runs)
3. Drops old keyword_history_backup_* collections
"""

import logging
from pymongo.database import Database

from . import backup_database

MIGRATION_ID = 2
DESCRIPTION = "Backup database and drop legacy collections (workflows, keyword_history_backup_*)"

logger = logging.getLogger("workflow.db.migrations")


def apply(db: Database) -> None:
    """
    Backup database and drop legacy collections.
    """
    # Create full backup first
    backup_database(db)

    # Drop legacy collections
    collections = db.list_collection_names()

    if "workflows" in collections:
        logger.info("Dropping legacy 'workflows' collection")
        db.workflows.drop()

    for coll_name in collections:
        if coll_name.startswith("keyword_history_backup_"):
            logger.info(f"Dropping legacy collection: {coll_name}")
            db[coll_name].drop()

    logger.info("Legacy collection cleanup complete")
