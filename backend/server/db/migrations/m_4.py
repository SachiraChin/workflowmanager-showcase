"""
Migration 4: Rename current_version_id to current_workflow_version_id

This migration renames the field in workflow_runs collection for clarity.
"""

from pymongo.database import Database

MIGRATION_ID = 4
DESCRIPTION = "Rename current_version_id to current_workflow_version_id"


def apply(db: Database) -> None:
    """Rename current_version_id to current_workflow_version_id in workflow_runs."""

    # Rename the field in all documents that have it
    result = db.workflow_runs.update_many(
        {"current_version_id": {"$exists": True}},
        {"$rename": {"current_version_id": "current_workflow_version_id"}}
    )

    print(f"  Renamed current_version_id -> current_workflow_version_id in {result.modified_count} workflow_runs")

    # Drop old index if it exists
    try:
        db.workflow_runs.drop_index("current_version_id_1")
        print("  Dropped old index: current_version_id_1")
    except Exception:
        pass  # Index may not exist

    # Create new index
    db.workflow_runs.create_index("current_workflow_version_id")
    print("  Created new index: current_workflow_version_id")
