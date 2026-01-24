"""
Migration 7: Simplify version management

This migration:
1. Adds version_type field ("raw" | "flattened") to workflow_versions
2. Fixes source_type for flattened versions ("flattened" -> "json")
3. Adds parent_workflow_version_id and requires fields to workflow_versions
4. Migrates parent relationships from workflow_resolutions
5. Updates workflow_runs.current_workflow_version_id from active resolutions
6. Drops workflow_resolutions and workflow_run_resolutions collections

This simplifies the version management by:
- Using direct parent links instead of resolution collections
- Keeping version fields on workflow_runs but using them correctly
- current_workflow_version_id now points to actual version being executed
"""

from pymongo.database import Database
from . import ensure_index, backup_database

MIGRATION_ID = 7
DESCRIPTION = "Simplify version management: parent links, remove resolutions"


def apply(db: Database) -> None:
    """Apply migration to simplify version management."""

    # Create backup before destructive operations
    backup_database(db)
    print("  Database backup created")

    # 1. Add version_type field based on source_type
    # Raw versions: source_type is "json" or "zip"
    result = db.workflow_versions.update_many(
        {"source_type": {"$in": ["json", "zip"]}},
        {"$set": {"version_type": "raw"}}
    )
    print(f"  Set version_type='raw' for {result.modified_count} versions")

    # Flattened versions: source_type was incorrectly "flattened", fix to "json"
    result = db.workflow_versions.update_many(
        {"source_type": "flattened"},
        {"$set": {"version_type": "flattened", "source_type": "json"}}
    )
    print(f"  Set version_type='flattened' and fixed source_type for {result.modified_count} versions")

    # 2. Set defaults for new fields on raw versions
    result = db.workflow_versions.update_many(
        {"version_type": "raw"},
        {"$set": {"parent_workflow_version_id": None, "requires": []}}
    )
    print(f"  Set defaults for {result.modified_count} raw versions")

    # 3. Migrate parent relationships and requires from workflow_resolutions
    # Note: requires keeps original format [{capability: str, priority: int}]
    resolutions_migrated = 0
    if "workflow_resolutions" in db.list_collection_names():
        for resolution in db.workflow_resolutions.find():
            db.workflow_versions.update_one(
                {"workflow_version_id": resolution["resolved_workflow_version_id"]},
                {"$set": {
                    "parent_workflow_version_id": resolution["source_workflow_version_id"],
                    "requires": resolution.get("requires", [])  # Keep original format
                }}
            )
            resolutions_migrated += 1
        print(f"  Migrated {resolutions_migrated} resolution parent links")
    else:
        print("  No workflow_resolutions collection to migrate")

    # 4. Update workflow_runs.current_workflow_version_id to point to flattened
    runs_updated = 0
    if "workflow_run_resolutions" in db.list_collection_names():
        for run_res in db.workflow_run_resolutions.find({"is_active": True}):
            resolution = db.workflow_resolutions.find_one({
                "workflow_resolution_id": run_res["workflow_resolution_id"]
            })
            if resolution:
                db.workflow_runs.update_one(
                    {"workflow_run_id": run_res["workflow_run_id"]},
                    {"$set": {
                        "current_workflow_version_id": resolution["resolved_workflow_version_id"]
                    }}
                )
                runs_updated += 1
        print(f"  Updated current_workflow_version_id for {runs_updated} runs")
    else:
        print("  No workflow_run_resolutions collection to migrate")

    # 5. Drop resolution collections
    if "workflow_resolutions" in db.list_collection_names():
        db.workflow_resolutions.drop()
        print("  Dropped collection: workflow_resolutions")

    if "workflow_run_resolutions" in db.list_collection_names():
        db.workflow_run_resolutions.drop()
        print("  Dropped collection: workflow_run_resolutions")

    # 6. Create indexes for new fields
    ensure_index(db.workflow_versions, "parent_workflow_version_id")
    print("  Created index: workflow_versions.parent_workflow_version_id")

    ensure_index(db.workflow_versions, "version_type")
    print("  Created index: workflow_versions.version_type")

    print("  Migration 7 complete: version management simplified")
