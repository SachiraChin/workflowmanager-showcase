"""
Migration 9: Replace keyword_history with weighted_keywords

This migration:
1. Drops the legacy keyword_history collection
2. Creates the new weighted_keywords collection with indexes
   - Unique compound index on (workflow_template_id, keyword)
   - Query optimization index on (workflow_template_id, category, weight)

Note: Data from keyword_history is NOT migrated. The new module has a different
structure (workflow_template_id scoped only, no step_id/module_name).
"""

from pymongo.database import Database
from pymongo import ASCENDING, DESCENDING
from . import backup_database

MIGRATION_ID = 9
DESCRIPTION = "Replace keyword_history with weighted_keywords"


def apply(db: Database) -> None:
    """Apply migration to replace keyword_history with weighted_keywords."""

    # Create backup before dropping collection
    backup_database(db)
    print("  Database backup created")

    # Drop legacy keyword_history collection
    if "keyword_history" in db.list_collection_names():
        count = db.keyword_history.count_documents({})
        db.keyword_history.drop()
        print(f"  Dropped keyword_history collection ({count} documents)")
    else:
        print("  keyword_history collection not found, skipping drop")

    # Create unique compound index for (workflow_template_id, keyword)
    db.weighted_keywords.create_index(
        [
            ("workflow_template_id", ASCENDING),
            ("keyword", ASCENDING)
        ],
        unique=True,
        name="workflow_template_keyword_unique"
    )
    print("  Created unique index: weighted_keywords(workflow_template_id, keyword)")

    # Create query optimization index for common filter patterns
    db.weighted_keywords.create_index(
        [
            ("workflow_template_id", ASCENDING),
            ("category", ASCENDING),
            ("weight", DESCENDING)
        ],
        name="workflow_template_category_weight"
    )
    print("  Created index: weighted_keywords(workflow_template_id, category, weight)")

    print("  Migration 9 complete: keyword_history replaced with weighted_keywords")
