"""
Workflow Execution Engine

Handles step and module execution within workflows.
"""

import logging
from typing import Dict, Any, TYPE_CHECKING

from backend.db import Database, DbEventType
from models import (
    WorkflowStatus,
    WorkflowResponse,
    WorkflowProgress,
)
from .workflow_context import WorkflowExecutionContext, StateProxy
from utils import sanitize_error_message, get_nested_value
from engine.module_registry import ModuleRegistry
from engine.jinja2_resolver import Jinja2Resolver as ParameterResolver
from engine.module_interface import InteractiveModule
from modules.addons.processor import AddonProcessor

from .workflow_utils import (
    serialize_interaction_request,
    convert_interaction_request,
)

if TYPE_CHECKING:
    from .processor import WorkflowProcessor


class WorkflowExecutor:
    """
    Executes workflow steps and modules.

    Handles the core execution loop, module instantiation,
    and output storage.
    """

    def __init__(self, db: Database, registry: ModuleRegistry, logger: logging.Logger):
        self.db = db
        self.registry = registry
        self.logger = logger

    def setup_addon_processor(
        self,
        module: InteractiveModule,
        module_config: Dict[str, Any],
        resolver: ParameterResolver,
        module_outputs: Dict[str, Any],
        context: Any
    ) -> None:
        """
        Create and inject addon processor into module if addons are configured.
        """
        if not hasattr(module, 'set_addon_processor'):
            return

        addon_configs = module_config.get('addons', [])
        if not addon_configs:
            return

        resolved_addon_configs = []
        for addon in addon_configs:
            resolved_addon = addon.copy()
            if 'inputs' in addon:
                resolved_addon['inputs'] = resolver.resolve_with_schema(addon['inputs'], module_outputs)
            resolved_addon_configs.append(resolved_addon)

        addon_processor = AddonProcessor(resolved_addon_configs, context)
        module.set_addon_processor(addon_processor)

    def resolve_interaction_display_data(
        self,
        workflow_run_id: str,
        step_id: str,
        module_name: str,
        module_id: str,
        module_config: Dict[str, Any],
        workflow_def: Dict[str, Any],
        services: Dict[str, Any],
        user_id: str = None,
    ) -> Dict[str, Any]:
        """
        Resolve and return display_data for an interaction using current state.

        This re-resolves module inputs against current workflow state and calls
        get_interaction_request to get fresh display_data. Used by the API
        to refresh interaction data after sub-actions modify state.

        Args:
            workflow_run_id: Workflow run ID
            step_id: Step containing the module
            module_name: Module name
            module_id: Module ID (e.g., "user.select")
            module_config: Module configuration from step
            workflow_def: Full workflow definition
            services: Rebuilt services dict
            user_id: Optional user ID for context

        Returns:
            display_data dict from the resolved interaction request
        """
        # Get current state
        module_outputs = self.db.state_repo.get_module_outputs(workflow_run_id)

        # Get workflow metadata
        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        workflow_path = workflow.get("workflow_path", "") if workflow else ""

        # Find step config for state proxy
        step_config = None
        for step in workflow_def.get("steps", []):
            if step.get("step_id") == step_id:
                step_config = step
                break

        # Create state proxy for resolver
        state_proxy = StateProxy(module_outputs, workflow_run_id, workflow_path)
        if step_config:
            state_proxy.set_step_config(step_config)

        # Create resolver with state proxy
        config = workflow_def.get("config", {})
        resolver = ParameterResolver(state_proxy, config=config)

        # Resolve inputs
        raw_inputs = module_config.get("inputs", {}).copy()
        resolved_inputs = resolver.resolve_with_schema(raw_inputs, module_outputs)

        # Get module instance
        module = self.registry.get_module(module_id)
        if not isinstance(module, InteractiveModule):
            raise ValueError(f"Module {module_id} is not interactive")

        # Create minimal context
        context = WorkflowExecutionContext(
            workflow_run_id=workflow_run_id,
            db=self.db,
            module_outputs=module_outputs,
            services=services,
            config=workflow_def.get("config", {}),
            workflow_dir=workflow_path,
            workflow_path=workflow_path,
            workflow_template_name=workflow_def.get("workflow_id"),
            user_id=user_id,
            branch_id=workflow.get("current_branch_id") if workflow else None,
            logger=self.logger,
        )
        context.step_id = step_id
        context.current_module_name = module_name
        context.retryable = module_config.get("retryable")
        context.sub_actions = module_config.get("sub_actions")

        # Setup addon processor if module supports it
        self.setup_addon_processor(module, module_config, resolver, module_outputs, context)

        # Get fresh interaction request
        interaction_request = module.get_interaction_request(resolved_inputs, context)

        if not interaction_request:
            raise ValueError("Module did not return interaction request")

        return interaction_request.display_data

    def execute_from_position(
        self,
        workflow_run_id: str,
        workflow_def: Dict,
        position: Dict,
        services: Dict,
        cancel_event=None
    ) -> WorkflowResponse:
        """Execute workflow from current position until interaction or completion"""
        steps = workflow_def.get('steps', [])
        config = workflow_def.get('config', {})

        # Load all module outputs from DB
        module_outputs = self.db.state_repo.get_module_outputs(workflow_run_id)

        # Find starting point
        completed_steps = position.get('completed_steps', [])
        current_step = position.get('current_step')
        current_module_index = position.get('current_module_index', 0)

        # Find step index to start from
        start_step_index = 0
        if current_step:
            for i, step in enumerate(steps):
                if step.get('step_id') == current_step:
                    start_step_index = i
                    break
        else:
            # Find first uncompleted step
            for i, step in enumerate(steps):
                if step.get('step_id') not in completed_steps:
                    start_step_index = i
                    break

        # Execute steps
        for step_index in range(start_step_index, len(steps)):
            step = steps[step_index]
            step_id = step.get('step_id')

            # Skip if already completed
            if step_id in completed_steps:
                continue

            # Store step started event
            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.STEP_STARTED,
                step_id=step_id
            )

            # Get step name, replacing {step_number} placeholder
            step_name = step.get('name', step_id)
            step_name = step_name.replace('{step_number}', str(step_index + 1))

            self.db.workflow_repo.update_workflow_status(
                workflow_run_id=workflow_run_id,
                status="processing",
                current_step=step_id,
                current_step_name=step_name
            )

            # Determine module start index
            module_start = current_module_index if step_index == start_step_index else 0

            # Execute modules in step
            result = self.execute_step_modules(
                workflow_run_id=workflow_run_id,
                step=step,
                step_id=step_id,
                module_start=module_start,
                module_outputs=module_outputs,
                services=services,
                config=config,
                workflow_def=workflow_def,
                cancel_event=cancel_event
            )

            if result.status == WorkflowStatus.AWAITING_INPUT:
                return result

            if result.status == WorkflowStatus.ERROR:
                return result

            # Step completed
            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.STEP_COMPLETED,
                step_id=step_id
            )

        # Workflow completed
        self.db.workflow_repo.update_workflow_status(workflow_run_id, "completed")
        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.WORKFLOW_COMPLETED
        )

        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=WorkflowStatus.COMPLETED,
            message="Workflow completed successfully",
            result=module_outputs
        )

    def execute_step_modules(
        self,
        workflow_run_id: str,
        step: Dict,
        step_id: str,
        module_start: int,
        module_outputs: Dict,
        services: Dict,
        config: Dict,
        workflow_def: Dict,
        cancel_event=None
    ) -> WorkflowResponse:
        """Execute modules within a step"""
        modules = step.get('modules', [])
        workflow_dir = services.get('workflow_dir', '.')
        workflow_path = services.get('workflow_path', '')

        # Create state proxy and set step config for $step references
        state_proxy = StateProxy(module_outputs, workflow_run_id, workflow_path)
        state_proxy.set_step_config(step)

        # Create parameter resolver
        resolver = ParameterResolver(state_proxy, config=config)

        # Create context
        workflow_template_name = services.get('workflow_template_name')
        workflow_template_id = services.get('workflow_template_id')
        user_id = services.get('user_id')
        branch_id = services.get('branch_id')
        context = WorkflowExecutionContext(
            workflow_run_id=workflow_run_id,
            db=self.db,
            module_outputs=module_outputs,
            services=services,
            config=config,
            workflow_dir=workflow_dir,
            workflow_path=workflow_path,
            workflow_template_name=workflow_template_name,
            workflow_template_id=workflow_template_id,
            user_id=user_id,
            branch_id=branch_id,
            logger=self.logger
        )
        context.cancel_event = cancel_event

        for i in range(module_start, len(modules)):
            module_config = modules[i]
            module_id = module_config.get('module_id')
            module_name = module_config.get('name', module_id)

            context.current_module_name = module_name
            context.current_module_index = i
            context.step_id = step_id
            context.retryable = module_config.get('retryable')
            context.sub_actions = module_config.get('sub_actions')

            # Store module started event
            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.MODULE_STARTED,
                step_id=step_id,
                module_name=module_name,
                data={"module_id": module_id}
            )

            try:
                module = self.registry.get_module(module_id)
                raw_inputs = module_config.get('inputs', {}).copy()

                # Extract resolver_schema before resolution
                resolver_schema = raw_inputs.get('resolver_schema')

                # Resolve inputs
                resolved_inputs = resolver.resolve_with_schema(raw_inputs, module_outputs)

                # Validate inputs
                is_valid, error_msg = module.validate_inputs(resolved_inputs)
                if not is_valid:
                    return WorkflowResponse(
                        workflow_run_id=workflow_run_id,
                        status=WorkflowStatus.ERROR,
                        error=f"Module '{module_id}' validation failed: {sanitize_error_message(str(error_msg))}"
                    )

                # Execute module
                if isinstance(module, InteractiveModule):
                    # Setup addon processor if module supports addons
                    self.setup_addon_processor(module, module_config, resolver, module_outputs, context)

                    # Get interaction request
                    interaction_request = module.get_interaction_request(resolved_inputs, context)

                    # Store interaction requested event with resolved_inputs
                    request_data = serialize_interaction_request(interaction_request)
                    request_data['_resolved_inputs'] = resolved_inputs
                    request_data['module_id'] = module_id  # For sub-action routing
                    if resolver_schema:
                        request_data['resolver_schema'] = resolver_schema
                    self.db.event_repo.store_event(
                        workflow_run_id=workflow_run_id,
                        event_type=DbEventType.INTERACTION_REQUESTED,
                        step_id=step_id,
                        module_name=module_name,
                        data=request_data
                    )

                    self.db.workflow_repo.update_workflow_status(
                        workflow_run_id=workflow_run_id,
                        status="awaiting_input",
                        current_module=module_name
                    )

                    return WorkflowResponse(
                        workflow_run_id=workflow_run_id,
                        status=WorkflowStatus.AWAITING_INPUT,
                        message=f"Waiting for input at {module_name}",
                        interaction_request=convert_interaction_request(request_data),
                        progress=WorkflowProgress(
                            current_step=step_id,
                            current_module=module_name,
                            step_index=i
                        )
                    )
                else:
                    # Execute executable module
                    outputs = module.execute(resolved_inputs, context)

                # Store outputs
                self.store_module_outputs(
                    workflow_run_id=workflow_run_id,
                    step_id=step_id,
                    module_name=module_name,
                    module_config=module_config,
                    outputs=outputs,
                    module_outputs=module_outputs
                )

            except Exception as e:
                self.logger.error(f"Module {module_id} failed: {e}")
                self.db.event_repo.store_event(
                    workflow_run_id=workflow_run_id,
                    event_type=DbEventType.MODULE_ERROR,
                    step_id=step_id,
                    module_name=module_name,
                    data={"error": sanitize_error_message(str(e))}
                )
                return WorkflowResponse(
                    workflow_run_id=workflow_run_id,
                    status=WorkflowStatus.ERROR,
                    error=f"Module '{module_id}' failed: {sanitize_error_message(str(e))}"
                )

        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=WorkflowStatus.PROCESSING,
            message=f"Step {step_id} completed"
        )

    def execute_from_module(
        self,
        workflow_run_id: str,
        workflow_def: Dict,
        step_id: str,
        module_index: int,
        services: Dict,
        retry_context: Dict = None
    ) -> WorkflowResponse:
        """Execute from a specific module (for retry)"""
        steps = workflow_def.get('steps', [])
        config = workflow_def.get('config', {})

        # Find step
        step = None
        for s in steps:
            if s.get('step_id') == step_id:
                step = s
                break

        if not step:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Step '{step_id}' not found"
            )

        # Get module outputs and inject retry context
        module_outputs = self.db.state_repo.get_module_outputs(workflow_run_id)

        if retry_context:
            conversation_history = retry_context.get('conversation_history', [])
            feedback = retry_context.get('feedback')

            if conversation_history:
                module_outputs['_retry_conversation_history'] = conversation_history
            if feedback:
                module_outputs['_retry_feedback'] = feedback

        # Execute from module
        return self.execute_step_modules(
            workflow_run_id=workflow_run_id,
            step=step,
            step_id=step_id,
            module_start=module_index,
            module_outputs=module_outputs,
            services=services,
            config=config,
            workflow_def=workflow_def
        )

    def store_module_outputs(
        self,
        workflow_run_id: str,
        step_id: str,
        module_name: str,
        module_config: Dict,
        outputs: Dict,
        module_outputs: Dict
    ):
        """Store module outputs to DB and update module_outputs dict"""
        # Map outputs to state
        output_mapping = module_config.get('outputs_to_state', {})
        state_mapped = {}
        for module_output_key, state_key in output_mapping.items():
            value = get_nested_value(outputs, module_output_key)
            module_outputs[state_key] = value
            state_mapped[state_key] = value
            # Debug logging for aesthetic selections
            if state_key == 'aesthetic_selections':
                self.logger.info(f"[STORE_OUTPUT] Storing {state_key}: type={type(value).__name__}, len={len(value) if isinstance(value, list) else 'N/A'}")
                if isinstance(value, list) and len(value) > 0:
                    first = value[0]
                    self.logger.info(f"[STORE_OUTPUT] First item type={type(first).__name__}, keys={list(first.keys()) if isinstance(first, dict) else 'N/A'}")
                    if isinstance(first, dict) and 'aesthetic' in first:
                        self.logger.info(f"[STORE_OUTPUT] First item aesthetic: {first['aesthetic']}")

        # Store event with both raw outputs and state mappings
        event_data = outputs.copy()
        event_data['_state_mapped'] = state_mapped

        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.MODULE_COMPLETED,
            step_id=step_id,
            module_name=module_name,
            data=event_data
        )
