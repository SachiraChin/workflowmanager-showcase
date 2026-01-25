"""
State Repository - Module output and state reconstruction.

Handles:
- Module output retrieval from events
- Hierarchical state reconstruction
- Workflow position tracking
"""

import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple, Union

from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from ..base import BaseRepository

logger = logging.getLogger(__name__)


class StateRepository(BaseRepository):
    """
    Repository for reconstructing workflow state from events.

    This repository provides methods for querying and reconstructing
    state from the event log, respecting branch lineage.
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.events: Collection = db.events
        self.branches: Collection = db.branches
        self.workflow_runs: Collection = db.workflow_runs
        self.workflow_files: Collection = db.workflow_files

    def get_branch_lineage(self, branch_id: str) -> List[Tuple[str, Optional[str]]]:
        """
        Get branch lineage from root to specified branch.

        Returns list of (branch_id, cutoff_event_id) tuples.
        """
        branch = self.branches.find_one({"branch_id": branch_id})
        if not branch:
            return []

        if "lineage" in branch:
            return [
                (entry["branch_id"], entry.get("cutoff_event_id"))
                for entry in branch["lineage"]
            ]

        # Fallback for old format
        lineage = []
        current = branch
        while current:
            lineage.append(current)
            parent_id = current.get("parent_branch_id")
            current = self.branches.find_one({"branch_id": parent_id}) if parent_id else None

        lineage.reverse()
        result = []
        for i, br in enumerate(lineage):
            cutoff = lineage[i + 1].get("parent_event_id") if i < len(lineage) - 1 else None
            result.append((br["branch_id"], cutoff))

        return result

    def get_current_branch_id(self, workflow_run_id: str) -> Optional[str]:
        """Get the current branch ID for a workflow."""
        workflow = self.workflow_runs.find_one(
            {"workflow_run_id": workflow_run_id},
            {"current_branch_id": 1}
        )
        return workflow.get("current_branch_id") if workflow else None

    def get_lineage_events(
        self,
        workflow_run_id: str,
        branch_id: str = None,
        event_type: Union[str, List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get all events in the branch lineage, respecting cutoffs.

        Args:
            workflow_run_id: Workflow ID
            branch_id: Branch to get lineage for (defaults to current branch)
            event_type: Optional filter - single event type or list of types

        Returns:
            List of events in chronological order
        """
        if branch_id is None:
            branch_id = self.get_current_branch_id(workflow_run_id)

        if not branch_id:
            return []

        lineage = self.get_branch_lineage(branch_id)
        if not lineage:
            return []

        # Build $or conditions for each branch with its cutoff
        or_conditions = []
        for br_id, cutoff_event_id in lineage:
            condition = {"branch_id": br_id}
            if cutoff_event_id:
                condition["event_id"] = {"$lte": cutoff_event_id}
            or_conditions.append(condition)

        query = {"workflow_run_id": workflow_run_id, "$or": or_conditions}

        # Filter by event type(s)
        if event_type:
            if isinstance(event_type, list):
                type_values = [
                    et.value if hasattr(et, 'value') else et
                    for et in event_type
                ]
                query["event_type"] = {"$in": type_values}
            else:
                query["event_type"] = event_type.value if hasattr(event_type, 'value') else event_type

        return list(self.events.find(query).sort("event_id", ASCENDING))

    def get_module_outputs(
        self, workflow_run_id: str, branch_id: str = None
    ) -> Dict[str, Any]:
        """
        Reconstruct all module outputs by replaying MODULE_COMPLETED events.

        Returns dict containing:
        - Raw module outputs keyed by module_name
        - State-mapped values keyed by their state keys
        """
        events = self.get_lineage_events(
            workflow_run_id=workflow_run_id,
            branch_id=branch_id,
            event_type="module_completed",
        )

        outputs = {}
        for event in events:
            module_name = event.get("module_name")
            data = event.get("data", {})

            if module_name:
                outputs[module_name] = data

                # Extract state-mapped values
                state_mapped = data.get("_state_mapped", {})
                for state_key, value in state_mapped.items():
                    outputs[state_key] = value

        return outputs

    def get_module_outputs_hierarchical(
        self, workflow_run_id: str, branch_id: str = None
    ) -> Dict[str, Any]:
        """
        Reconstruct module state in a hierarchical structure:
        step_id -> module_name -> {interaction_requested, interaction_response, module_completed}

        Each level includes _metadata.node_type for client-side node identification.
        """
        events = self.get_lineage_events(
            workflow_run_id=workflow_run_id,
            branch_id=branch_id,
            event_type=[
                "interaction_requested",
                "interaction_response",
                "module_completed",
            ],
        )

        result = {
            "steps": {"_metadata": {"node_type": "steps_container"}},
            "state_mapped": {},
        }

        for event in events:
            event_type = event.get("event_type")
            step_id = event.get("step_id", "_unknown")
            module_name = event.get("module_name")
            data = event.get("data", {})

            if not module_name:
                continue

            # Initialize step if needed
            if step_id not in result["steps"]:
                result["steps"][step_id] = {"_metadata": {"node_type": "step"}}

            # Initialize module if needed
            if module_name not in result["steps"][step_id]:
                result["steps"][step_id][module_name] = {"_metadata": {"node_type": "module"}}

            # Add metadata to event data
            data_with_metadata = {
                "_metadata": {"node_type": "event_data", "event_type": event_type},
                **data,
            }

            # Store data under appropriate key
            if event_type == "interaction_requested":
                result["steps"][step_id][module_name]["interaction_requested"] = data_with_metadata
            elif event_type == "interaction_response":
                result["steps"][step_id][module_name]["interaction_response"] = data_with_metadata
            elif event_type == "module_completed":
                result["steps"][step_id][module_name]["module_completed"] = data_with_metadata

                # Extract state-mapped values
                state_mapped = data.get("_state_mapped")
                if state_mapped:
                    for state_key, value in state_mapped.items():
                        result["state_mapped"][state_key] = value

        return result

    def get_full_workflow_state(
        self, workflow_run_id: str, branch_id: str = None
    ) -> Dict[str, Any]:
        """
        Get complete workflow state including module outputs and file tree.

        This is the main method for the state streaming endpoint, providing
        all workflow state data in a single response.

        Returns:
            {
                "steps": {...},        # hierarchical module state
                "state_mapped": {...}, # state-mapped values
                "files": {...}         # file tree structure
            }
        """
        # Get existing hierarchical state
        state = self.get_module_outputs_hierarchical(workflow_run_id, branch_id)

        # Add file tree (includes all branches, organized appropriately)
        state["files"] = self._build_file_tree(workflow_run_id)

        return state

    def _build_file_tree(self, workflow_run_id: str) -> Dict[str, Any]:
        """
        Build hierarchical file tree from workflow_files collection.

        Hierarchy rules (all dynamic based on actual data):
        - If multiple branches exist: branch_id becomes root level
        - If single branch: branch level is omitted
        - Files with group_id: organized as category/step_id/[groups]
        - Files without group_id: flat list directly under category

        The structure is entirely determined by the data - no hardcoded keys.
        """
        query = {"workflow_run_id": workflow_run_id}
        files = list(self.workflow_files.find(query).sort("created_at", ASCENDING))

        if not files:
            return {}

        # Check how many unique branches exist
        branch_ids = set()
        for f in files:
            bid = f.get("branch_id")
            if bid:
                branch_ids.add(bid)

        has_multiple_branches = len(branch_ids) > 1

        if has_multiple_branches:
            # Organize by branch_id at root
            result: Dict[str, Any] = {}
            for file_doc in files:
                branch_id = file_doc.get("branch_id")
                if not branch_id:
                    continue  # Skip files without branch_id when multiple branches exist
                if branch_id not in result:
                    result[branch_id] = {}
                self._add_file_to_tree(result[branch_id], file_doc)
            return result
        else:
            # Single branch - hide branch level
            result: Dict[str, Any] = {}
            for file_doc in files:
                self._add_file_to_tree(result, file_doc)
            return result

    def _add_file_to_tree(self, tree: Dict[str, Any], file_doc: Dict[str, Any]) -> None:
        """
        Add a single file document to a tree structure.

        Hierarchy rules:
        - Files with group_id: category -> step_id -> groups -> files
        - Files without group_id: category -> files (flat list)

        Args:
            tree: The tree dict to add file to
            file_doc: The file document from MongoDB
        """
        category = file_doc.get("category")
        if not category:
            return  # Skip files without category

        group_id = file_doc.get("group_id")
        metadata = file_doc.get("metadata", {})
        step_id = metadata.get("step_id")
        created_at = file_doc.get("created_at")

        file_entry = {
            "file_id": file_doc.get("file_id"),
            "filename": file_doc.get("filename"),
            "content_type": file_doc.get("content_type", "text"),
        }

        if group_id and step_id:
            # File has group_id - organize under category/step_id/groups
            if category not in tree:
                tree[category] = {}

            if step_id not in tree[category]:
                tree[category][step_id] = []

            # Find or create group entry
            group_entry = None
            for g in tree[category][step_id]:
                if g["group_id"] == group_id:
                    group_entry = g
                    break

            if not group_entry:
                group_entry = {
                    "group_id": group_id,
                    "created_at": created_at.isoformat() if created_at else None,
                    "files": [],
                }
                tree[category][step_id].append(group_entry)

            group_entry["files"].append(file_entry)
        else:
            # File without group_id - flat list under category
            if category not in tree:
                tree[category] = []

            tree[category].append(file_entry)

    def get_module_output(
        self, workflow_run_id: str, module_name: str
    ) -> Optional[Dict[str, Any]]:
        """Get the latest output from a specific module."""
        query = {
            "workflow_run_id": workflow_run_id,
            "event_type": "module_completed",
            "module_name": module_name,
        }
        event = self.events.find_one(query, sort=[("timestamp", DESCENDING)])
        return event.get("data") if event else None

    def get_step_outputs(self, workflow_run_id: str, step_id: str) -> Dict[str, Any]:
        """Get all module outputs for a specific step."""
        query = {
            "workflow_run_id": workflow_run_id,
            "event_type": "module_completed",
            "step_id": step_id,
        }
        events = self.events.find(query).sort("timestamp", ASCENDING)

        outputs = {}
        for event in events:
            module_name = event.get("module_name")
            if module_name:
                outputs[module_name] = event.get("data", {})

        return outputs

    def get_workflow_position(
        self, workflow_run_id: str, branch_id: str = None
    ) -> Dict[str, Any]:
        """
        Get current workflow position (for resuming) using branch lineage.

        Returns:
            {
                "current_step": "step_id" or None,
                "current_module_index": int,
                "completed_steps": ["step1", "step2", ...],
                "pending_interaction": {...} or None
            }
        """
        lineage_events = self.get_lineage_events(workflow_run_id, branch_id)

        # Extract step completed events
        completed_steps = []
        for event in lineage_events:
            if event.get("event_type") == "step_completed":
                step_id = event.get("step_id")
                if step_id:
                    completed_steps.append(step_id)

        # Find the most recent STEP_STARTED event
        step_started = None
        for event in reversed(lineage_events):
            if event.get("event_type") == "step_started":
                step_started = event
                break

        current_step = None
        current_module_index = 0

        if step_started:
            step_id = step_started.get("step_id")
            if step_id not in completed_steps:
                current_step = step_id
                step_started_event_id = step_started.get("event_id")

                # Count completed modules in current step
                for event in lineage_events:
                    if event.get("event_id", "") > step_started_event_id:
                        if (
                            event.get("event_type") == "module_completed"
                            and event.get("step_id") == step_id
                        ):
                            current_module_index += 1

        # Check for pending interaction
        pending_interaction = None
        interaction_requested = None
        interaction_response = None

        for event in reversed(lineage_events):
            if event.get("event_type") == "interaction_requested" and not interaction_requested:
                interaction_requested = event
            if event.get("event_type") == "interaction_response" and not interaction_response:
                interaction_response = event
            if interaction_requested and interaction_response:
                break

        if interaction_requested:
            req_id = interaction_requested.get("event_id", "")
            resp_id = interaction_response.get("event_id", "") if interaction_response else ""

            if not interaction_response or resp_id < req_id:
                pending_interaction = interaction_requested.get("data")

        return {
            "current_step": current_step,
            "current_module_index": current_module_index,
            "completed_steps": completed_steps,
            "pending_interaction": pending_interaction,
        }

    def get_interaction_history(
        self, workflow_run_id: str, branch_id: str = None
    ) -> List[Dict[str, Any]]:
        """
        Get completed interaction history for a workflow.

        Returns list of completed interactions with request/response pairs.
        """
        lineage_events = self.get_lineage_events(workflow_run_id, branch_id)

        requests: Dict[str, Dict[str, Any]] = {}
        responses: Dict[str, Dict[str, Any]] = {}

        for event in lineage_events:
            event_type = event.get("event_type")
            data = event.get("data", {})
            interaction_id = data.get("interaction_id")

            if not interaction_id:
                continue

            if event_type == "interaction_requested":
                requests[interaction_id] = {"event": event, "data": data}
            elif event_type == "interaction_response":
                responses[interaction_id] = {"event": event, "data": data}

        # Build completed interactions
        completed = []
        for interaction_id, req_info in requests.items():
            if interaction_id in responses:
                resp_info = responses[interaction_id]
                req_event = req_info["event"]
                resp_event = resp_info["event"]

                resp_data = resp_info["data"]
                inner_response = resp_data.get("response", resp_data)

                completed.append({
                    "interaction_id": interaction_id,
                    "request": req_info["data"],
                    "response": inner_response,
                    "timestamp": resp_event.get("timestamp"),
                    "step_id": req_event.get("step_id"),
                    "module_name": req_event.get("module_name"),
                })

        completed.sort(key=lambda x: x.get("timestamp") or datetime.min)
        return completed

    def get_retry_context(
        self, workflow_run_id: str, target_module: str
    ) -> Dict[str, Any]:
        """
        Get context for a retry operation.

        Builds a conversation history from all previous responses and retry feedback.
        """
        import json

        conversation_history = []

        # Get all MODULE_COMPLETED events for target module
        module_query = {
            "workflow_run_id": workflow_run_id,
            "event_type": "module_completed",
            "module_name": target_module,
        }
        module_completed_events = list(
            self.events.find(module_query).sort("timestamp", ASCENDING)
        )

        # Get all RETRY_REQUESTED events for target module
        retry_query = {
            "workflow_run_id": workflow_run_id,
            "event_type": "retry_requested",
            "data.target_module": target_module,
        }
        retry_events = list(self.events.find(retry_query).sort("timestamp", ASCENDING))

        # Build conversation history by interleaving
        for i, completed_event in enumerate(module_completed_events):
            response_data = completed_event.get("data", {})
            response_content = response_data.get("response") or response_data.get("response_text")

            if response_content:
                if isinstance(response_content, (dict, list)):
                    response_content = json.dumps(response_content, indent=2)
                conversation_history.append(
                    {"role": "assistant", "content": str(response_content)}
                )

            # Find retry feedback after this completion
            completed_time = completed_event.get("timestamp")
            next_completed_time = (
                module_completed_events[i + 1].get("timestamp")
                if i + 1 < len(module_completed_events)
                else None
            )

            for retry_event in retry_events:
                retry_time = retry_event.get("timestamp")
                if retry_time and retry_time > completed_time:
                    if next_completed_time is None or retry_time < next_completed_time:
                        feedback = retry_event.get("data", {}).get("feedback")
                        if feedback:
                            conversation_history.append(
                                {"role": "user", "content": f"FEEDBACK FROM USER: {feedback}"}
                            )

        latest_feedback = retry_events[-1].get("data", {}).get("feedback") if retry_events else None

        logger.info(f"[RETRY_CONTEXT] Built conversation_history with {len(conversation_history)} messages")
        return {
            "conversation_history": conversation_history,
            "feedback": latest_feedback,
        }

    def jump_to_module(
        self, workflow_run_id: str, target_step: str, target_module: str
    ) -> str:
        """
        Jump back to a module by creating a new branch.

        "Jump to module_X" means:
        - Re-run module_X from its start
        - Keep all state up to (but not including) module_X's first event
        - Create new branch forking from that point

        Args:
            workflow_run_id: Workflow ID
            target_step: Step containing the target module
            target_module: Module to jump back to

        Returns:
            New branch ID

        Raises:
            ValueError: If target module not found in branch lineage
        """
        from ..utils import uuid7_str

        current_branch_id = self.get_current_branch_id(workflow_run_id)
        logger.info(
            f"[DB] jump_to_module: workflow={workflow_run_id}, target={target_step}/{target_module}, current_branch={current_branch_id}"
        )

        # Get all events in current lineage
        lineage_events = self.get_lineage_events(workflow_run_id, current_branch_id)

        # Find the first event of target module
        first_target_event = None
        for event in lineage_events:
            if (
                event.get("step_id") == target_step
                and event.get("module_name") == target_module
            ):
                first_target_event = event
                break

        if not first_target_event:
            raise ValueError(
                f"Module {target_step}/{target_module} not found in branch lineage"
            )

        logger.info(
            f"[DB] jump_to_module: first_target_event={first_target_event.get('event_id')}"
        )

        # Find the last event BEFORE the target module
        parent_event = None
        for event in lineage_events:
            if event["event_id"] >= first_target_event["event_id"]:
                break
            parent_event = event

        # Determine which branch the parent event belongs to
        if parent_event:
            parent_branch_id = parent_event["branch_id"]
            parent_event_id = parent_event["event_id"]
            logger.info(
                f"[DB] jump_to_module: parent_event={parent_event_id} on branch={parent_branch_id}"
            )
        else:
            # Jumping to very first module - fork from root with no events
            parent_branch_id = current_branch_id
            parent_event_id = None
            logger.info(f"[DB] jump_to_module: no parent event, forking from root")

        # Create new branch (inline logic from branch_repo.create_branch)
        new_branch_id = f"br_{uuid7_str()}"

        # Get parent branch to copy its lineage
        parent_branch = self.branches.find_one({"branch_id": parent_branch_id})

        # Build new lineage from parent's lineage
        new_lineage = []
        if parent_branch and "lineage" in parent_branch:
            for entry in parent_branch["lineage"]:
                if entry["branch_id"] == parent_branch_id:
                    new_lineage.append({
                        "branch_id": entry["branch_id"],
                        "cutoff_event_id": parent_event_id,
                    })
                else:
                    new_lineage.append(entry.copy())
        else:
            new_lineage.append({
                "branch_id": parent_branch_id,
                "cutoff_event_id": parent_event_id
            })

        new_lineage.append({"branch_id": new_branch_id, "cutoff_event_id": None})

        self.branches.insert_one({
            "branch_id": new_branch_id,
            "workflow_run_id": workflow_run_id,
            "lineage": new_lineage,
            "created_at": datetime.utcnow(),
        })

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

        logger.info(f"[DB] jump_to_module: created new branch={new_branch_id}")
        return new_branch_id
