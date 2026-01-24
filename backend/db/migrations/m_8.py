"""
Migration 8: Remove initial_workflow_version_id and simplify version types

This migration:
1. Renames version_type "flattened" to "resolved"
2. Sets parent versions (those with resolved children) to "unresolved"
3. Creates workflow_run_version_history collection for tracking
4. Migrates existing workflow_runs to history table
5. Removes initial_workflow_version_id from all workflow_runs

Version types after migration:
- raw: Workflow without execution groups (runnable)
- unresolved: Workflow with execution groups, not flattened (NOT runnable)
- resolved: Flattened workflow from unresolved (runnable)
"""

from datetime import datetime
from pymongo.database import Database
from . import ensure_index, backup_database

MIGRATION_ID = 8
DESCRIPTION = "Remove initial_workflow_version_id, rename flattened to resolved"


def apply(db: Database) -> None:
    """Apply migration to simplify version fields."""

    # Create backup before destructive operations
    backup_database(db)
    print("  Database backup created")

    # Step 1: Rename version_type "flattened" to "resolved"
    result = db.workflow_versions.update_many(
        {"version_type": "flattened"},
        {"$set": {"version_type": "resolved"}}
    )
    print(f"  Renamed version_type 'flattened' to 'resolved' for {result.modified_count} versions")

    # Step 2: Set parent versions to "unresolved"
    # Find all resolved versions and update their parents
    parents_updated = set()
    for resolved_version in db.workflow_versions.find({"version_type": "resolved"}):
        parent_id = resolved_version.get("parent_workflow_version_id")
        if parent_id and parent_id not in parents_updated:
            db.workflow_versions.update_one(
                {"workflow_version_id": parent_id},
                {"$set": {"version_type": "unresolved"}}
            )
            parents_updated.add(parent_id)
    print(f"  Set version_type 'unresolved' for {len(parents_updated)} parent versions")

    # Step 3: Create workflow_run_version_history collection
    # (Collection is created implicitly on first insert, but we create indexes)

    # Step 4: Migrate workflow_runs to history table
    runs_migrated = 0
    runs_skipped_broken = 0
    runs_skipped_no_version = 0

    for run in db.workflow_runs.find({"current_workflow_version_id": {"$exists": True, "$ne": None}}):
        version_id = run.get("current_workflow_version_id")
        if not version_id:
            runs_skipped_no_version += 1
            continue

        version = db.workflow_versions.find_one({"workflow_version_id": version_id})
        if not version:
            runs_skipped_no_version += 1
            continue

        version_type = version.get("version_type")

        if version_type == "resolved":
            # Valid resolved version - add to history
            db.workflow_run_version_history.insert_one({
                "workflow_run_id": run["workflow_run_id"],
                "workflow_version_id": version_id,
                "client_capabilities": [],  # Data is lost from previous runs
                "workflow_version_requirements": version.get("requires", []),
                "created_at": run.get("created_at", datetime.utcnow())
            })
            runs_migrated += 1

        elif version_type == "raw":
            # Check if this raw version has resolved children
            has_resolved_child = db.workflow_versions.find_one({
                "parent_workflow_version_id": version_id,
                "version_type": "resolved"
            })

            if has_resolved_child:
                # Broken reference - raw version has resolved children but run points to raw
                # Skip - don't add to history
                runs_skipped_broken += 1
            else:
                # Valid raw workflow (no execution groups) - add to history
                db.workflow_run_version_history.insert_one({
                    "workflow_run_id": run["workflow_run_id"],
                    "workflow_version_id": version_id,
                    "client_capabilities": [],
                    "workflow_version_requirements": [],  # Raw has no requirements
                    "created_at": run.get("created_at", datetime.utcnow())
                })
                runs_migrated += 1

        elif version_type == "unresolved":
            # This shouldn't happen - unresolved versions shouldn't be used for runs
            # Skip and log
            runs_skipped_broken += 1

    print(f"  Migrated {runs_migrated} workflow runs to history table")
    if runs_skipped_broken > 0:
        print(f"  Skipped {runs_skipped_broken} runs with broken/invalid version references")
    if runs_skipped_no_version > 0:
        print(f"  Skipped {runs_skipped_no_version} runs with missing version")

    # Step 5: Remove initial_workflow_version_id from all workflow_runs
    result = db.workflow_runs.update_many(
        {"initial_workflow_version_id": {"$exists": True}},
        {"$unset": {"initial_workflow_version_id": ""}}
    )
    print(f"  Removed initial_workflow_version_id from {result.modified_count} workflow runs")

    # Step 6: Create indexes
    ensure_index(db.workflow_run_version_history, "workflow_run_id")
    print("  Created index: workflow_run_version_history.workflow_run_id")

    ensure_index(db.workflow_run_version_history, "workflow_version_id")
    print("  Created index: workflow_run_version_history.workflow_version_id")

    print("  Migration 8 complete: version fields simplified")
