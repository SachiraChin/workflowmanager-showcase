"""
Workflow Execution Context and State Management

Contains context classes used by workflow processor and modules.
"""

import logging
from typing import Dict, Any, Optional

from backend.server.db import Database


class StateProxy:
    """
    Proxy for state access that reads from module_outputs.

    Modules expect a state object with get/set/has/delete methods.
    This proxy provides that interface while keeping state in module_outputs.
    """

    def __init__(
        self,
        module_outputs: Dict[str, Any],
        workflow_run_id: str,
        workflow_path: str = None
    ):
        self._outputs = module_outputs
        self._workflow_run_id = workflow_run_id
        self._workflow_path = workflow_path
        self._step_config = {}  # Current step's configuration
        self._step_outputs = {}  # Outputs from completed steps

    def set_step_config(self, step_config: Dict[str, Any]):
        """Set current step configuration for $step references"""
        self._step_config = step_config or {}

    def get_step_config(self) -> Dict[str, Any]:
        """Get current step configuration for $step references"""
        return self._step_config

    def get_step_output(self, step_id: str) -> Any:
        """Get output from a completed step (for $step.step_id.key)"""
        # First check step_outputs, then check _step_config for current step
        if step_id in self._step_outputs:
            return self._step_outputs.get(step_id)
        # For current step, return step config
        return self._step_config.get(step_id)

    def get_all_step_outputs(self) -> Dict[str, Any]:
        """Get all step outputs"""
        return dict(self._step_outputs)

    @property
    def workflow_path(self) -> str:
        """Get workflow path for usage history"""
        return self._workflow_path

    def get(self, key: str, default: Any = None) -> Any:
        return self._outputs.get(key, default)

    def set(self, key: str, value: Any):
        self._outputs[key] = value

    def has(self, key: str) -> bool:
        return key in self._outputs

    def __contains__(self, key: str) -> bool:
        """Support 'key in state' syntax"""
        return key in self._outputs

    def __getitem__(self, key: str) -> Any:
        """Support state[key] syntax"""
        return self._outputs[key]

    def __setitem__(self, key: str, value: Any):
        """Support state[key] = value syntax"""
        self._outputs[key] = value

    def delete(self, key: str):
        if key in self._outputs:
            del self._outputs[key]

    def save_step_output(self, step_id: str, outputs: Dict[str, Any]):
        """Called at end of step - we store in DB via events instead"""
        pass  # Handled by processor storing MODULE_COMPLETED events

    def get_all_state(self) -> Dict[str, Any]:
        """Return all state as a dictionary"""
        return dict(self._outputs)


class WorkflowExecutionContext:
    """
    Minimal execution context for modules.

    Unlike the old ExecutionContext, this doesn't hold persistent state.
    State access is proxied through methods that read from module_outputs.
    """

    def __init__(
        self,
        workflow_run_id: str,
        db: Database,
        module_outputs: Dict[str, Any],
        services: Dict[str, Any],
        config: Dict[str, Any],
        workflow_dir: str,
        workflow_path: str = None,
        workflow_template_name: str = None,
        workflow_template_id: str = None,
        user_id: str = None,
        branch_id: str = None,
        logger: logging.Logger = None
    ):
        self.workflow_run_id = workflow_run_id
        self.db = db
        self._module_outputs = module_outputs
        self.services = services
        self.config = config
        self.workflow_dir = workflow_dir
        self.workflow_path = workflow_path or workflow_dir
        self.workflow_template_name = workflow_template_name
        self.workflow_template_id = workflow_template_id  # DB ID for db.query context filtering
        self.user_id = user_id  # User ID for multi-tenant scoping
        self.branch_id = branch_id  # Current branch ID for file isolation
        self.logger = logger or logging.getLogger('workflow')
        self.current_module_name = None
        self.current_module_index = None
        self.step_id = None
        self.router = None  # No router in API mode
        self.retryable = None  # Module's retryable config
        self.sub_actions = None  # Module's sub_actions config (for media.generate)
        self.cancel_event = None  # threading.Event for cancellation support

        # Create state proxy - use workflow_path for option usage tracking
        self.state = StateProxy(module_outputs, workflow_run_id, workflow_path or workflow_dir)

    def get_service(self, name: str) -> Any:
        if name not in self.services:
            raise KeyError(f"Service '{name}' not found")
        return self.services[name]

    def has_service(self, name: str) -> bool:
        return name in self.services

    def get_config(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)
