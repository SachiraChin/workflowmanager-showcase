"""
Event Repository - Event sourcing operations.

Handles:
- Event storage (immutable event log)
- Event queries and filtering
- Branch-aware event retrieval
"""

from datetime import datetime
from typing import Dict, Any, List, Optional, Union

from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from .base import BaseRepository
from ..utils import uuid7_str


class EventRepository(BaseRepository):
    """
    Repository for event sourcing operations.

    Collections:
    - events: Immutable event log with branch_id and version_id
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.events: Collection = db.events

    def store_event(
        self,
        workflow_run_id: str,
        event_type: str,
        data: Dict[str, Any] = None,
        step_id: str = None,
        module_name: str = None,
        branch_id: str = None,
        workflow_version_id: str = None,
    ) -> str:
        """
        Store an immutable event.

        Args:
            workflow_run_id: Workflow ID
            event_type: Type of event (string or DbEventType enum value)
            data: Event data
            step_id: Step identifier
            module_name: Module name
            branch_id: Branch ID (auto-looked up from workflow if not provided)
            workflow_version_id: Version ID (auto-looked up from workflow if not provided)

        Returns:
            Event ID (UUID v7 for time-sortability)
        """
        # Get branch_id and version_id from workflow if not provided
        if branch_id is None or workflow_version_id is None:
            workflow = self.db.workflow_runs.find_one({"workflow_run_id": workflow_run_id})
            if workflow:
                if branch_id is None:
                    branch_id = workflow.get("current_branch_id")
                if workflow_version_id is None:
                    workflow_version_id = workflow.get("current_workflow_version_id")

        # Use UUID v7 for time-sortable event IDs
        event_id = f"evt_{uuid7_str()}"

        event = {
            "event_id": event_id,
            "workflow_run_id": workflow_run_id,
            "branch_id": branch_id,
            "workflow_version_id": workflow_version_id,
            "event_type": event_type.value if hasattr(event_type, 'value') else event_type,
            "timestamp": datetime.utcnow(),
            "data": data or {},
        }

        if step_id:
            event["step_id"] = step_id
        if module_name:
            event["module_name"] = module_name

        self.events.insert_one(event)
        return event_id

    def get_events(
        self,
        workflow_run_id: str,
        event_type: str = None,
        module_name: str = None,
        step_id: str = None,
        since: datetime = None,
        limit: int = None,
    ) -> List[Dict[str, Any]]:
        """
        Query events with filters.

        Args:
            workflow_run_id: Workflow ID
            event_type: Filter by event type
            module_name: Filter by module name
            step_id: Filter by step ID
            since: Filter events after this timestamp
            limit: Maximum number of events to return

        Returns:
            List of events sorted by timestamp ascending
        """
        query = {"workflow_run_id": workflow_run_id}

        if event_type:
            query["event_type"] = event_type.value if hasattr(event_type, 'value') else event_type
        if module_name:
            query["module_name"] = module_name
        if step_id:
            query["step_id"] = step_id
        if since:
            query["timestamp"] = {"$gt": since}

        cursor = self.events.find(query).sort("timestamp", ASCENDING)

        if limit:
            cursor = cursor.limit(limit)

        return list(cursor)

    def get_latest_event(
        self,
        workflow_run_id: str,
        event_type: str = None,
        module_name: str = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Get the most recent event matching criteria.

        Args:
            workflow_run_id: Workflow ID
            event_type: Filter by event type
            module_name: Filter by module name

        Returns:
            Most recent matching event or None
        """
        query = {"workflow_run_id": workflow_run_id}

        if event_type:
            query["event_type"] = event_type.value if hasattr(event_type, 'value') else event_type
        if module_name:
            query["module_name"] = module_name

        return self.events.find_one(query, sort=[("timestamp", DESCENDING)])

    def get_lineage_events(
        self,
        workflow_run_id: str,
        lineage: List[tuple],
        event_type: Union[str, List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get all events in the branch lineage, respecting cutoffs.

        This is the primary method for reconstructing state - it returns events
        from the root branch through to the current branch, excluding events
        after cutoff points where branches fork.

        Uses a single $or query across all branches in lineage for efficiency.

        Args:
            workflow_run_id: Workflow ID
            lineage: List of (branch_id, cutoff_event_id) tuples from root to current
            event_type: Optional filter - single event type or list of types

        Returns:
            List of events in chronological order, respecting branch cutoffs
        """
        if not lineage:
            return []

        # Build $or conditions for each branch with its cutoff
        or_conditions = []
        for br_id, cutoff_event_id in lineage:
            condition = {"branch_id": br_id}
            if cutoff_event_id:
                condition["event_id"] = {"$lte": cutoff_event_id}
            or_conditions.append(condition)

        # Single query with $or across all branches
        query = {"workflow_run_id": workflow_run_id, "$or": or_conditions}

        # Filter by event type(s)
        if event_type:
            if isinstance(event_type, list):
                # Multiple event types - use $in
                type_values = [
                    et.value if hasattr(et, 'value') else et
                    for et in event_type
                ]
                query["event_type"] = {"$in": type_values}
            else:
                # Single event type
                query["event_type"] = event_type.value if hasattr(event_type, 'value') else event_type

        return list(self.events.find(query).sort("event_id", ASCENDING))

    def delete_workflow_events(self, workflow_run_id: str) -> int:
        """
        Delete all events for a workflow.

        Args:
            workflow_run_id: Workflow ID

        Returns:
            Number of events deleted
        """
        result = self.events.delete_many({"workflow_run_id": workflow_run_id})
        return result.deleted_count

    def get_events_by_type_for_module(
        self,
        workflow_run_id: str,
        event_type: str,
        module_name: str,
    ) -> List[Dict[str, Any]]:
        """
        Get all events of a specific type for a module.

        Used for retry context building.

        Args:
            workflow_run_id: Workflow ID
            event_type: Event type to filter
            module_name: Module name to filter

        Returns:
            List of events sorted by timestamp ascending
        """
        query = {
            "workflow_run_id": workflow_run_id,
            "event_type": event_type.value if hasattr(event_type, 'value') else event_type,
            "module_name": module_name,
        }
        return list(self.events.find(query).sort("timestamp", ASCENDING))

    def get_retry_events_for_module(
        self,
        workflow_run_id: str,
        event_type: str,
        target_module: str,
    ) -> List[Dict[str, Any]]:
        """
        Get retry events targeting a specific module.

        Args:
            workflow_run_id: Workflow ID
            event_type: Event type (typically RETRY_REQUESTED)
            target_module: The target_module field in event data

        Returns:
            List of retry events sorted by timestamp ascending
        """
        query = {
            "workflow_run_id": workflow_run_id,
            "event_type": event_type.value if hasattr(event_type, 'value') else event_type,
            "data.target_module": target_module,
        }
        return list(self.events.find(query).sort("timestamp", ASCENDING))
