"""
Migration 5: Consolidate version fields to initial_workflow_version_id

This migration consolidates the version field naming in workflow_runs:
- Rename initial_version_id -> initial_workflow_version_id
- Rename workflow_version_id -> initial_workflow_version_id (for old workflows)
- Remove the old fields
"""

from pymongo.database import Database

MIGRATION_ID = 5
DESCRIPTION = "Consolidate version fields to initial_workflow_version_id"


def apply(db: Database) -> None:
    """Consolidate version fields in workflow_runs."""

    # 1. Rename initial_version_id -> initial_workflow_version_id
    result1 = db.workflow_runs.update_many(
        {"initial_version_id": {"$exists": True}},
        {"$rename": {"initial_version_id": "initial_workflow_version_id"}}
    )
    print(f"  Renamed initial_version_id -> initial_workflow_version_id in {result1.modified_count} workflow_runs")

    # 2. Rename workflow_version_id -> initial_workflow_version_id (for old workflows)
    result2 = db.workflow_runs.update_many(
        {
            "workflow_version_id": {"$exists": True},
            "initial_workflow_version_id": {"$exists": False}
        },
        {"$rename": {"workflow_version_id": "initial_workflow_version_id"}}
    )
    print(f"  Renamed workflow_version_id -> initial_workflow_version_id in {result2.modified_count} workflow_runs")

    # 3. Remove any remaining old fields
    result3 = db.workflow_runs.update_many(
        {"$or": [
            {"workflow_version_id": {"$exists": True}},
            {"initial_version_id": {"$exists": True}}
        ]},
        {"$unset": {"workflow_version_id": "", "initial_version_id": ""}}
    )
    if result3.modified_count > 0:
        print(f"  Removed old fields from {result3.modified_count} workflow_runs")

    # Drop old indexes if they exist
    for old_index in ["initial_version_id_1", "workflow_version_id_1"]:
        try:
            db.workflow_runs.drop_index(old_index)
            print(f"  Dropped old index: {old_index}")
        except Exception:
            pass  # Index may not exist

    # Create new index
    db.workflow_runs.create_index("initial_workflow_version_id")
    print("  Created index: initial_workflow_version_id")
