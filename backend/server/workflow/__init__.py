"""
Workflow Management Module

Contains the core workflow execution engine split into focused components:
- processor: Main WorkflowProcessor orchestrator
- executor: Step and module execution
- interaction: User interaction handling
- navigation: Retry and jump logic
- sub_action: Sub-action execution within interactions
- helpers: Shared utilities
"""

from .processor import WorkflowProcessor
from .sub_action import SubActionHandler, SubActionContext

__all__ = ['WorkflowProcessor', 'SubActionHandler', 'SubActionContext']
