"""
File Repository - Workflow file storage operations.

Handles:
- Storing and retrieving workflow files (API calls, outputs)
- File queries by category, group, branch
"""

from datetime import datetime
from typing import Dict, Any, List, Optional

from pymongo import ASCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from ..base import BaseRepository
from ..utils import uuid7_str


class FileRepository(BaseRepository):
    """
    Repository for workflow file operations.

    Collections:
    - workflow_files: All ws/ folder files (API logs, outputs)
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.workflow_files: Collection = db.workflow_files

    def store_workflow_file(
        self,
        workflow_run_id: str,
        category: str,
        group_id: Optional[str],
        filename: str,
        content: Any,
        content_type: str = "text",
        metadata: Dict[str, Any] = None,
        branch_id: str = None,
    ) -> str:
        """
        Store a file in the workflow_files collection.

        Args:
            workflow_run_id: The workflow run this file belongs to
            category: File category ("api_calls", "outputs", "root")
            group_id: Group identifier (e.g., API call directory name)
            filename: Original filename
            content: File content (string for text, dict for json)
            content_type: "json" or "text"
            metadata: Additional metadata (step_id, provider, file_role, etc.)
            branch_id: Branch ID for file isolation

        Returns:
            file_id of the stored file
        """
        file_id = f"wff_{uuid7_str()}"

        doc = {
            "file_id": file_id,
            "workflow_run_id": workflow_run_id,
            "branch_id": branch_id,
            "category": category,
            "group_id": group_id,
            "filename": filename,
            "content_type": content_type,
            "content": content,
            "metadata": metadata or {},
            "created_at": datetime.utcnow(),
        }

        self.workflow_files.insert_one(doc)
        return file_id

    def get_workflow_files(
        self,
        workflow_run_id: str,
        category: str = None,
        group_id: str = None,
        branch_id: str = None,
        since: str = None,
        step_id: str = None,
    ) -> List[Dict[str, Any]]:
        """
        Get files for a workflow run.

        Args:
            workflow_run_id: The workflow run ID
            category: Optional filter by category
            group_id: Optional filter by group
            branch_id: Optional filter by branch
            since: Optional ISO timestamp to filter files created after
            step_id: Optional filter by step_id in metadata

        Returns:
            List of file documents
        """
        query = {"workflow_run_id": workflow_run_id}
        if category:
            query["category"] = category
        if group_id:
            query["group_id"] = group_id
        if branch_id:
            query["branch_id"] = branch_id
        if since:
            try:
                since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
                query["created_at"] = {"$gt": since_dt}
            except ValueError:
                pass
        if step_id:
            query["metadata.step_id"] = step_id

        return list(self.workflow_files.find(query).sort("created_at", ASCENDING))

    def get_workflow_file(self, file_id: str) -> Optional[Dict[str, Any]]:
        """Get a single file by ID."""
        return self.workflow_files.find_one({"file_id": file_id})

    def get_workflow_file_by_name(
        self,
        workflow_run_id: str,
        filename: str,
        category: str = None,
        group_id: str = None,
        branch_id: str = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Get a file by filename within a workflow run.

        Returns the most recent if multiple exist.
        """
        query = {"workflow_run_id": workflow_run_id, "filename": filename}
        if category:
            query["category"] = category
        if group_id:
            query["group_id"] = group_id
        if branch_id:
            query["branch_id"] = branch_id

        return self.workflow_files.find_one(query, sort=[("created_at", -1)])

    def get_api_call_files(self, workflow_run_id: str, group_id: str) -> Dict[str, Any]:
        """
        Get all files for a specific API call, organized by file role.

        Uses MongoDB $facet to categorize files by role in a single query.

        Returns:
            Dict with files organized by role
        """
        pipeline = [
            {
                "$match": {
                    "workflow_run_id": workflow_run_id,
                    "category": "api_calls",
                    "group_id": group_id
                }
            },
            {
                "$facet": {
                    "request": [{"$match": {"metadata.file_role": "request"}}],
                    "response": [{"$match": {"metadata.file_role": "response"}}],
                    "schema": [{"$match": {"metadata.file_role": "schema"}}],
                    "metadata": [{"$match": {"metadata.file_role": "metadata"}}],
                    "inputs": [{"$match": {"metadata.file_role": "input"}}],
                    "outputs": [{"$match": {"metadata.file_role": "output"}}]
                }
            }
        ]

        results = list(self.workflow_files.aggregate(pipeline))
        if not results:
            return {
                "request": None,
                "response": None,
                "schema": None,
                "metadata": None,
                "inputs": [],
                "outputs": [],
            }

        facet_result = results[0]
        return {
            "request": facet_result["request"][0] if facet_result["request"] else None,
            "response": facet_result["response"][0] if facet_result["response"] else None,
            "schema": facet_result["schema"][0] if facet_result["schema"] else None,
            "metadata": facet_result["metadata"][0] if facet_result["metadata"] else None,
            "inputs": facet_result["inputs"],
            "outputs": facet_result["outputs"],
        }

    def list_api_calls(self, workflow_run_id: str) -> List[Dict[str, Any]]:
        """
        List all API calls for a workflow run.

        Returns list of unique group_ids with basic metadata.
        """
        pipeline = [
            {
                "$match": {
                    "workflow_run_id": workflow_run_id,
                    "category": "api_calls",
                    "metadata.file_role": "metadata",
                }
            },
            {"$project": {"group_id": 1, "metadata": 1, "created_at": 1}},
            {"$sort": {"created_at": ASCENDING}},
        ]

        return list(self.workflow_files.aggregate(pipeline))

    def delete_workflow_files(self, workflow_run_id: str) -> int:
        """
        Delete all files for a workflow.

        Returns:
            Number of files deleted
        """
        result = self.workflow_files.delete_many({"workflow_run_id": workflow_run_id})
        return result.deleted_count
