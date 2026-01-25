"""
Database History Operations

Option usage and keyword history management for workflow templates.
Extracted from database_provider.py for maintainability.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.db import Database


class DatabaseHistoryMixin:
    """
    Mixin providing option usage and keyword history operations.
    """

    # =========================================================================
    # Workflow Templates (stable identity by user_id + workflow_template_name)
    # =========================================================================

    def get_or_create_workflow_template(
        self: "Database",
        workflow_template_name: str,
        user_id: str
    ) -> str:
        """
        Get or create a workflow template by name (scoped to user).

        Args:
            workflow_template_name: The workflow_id from workflow JSON (e.g., 'oms_video_generation')
            user_id: User ID (required)

        Returns:
            workflow_template_id (random ID like tpl_xxxxxxxxxxxx)
        """
        import uuid

        # Check if template exists for this user + name
        existing = self.workflow_templates.find_one({
            "user_id": user_id,
            "workflow_template_name": workflow_template_name
        })
        if existing:
            return existing["workflow_template_id"]

        # Create new template
        template_id = f"tpl_{uuid.uuid4().hex[:12]}"
        self.workflow_templates.insert_one({
            "workflow_template_id": template_id,
            "user_id": user_id,
            "workflow_template_name": workflow_template_name,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        })
        return template_id

    def get_workflow_template_by_name(
        self: "Database",
        workflow_template_name: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get workflow template by name (scoped to user)."""
        return self.workflow_templates.find_one({
            "user_id": user_id,
            "workflow_template_name": workflow_template_name
        })

    def get_workflow_template_by_id(self: "Database", template_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow template by ID."""
        return self.workflow_templates.find_one({"workflow_template_id": template_id})

    # =========================================================================
    # Workflow Versions (content-hash based identity, unique per template)
    # =========================================================================

    def get_or_create_workflow_version(
        self: "Database",
        content_hash: str,
        source_type: str,
        resolved_workflow: Dict[str, Any],
        workflow_template_name: str,
        user_id: str
    ) -> tuple[str, str, bool]:
        """
        Get or create a workflow version by content hash.

        If a version with the same content_hash exists for this template, returns it.
        Otherwise creates a new version record.

        Args:
            content_hash: SHA256 hash of submitted content (e.g., "sha256:abc123...")
            source_type: "zip" or "json"
            resolved_workflow: Fully resolved workflow JSON (all $refs expanded)
            workflow_template_name: The workflow_id from workflow JSON
            user_id: User ID (required)

        Returns:
            Tuple of (workflow_version_id, workflow_template_id, is_new)
        """
        from ..utils import uuid7_str

        # Ensure template exists for this user
        template_id = self.get_or_create_workflow_template(workflow_template_name, user_id)

        # Check if version exists with this content hash for this template
        existing = self.workflow_versions.find_one({
            "workflow_template_id": template_id,
            "content_hash": content_hash
        })
        if existing:
            return existing["workflow_version_id"], template_id, False

        # Create new version (raw - no execution groups)
        version_id = f"ver_{uuid7_str()}"
        self.workflow_versions.insert_one({
            "workflow_version_id": version_id,
            "workflow_template_id": template_id,
            "content_hash": content_hash,
            "source_type": source_type,
            "version_type": "raw",
            "parent_workflow_version_id": None,
            "requires": [],
            "resolved_workflow": resolved_workflow,
            "created_at": datetime.utcnow()
        })
        return version_id, template_id, True

    def get_workflow_version_by_hash(self: "Database", content_hash: str) -> Optional[Dict[str, Any]]:
        """Get workflow version by content hash."""
        return self.workflow_versions.find_one({"content_hash": content_hash})

    def get_workflow_version_by_id(self: "Database", version_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow version by ID."""
        return self.workflow_versions.find_one({"workflow_version_id": version_id})

    def get_resolved_workflow(self: "Database", version_id: str) -> Optional[Dict[str, Any]]:
        """Get the resolved workflow JSON for a version."""
        version = self.get_workflow_version_by_id(version_id)
        if version:
            return version.get("resolved_workflow")
        return None

    def get_latest_workflow_version(
        self: "Database",
        workflow_template_name: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the latest workflow version for a template.

        DEPRECATED: Use get_latest_source_version instead.

        Args:
            workflow_template_name: The workflow_id from workflow JSON
            user_id: User ID for multi-tenant scoping

        Returns:
            Latest workflow version document or None if no versions exist
        """
        return self.get_latest_source_version(workflow_template_name, user_id)

    def get_latest_source_version(
        self: "Database",
        workflow_template_name: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the latest source version (raw or unresolved) for a template.

        Source versions are the original uploaded workflow content:
        - raw: No execution groups, directly runnable
        - unresolved: Has execution groups, parent of resolved versions

        This excludes resolved versions which are derived.

        Args:
            workflow_template_name: The workflow_id from workflow JSON
            user_id: User ID for multi-tenant scoping

        Returns:
            Latest source version document or None if no versions exist
        """
        # Get the template ID for this user
        template = self.get_workflow_template_by_name(workflow_template_name, user_id)
        if not template:
            return None

        template_id = template["workflow_template_id"]

        # Get the most recent source version (raw or unresolved)
        version = self.workflow_versions.find_one(
            {
                "workflow_template_id": template_id,
                "version_type": {"$in": ["raw", "unresolved"]}
            },
            sort=[("created_at", -1)]
        )
        return version

    def get_source_versions_for_template(
        self: "Database",
        workflow_template_id: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Get source versions for a template (raw and unresolved, excludes resolved).

        Returns versions sorted by created_at descending (newest first).
        Only includes source versions (version_type="raw" or "unresolved").

        Args:
            workflow_template_id: The template ID
            limit: Maximum number of versions to return (default 20)

        Returns:
            List of version documents with workflow_version_id, created_at, content_hash, source_type
        """
        versions = list(self.workflow_versions.find(
            {
                "workflow_template_id": workflow_template_id,
                "version_type": {"$in": ["raw", "unresolved"]}
            },
            {
                "workflow_version_id": 1,
                "created_at": 1,
                "content_hash": 1,
                "source_type": 1,
                "version_type": 1,
                "_id": 0
            }
        ).sort("created_at", -1).limit(limit))
        return versions

    def get_raw_versions_for_template(
        self: "Database",
        workflow_template_id: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        DEPRECATED: Use get_source_versions_for_template instead.

        Get source versions for a template (raw and unresolved).
        """
        return self.get_source_versions_for_template(workflow_template_id, limit)

    # =========================================================================
    # Option Usage History (normalized - one record per option)
    # =========================================================================

    def get_option_usage(self: "Database", workflow_template_name: str, step_id: str, module_name: str, user_id: str) -> Dict[str, str]:
        """
        Get option usage history for a specific step/module.

        Uses MongoDB aggregation to build option->timestamp dict.

        Args:
            workflow_template_name: The workflow_id from workflow JSON
            step_id: Step identifier
            module_name: Module name
            user_id: User ID for multi-tenant scoping

        Returns:
            Dict mapping option_key -> last_used timestamp (ISO format)
        """
        import logging
        logger = logging.getLogger(__name__)

        template_id = self.get_or_create_workflow_template(workflow_template_name, user_id)

        logger.info(f"[DB] get_option_usage: workflow_template_name={workflow_template_name}, "
                   f"step_id={step_id}, module_name={module_name}, template_id={template_id}")

        pipeline = [
            {
                "$match": {
                    "workflow_template_id": template_id,
                    "step_id": step_id,
                    "module_name": module_name,
                    "option": {"$exists": True, "$ne": None},
                    "updated_at": {"$exists": True, "$ne": None}
                }
            },
            {
                "$group": {
                    "_id": None,
                    "entries": {
                        "$push": {
                            "k": "$option",
                            "v": {"$dateToString": {"format": "%Y-%m-%dT%H:%M:%S.%LZ", "date": "$updated_at"}}
                        }
                    }
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "result": {"$arrayToObject": "$entries"}
                }
            }
        ]

        results = list(self.option_usage.aggregate(pipeline))
        result = results[0]["result"] if results else {}

        logger.info(f"[DB] get_option_usage result: {len(result)} options found")
        return result

    def update_option_usage(
        self: "Database",
        workflow_template_name: str,
        step_id: str,
        module_name: str,
        option_key: str,
        timestamp: str,
        user_id: str
    ):
        """
        Update usage timestamp for an option.

        Args:
            workflow_template_name: The workflow_id from workflow JSON
            step_id: Step identifier
            module_name: Module name
            option_key: Option key (from history_key_format)
            timestamp: ISO format timestamp
            user_id: User ID for multi-tenant scoping
        """
        template_id = self.get_or_create_workflow_template(workflow_template_name, user_id)

        # Parse timestamp
        try:
            updated_at = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            updated_at = datetime.utcnow()

        # Upsert normalized record
        self.option_usage.update_one(
            {
                "workflow_template_id": template_id,
                "step_id": step_id,
                "module_name": module_name,
                "option": option_key
            },
            {
                "$set": {"updated_at": updated_at},
                "$setOnInsert": {"created_at": updated_at}
            },
            upsert=True
        )

    def get_all_option_usage(self: "Database", workflow_template_name: str, user_id: str) -> Dict[str, Dict[str, Dict[str, str]]]:
        """
        Get all option usage history for a workflow.

        Uses MongoDB aggregation to build nested structure.

        Args:
            workflow_template_name: The workflow_id from workflow JSON
            user_id: User ID for multi-tenant scoping

        Returns:
            Nested dict: {step_id: {module_name: {option_key: timestamp}}}
        """
        template_id = self.get_or_create_workflow_template(workflow_template_name, user_id)

        pipeline = [
            {"$match": {"workflow_template_id": template_id}},
            # Group by step_id + module_name, collect options as key-value pairs
            {
                "$group": {
                    "_id": {"step_id": "$step_id", "module_name": "$module_name"},
                    "options": {
                        "$push": {
                            "k": "$option",
                            "v": {"$dateToString": {"format": "%Y-%m-%dT%H:%M:%S.%LZ", "date": "$updated_at"}}
                        }
                    }
                }
            },
            # Group by step_id, collect modules
            {
                "$group": {
                    "_id": "$_id.step_id",
                    "modules": {
                        "$push": {
                            "k": "$_id.module_name",
                            "v": {"$arrayToObject": "$options"}
                        }
                    }
                }
            },
            # Convert to final structure
            {
                "$project": {
                    "_id": 0,
                    "step_id": "$_id",
                    "modules": {"$arrayToObject": "$modules"}
                }
            }
        ]

        result = {}
        for doc in self.option_usage.aggregate(pipeline):
            step_id = doc.get("step_id", "")
            modules = doc.get("modules", {})
            result[step_id] = modules

        return result
