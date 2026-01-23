"""
Workflow Engine

Core engine for executing JSON-defined workflows with pluggable modules.
"""

from .module_interface import Module, ModuleInput, ModuleOutput, ModuleExecutionError
from .module_registry import ModuleRegistry
from .state_manager import StateManager
from .jinja2_resolver import Jinja2Resolver as ParameterResolver
from .execution_groups import ExecutionGroupsProcessor, process_execution_groups

__all__ = [
    'Module',
    'ModuleInput',
    'ModuleOutput',
    'ModuleExecutionError',
    'ModuleRegistry',
    'StateManager',
    'ParameterResolver',
    'ExecutionGroupsProcessor',
    'process_execution_groups',
]
