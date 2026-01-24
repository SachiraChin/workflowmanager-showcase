"""
Migration 3: Clean Up Legacy Indexes

This migration drops indexes that are no longer needed:

1. workflow_runs.workflow_id_1 - Uses old field name (code uses workflow_run_id)
2. workflow_runs.project_path_1 - Field stored but never queried
3. workflow_templates.workflow_template_name_1 - Non-compound unique index
   (should be compound with user_id, which already exists)
4. branches.workflow_id_1 - Uses old field name (code uses workflow_run_id)
5. events.workflow_id_1 - Uses old field name (code uses workflow_run_id)
6. tokens.workflow_id_1 - Uses old field name (code uses workflow_run_id)

All these indexes were confirmed unused by searching the codebase.
The correct indexes are created by _ensure_indexes() using the proper field names.
"""

import logging
from pymongo.database import Database

MIGRATION_ID = 3
DESCRIPTION = "Drop legacy indexes (workflow_id_1, project_path_1, workflow_template_name_1)"

logger = logging.getLogger("workflow.db.migrations")


def _drop_index_if_exists(collection, index_name: str) -> bool:
    """
    Drop an index if it exists.

    Args:
        collection: MongoDB collection
        index_name: Name of index to drop

    Returns:
        True if index was dropped, False if it didn't exist
    """
    try:
        indexes = collection.index_information()
        if index_name in indexes:
            logger.info(f"Dropping index: {collection.name}.{index_name}")
            collection.drop_index(index_name)
            logger.info(f"Dropped index: {collection.name}.{index_name}")
            return True
        else:
            logger.info(f"Index not found (already dropped?): {collection.name}.{index_name}")
            return False
    except Exception as e:
        logger.warning(f"Error dropping index {collection.name}.{index_name}: {e}")
        return False


def apply(db: Database) -> None:
    """
    Drop legacy indexes from all collections.
    """
    dropped = []

    # workflow_runs collection
    if _drop_index_if_exists(db.workflow_runs, "workflow_id_1"):
        dropped.append("workflow_runs.workflow_id_1")
    if _drop_index_if_exists(db.workflow_runs, "project_path_1"):
        dropped.append("workflow_runs.project_path_1")

    # workflow_templates collection
    if _drop_index_if_exists(db.workflow_templates, "workflow_template_name_1"):
        dropped.append("workflow_templates.workflow_template_name_1")

    # branches collection
    if _drop_index_if_exists(db.branches, "workflow_id_1"):
        dropped.append("branches.workflow_id_1")

    # events collection
    if _drop_index_if_exists(db.events, "workflow_id_1"):
        dropped.append("events.workflow_id_1")

    # tokens collection
    if _drop_index_if_exists(db.tokens, "workflow_id_1"):
        dropped.append("tokens.workflow_id_1")

    logger.info(f"Legacy index cleanup complete. Dropped {len(dropped)} indexes: {dropped}")
