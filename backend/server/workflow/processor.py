"""
Stateless Workflow Processor

Main orchestrator that coordinates workflow execution.
Delegates to specialized handlers for execution, interaction, and navigation.
"""

import logging
import time
from datetime import datetime
from typing import Dict, Any, Optional, List

from backend.db import Database, DbEventType
from models import (
    WorkflowStatus,
    WorkflowResponse,
    InteractionResponseData,
)
from engine.module_registry import ModuleRegistry

from .executor import WorkflowExecutor
from .interaction import InteractionHandler
from .navigation import NavigationHandler
from .sub_action import SubActionHandler
from .streaming import WorkflowStreamingMixin
from .workflow_utils import (
    convert_interaction_request,
    build_progress,
    rebuild_services,
    get_workflow_def,
)


class WorkflowProcessor(WorkflowStreamingMixin):
    """
    Stateless workflow processor.

    Each method call:
    1. Loads context from database
    2. Processes until interaction needed or completion
    3. Stores events in database
    4. Returns response

    Delegates to:
    - WorkflowExecutor: Step/module execution
    - InteractionHandler: User interaction processing
    - NavigationHandler: Retry/jump operations

    SSE streaming methods are provided by WorkflowStreamingMixin.
    """

    def __init__(self, db: Database):
        self.db = db
        self.registry = ModuleRegistry()
        self.registry.discover_modules()
        self.logger = logging.getLogger('workflow.processor')

        # Initialize handlers
        self.executor = WorkflowExecutor(db, self.registry, self.logger)
        self.navigator = NavigationHandler(db, self.logger, self.executor)
        self.interaction_handler = InteractionHandler(
            db, self.registry, self.logger, self.executor, self.navigator
        )
        self.sub_action_handler = SubActionHandler(db, self.registry)

    def start_workflow(
        self,
        version_id: str,
        project_name: str,
        workflow_template_name: str,
        user_id: str,
        ai_config: Dict[str, Any] = None,
        force_new: bool = False,
        capabilities: List[str] = None
    ) -> WorkflowResponse:
        """
        Start or resume a workflow.

        Args:
            version_id: Source version ID (raw or unresolved)
            project_name: User-provided project identifier
            workflow_template_name: The workflow_id from workflow JSON
            user_id: User ID (required)
            ai_config: AI configuration
            force_new: Force new workflow even if one exists
            capabilities: List of client capabilities for version selection

        Returns:
            WorkflowResponse with status and optional interaction request
        """
        if capabilities is None:
            capabilities = []

        # Get version info for template lookup
        source_version = self.db.version_repo.get_workflow_version_by_id(version_id)
        if not source_version:
            return WorkflowResponse(
                workflow_run_id="",
                status=WorkflowStatus.ERROR,
                error=f"Version {version_id} not found"
            )
        workflow_template_id = source_version.get("workflow_template_id")

        # Select best version for capabilities
        best_version = self.db.version_repo.get_version_for_capabilities(version_id, capabilities)
        if not best_version:
            return WorkflowResponse(
                workflow_run_id="",
                status=WorkflowStatus.ERROR,
                error=f"No suitable version found for capabilities: {capabilities}"
            )
        active_version_id = best_version["workflow_version_id"]
        workflow_def = best_version["resolved_workflow"]

        # Get or create workflow run
        workflow_run_id, is_new, branch_id = self.db.workflow_repo.get_or_create_workflow_run(
            project_name=project_name,
            user_id=user_id,
            workflow_template_name=workflow_template_name,
            workflow_template_id=workflow_template_id,
            active_version_id=active_version_id,
        )

        version_changed = False

        if is_new:
            # Store WORKFLOW_CREATED event
            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.WORKFLOW_CREATED,
                data={
                    "project_name": project_name,
                    "workflow_template_name": workflow_template_name,
                    "workflow_template_id": workflow_template_id,
                    "version_id": active_version_id,
                },
                branch_id=branch_id,
                workflow_version_id=active_version_id,
            )
            self.db.workflow_repo.add_version_history_entry(
                workflow_run_id=workflow_run_id,
                workflow_version_id=active_version_id,
                client_capabilities=capabilities,
                version_repo=self.db.version_repo,
            )
        elif force_new:
            # Delete existing events and reset
            self.db.event_repo.delete_workflow_events(workflow_run_id)
            self.db.workflow_repo.reset_workflow(workflow_run_id)
            self.db.workflow_runs.update_one(
                {"workflow_run_id": workflow_run_id},
                {"$set": {"current_workflow_version_id": active_version_id}}
            )
            # Store new WORKFLOW_CREATED event with reset flag
            self.db.event_repo.store_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.WORKFLOW_CREATED,
                data={
                    "project_name": project_name,
                    "workflow_template_name": workflow_template_name,
                    "workflow_template_id": workflow_template_id,
                    "version_id": active_version_id,
                    "reset": True,
                },
                branch_id=branch_id,
                workflow_version_id=active_version_id,
            )
            self.db.workflow_repo.add_version_history_entry(
                workflow_run_id=workflow_run_id,
                workflow_version_id=active_version_id,
                client_capabilities=capabilities,
                version_repo=self.db.version_repo,
            )
            is_new = True
        else:
            # Resume existing workflow
            workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
            current_version_id = workflow.get("current_workflow_version_id") if workflow else None

            if not current_version_id:
                return WorkflowResponse(
                    workflow_run_id=workflow_run_id,
                    status=WorkflowStatus.ERROR,
                    error="Workflow run has no current_workflow_version_id"
                )

            current_version = self.db.version_repo.get_workflow_version_by_id(current_version_id)
            if current_version:
                current_source_id = current_version.get("parent_workflow_version_id") or current_version_id
                version_changed = current_source_id != version_id

            if current_version and current_version.get("resolved_workflow"):
                workflow_def = current_version["resolved_workflow"]
                active_version_id = current_version_id
                self.logger.debug(f"[VERSION] Resuming with existing version {current_version_id}")
            else:
                return WorkflowResponse(
                    workflow_run_id=workflow_run_id,
                    status=WorkflowStatus.ERROR,
                    error=f"Current version {current_version_id} has no workflow definition"
                )

        # Store ai_config
        if ai_config:
            self.db.workflow_runs.update_one(
                {"workflow_run_id": workflow_run_id},
                {"$set": {"ai_config": ai_config}}
            )

        # Get current branch_id
        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        branch_id = workflow.get('current_branch_id', '') if workflow else ''

        # Setup services
        services = {
            'ai_config': ai_config or {},
            'workflow_run_id': workflow_run_id,
            'project_name': project_name,
            'workflow_template_name': workflow_template_name,
            'workflow_template_id': workflow_template_id,
            'user_id': user_id,
            'branch_id': branch_id,
            'session_timestamp': datetime.now().strftime('%Y%m%d_%H%M%S'),
        }

        # Get current position
        position = self.db.state_repo.get_workflow_position(workflow_run_id)

        self.logger.debug(f"[RESUME] Position: current_step={position.get('current_step')}, "
                         f"completed_steps={position.get('completed_steps')}, "
                         f"current_module_index={position.get('current_module_index')}, "
                         f"has_pending_interaction={position['pending_interaction'] is not None}, "
                         f"version_changed={version_changed}")

        if position['pending_interaction'] and not version_changed:
            self.logger.debug(f"[RESUME] Returning pending interaction")
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.AWAITING_INPUT,
                message="Pending interaction",
                interaction_request=convert_interaction_request(
                    position['pending_interaction']
                ),
                progress=build_progress(workflow_def, position)
            )

        if version_changed and position['pending_interaction']:
            self.logger.debug(f"[RESUME] Version changed with pending interaction - re-executing")

        self.logger.debug(f"[RESUME] Executing from position")
        return self.executor.execute_from_position(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            position=position,
            services=services
        )

    def resume_workflow_with_update(
        self,
        workflow_run_id: str,
        version_id: str,
        user_id: str,
        ai_config: Dict[str, Any] = None,
        capabilities: List[str] = None
    ) -> WorkflowResponse:
        """
        Resume a workflow with an updated workflow definition.

        Called after user confirms version change.
        """
        if capabilities is None:
            capabilities = []

        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow not found"
            )

        if workflow.get("user_id") != user_id:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Access denied"
            )

        source_version = self.db.version_repo.get_workflow_version_by_id(version_id)
        if not source_version:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"Version {version_id} not found"
            )

        workflow_template_id = source_version.get("workflow_template_id")
        workflow_template_name = source_version.get("resolved_workflow", {}).get("workflow_id")

        best_version = self.db.version_repo.get_version_for_capabilities(version_id, capabilities)
        if not best_version:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error=f"No suitable version found for capabilities: {capabilities}"
            )

        active_version_id = best_version["workflow_version_id"]
        workflow_def = best_version["resolved_workflow"]
        is_resolved = best_version.get("version_type") == "resolved"

        if is_resolved:
            self.logger.info(
                f"[RESUME WITH UPDATE] Selected resolved version {active_version_id} "
                f"with score {best_version.get('computed_score', 0)}"
            )
        else:
            self.logger.info(f"[RESUME WITH UPDATE] Using source version {active_version_id}")

        self.db.workflow_runs.update_one(
            {"workflow_run_id": workflow_run_id},
            {"$set": {"current_workflow_version_id": active_version_id}}
        )

        self.db.workflow_repo.add_version_history_entry(
            workflow_run_id=workflow_run_id,
            workflow_version_id=version_id
        )

        if ai_config:
            self.db.workflow_runs.update_one(
                {"workflow_run_id": workflow_run_id},
                {"$set": {"ai_config": ai_config}}
            )

        project_name = workflow.get("project_name", "")
        position = self.db.state_repo.get_workflow_position(workflow_run_id)
        branch_id = workflow.get('current_branch_id', '')

        services = {
            'ai_config': ai_config or {},
            'workflow_run_id': workflow_run_id,
            'project_name': project_name,
            'workflow_template_name': workflow_template_name,
            'workflow_template_id': workflow_template_id,
            'user_id': user_id,
            'branch_id': branch_id,
            'session_timestamp': datetime.now().strftime('%Y%m%d_%H%M%S'),
        }

        self.logger.debug(f"[RESUME WITH UPDATE] Resuming workflow {workflow_run_id} with version {version_id}...")

        return self.executor.execute_from_position(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            position=position,
            services=services
        )

    def respond(
        self,
        workflow_run_id: str,
        interaction_id: str,
        response: InteractionResponseData,
        ai_config: Optional[Dict[str, Any]] = None
    ) -> WorkflowResponse:
        """
        Process user response to an interaction.
        
        Args:
            workflow_run_id: The workflow run identifier
            interaction_id: The interaction being responded to
            response: The user's response data
            ai_config: Optional runtime override for AI configuration (provider, model)
        """
        t0 = time.time()

        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        self.logger.debug(f"[TIMING] get_workflow: {(time.time()-t0)*1000:.0f}ms")
        if not workflow:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow not found"
            )

        # Find the interaction request to get step_id and module_name
        interaction_request = self.db.events.find_one({
            "workflow_run_id": workflow_run_id,
            "event_type": DbEventType.INTERACTION_REQUESTED.value,
            "data.interaction_id": interaction_id
        })
        step_id = interaction_request.get("step_id") if interaction_request else None
        module_name = interaction_request.get("module_name") if interaction_request else None
        module_id = interaction_request.get("data", {}).get("module_id") if interaction_request else None

        # Store response event
        t1 = time.time()
        response_data = {
            "interaction_id": interaction_id,
            "response": response.model_dump()
        }
        if module_id:
            response_data["module_id"] = module_id
        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.INTERACTION_RESPONSE,
            step_id=step_id,
            module_name=module_name,
            data=response_data
        )
        self.logger.debug(f"[TIMING] store_event: {(time.time()-t1)*1000:.0f}ms")

        # Check if this is a retry request
        if self.navigator.is_retry_response(response):
            return self.navigator.handle_retry_from_response(workflow_run_id, workflow, response)

        # Get workflow definition
        t2 = time.time()
        workflow_def = get_workflow_def(workflow, self.db, self.logger)
        if workflow_def is None:
            return WorkflowResponse(
                workflow_run_id=workflow_run_id,
                status=WorkflowStatus.ERROR,
                error="Workflow definition not found in database"
            )
        self.logger.debug(f"[TIMING] get_workflow_def: {(time.time()-t2)*1000:.0f}ms")

        # Get position and rebuild services
        t3 = time.time()
        position = self.db.state_repo.get_workflow_position(workflow_run_id)
        self.logger.debug(f"[TIMING] get_workflow_position: {(time.time()-t3)*1000:.0f}ms")
        services = rebuild_services(workflow, workflow_def, self.db, self.logger)
        
        # Apply runtime ai_config override if provided
        if ai_config:
            self.logger.info(f"[RESPOND] Applying ai_config override: {ai_config}")
            services['ai_config'] = {**services.get('ai_config', {}), **ai_config}

        # Get module outputs
        t4 = time.time()
        module_outputs = self.db.state_repo.get_module_outputs(workflow_run_id)
        self.logger.debug(f"[TIMING] get_module_outputs: {(time.time()-t4)*1000:.0f}ms")

        # Continue after interaction
        t5 = time.time()
        result = self.interaction_handler.continue_after_interaction(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            position=position,
            services=services,
            module_outputs=module_outputs,
            interaction_response=response
        )
        self.logger.debug(f"[TIMING] continue_after_interaction: {(time.time()-t5)*1000:.0f}ms")
        self.logger.debug(f"[TIMING] TOTAL respond: {(time.time()-t0)*1000:.0f}ms")

        return result

    def retry(
        self,
        workflow_run_id: str,
        target_module: str,
        feedback: Optional[str] = None,
        ai_config: Optional[Dict[str, Any]] = None
    ) -> WorkflowResponse:
        """
        Retry a module with optional feedback.
        
        Args:
            workflow_run_id: The workflow run identifier
            target_module: Module name to retry
            feedback: Optional feedback for retry
            ai_config: Optional runtime override for AI configuration (provider, model)
        """
        return self.navigator.retry(workflow_run_id, target_module, feedback, ai_config)

    def jump(
        self,
        workflow_run_id: str,
        target_step: str,
        target_module: str
    ) -> WorkflowResponse:
        """Jump to a specific step/module by creating a new branch."""
        return self.navigator.jump(workflow_run_id, target_step, target_module)

    def get_status(self, workflow_run_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow status"""
        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            return None

        position = self.db.state_repo.get_workflow_position(workflow_run_id)

        return {
            "workflow_run_id": workflow_run_id,
            "project_name": workflow.get("project_name"),
            "status": workflow.get("status"),
            "current_step": position.get("current_step"),
            "completed_steps": position.get("completed_steps", []),
            "created_at": workflow.get("created_at"),
            "updated_at": workflow.get("updated_at")
        }
