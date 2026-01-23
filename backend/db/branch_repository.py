"""
Branch Repository - Branch management for retry/jump operations.

Handles:
- Branch CRUD operations
- Lineage tracking
- Branch creation for forking
"""

import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from pymongo.database import Database
from pymongo.collection import Collection

from .base import BaseRepository
from utils import uuid7_str


logger = logging.getLogger(__name__)


class BranchRepository(BaseRepository):
    """
    Repository for branch operations.

    Collections:
    - branches: Branch metadata with lineage
    - workflow_runs: For updating current branch
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.branches: Collection = db.branches
        self.workflow_runs: Collection = db.workflow_runs

    def get_branch(self, branch_id: str) -> Optional[Dict[str, Any]]:
        """Get branch by ID."""
        return self.branches.find_one({"branch_id": branch_id})

    def get_branch_lineage(self, branch_id: str) -> List[Tuple[str, Optional[str]]]:
        """
        Get branch lineage from root to specified branch.

        Returns list of (branch_id, cutoff_event_id) tuples from root to current.
        The cutoff_event_id indicates the last event to include from that branch.
        None means include all events (current branch has no cutoff).
        """
        branch = self.get_branch(branch_id)
        if not branch:
            return []

        # Use stored lineage if available (new format)
        if "lineage" in branch:
            return [
                (entry["branch_id"], entry.get("cutoff_event_id"))
                for entry in branch["lineage"]
            ]

        # Fallback for old format branches (recursive lookup)
        lineage = []
        current = branch
        while current:
            lineage.append(current)
            parent_id = current.get("parent_branch_id")
            if parent_id:
                current = self.get_branch(parent_id)
            else:
                current = None

        lineage.reverse()  # Root first

        # Build cutoffs: each branch's cutoff is the NEXT branch's parent_event_id
        result = []
        for i, br in enumerate(lineage):
            if i < len(lineage) - 1:
                cutoff = lineage[i + 1].get("parent_event_id")
            else:
                cutoff = None
            result.append((br["branch_id"], cutoff))

        return result

    def create_root_branch(self, workflow_run_id: str) -> str:
        """
        Create a root branch for a new workflow.

        Args:
            workflow_run_id: Workflow ID

        Returns:
            New branch ID
        """
        branch_id = f"br_{uuid7_str()}"
        self.branches.insert_one(
            {
                "branch_id": branch_id,
                "workflow_run_id": workflow_run_id,
                "lineage": [{"branch_id": branch_id, "cutoff_event_id": None}],
                "created_at": datetime.utcnow(),
            }
        )
        return branch_id

    def create_branch(
        self,
        workflow_run_id: str,
        parent_branch_id: str,
        parent_event_id: Optional[str],
    ) -> str:
        """
        Create a new branch forking from a specific point.

        Args:
            workflow_run_id: Workflow ID
            parent_branch_id: Branch containing the parent event
            parent_event_id: Last event to include from parent (cutoff point)

        Returns:
            New branch ID
        """
        new_branch_id = f"br_{uuid7_str()}"

        # Get parent branch to copy its lineage
        parent_branch = self.get_branch(parent_branch_id)

        # Build new lineage from parent's lineage
        new_lineage = []
        if parent_branch and "lineage" in parent_branch:
            for entry in parent_branch["lineage"]:
                if entry["branch_id"] == parent_branch_id:
                    # This is the parent - set its cutoff to fork point
                    new_lineage.append(
                        {
                            "branch_id": entry["branch_id"],
                            "cutoff_event_id": parent_event_id,
                        }
                    )
                else:
                    # Ancestor - keep as-is
                    new_lineage.append(entry.copy())
        else:
            # Parent doesn't have lineage (old format)
            new_lineage.append(
                {"branch_id": parent_branch_id, "cutoff_event_id": parent_event_id}
            )

        # Add new branch (no cutoff - it's current)
        new_lineage.append({"branch_id": new_branch_id, "cutoff_event_id": None})

        self.branches.insert_one(
            {
                "branch_id": new_branch_id,
                "workflow_run_id": workflow_run_id,
                "lineage": new_lineage,
                "created_at": datetime.utcnow(),
            }
        )

        # Update workflow's current branch
        self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {
                "$set": {
                    "current_branch_id": new_branch_id,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

        logger.info(
            f"[DB] create_branch: new_branch={new_branch_id}, parent={parent_branch_id}, cutoff={parent_event_id}"
        )

        return new_branch_id

    def delete_workflow_branches(self, workflow_run_id: str) -> int:
        """
        Delete all branches for a workflow.

        Args:
            workflow_run_id: Workflow ID

        Returns:
            Number of branches deleted
        """
        result = self.branches.delete_many({"workflow_run_id": workflow_run_id})
        return result.deleted_count
