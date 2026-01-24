"""
Migration 6: Create workflow resolution collections

Creates collections for the execution groups feature:
- workflow_resolutions: Maps source workflows to flattened versions by capability requirements
- workflow_run_resolutions: Links workflow runs to their active resolution (supports version switching)

Note: Collections are created implicitly by create_index(). This migration runs at server
startup before any queries, so indexes will be in place before any data is inserted.
"""

from pymongo.database import Database
from . import ensure_index

MIGRATION_ID = 6
DESCRIPTION = "Create workflow_resolutions and workflow_run_resolutions collections"


def apply(db: Database) -> None:
    """Create resolution collections and indexes."""

    # workflow_resolutions collection
    # Maps raw workflow versions to flattened versions with capability requirements
    #
    # Schema:
    # {
    #     workflow_resolution_id: str,
    #     workflow_template_id: str,
    #     source_workflow_version_id: str,      // Raw workflow with execution_groups
    #     resolved_workflow_version_id: str,    // Flattened workflow
    #     requires: [{ capability: str, priority: int }],
    #     selected_paths: { [group_name]: path_name },
    #     created_at: datetime
    # }

    ensure_index(
        db.workflow_resolutions,
        [("workflow_template_id", 1), ("source_workflow_version_id", 1)],
        name="workflow_resolutions_template_source"
    )
    print("  Created index: workflow_resolutions_template_source")

    ensure_index(
        db.workflow_resolutions,
        "source_workflow_version_id",
        name="workflow_resolutions_source"
    )
    print("  Created index: workflow_resolutions_source")

    ensure_index(
        db.workflow_resolutions,
        "workflow_resolution_id",
        unique=True,
        name="workflow_resolutions_id"
    )
    print("  Created index: workflow_resolutions_id (unique)")

    # workflow_run_resolutions collection
    # Links workflow runs to their active resolution (supports version switching mid-run)
    #
    # Schema:
    # {
    #     workflow_run_resolution_id: str,
    #     workflow_run_id: str,
    #     workflow_resolution_id: str,
    #     source_workflow_version_id: str,  // For version comparison on resume
    #     client_capabilities: [str],
    #     is_active: bool,
    #     created_at: datetime
    # }

    # Unique constraint: only one active resolution per run
    ensure_index(
        db.workflow_run_resolutions,
        [("workflow_run_id", 1), ("is_active", 1)],
        unique=True,
        partialFilterExpression={"is_active": True},
        name="workflow_run_resolutions_active_unique"
    )
    print("  Created index: workflow_run_resolutions_active_unique (unique partial)")

    ensure_index(
        db.workflow_run_resolutions,
        "workflow_run_resolution_id",
        unique=True,
        name="workflow_run_resolutions_id"
    )
    print("  Created index: workflow_run_resolutions_id (unique)")

    ensure_index(
        db.workflow_run_resolutions,
        "workflow_run_id",
        name="workflow_run_resolutions_run"
    )
    print("  Created index: workflow_run_resolutions_run")

    print("  Migration 6 complete: workflow resolution collections created")
