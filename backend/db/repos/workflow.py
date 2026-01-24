"""
Workflow Repository - Workflow run CRUD operations.

Handles:
- Workflow run creation and retrieval
- Status updates
- Version history tracking
"""

import uuid
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from pymongo import DESCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from backend.db.base import BaseRepository
from backend.db.utils import uuid7_str

logger = logging.getLogger(__name__)


class WorkflowRepository(BaseRepository):
    """
    Repository for workflow run operations.

    Collections:
    - workflow_runs: Workflow execution instances
    - workflow_run_version_history: Version usage history
    - branches: Branch metadata (for root branch creation)
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.workflow_runs: Collection = db.workflow_runs
        self.workflow_run_version_history: Collection = db.workflow_run_version_history
        self.branches: Collection = db.branches

    def get_workflow(self, workflow_run_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow metadata by ID."""
        return self.workflow_runs.find_one({"workflow_run_id": workflow_run_id})

    def workflow_run_exists(
        self, user_id: str, workflow_run_id: str
    ) -> Tuple[bool, bool]:
        """
        Check if workflow run exists and if user owns it.

        Returns:
            Tuple of (user_owns_workflow, workflow_exists)
            - (True, True): Workflow exists and user owns it
            - (False, True): Workflow exists but user doesn't own it
            - (False, False): Workflow doesn't exist
        """
        workflow = self.workflow_runs.find_one(
            {"workflow_run_id": workflow_run_id},
            {"user_id": 1},
        )
        if not workflow:
            return (False, False)
        return (workflow.get("user_id") == user_id, True)

    def get_workflow_by_project(
        self, user_id: str, project_name: str, workflow_template_name: str
    ) -> Optional[Dict[str, Any]]:
        """Get active workflow for user + project + template."""
        return self.workflow_runs.find_one(
            {
                "user_id": user_id,
                "project_name": project_name,
                "workflow_template_name": workflow_template_name,
                "status": {"$nin": ["completed", "error"]},
            }
        )

    def find_existing_workflow(
        self,
        user_id: str,
        workflow_template_name: str,
        project_name: str,
    ) -> Optional[Dict[str, Any]]:
        """Find existing active workflow for user + template + project."""
        return self.workflow_runs.find_one(
            {
                "user_id": user_id,
                "workflow_template_name": workflow_template_name,
                "project_name": project_name,
                "status": {"$nin": ["completed", "error"]},
            }
        )

    def get_or_create_workflow_run(
        self,
        project_name: str,
        user_id: str,
        workflow_template_name: str,
        workflow_template_id: str,
        active_version_id: str,
    ) -> Tuple[str, bool, Optional[str]]:
        """
        Get existing workflow run for project or create new one.

        Args:
            project_name: User-provided project identifier
            user_id: User ID (required)
            workflow_template_name: The workflow_id from workflow JSON
            workflow_template_id: Template ID for this workflow
            active_version_id: Already-selected version ID

        Returns:
            Tuple of (workflow_run_id, is_new, branch_id)
            - branch_id is returned so caller can store WORKFLOW_CREATED event
        """
        # Try to find existing active workflow
        existing = self.find_existing_workflow(user_id, workflow_template_name, project_name)
        if existing:
            logger.info(f"[DB] get_or_create_workflow_run: found existing workflow={existing['workflow_run_id']}")
            return existing["workflow_run_id"], False, existing.get("current_branch_id")

        # Create new workflow run with root branch
        workflow_run_id = f"wf_{uuid.uuid4().hex[:12]}"
        branch_id = f"br_{uuid7_str()}"

        # Create root branch with lineage
        self.branches.insert_one({
            "branch_id": branch_id,
            "workflow_run_id": workflow_run_id,
            "lineage": [{"branch_id": branch_id, "cutoff_event_id": None}],
            "created_at": datetime.utcnow(),
        })

        # Create workflow run
        self.create_workflow_run(
            workflow_run_id=workflow_run_id,
            user_id=user_id,
            project_name=project_name,
            workflow_template_name=workflow_template_name,
            workflow_template_id=workflow_template_id,
            active_version_id=active_version_id,
            branch_id=branch_id,
        )

        logger.info(f"[DB] get_or_create_workflow_run: created new workflow={workflow_run_id}")
        return workflow_run_id, True, branch_id

    def create_workflow_run(
        self,
        workflow_run_id: str,
        user_id: str,
        project_name: str,
        workflow_template_name: str,
        workflow_template_id: str,
        active_version_id: str,
        branch_id: str,
    ) -> None:
        """
        Create a new workflow run record.

        Args:
            workflow_run_id: Unique ID for this workflow run
            user_id: Owner user ID
            project_name: User-provided project identifier
            workflow_template_name: The workflow_id from workflow JSON
            workflow_template_id: Template ID
            active_version_id: Selected version ID
            branch_id: Root branch ID
        """
        self.workflow_runs.insert_one(
            {
                "workflow_run_id": workflow_run_id,
                "user_id": user_id,
                "project_name": project_name,
                "workflow_template_name": workflow_template_name,
                "workflow_template_id": workflow_template_id,
                "current_workflow_version_id": active_version_id,
                "current_branch_id": branch_id,
                "status": "created",
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }
        )
        logger.info(
            f"[DB] create_workflow_run: workflow={workflow_run_id}, branch={branch_id}, version={active_version_id}"
        )

    def update_workflow_status(
        self,
        workflow_run_id: str,
        status: str,
        current_step: str = None,
        current_step_name: str = None,
        current_module: str = None,
    ) -> None:
        """Update workflow status."""
        update = {"status": status, "updated_at": datetime.utcnow()}
        if current_step:
            update["current_step"] = current_step
        if current_step_name:
            update["current_step_name"] = current_step_name
        if current_module:
            update["current_module"] = current_module

        if status == "completed":
            update["completed_at"] = datetime.utcnow()

        logger.info(
            f"[DB] update_workflow_status: workflow={workflow_run_id}, status={status}"
        )

        result = self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id}, {"$set": update}
        )

        logger.debug(
            f"[DB] update_workflow_status result: matched={result.matched_count}, modified={result.modified_count}"
        )

    def update_workflow_branch(
        self,
        workflow_run_id: str,
        branch_id: str,
    ) -> None:
        """Update workflow's current branch."""
        self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {
                "$set": {
                    "current_branch_id": branch_id,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    def update_workflow_version(
        self,
        workflow_run_id: str,
        version_id: str,
    ) -> None:
        """Update workflow's current version."""
        self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {
                "$set": {
                    "current_workflow_version_id": version_id,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    def add_version_history_entry(
        self,
        workflow_run_id: str,
        workflow_version_id: str,
        client_capabilities: List[str] = None,
        version_repo=None,
    ) -> None:
        """
        Add an entry to workflow_run_version_history.

        Called when:
        - New workflow_run is created
        - Workflow run switches to a new version (resume with update)

        Args:
            workflow_run_id: The workflow run ID
            workflow_version_id: The version being used (must be raw or resolved, not unresolved)
            client_capabilities: List of client capabilities at time of creation
            version_repo: VersionRepository instance for validation (optional)

        Raises:
            ValueError: If workflow_version_id points to an unresolved version
        """
        if client_capabilities is None:
            client_capabilities = []

        workflow_version_requirements = []

        # Validate version type if version_repo provided
        if version_repo:
            version = version_repo.get_workflow_version_by_id(workflow_version_id)
            if not version:
                # Version not found - skip silently (may be a broken reference)
                return

            version_type = version.get("version_type")
            if version_type == "unresolved":
                raise ValueError(
                    f"Cannot use unresolved version {workflow_version_id} for workflow run. "
                    f"Unresolved versions have execution groups that must be resolved first."
                )

            # Get workflow_version_requirements from the version's "requires" field
            # Only populated for resolved versions; empty for raw versions
            workflow_version_requirements = version.get("requires", []) if version_type == "resolved" else []

        self.workflow_run_version_history.insert_one({
            "workflow_run_id": workflow_run_id,
            "workflow_version_id": workflow_version_id,
            "client_capabilities": client_capabilities,
            "workflow_version_requirements": workflow_version_requirements,
            "created_at": datetime.utcnow()
        })

    def delete_workflow(self, workflow_run_id: str) -> None:
        """Delete a workflow run record."""
        self.workflow_runs.delete_one({"workflow_run_id": workflow_run_id})

    def reset_workflow(self, workflow_run_id: str) -> None:
        """Reset workflow status to created."""
        self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {
                "$set": {
                    "status": "created",
                    "current_step": None,
                    "current_module": None,
                    "updated_at": datetime.utcnow(),
                }
            },
        )

    def get_active_workflows(self, user_id: str = None) -> List[Dict[str, Any]]:
        """
        Get all active (non-completed, non-error) workflows.

        Args:
            user_id: If provided, only return workflows for this user

        Returns:
            List of active workflow documents
        """
        query = {"status": {"$nin": ["completed", "error"]}}
        if user_id:
            query["user_id"] = user_id
        return list(self.workflow_runs.find(query))

    def get_all_workflows(
        self,
        limit: int = 50,
        updated_since: datetime = None,
        user_id: str = None,
    ) -> List[Dict[str, Any]]:
        """
        Get all workflows with optional filters.

        Args:
            limit: Maximum number of workflows to return
            updated_since: Only return workflows updated after this time
            user_id: If provided, only return workflows for this user

        Returns:
            List ordered by updated_at descending
        """
        query = {}
        if updated_since:
            query["updated_at"] = {"$gte": updated_since}
        if user_id:
            query["user_id"] = user_id

        return list(
            self.workflow_runs.find(query).sort("updated_at", DESCENDING).limit(limit)
        )
