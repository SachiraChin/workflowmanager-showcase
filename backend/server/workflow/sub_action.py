"""
Sub-Action Processor

Handles execution of sub-actions from within interactive modules.
Supports two action types:
- target_sub_action: Execute a child workflow with referenced modules
- self_sub_action: Invoke the module's own sub_action() method
"""

import asyncio
import concurrent.futures
import copy
import json
import logging
import time
from datetime import datetime
from typing import Dict, Any, Tuple, Optional, AsyncIterator

from backend.db import Database, DbEventType
from backend.db.utils import uuid7_str
from models import WorkflowStatus, SSEEvent, SSEEventType
from engine.module_registry import ModuleRegistry
from engine.module_interface import InteractiveModule

from .executor import WorkflowExecutor
from .workflow_utils import get_workflow_def, rebuild_services
from .streaming import get_poll_interval, get_progress_interval


logger = logging.getLogger("workflow.sub_action")


class SubActionContext:
    """Context passed to module sub_action() method for self_sub_action."""

    def __init__(
        self,
        workflow_run_id: str,
        execution_id: str,
        interaction_id: str,
        db: Database,
        params: Dict[str, Any],
    ):
        self.workflow_run_id = workflow_run_id
        self.execution_id = execution_id
        self.interaction_id = interaction_id
        self.db = db
        self.params = params


