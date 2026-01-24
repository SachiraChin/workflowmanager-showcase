"""
Database Recovery Mixin - Workflow state recovery operations.

Detects and recovers from inconsistent workflow states using event sourcing.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.db import Database


class DatabaseRecoveryMixin:
    """
    Mixin providing workflow state recovery operations.
    """

    def recover_workflow(self: "Database", workflow_run_id: str) -> Optional[Dict[str, Any]]:
        """
        Detect and recover from inconsistent workflow states.

        Uses event sourcing principle: the event log is source of truth.
        When status field doesn't match derived state from events, we:
        1. Find the last stable event
        2. Create a new branch with cutoff at that event
        3. Reset status to processing for re-execution

        Returns:
            None if workflow is consistent (no recovery needed)
            Dict with recovery info if recovery was applied:
            {
                "reason": "A1: Status awaiting_input but no pending interaction",
                "previous_branch_id": "br_xxx",
                "new_branch_id": "br_yyy",
                "cutoff_event_id": "evt_xxx"
            }
        """
        from backend.db import DbEventType
        import logging

        logger = logging.getLogger(__name__)

        # 1. Get current state from workflow document (cached status)
        workflow = self.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            return None

        cached_status = workflow.get("status")

        # Skip if already in terminal state
        if cached_status in ["completed", "error"]:
            return None

        # 2. Derive true state from events
        position = self.state_repo.get_workflow_position(workflow_run_id)
        pending_interaction = position.get("pending_interaction")
        completed_steps = position.get("completed_steps", [])

        # 3. Detect inconsistencies
        needs_recovery = False
        recovery_reason = None

        # A1: AWAITING_INPUT but no pending interaction
        if cached_status == "awaiting_input" and not pending_interaction:
            needs_recovery = True
            recovery_reason = "A1: Status awaiting_input but no pending interaction"

        # A2: PROCESSING but has pending interaction
        elif cached_status == "processing" and pending_interaction:
            needs_recovery = True
            recovery_reason = "A2: Status processing but has pending interaction"

        # A3: PROCESSING but all steps completed (check against workflow definition)
        elif cached_status == "processing":
            version_id = workflow.get("current_workflow_version_id")
            if version_id:
                resolved_workflow = self.version_repo.get_resolved_workflow(version_id)
                if resolved_workflow:
                    all_step_ids = [
                        s.get("step_id") for s in resolved_workflow.get("steps", [])
                    ]
                    if all_step_ids and set(all_step_ids) <= set(completed_steps):
                        needs_recovery = True
                        recovery_reason = (
                            "A3: Status processing but all steps completed"
                        )

        if not needs_recovery:
            return None

        logger.info(
            f"[RECOVERY] Detected inconsistency for {workflow_run_id}: {recovery_reason}"
        )

        # 4. Find last stable event
        events = self.state_repo.get_lineage_events(workflow_run_id)
        last_stable = self._find_last_stable_event(events)

        if not last_stable:
            logger.error(f"[RECOVERY] No stable event found for {workflow_run_id}")
            return None

        logger.info(
            f"[RECOVERY] Last stable event: {last_stable.get('event_type')} at {last_stable.get('event_id')}"
        )

        # 5. Create recovery branch
        # Use branch_id from last stable event, not current branch
        # This ensures correct lineage even if last stable event is from ancestor branch
        current_branch_id = workflow.get("current_branch_id")
        parent_branch_id = last_stable.get("branch_id")

        new_branch_id = self.branch_repo.create_branch(
            workflow_run_id=workflow_run_id,
            parent_branch_id=parent_branch_id,
            parent_event_id=last_stable.get("event_id"),
        )

        # 6. Update workflow to use new branch and set status to processing
        self.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {"$set": {
                "status": "processing",
                "current_branch_id": new_branch_id,
                "updated_at": datetime.utcnow()
            }},
        )

        # 7. Store recovery event for audit
        self.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.WORKFLOW_RECOVERED,
            data={
                "reason": recovery_reason,
                "previous_branch_id": current_branch_id,
                "new_branch_id": new_branch_id,
                "cutoff_event_id": last_stable.get("event_id"),
            },
            branch_id=new_branch_id,
            workflow_version_id=workflow.get("current_workflow_version_id"),
        )

        logger.info(
            f"[RECOVERY] Recovered {workflow_run_id}: {recovery_reason}. "
            f"Created branch {new_branch_id} from event {last_stable.get('event_id')}"
        )

        return {
            "reason": recovery_reason,
            "previous_branch_id": current_branch_id,
            "new_branch_id": new_branch_id,
            "cutoff_event_id": last_stable.get("event_id"),
        }

    def _find_last_stable_event(
        self: "Database", events: List[Dict[str, Any]]
    ) -> Optional[Dict[str, Any]]:
        """
        Find the last stable event in the event list for recovery branching.

        Stable events are points where the workflow was in a consistent state
        AND safe to use as a branch cutoff point:
        - STEP_COMPLETED: Step fully done
        - MODULE_COMPLETED: Module fully done

        NOT stable for recovery (would cause duplicates in history):
        - INTERACTION_RESPONSE: Using this as cutoff includes the interaction
          in old branch lineage, but recovery re-runs the module creating a
          duplicate. Cut at MODULE_COMPLETED before the interaction instead.

        Non-stable events (workflow may be mid-operation):
        - STEP_STARTED, MODULE_STARTED, INTERACTION_REQUESTED
        """
        from backend.db import DbEventType

        # Use .value to compare with string event_type from database
        stable_types = {
            DbEventType.STEP_COMPLETED.value,
            DbEventType.MODULE_COMPLETED.value,
        }

        for event in reversed(events):
            event_type = event.get("event_type")
            if event_type in stable_types:
                return event

        return None
