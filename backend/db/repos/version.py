"""
Version Repository - Workflow version management.

Handles:
- Workflow version CRUD
- Template management
- Execution groups and resolved versions
- Version selection by capabilities
"""

import json
import hashlib
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from pymongo import DESCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from ..base import BaseRepository
from ..utils import uuid7_str


logger = logging.getLogger(__name__)
GLOBAL_TEMPLATE_USER_ID = "global"


class VersionRepository(BaseRepository):
    """
    Repository for workflow version operations.

    Collections:
    - workflow_templates: Template metadata
    - workflow_versions: Version storage with content and metadata
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.workflow_templates: Collection = db.workflow_templates
        self.workflow_versions: Collection = db.workflow_versions

    def get_or_create_template(
        self,
        workflow_template_name: str,
        user_id: str
    ) -> Tuple[str, bool]:
        """
        Get or create a workflow template.

        Returns:
            Tuple of (template_id, is_new)
        """
        existing = self.workflow_templates.find_one({
            "workflow_template_name": workflow_template_name,
            "user_id": user_id,
            "$or": [{"scope": {"$exists": False}}, {"scope": "user"}],
        })
        if existing:
            updates = {}
            if "scope" not in existing:
                updates["scope"] = "user"
            if "visibility" not in existing:
                updates["visibility"] = "visible"
            if updates:
                self.workflow_templates.update_one(
                    {"workflow_template_id": existing["workflow_template_id"]},
                    {"$set": updates},
                )
            return existing["workflow_template_id"], False

        template_id = f"tpl_{uuid7_str()}"
        now = datetime.utcnow()
        self.workflow_templates.insert_one({
            "workflow_template_id": template_id,
            "workflow_template_name": workflow_template_name,
            "user_id": user_id,
            "scope": "user",
            "visibility": "visible",
            "created_at": now,
            "updated_at": now,
        })
        return template_id, True

    def get_template_by_id(self, template_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow template by ID."""
        return self.workflow_templates.find_one({"workflow_template_id": template_id})

    def get_or_create_global_template(
        self,
        workflow_template_name: str,
        owner_user_id: str,
    ) -> Tuple[str, bool]:
        """Get or create a global workflow template."""
        existing = self.workflow_templates.find_one({
            "workflow_template_name": workflow_template_name,
            "scope": "global",
        })
        if existing:
            updates = {}
            if existing.get("user_id") != GLOBAL_TEMPLATE_USER_ID:
                updates["user_id"] = GLOBAL_TEMPLATE_USER_ID
            if existing.get("visibility") != "public":
                updates["visibility"] = "public"
            if updates:
                self.workflow_templates.update_one(
                    {"workflow_template_id": existing["workflow_template_id"]},
                    {"$set": updates},
                )
            return existing["workflow_template_id"], False

        template_id = f"tpl_{uuid7_str()}"
        now = datetime.utcnow()
        self.workflow_templates.insert_one({
            "workflow_template_id": template_id,
            "workflow_template_name": workflow_template_name,
            "user_id": GLOBAL_TEMPLATE_USER_ID,
            "scope": "global",
            "visibility": "public",
            "created_at": now,
            "updated_at": now,
        })
        return template_id, True

    def get_or_create_hidden_template(
        self,
        global_template_id: str,
        user_id: str,
    ) -> Tuple[str, bool, str]:
        """Get or create hidden per-user template for a global template."""
        template_name = f"global_{global_template_id}_{user_id}"
        existing = self.workflow_templates.find_one({
            "workflow_template_name": template_name,
            "user_id": user_id,
            "$or": [{"scope": {"$exists": False}}, {"scope": "user"}],
        })
        if existing:
            updates = {}
            if existing.get("visibility") != "hidden":
                updates["visibility"] = "hidden"
            if existing.get("derived_from") != global_template_id:
                updates["derived_from"] = global_template_id
            if existing.get("scope") != "user":
                updates["scope"] = "user"
            if updates:
                self.workflow_templates.update_one(
                    {"workflow_template_id": existing["workflow_template_id"]},
                    {"$set": updates},
                )
            return existing["workflow_template_id"], False, template_name

        template_id = f"tpl_{uuid7_str()}"
        now = datetime.utcnow()
        self.workflow_templates.insert_one({
            "workflow_template_id": template_id,
            "workflow_template_name": template_name,
            "user_id": user_id,
            "scope": "user",
            "visibility": "hidden",
            "derived_from": global_template_id,
            "created_at": now,
            "updated_at": now,
        })
        return template_id, True, template_name

    def get_version_by_content_hash(
        self,
        template_id: str,
        content_hash: str,
    ) -> Optional[Dict[str, Any]]:
        """Get a workflow version by template and content hash."""
        return self.workflow_versions.find_one({
            "workflow_template_id": template_id,
            "content_hash": content_hash,
        })

    def copy_version_tree(
        self,
        source_version_id: str,
        target_template_id: str,
    ) -> Dict[str, int]:
        """
        Copy a source version and its resolved children to a target template.

        Returns counts for inserted and existing versions.
        """
        source_version = self.get_workflow_version_by_id(source_version_id)
        if not source_version:
            return {"inserted": 0, "existing": 0}

        source_template_id = source_version.get("workflow_template_id")
        target_versions = list(self.workflow_versions.find(
            {"workflow_template_id": target_template_id},
            {"workflow_version_id": 1, "content_hash": 1}
        ))

        target_by_hash = {
            v.get("content_hash"): v.get("workflow_version_id")
            for v in target_versions
            if v.get("content_hash")
        }

        inserted = 0
        existing = 0

        def insert_version(
            source_doc: Dict[str, Any],
            parent_id: Optional[str]
        ) -> str:
            new_id = f"ver_{uuid7_str()}"
            doc = {k: v for k, v in source_doc.items() if k not in [
                "_id",
                "workflow_version_id",
                "workflow_template_id",
            ]}
            doc["workflow_version_id"] = new_id
            doc["workflow_template_id"] = target_template_id
            if "parent_workflow_version_id" in doc:
                doc["parent_workflow_version_id"] = parent_id
            self.workflow_versions.insert_one(doc)
            return new_id

        def ensure_version(
            source_doc: Dict[str, Any],
            parent_id: Optional[str]
        ) -> str:
            nonlocal inserted, existing
            content_hash = source_doc.get("content_hash")
            if content_hash in target_by_hash:
                existing += 1
                return target_by_hash[content_hash]
            new_id = insert_version(source_doc, parent_id)
            inserted += 1
            target_by_hash[content_hash] = new_id
            return new_id

        source_target_id = ensure_version(source_version, None)

        resolved_children = list(self.workflow_versions.find({
            "workflow_template_id": source_template_id,
            "parent_workflow_version_id": source_version_id,
            "version_type": "resolved",
        }))

        for child in resolved_children:
            ensure_version(child, source_target_id)

        return {"inserted": inserted, "existing": existing}

    def sync_template_versions(
        self,
        source_template_id: str,
        target_template_id: str,
    ) -> Dict[str, int]:
        """
        Copy all versions from source template to target template.

        Returns counts for inserted and existing versions.
        """
        source_versions = list(self.workflow_versions.find({
            "workflow_template_id": source_template_id,
        }))
        target_versions = list(self.workflow_versions.find(
            {"workflow_template_id": target_template_id},
            {"workflow_version_id": 1, "content_hash": 1}
        ))

        target_by_hash = {
            v.get("content_hash"): v.get("workflow_version_id")
            for v in target_versions
            if v.get("content_hash")
        }

        id_map: Dict[str, str] = {}
        inserted = 0
        existing = 0

        def insert_version(
            source_doc: Dict[str, Any],
            parent_id: Optional[str]
        ) -> str:
            new_id = f"ver_{uuid7_str()}"
            doc = {k: v for k, v in source_doc.items() if k not in [
                "_id",
                "workflow_version_id",
                "workflow_template_id",
            ]}
            doc["workflow_version_id"] = new_id
            doc["workflow_template_id"] = target_template_id
            if "parent_workflow_version_id" in doc:
                doc["parent_workflow_version_id"] = parent_id
            self.workflow_versions.insert_one(doc)
            return new_id

        for version in source_versions:
            if version.get("version_type") not in ["raw", "unresolved"]:
                continue
            content_hash = version.get("content_hash")
            if content_hash in target_by_hash:
                existing += 1
                id_map[version["workflow_version_id"]] = target_by_hash[content_hash]
                continue
            new_id = insert_version(version, None)
            inserted += 1
            target_by_hash[content_hash] = new_id
            id_map[version["workflow_version_id"]] = new_id

        for version in source_versions:
            if version.get("version_type") != "resolved":
                continue
            content_hash = version.get("content_hash")
            if content_hash in target_by_hash:
                existing += 1
                id_map[version["workflow_version_id"]] = target_by_hash[content_hash]
                continue
            parent_source_id = version.get("parent_workflow_version_id")
            parent_target_id = id_map.get(parent_source_id)
            new_id = insert_version(version, parent_target_id)
            inserted += 1
            target_by_hash[content_hash] = new_id
            id_map[version["workflow_version_id"]] = new_id

        return {"inserted": inserted, "existing": existing}

    def get_or_create_workflow_version(
        self,
        content_hash: str,
        source_type: str,
        resolved_workflow: Dict[str, Any],
        workflow_template_name: str,
        user_id: str
    ) -> Tuple[str, str, bool]:
        """
        Get or create a workflow version.

        Returns:
            Tuple of (version_id, template_id, is_new)
        """
        # Get or create template
        template_id, _ = self.get_or_create_template(workflow_template_name, user_id)

        # Check for existing version with same hash
        existing = self.workflow_versions.find_one({
            "workflow_template_id": template_id,
            "content_hash": content_hash
        })
        if existing:
            return existing["workflow_version_id"], template_id, False

        # Create new version
        version_id = f"ver_{uuid7_str()}"
        self.workflow_versions.insert_one({
            "workflow_version_id": version_id,
            "workflow_template_id": template_id,
            "content_hash": content_hash,
            "source_type": source_type,
            "version_type": "raw",  # Will be updated to "unresolved" if execution groups exist
            "resolved_workflow": resolved_workflow,
            "created_at": datetime.utcnow()
        })
        return version_id, template_id, True

    def get_workflow_version_by_id(self, version_id: str) -> Optional[Dict[str, Any]]:
        """Get a workflow version by ID."""
        return self.workflow_versions.find_one({"workflow_version_id": version_id})

    def get_latest_source_version(
        self,
        workflow_template_name: str,
        user_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get the latest source (raw or unresolved) version for a template.
        """
        template = self.workflow_templates.find_one({
            "workflow_template_name": workflow_template_name,
            "user_id": user_id
        })
        if not template:
            return None

        return self.workflow_versions.find_one(
            {
                "workflow_template_id": template["workflow_template_id"],
                "version_type": {"$in": ["raw", "unresolved"]}
            },
            sort=[("created_at", DESCENDING)]
        )

    def get_raw_versions_for_template(
        self,
        template_id: str,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Get source versions for a template (excludes resolved versions).
        """
        return list(self.workflow_versions.find(
            {
                "workflow_template_id": template_id,
                "version_type": {"$in": ["raw", "unresolved"]}
            },
            {"_id": 0, "workflow_version_id": 1, "created_at": 1, "content_hash": 1, "source_type": 1}
        ).sort("created_at", DESCENDING).limit(limit))

    def get_resolved_workflow(self, version_id: str) -> Optional[Dict[str, Any]]:
        """Get just the resolved_workflow field from a version."""
        version = self.workflow_versions.find_one(
            {"workflow_version_id": version_id},
            {"resolved_workflow": 1}
        )
        return version.get("resolved_workflow") if version else None

    def create_resolved_version(
        self,
        template_id: str,
        resolved_workflow: Dict[str, Any],
        parent_workflow_version_id: str,
        requires: List[Dict[str, Any]],
        content_hash: Optional[str] = None
    ) -> str:
        """
        Get or create a resolved workflow version by content hash.

        Returns:
            workflow_version_id (existing or newly created)
        """
        # Compute hash if not provided
        if not content_hash:
            json_str = json.dumps(resolved_workflow, sort_keys=True)
            content_hash = f"sha256:{hashlib.sha256(json_str.encode()).hexdigest()}"

        # Check if version with same hash already exists
        existing = self.workflow_versions.find_one({
            "workflow_template_id": template_id,
            "content_hash": content_hash
        })
        if existing:
            return existing["workflow_version_id"]

        version_id = f"ver_{uuid7_str()}"
        self.workflow_versions.insert_one({
            "workflow_version_id": version_id,
            "workflow_template_id": template_id,
            "content_hash": content_hash,
            "source_type": "json",
            "version_type": "resolved",
            "parent_workflow_version_id": parent_workflow_version_id,
            "requires": requires,
            "resolved_workflow": resolved_workflow,
            "created_at": datetime.utcnow()
        })
        return version_id

    def set_version_type(self, version_id: str, version_type: str) -> None:
        """Update a version's type (raw -> unresolved)."""
        self.workflow_versions.update_one(
            {"workflow_version_id": version_id},
            {"$set": {"version_type": version_type}}
        )

    def get_version_for_capabilities(
        self,
        raw_version_id: str,
        capabilities: List[str]
    ) -> Optional[Dict[str, Any]]:
        """
        Get the best version for given capabilities.

        Returns best resolved match, or raw version if no execution groups.

        Raises:
            ValueError: If the returned version is unresolved (not runnable)
        """
        pipeline = [
            {"$match": {"workflow_version_id": raw_version_id}},
            {"$lookup": {
                "from": "workflow_versions",
                "let": {"parent_id": "$workflow_version_id"},
                "pipeline": [
                    {"$match": {
                        "$expr": {
                            "$and": [
                                {"$eq": ["$parent_workflow_version_id", "$$parent_id"]},
                                {"$eq": ["$version_type", "resolved"]},
                                {"$setIsSubset": [
                                    {"$map": {
                                        "input": {"$ifNull": ["$requires", []]},
                                        "as": "req",
                                        "in": "$$req.capability"
                                    }},
                                    capabilities if capabilities else []
                                ]}
                            ]
                        }
                    }},
                    {"$addFields": {
                        "computed_score": {
                            "$reduce": {
                                "input": {"$ifNull": ["$requires", []]},
                                "initialValue": 0,
                                "in": {"$add": ["$$value", {"$ifNull": ["$$this.priority", 0]}]}
                            }
                        }
                    }},
                    {"$sort": {"computed_score": -1}},
                    {"$limit": 1}
                ],
                "as": "resolved_matches"
            }},
            {"$addFields": {
                "best_resolved": {"$arrayElemAt": ["$resolved_matches", 0]},
                "has_resolved": {"$gt": [{"$size": "$resolved_matches"}, 0]}
            }},
            {"$replaceRoot": {
                "newRoot": {
                    "$cond": {
                        "if": "$has_resolved",
                        "then": "$best_resolved",
                        "else": "$$ROOT"
                    }
                }
            }},
            {"$project": {"resolved_matches": 0, "best_resolved": 0, "has_resolved": 0}}
        ]

        results = list(self.workflow_versions.aggregate(pipeline))
        if not results:
            return None

        version = results[0]
        version_type = version.get("version_type")
        if version_type == "unresolved":
            raise ValueError(
                f"Cannot use unresolved version {version.get('workflow_version_id')} for workflow run."
            )

        return version

    def get_version_with_parent(self, version_id: str) -> Optional[Dict[str, Any]]:
        """Get version with its parent (if resolved)."""
        pipeline = [
            {"$match": {"workflow_version_id": version_id}},
            {"$lookup": {
                "from": "workflow_versions",
                "localField": "parent_workflow_version_id",
                "foreignField": "workflow_version_id",
                "as": "parent_version"
            }},
            {"$addFields": {
                "parent_version": {"$arrayElemAt": ["$parent_version", 0]}
            }}
        ]
        results = list(self.workflow_versions.aggregate(pipeline))
        return results[0] if results else None

    def process_and_store_workflow_versions(
        self,
        resolved_workflow: Dict[str, Any],
        content_hash: str,
        source_type: str,
        workflow_template_name: str,
        user_id: str
    ) -> Tuple[str, str, bool]:
        """
        Process a resolved workflow and store all resolved versions.

        Handles execution groups feature - creates resolved versions for
        all path combinations.

        Returns:
            Tuple of (source_workflow_version_id, workflow_template_id, is_new)
        """
        from backend.workflow_engine.engine.execution_groups import ExecutionGroupsProcessor

        # Get or create source version
        source_version_id, template_id, is_new = self.get_or_create_workflow_version(
            content_hash=content_hash,
            source_type=source_type,
            resolved_workflow=resolved_workflow,
            workflow_template_name=workflow_template_name,
            user_id=user_id
        )

        if not is_new:
            logger.debug(f"[VERSIONS] Source version {source_version_id} already exists")
            return source_version_id, template_id, False

        # Process execution groups
        processor = ExecutionGroupsProcessor()
        resolution_results = processor.process_workflow(resolved_workflow)

        logger.debug(f"[VERSIONS] Generated {len(resolution_results)} resolved variations")

        has_execution_groups = False

        for result in resolution_results:
            resolved_wf = result["flattened_workflow"]
            requires = result["requires"]
            selected_paths = result["selected_paths"]

            if not selected_paths:
                logger.debug(f"[VERSIONS] No execution_groups, using raw version")
                continue

            has_execution_groups = True

            resolved_version_id = self.create_resolved_version(
                template_id=template_id,
                resolved_workflow=resolved_wf,
                parent_workflow_version_id=source_version_id,
                requires=requires
            )

            paths_str = ", ".join(f"{k}={v}" for k, v in selected_paths.items())
            logger.debug(f"[VERSIONS] Created resolved version: {paths_str} -> {resolved_version_id}")

        if has_execution_groups:
            self.set_version_type(source_version_id, "unresolved")
            logger.debug(f"[VERSIONS] Set source to 'unresolved'")

        return source_version_id, template_id, True