class SubActionHandler:
    """
    Processes sub-action execution.

    Sub-actions allow operations from within an interactive module
    without completing the interaction. Results are mapped back to
    the parent workflow's state.
    """

    def __init__(self, db: Database, registry: ModuleRegistry):
        self.db = db
        self.registry = registry
        self.executor = WorkflowExecutor(db, registry, logger)

    async def execute_sub_action(
        self,
        workflow_run_id: str,
        interaction_id: str,
        sub_action_id: str,
        params: Dict[str, Any] = None,
        ai_config: Dict[str, Any] = None,
    ) -> AsyncIterator[SSEEvent]:
        """
        Execute sub-action and yield progress events.

        Args:
            workflow_run_id: Parent workflow run ID
            interaction_id: Current interaction ID
            sub_action_id: Sub-action ID from schema (e.g., "image_generation")
            params: Optional parameters (e.g., feedback)
            ai_config: Optional runtime override for AI configuration (provider, model)

        Yields:
            SSEEvent objects for streaming
        """
        params = params or {}

        # 1. Generate unique execution_id for this run
        execution_id = f"{sub_action_id}_{uuid7_str()}"

        # 2. Get interaction and module config
        interaction = self._get_interaction(workflow_run_id, interaction_id)
        if not interaction:
            yield SSEEvent(
                type=SSEEventType.ERROR,
                data={"message": f"Interaction {interaction_id} not found"},
            )
            return

        step_id = interaction.get("step_id")
        module_name = interaction.get("module_name")
        module_config = self._get_module_config_from_interaction(interaction)

        sub_action_def = self._find_sub_action(module_config, sub_action_id)
        if not sub_action_def:
            yield SSEEvent(
                type=SSEEventType.ERROR,
                data={"message": f"Sub-action '{sub_action_id}' not found in module config"},
            )
            return

        logger.info(
            f"[SubAction] Found sub_action_def: id={sub_action_id}, "
            f"result_mapping={sub_action_def.get('result_mapping')}"
        )

        # 3. Store sub_action_started event
        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.SUB_ACTION_STARTED,
            step_id=step_id,
            module_name=module_name,
            data={
                "execution_id": execution_id,
                "sub_action_id": sub_action_id,
                "interaction_id": interaction_id,
                "params": params,
            },
        )

        logger.info(f"[SubAction] Yielding initial PROGRESS event for {execution_id}")
        yield SSEEvent(
            type=SSEEventType.PROGRESS,
            data={
                "workflow_run_id": workflow_run_id,
                "execution_id": execution_id,
                "message": sub_action_def.get("loading_label", "Processing..."),
            },
        )
        logger.info(f"[SubAction] Initial PROGRESS event yielded for {execution_id}")

        # 4. Determine action type and execute
        actions = sub_action_def.get("actions", [])
        if not actions:
            yield SSEEvent(
                type=SSEEventType.ERROR,
                data={"message": f"Sub-action '{sub_action_id}' has no actions"},
            )
            return

        first_action = actions[0]
        action_type = first_action.get("type")

        try:
            # 5. Execute based on type (both yield progress and return child_state)
            if action_type == "target_sub_action":
                logger.info(f"[SubAction] Executing target_sub_action for {execution_id}")
                child_state = None
                child_workflow_id = None
                async for event_type, event_data in self._execute_target_sub_actions(
                    workflow_run_id, execution_id, sub_action_def, params, ai_config
                ):
                    if event_type == "progress":
                        logger.info(f"[SubAction] Yielding target_sub_action PROGRESS for {execution_id}")
                        yield SSEEvent(
                            type=SSEEventType.PROGRESS,
                            data={
                                "workflow_run_id": workflow_run_id,
                                "execution_id": execution_id,
                                **event_data,
                            },
                        )
                    elif event_type == "result":
                        logger.info(f"[SubAction] Received result from target_sub_action for {execution_id}")
                        child_state, child_workflow_id = event_data

                if child_state is None:
                    raise ValueError("target_sub_action did not return a result")

            elif action_type == "self_sub_action":
                # self_sub_action yields progress events before returning result
                logger.info(f"[SubAction] Executing self_sub_action for {execution_id}")
                child_state = None
                async for event_type, event_data in self._execute_self_sub_action(
                    workflow_run_id, execution_id, interaction, sub_action_def, params
                ):
                    if event_type == "progress":
                        logger.info(f"[SubAction] Yielding self_sub_action PROGRESS for {execution_id}")
                        yield SSEEvent(
                            type=SSEEventType.PROGRESS,
                            data={
                                "workflow_run_id": workflow_run_id,
                                "execution_id": execution_id,
                                **event_data,
                            },
                        )
                        logger.info(f"[SubAction] self_sub_action PROGRESS yielded for {execution_id}")
                    elif event_type == "result":
                        logger.info(f"[SubAction] Received result from self_sub_action for {execution_id}")
                        child_state = event_data
                child_workflow_id = None

                if child_state is None:
                    raise ValueError("self_sub_action did not return a result")
            else:
                yield SSEEvent(
                    type=SSEEventType.ERROR,
                    data={"message": f"Unknown action type: {action_type}"},
                )
                return

            # 6. Get parent state for merge mode
            parent_outputs = self.db.state_repo.get_module_outputs(workflow_run_id)

            logger.info(
                f"[SubAction] Child workflow completed. child_state keys: {list(child_state.keys()) if child_state else 'None'}"
            )

            # 7. Apply result_mapping
            out_state = self._apply_result_mapping(sub_action_def, child_state, parent_outputs)

            logger.info(
                f"[SubAction] Result mapping applied. out_state keys: {list(out_state.keys()) if out_state else 'None'}"
            )

            # 8. Store sub_action_completed event in PARENT
            completed_data = {
                "execution_id": execution_id,
                "sub_action_id": sub_action_id,
                "child_state": child_state,
                "_state_mapped": out_state,
            }
            if child_workflow_id:
                completed_data["child_workflow_id"] = child_workflow_id

            logger.info(
                f"[SubAction] Storing sub_action_completed event in parent workflow {workflow_run_id[:8]}... "
                f"with _state_mapped keys: {list(out_state.keys()) if out_state else 'None'}"
            )

            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.SUB_ACTION_COMPLETED,
                step_id=step_id,
                module_name=module_name,
                data=completed_data,
            )

            # 9. Yield completion with result data for UI consumption
            completion_data = {
                "execution_id": execution_id,
                "updated_state": out_state,
            }
            # Include raw result for UI components (e.g., media generation)
            if child_state:
                completion_data["sub_action_result"] = child_state

            yield SSEEvent(
                type=SSEEventType.COMPLETE,
                data=completion_data,
            )

        except Exception as e:
            logger.error(f"Sub-action execution {execution_id} failed: {e}")
            yield SSEEvent(
                type=SSEEventType.ERROR,
                data={"message": str(e), "execution_id": execution_id},
            )

    async def _execute_target_sub_actions(
        self,
        parent_workflow_run_id: str,
        execution_id: str,
        sub_action_def: Dict,
        params: Dict,
        ai_config: Dict = None,
    ) -> AsyncIterator[Tuple[str, Any]]:
        """
        Execute target_sub_action chain as child workflow.

        Runs the synchronous execute_step_modules in a ThreadPoolExecutor
        while yielding progress events to keep the SSE connection alive.

        Args:
            parent_workflow_run_id: Parent workflow run ID
            execution_id: Unique execution ID for this sub-action run
            sub_action_def: Sub-action definition from module config
            params: Parameters passed to sub-action
            ai_config: Optional runtime override for AI configuration (provider, model)

        Yields:
            Tuples of (event_type, data):
            - ("progress", {...}) for progress updates
            - ("result", (child_state, child_workflow_id)) for the final result
        """
        # Get parent's state for Jinja resolution
        parent_outputs = self.db.state_repo.get_module_outputs(parent_workflow_run_id)

        # Get workflow context
        workflow = self.db.workflow_repo.get_workflow(parent_workflow_run_id)
        workflow_def = get_workflow_def(workflow, self.db, logger)
        services = rebuild_services(workflow, workflow_def, self.db, logger)

        # Apply runtime ai_config override if provided
        if ai_config:
            logger.info(f"[SubAction] Applying ai_config override: {ai_config}")
            services['ai_config'] = {**services.get('ai_config', {}), **ai_config}

        # Inject feedback if provided
        if params.get("feedback"):
            feedback_key = sub_action_def.get("feedback", {}).get(
                "state_key", "_retry_feedback"
            )
            parent_outputs[feedback_key] = params["feedback"]

        # Resolve actions to module configs
        actions = sub_action_def.get("actions", [])
        resolved_modules = []
        for action in actions:
            module_config = self._resolve_action_to_module(action, workflow_def)
            resolved_modules.append(module_config)
            logger.info(
                f"[SubAction] Resolved action: module_id={module_config.get('module_id')}, "
                f"name={module_config.get('name')}"
            )

        # Validate no interactive modules
        for module_config in resolved_modules:
            module = self.registry.get_module(module_config["module_id"])
            if isinstance(module, InteractiveModule):
                raise ValueError(
                    f"Sub-action cannot contain interactive module: {module_config['module_id']}"
                )

        # Build virtual step
        virtual_step = {
            "step_id": f"sub_action_{execution_id}",
            "modules": resolved_modules,
        }

        # Create child workflow run
        child_id = self._create_child_workflow_run(parent_workflow_run_id, execution_id)

        # Run sync executor in thread pool while yielding progress events
        loop = asyncio.get_event_loop()
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        start_time = time.time()

        def run_executor():
            return self.executor.execute_step_modules(
                workflow_run_id=child_id,
                step=virtual_step,
                step_id=virtual_step["step_id"],
                module_start=0,
                module_outputs=parent_outputs,
                services=services,
                config=workflow_def.get("config", {}),
                workflow_def=workflow_def,
            )

        future = loop.run_in_executor(executor, run_executor)

        # Use same intervals as main workflow streaming
        poll_interval = get_poll_interval()
        progress_interval = get_progress_interval()
        last_progress_time = start_time

        try:
            while not future.done():
                now = time.time()
                elapsed_ms = int((now - start_time) * 1000)

                # Yield progress event periodically
                if now - last_progress_time >= progress_interval:
                    yield ("progress", {
                        "elapsed_ms": elapsed_ms,
                        "message": "Processing...",
                    })
                    last_progress_time = now

                await asyncio.sleep(poll_interval)

            response = future.result()

            if response.status == WorkflowStatus.ERROR:
                raise ValueError(f"Sub-action failed: {response.error}")

            logger.info(
                f"[SubAction] Child workflow {child_id[:8]}... completed with "
                f"status={response.status}"
            )

            # Get child's state from its events
            child_state = self.db.state_repo.get_module_outputs(child_id)
            yield ("result", (child_state, child_id))

        finally:
            executor.shutdown(wait=False)

    def _create_child_workflow_run(
        self,
        parent_workflow_run_id: str,
        execution_id: str,
    ) -> str:
        """Create child workflow run for sub-action execution."""
        child_id = f"wf_sub_{uuid7_str()}"

        self.db.workflow_runs.insert_one({
            "workflow_run_id": child_id,
            "parent_workflow_id": parent_workflow_run_id,
            "execution_id": execution_id,
            "visible_in_ui": False,
            "status": "processing",
            "created_at": datetime.utcnow(),
        })

        # Create initial branch for child
        branch_id = f"br_{uuid7_str()}"
        self.db.branches.insert_one({
            "branch_id": branch_id,
            "workflow_run_id": child_id,
            "lineage": [{"branch_id": branch_id, "cutoff_event_id": None}],
            "created_at": datetime.utcnow(),
        })

        self.db.workflow_runs.update_one(
            {"workflow_run_id": child_id},
            {"$set": {"current_branch_id": branch_id}},
        )

        return child_id

    def _resolve_action_to_module(
        self,
        action: Dict,
        workflow_def: Dict,
    ) -> Dict:
        """Resolve action to full module configuration."""
        config = {}

        # Load from ref if specified
        ref = action.get("ref")
        if ref:
            ref_config = self._load_module_from_ref(workflow_def, ref)
            config = copy.deepcopy(ref_config)

        # Merge inline fields
        for key in ["module_id", "inputs", "outputs_to_state", "name"]:
            if key in action:
                if key in config and isinstance(config[key], dict) and isinstance(action[key], dict):
                    config[key] = self._deep_merge(config[key], action[key])
                else:
                    config[key] = action[key]

        # Apply overrides
        overrides = action.get("overrides", {})
        for key, value in overrides.items():
            if key in config and isinstance(config[key], dict) and isinstance(value, dict):
                config[key] = self._deep_merge(config[key], value)
            else:
                config[key] = value

        return config

    def _load_module_from_ref(self, workflow_def: Dict, ref: Dict) -> Dict:
        """Load module config from workflow by step_id and module_name."""
        step_id = ref.get("step_id")
        module_name = ref.get("module_name")

        for step in workflow_def.get("steps", []):
            if step.get("step_id") == step_id:
                for module in step.get("modules", []):
                    if module.get("name") == module_name:
                        return module

        raise ValueError(f"Module ref not found: step={step_id}, module={module_name}")

    def _deep_merge(self, base: Dict, override: Dict) -> Dict:
        """Deep merge two dicts, override takes precedence."""
        result = base.copy()
        for key, value in override.items():
            if (
                key in result
                and isinstance(result[key], dict)
                and isinstance(value, dict)
            ):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    def _get_nested_value(self, data: Dict, path: str) -> Any:
        """Get value from nested dict using dot notation path."""
        keys = path.split(".")
        value = data
        for key in keys:
            if isinstance(value, dict):
                value = value.get(key)
            else:
                return None
        return value

    def _set_nested_value(self, data: Dict, path: str, value: Any) -> None:
        """Set value in nested dict using dot notation path."""
        keys = path.split(".")
        for key in keys[:-1]:
            if key not in data:
                data[key] = {}
            data = data[key]
        data[keys[-1]] = value

    def _apply_result_mapping(
        self,
        sub_action_def: Dict,
        child_state: Dict,
        parent_outputs: Dict,
    ) -> Dict:
        """
        Apply result_mapping array to build out_state.

        Supports nested paths using dot notation:
        - source: "scene_concepts.scenes" gets child_state["scene_concepts"]["scenes"]
        - target: "scene_concepts.scenes" sets out_state["scene_concepts"]["scenes"]
        """
        result_mapping = sub_action_def.get("result_mapping", [])
        out_state = {}

        logger.debug(f"[SubAction] Applying {len(result_mapping)} result mappings")

        for mapping in result_mapping:
            source_path = mapping["source"]
            target_path = mapping["target"]
            mode = mapping.get("mode", "replace")

            # Get source value (supports nested paths)
            source_value = self._get_nested_value(child_state, source_path)

            logger.info(
                f"[SubAction] Mapping: source='{source_path}' -> target='{target_path}', "
                f"mode={mode}, source_value_type={type(source_value).__name__}, "
                f"source_value_len={len(source_value) if isinstance(source_value, (list, dict)) else 'N/A'}"
            )

            if source_value is None:
                logger.warning(
                    f"[SubAction] Source path '{source_path}' returned None. "
                    f"Available child_state keys: {list(child_state.keys()) if child_state else 'None'}"
                )

            if mode == "replace":
                self._set_nested_value(out_state, target_path, source_value)
                logger.info(f"[SubAction] Replace mode applied to {target_path}")
            elif mode == "merge":
                existing = self._get_nested_value(parent_outputs, target_path) or []
                new_value = source_value or []
                merged = [*existing, *new_value]
                logger.info(
                    f"[SubAction] Merge mode: existing_len={len(existing) if isinstance(existing, list) else 'N/A'}, "
                    f"new_len={len(new_value) if isinstance(new_value, list) else 'N/A'}, "
                    f"merged_len={len(merged) if isinstance(merged, list) else 'N/A'}"
                )
                self._set_nested_value(out_state, target_path, merged)

        return out_state

    async def _execute_self_sub_action(
        self,
        workflow_run_id: str,
        execution_id: str,
        interaction: Dict,
        sub_action_def: Dict,
        params: Dict,
    ) -> AsyncIterator[Tuple[str, Any]]:
        """
        Execute self_sub_action (module's own sub_action method).

        Yields:
            Tuples of (event_type, data) where:
            - ("progress", {...}) for progress updates
            - ("result", child_state) for the final result
        """
        module_id = interaction.get("data", {}).get("module_id")
        module = self.registry.get_module(module_id)

        if not hasattr(module, "sub_action"):
            raise ValueError(f"Module '{module_id}' does not implement sub_action()")

        action = sub_action_def.get("actions", [{}])[0]
        action_params = action.get("params", {})

        context = SubActionContext(
            workflow_run_id=workflow_run_id,
            execution_id=execution_id,
            interaction_id=interaction.get("data", {}).get("interaction_id"),
            db=self.db,
            params={**action_params, **params},
        )

        # Module's sub_action is an async generator yielding (event_type, data)
        async for event_type, event_data in module.sub_action(context):
            yield (event_type, event_data)

    def _get_interaction(
        self, workflow_run_id: str, interaction_id: str
    ) -> Optional[Dict]:
        """Get interaction event by ID."""
        return self.db.events.find_one({
            "workflow_run_id": workflow_run_id,
            "event_type": DbEventType.INTERACTION_REQUESTED.value,
            "data.interaction_id": interaction_id,
        })

    def _get_module_config_from_interaction(self, interaction: Dict) -> Dict:
        """
        Get module config from workflow definition for the interaction's module.

        The interaction stores step_id and module_name, which we use to
        look up the full module config (including sub_actions) from the
        workflow definition.
        """
        workflow_run_id = interaction.get("workflow_run_id")
        step_id = interaction.get("step_id")
        module_name = interaction.get("module_name")

        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            return {}

        workflow_def = get_workflow_def(workflow, self.db, logger)

        for step in workflow_def.get("steps", []):
            if step.get("step_id") == step_id:
                for module in step.get("modules", []):
                    if module.get("name") == module_name:
                        return module

        return {}

    def _find_sub_action(self, module_config: Dict, action_id: str) -> Optional[Dict]:
        """Find sub_action definition by ID."""
        sub_actions = module_config.get("sub_actions", [])
        for sub_action in sub_actions:
            if sub_action.get("id") == action_id:
                return sub_action
        return None
