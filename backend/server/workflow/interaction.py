"""
Workflow Interaction Handler

Handles user interaction responses and continues execution.
"""

import time
import logging
import threading
import asyncio
from typing import Dict, Any, Union

from backend.db import Database, DbEventType
from models import (
    WorkflowStatus,
    WorkflowResponse,
    InteractionResponseData,
)
from .workflow_context import WorkflowExecutionContext, StateProxy
from utils import sanitize_error_message, get_nested_value
from engine.module_registry import ModuleRegistry
from engine.jinja2_resolver import Jinja2Resolver as ParameterResolver
from engine.module_interface import InteractionResponse as EngineInteractionResponse


class InteractionHandler:
    """
    Handles user interaction responses.

    Processes responses from interactive modules and continues
    workflow execution from the interaction point.
    """

    def __init__(
        self,
        db: Database,
        registry: ModuleRegistry,
        logger: logging.Logger,
        executor,  # WorkflowExecutor - avoid circular import
        navigator  # NavigationHandler - avoid circular import
    ):
        self.db = db
        self.registry = registry
        self.logger = logger
        self.executor = executor
        self.navigator = navigator

    def continue_after_interaction(
        self,
        workflow_run_id: str,
        workflow_def: Dict,
        position: Dict,
        services: Dict,
        module_outputs: Dict,
        interaction_response: InteractionResponseData,
        cancel_event: Union[threading.Event, asyncio.Event] = None
    ) -> WorkflowResponse:
        """Continue execution after receiving interaction response"""
        tc0 = time.time()

        # Find the module that was waiting for input
        last_interaction = self.db.event_repo.get_latest_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.INTERACTION_REQUESTED
        )
        self.logger.debug(f"[TIMING]   get_latest_event: {(time.time()-tc0)*1000:.0f}ms")

        if not last_interaction:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="No pending interaction found"
            )

        step_id = last_interaction.get('step_id')
        module_name = last_interaction.get('module_name')

        # Find step and module
        steps = workflow_def.get('steps', [])
        config = workflow_def.get('config', {})
        workflow_dir = services.get('workflow_dir', '.')

        step = None
        step_index = 0
        for i, s in enumerate(steps):
            if s.get('step_id') == step_id:
                step = s
                step_index = i
                break

        if not step:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Step '{step_id}' not found"
            )

        # Find module index
        modules = step.get('modules', [])
        module_index = None
        module_config = None
        for i, m in enumerate(modules):
            if m.get('name', m.get('module_id')) == module_name:
                module_index = i
                module_config = m
                break

        if module_index is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Module '{module_name}' not found in step"
            )

        # Create context and resolver
        workflow_path = services.get('workflow_path', '')
        state_proxy = StateProxy(module_outputs, workflow_run_id, workflow_path)
        state_proxy.set_step_config(step)
        resolver = ParameterResolver(state_proxy, config=config)

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
        context.current_module_name = module_name
        context.current_module_index = module_index
        context.step_id = step_id
        context.retryable = module_config.get('retryable')
        context.sub_actions = module_config.get('sub_actions')
        context.cancel_event = cancel_event
        self.logger.info(f"[CANCEL] Set context.cancel_event = {cancel_event}, type={type(cancel_event)}")

        # Execute the interactive module with response
        try:
            tc1 = time.time()
            module_id = module_config.get('module_id')
            module = self.registry.get_module(module_id)
            self.logger.debug(f"[TIMING]   get_module: {(time.time()-tc1)*1000:.0f}ms")

            # Setup addon processor if module supports addons
            self.executor.setup_addon_processor(module, module_config, resolver, module_outputs, context)

            tc2 = time.time()
            # Use stored resolved_inputs from when interaction was first requested
            stored_resolved_inputs = last_interaction.get('data', {}).get('_resolved_inputs')
            if stored_resolved_inputs:
                resolved_inputs = stored_resolved_inputs
                self.logger.debug(f"[TIMING]   using stored resolved_inputs")
            else:
                # Fallback to re-resolving (for backwards compatibility)
                raw_inputs = module_config.get('inputs', {}).copy()
                resolved_inputs = resolver.resolve_with_schema(raw_inputs, module_outputs)
                self.logger.debug(f"[TIMING]   resolve_inputs (fallback): {(time.time()-tc2)*1000:.0f}ms")

            # Convert response to engine format
            engine_response = EngineInteractionResponse(
                interaction_id=last_interaction['data'].get('interaction_id', ''),
                value=interaction_response.value,
                selected_indices=interaction_response.selected_indices,
                selected_options=interaction_response.selected_options,
                custom_value=interaction_response.custom_value,
                cancelled=interaction_response.cancelled,
                retry_requested=interaction_response.retry_requested,
                retry_groups=interaction_response.retry_groups,
                retry_feedback=interaction_response.retry_feedback,
                jump_back_requested=interaction_response.jump_back_requested,
                jump_back_target=interaction_response.jump_back_target,
                file_written=interaction_response.file_written,
                file_path=interaction_response.file_path,
                file_error=interaction_response.file_error,
                form_data=interaction_response.form_data,
                # MEDIA_GENERATION response fields
                selected_content_id=interaction_response.selected_content_id,
                selected_content=interaction_response.selected_content,
                generations=interaction_response.generations,
            )

            tc3 = time.time()
            outputs = module.execute_with_response(resolved_inputs, context, engine_response)
            self.logger.debug(f"[TIMING]   execute_with_response: {(time.time()-tc3)*1000:.0f}ms")
            self.logger.info(f"[MODULE_OUTPUT] {module_name}: {outputs}")

            # Check for retry request in outputs
            if outputs.get('retry_requested'):
                return self._handle_retry_from_outputs(
                    workflow_run_id, module_config, outputs
                )

            # Check for jump back request in outputs
            if outputs.get('jump_back_requested'):
                return self._handle_jump_from_outputs(
                    workflow_run_id, module_config, outputs
                )

            # Store outputs
            tc4 = time.time()
            self.executor.store_module_outputs(
                workflow_run_id=workflow_run_id,
                step_id=step_id,
                module_name=module_name,
                module_config=module_config,
                outputs=outputs,
                module_outputs=module_outputs
            )
            self.logger.debug(f"[TIMING]   store_module_outputs: {(time.time()-tc4)*1000:.0f}ms")

        except Exception as e:
            self.logger.error(f"Module execution failed: {e}")
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Module execution failed: {sanitize_error_message(str(e))}"
            )

        # Continue with remaining modules in this step
        tc5 = time.time()
        result = self.executor.execute_step_modules(
            workflow_run_id=workflow_run_id,
            step=step,
            step_id=step_id,
            module_start=module_index + 1,
            module_outputs=module_outputs,
            services=services,
            config=config,
            workflow_def=workflow_def,
            cancel_event=cancel_event
        )
        self.logger.debug(f"[TIMING]   execute_step_modules: {(time.time()-tc5)*1000:.0f}ms")

        # If step completed (PROCESSING status), continue to next steps
        if result.status == WorkflowStatus.PROCESSING:
            # Mark current step as completed
            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.STEP_COMPLETED,
                step_id=step_id
            )

            # Find and execute next steps
            steps = workflow_def.get('steps', [])
            next_step_index = step_index + 1

            if next_step_index < len(steps):
                position = self.db.state_repo.get_workflow_position(workflow_run_id)
                return self.executor.execute_from_position(
                    workflow_run_id=workflow_run_id,
                    workflow_def=workflow_def,
                    position=position,
                    services=services,
                    cancel_event=cancel_event
                )
            else:
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

        return result

    def _handle_retry_from_outputs(
        self,
        workflow_run_id: str,
        module_config: Dict,
        outputs: Dict
    ) -> WorkflowResponse:
        """Handle retry request from module outputs"""
        retryable = module_config.get('retryable', {})
        feedback = outputs.get('retry_feedback', '')

        target_module = None
        default_feedback = ''

        for opt in retryable.get('options', []):
            if opt.get('mode') == 'retry':
                target_module = opt.get('target_module')
                feedback_config = opt.get('feedback', {})
                default_feedback = feedback_config.get('default_message', '')
                break

        if not feedback:
            feedback = default_feedback

        if target_module:
            return self.navigator.retry(workflow_run_id, target_module, feedback)

        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=WorkflowStatus.ERROR,
            error="Retry requested but no target module configured"
        )

    def _handle_jump_from_outputs(
        self,
        workflow_run_id: str,
        module_config: Dict,
        outputs: Dict
    ) -> WorkflowResponse:
        """Handle jump back request from module outputs"""
        jump_target = outputs.get('jump_back_target', '')
        retryable = module_config.get('retryable', {})

        target_step = None
        target_module = None

        for opt in retryable.get('options', []):
            if opt.get('mode') == 'jump':
                if opt.get('target_module') == jump_target or opt.get('id') == jump_target:
                    target_step = opt.get('target_step')
                    target_module = opt.get('target_module')
                    break

        if target_step and target_module:
            self.logger.info(f"[JUMP_BACK] User requested jump to step={target_step}, module={target_module}")
            return self.navigator.jump(workflow_run_id, target_step, target_module)
        else:
            self.logger.warning(f"[JUMP_BACK] Jump target '{jump_target}' not found in retryable options")
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Jump target '{jump_target}' not found"
            )
