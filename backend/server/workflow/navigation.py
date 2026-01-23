"""
Workflow Navigation Handler

Handles retry and jump operations within workflows.
"""

import logging
from typing import Dict, Any, Optional

from backend.db import Database, DbEventType
from models import (
    WorkflowStatus,
    WorkflowResponse,
    InteractionResponseData,
)

from .workflow_utils import find_module_in_workflow, get_workflow_def, rebuild_services


class NavigationHandler:
    """
    Handles workflow navigation operations.

    Manages retry (re-execute module with feedback) and
    jump (branch to earlier point) operations.
    """

    def __init__(
        self,
        db: Database,
        logger: logging.Logger,
        executor  # WorkflowExecutor - avoid circular import
    ):
        self.db = db
        self.logger = logger
        self.executor = executor

    def retry(
        self,
        workflow_run_id: str,
        target_module: str,
        feedback: Optional[str] = None
    ) -> WorkflowResponse:
        """
        Retry a module with optional feedback.

        Args:
            workflow_run_id: Workflow ID
            target_module: Module to re-execute
            feedback: Optional user feedback

        Returns:
            WorkflowResponse with status
        """
        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow not found"
            )

        # Store retry event
        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.RETRY_REQUESTED,
            data={
                "target_module": target_module,
                "feedback": feedback
            }
        )

        # Get workflow definition from database
        workflow_def = get_workflow_def(workflow, self.db, self.logger)
        if workflow_def is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow definition not found in database"
            )

        # Find the step and module index for target
        step_id, module_index = find_module_in_workflow(workflow_def, target_module)

        if step_id is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Target module '{target_module}' not found"
            )

        # Get previous response and build retry context
        retry_context = self.db.state_repo.get_retry_context(workflow_run_id, target_module)

        # Rebuild services
        services = rebuild_services(workflow, workflow_def, self.db, self.logger)

        # Execute from target module with retry context
        return self.executor.execute_from_module(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            step_id=step_id,
            module_index=module_index,
            services=services,
            retry_context=retry_context
        )

    def jump(
        self,
        workflow_run_id: str,
        target_step: str,
        target_module: str
    ) -> WorkflowResponse:
        """
        Jump to a specific step/module by creating a new branch.

        Unlike retry, this creates a new branch that forks from just before the
        target module. All state after the fork point is discarded on the new branch.

        Args:
            workflow_run_id: Workflow ID
            target_step: Step to jump to
            target_module: Module within the step to start from

        Returns:
            WorkflowResponse with status
        """
        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow not found"
            )

        self.logger.info(f"[JUMP] Jumping to step={target_step}, module={target_module}")

        # Get workflow definition from database
        workflow_def = get_workflow_def(workflow, self.db, self.logger)
        if workflow_def is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow definition not found in database"
            )

        # Find module index in target step
        module_index = None
        step_found = False
        for step in workflow_def.get("steps", []):
            step_id = step.get("id") or step.get("step_id")
            if step_id == target_step:
                step_found = True
                self.logger.info(f"[JUMP] Found step '{target_step}' with {len(step.get('modules', []))} modules")
                for i, mod in enumerate(step.get("modules", [])):
                    mod_name = mod.get("name") or mod.get("module_id", "").split(".")[-1]
                    self.logger.debug(f"[JUMP]   Module {i}: name='{mod.get('name')}', module_id='{mod.get('module_id')}', resolved='{mod_name}'")
                    if mod_name == target_module:
                        module_index = i
                        break
                break

        if not step_found:
            available = [s.get('id') or s.get('step_id') for s in workflow_def.get('steps', [])]
            self.logger.warning(f"[JUMP] Step '{target_step}' not found in workflow. Available steps: {available}")

        if module_index is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Target module '{target_module}' not found in step '{target_step}'"
            )

        # Create new branch forking from just before the target module
        try:
            new_branch_id = self.db.state_repo.jump_to_module(
                workflow_run_id=workflow_run_id,
                target_step=target_step,
                target_module=target_module
            )
            self.logger.info(f"[JUMP] Created new branch: {new_branch_id}")
        except ValueError as e:
            self.logger.warning(f"[JUMP] Could not create branch: {e}. Executing directly.")
            new_branch_id = None

        # Store jump event on the new branch
        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.JUMP_REQUESTED,
            data={
                "target_step": target_step,
                "target_module": target_module,
                "new_branch_id": new_branch_id
            }
        )

        # Rebuild services
        services = rebuild_services(workflow, workflow_def, self.db, self.logger)

        # Execute from target step/module (no retry context - clean jump)
        return self.executor.execute_from_module(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            step_id=target_step,
            module_index=module_index,
            services=services,
            retry_context=None
        )

    def is_retry_response(self, response: InteractionResponseData) -> bool:
        """Check if response indicates a retry request"""
        for opt in response.selected_options:
            if opt.get('metadata', {}).get('is_retry'):
                return True
            if opt.get('id') == 'retry':
                return True

        # If no options selected but custom_value provided, treat as retry with feedback
        if not response.selected_options and response.custom_value:
            return True

        return False

    def handle_retry_from_response(
        self,
        workflow_run_id: str,
        workflow: Dict,
        response: InteractionResponseData
    ) -> WorkflowResponse:
        """Handle retry when user selects retry option in interaction"""
        last_interaction = self.db.event_repo.get_latest_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.INTERACTION_REQUESTED
        )

        if not last_interaction:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="No interaction context for retry"
            )

        module_name = last_interaction.get('module_name')

        # Get workflow definition from database
        workflow_def = get_workflow_def(workflow, self.db, self.logger)
        if workflow_def is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow definition not found in database"
            )

        # Find the module's retryable config
        target_module = None
        default_feedback = ""
        for step in workflow_def.get('steps', []):
            for module in step.get('modules', []):
                if module.get('name') == module_name:
                    retryable = module.get('retryable', {})
                    for opt in retryable.get('options', []):
                        if opt.get('mode') == 'retry':
                            target_module = opt.get('target_module')
                            feedback_config = opt.get('feedback', {})
                            default_feedback = feedback_config.get('default_message', '')
                            break
                    break

        if not target_module:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"No retry target configured for {module_name}"
            )

        # Extract feedback from response if available, fall back to default
        feedback = response.custom_value or default_feedback

        return self.retry(workflow_run_id, target_module, feedback)
