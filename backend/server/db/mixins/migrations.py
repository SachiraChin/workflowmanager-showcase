"""
Database Migration Utilities

Branch and workflow migration operations.
Extracted from database_provider.py for maintainability.
"""

from datetime import datetime
from typing import Dict, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from db import Database


class DatabaseMigrationsMixin:
    """
    Mixin providing migration utilities for database schema updates.
    """

    def ensure_workflow_has_branch(self: "Database", workflow_run_id: str) -> str:
        """
        Ensure a workflow has a branch. Creates a root branch if missing.

        This is for backwards compatibility with workflows created before
        the branch-based architecture was implemented.

        Args:
            workflow_run_id: Workflow ID

        Returns:
            Current branch ID (created if needed)
        """
        from ...utils import uuid7_str
        import logging
        logger = logging.getLogger(__name__)

        workflow = self.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            raise ValueError(f"Workflow {workflow_run_id} not found")

        # Check if workflow already has a branch
        current_branch_id = workflow.get("current_branch_id")
        if current_branch_id:
            # Verify branch exists and has lineage
            branch = self.branch_repo.get_branch(current_branch_id)
            if branch and "lineage" in branch:
                return current_branch_id
            elif branch:
                # Branch exists but no lineage - migrate it
                self._migrate_branch_to_lineage(branch)
                return current_branch_id

        # Create root branch with lineage
        branch_id = f"br_{uuid7_str()}"

        self.branches.insert_one({
            "branch_id": branch_id,
            "workflow_run_id": workflow_run_id,
            "lineage": [
                {"branch_id": branch_id, "cutoff_event_id": None}
            ],
            "created_at": datetime.utcnow()
        })

        # Update workflow with branch ID
        self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {"$set": {
                "current_branch_id": branch_id,
                "updated_at": datetime.utcnow()
            }}
        )

        # Update existing events to belong to this branch
        self.events.update_many(
            {"workflow_run_id": workflow_run_id, "branch_id": {"$exists": False}},
            {"$set": {"branch_id": branch_id}}
        )

        # Also update events that have branch_id: null
        self.events.update_many(
            {"workflow_run_id": workflow_run_id, "branch_id": None},
            {"$set": {"branch_id": branch_id}}
        )

        logger.info(f"[MIGRATION] Created root branch {branch_id} for workflow {workflow_run_id}")
        return branch_id

    def _migrate_branch_to_lineage(self: "Database", branch: Dict[str, Any]) -> None:
        """
        Migrate a single branch from old format (parent_branch_id/parent_event_id)
        to new format (lineage array).

        Args:
            branch: Branch document to migrate
        """
        import logging
        logger = logging.getLogger(__name__)

        branch_id = branch["branch_id"]

        # Build lineage by walking up parent chain
        lineage_branches = []
        current = branch
        while current:
            lineage_branches.append(current)
            parent_id = current.get("parent_branch_id")
            if parent_id:
                current = self.branch_repo.get_branch(parent_id)
            else:
                current = None

        lineage_branches.reverse()  # Root first

        # Build lineage array with cutoffs
        lineage = []
        for i, br in enumerate(lineage_branches):
            if i < len(lineage_branches) - 1:
                # Cutoff is the next branch's parent_event_id
                cutoff = lineage_branches[i + 1].get("parent_event_id")
            else:
                # Current branch has no cutoff
                cutoff = None
            lineage.append({
                "branch_id": br["branch_id"],
                "cutoff_event_id": cutoff
            })

        # Update the branch with lineage
        self.branches.update_one(
            {"branch_id": branch_id},
            {"$set": {"lineage": lineage}}
        )

        logger.info(f"[MIGRATION] Added lineage to branch {branch_id} ({len(lineage)} entries)")

    def migrate_all_branches_to_lineage(self: "Database") -> Dict[str, Any]:
        """
        Migrate all existing branches to include lineage array.

        Returns:
            Dict with migration statistics
        """
        import logging
        logger = logging.getLogger(__name__)

        stats = {
            "total": 0,
            "migrated": 0,
            "already_migrated": 0,
            "errors": []
        }

        # Find all branches without lineage
        branches = list(self.branches.find({"lineage": {"$exists": False}}))
        stats["total"] = len(branches)

        # Also count already migrated
        already_migrated = self.branches.count_documents({"lineage": {"$exists": True}})
        stats["already_migrated"] = already_migrated

        for branch in branches:
            branch_id = branch.get("branch_id")
            try:
                self._migrate_branch_to_lineage(branch)
                stats["migrated"] += 1
            except Exception as e:
                error_msg = f"Failed to migrate branch {branch_id}: {str(e)}"
                stats["errors"].append(error_msg)
                logger.error(f"[MIGRATION] {error_msg}")

        logger.info(f"[MIGRATION] Branch lineage migration complete: {stats}")
        return stats

    def migrate_all_workflows_to_branches(self: "Database") -> Dict[str, Any]:
        """
        Migrate all workflows to branch-based architecture.

        Returns:
            Dict with migration statistics
        """
        import logging
        logger = logging.getLogger(__name__)

        stats = {
            "total": 0,
            "migrated": 0,
            "already_migrated": 0,
            "errors": []
        }

        # Find all workflows
        workflows = list(self.workflow_runs.find({}))
        stats["total"] = len(workflows)

        for workflow in workflows:
            workflow_run_id = workflow.get("workflow_run_id")
            try:
                if workflow.get("current_branch_id"):
                    # Check if branch exists
                    branch = self.branch_repo.get_branch(workflow["current_branch_id"])
                    if branch:
                        stats["already_migrated"] += 1
                        continue

                # Migrate this workflow
                self.ensure_workflow_has_branch(workflow_run_id)
                stats["migrated"] += 1
                logger.info(f"[MIGRATION] Migrated workflow {workflow_run_id}")

            except Exception as e:
                error_msg = f"Failed to migrate {workflow_run_id}: {str(e)}"
                stats["errors"].append(error_msg)
                logger.error(f"[MIGRATION] {error_msg}")

        logger.info(f"[MIGRATION] Complete: {stats}")
        return stats
