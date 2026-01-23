"""
Workflow Management Module

Contains the core workflow execution engine split into focused components:
- processor: Main WorkflowProcessor orchestrator
- executor: Step and module execution
- interaction: User interaction handling
- navigation: Retry and jump logic
- helpers: Shared utilities
"""

from .processor import WorkflowProcessor

__all__ = ['WorkflowProcessor']
