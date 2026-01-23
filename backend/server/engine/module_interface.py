"""
Module Interface - Base classes for modular workflow system

This module contains:
1. Re-exports of shared contracts (for backward compatibility)
2. Server-side module base classes (ModuleBase, ExecutableModule, InteractiveModule)
3. Module I/O definitions (ModuleInput, ModuleOutput)
4. Module execution error

The shared contracts (InteractionType, InteractionRequest, etc.) are now
defined in contracts/ and re-exported here for backward compatibility.

🚨 CRITICAL: When creating new modules that inherit from Module 🚨

ALL modules must be 100% GENERIC and reusable across ANY workflow type.

NEVER hardcode workflow-specific values in your module:
  ❌ NO hardcoded field names in code
  ❌ NO hardcoded data structure assumptions
  ❌ NO workflow-specific logic

✅ ALWAYS make modules configurable:
  - Field names → Module inputs (configurable via workflow JSON)
  - Data keys → Module inputs (configurable via workflow JSON)
  - Groups/categories → Retrieved from inputs or state
  - Display fields → Passed as arrays in inputs

See DESIGN_PRINCIPLES.md for full guidelines.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

# Re-export shared contracts for backward compatibility
# New code should import directly from contracts/
import sys
import os

# Add parent directory to path for contracts import
_script_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

from contracts import (
    # Interactions
    InteractionType,
    SelectOption,
    InteractionRequest,
    InteractionResponse,
    # Events
    EventType,
    MessageLevel,
    WorkflowEvent,
)


# =============================================================================
# Server-side Module Definitions (not shared with clients)
# =============================================================================

@dataclass
class ModuleInput:
    """Defines a single input parameter for a module"""
    name: str
    type: str  # 'string', 'number', 'object', 'array', 'boolean', etc.
    required: bool = True
    default: Any = None
    description: str = ""


@dataclass
class ModuleOutput:
    """Defines a single output value from a module"""
    name: str
    type: str
    description: str = ""


class ModuleBase(ABC):
    """
    Base class for all workflow modules.

    Modules are stateless, reusable components that:
    - Declare their input/output contracts
    - Execute a single, well-defined task
    - Can be chained together via parameter passing

    Subclasses:
    - ExecutableModule: For non-interactive modules (API calls, IO, display, etc.)
    - InteractiveModule: For modules requiring user interaction (select, confirm, text input)
    """

    @property
    @abstractmethod
    def module_id(self) -> str:
        """
        Unique module identifier (e.g., 'user.text_input', 'api.call')

        Returns:
            str: Dot-separated module ID
        """
        pass

    @property
    @abstractmethod
    def inputs(self) -> List[ModuleInput]:
        """
        Define input contract - what parameters this module expects

        Returns:
            List[ModuleInput]: List of input definitions
        """
        pass

    @property
    @abstractmethod
    def outputs(self) -> List[ModuleOutput]:
        """
        Define output contract - what values this module produces

        Returns:
            List[ModuleOutput]: List of output definitions
        """
        pass

    def validate_inputs(self, inputs: Dict[str, Any]) -> tuple[bool, Optional[str]]:
        """
        Validate that provided inputs match the contract

        Args:
            inputs: Dictionary of input parameters to validate

        Returns:
            Tuple of (is_valid, error_message)
        """
        # Check required inputs
        for input_def in self.inputs:
            if input_def.required and input_def.name not in inputs:
                return False, f"Required input '{input_def.name}' missing"

        return True, None

    def get_input_value(self, inputs: Dict[str, Any], name: str) -> Any:
        """
        Get input value with fallback to default

        Args:
            inputs: Dictionary of input parameters
            name: Name of input to get

        Returns:
            Input value or default if not provided
        """
        input_def = next((i for i in self.inputs if i.name == name), None)
        if input_def:
            return inputs.get(name, input_def.default)
        return inputs.get(name)


class ExecutableModule(ModuleBase):
    """
    Base class for non-interactive modules.

    These modules execute synchronously without user input.
    Examples: API calls, file IO, display, data transformation, history management.

    Subclasses must implement execute().
    """

    @abstractmethod
    def execute(self, inputs: Dict[str, Any], context: 'ExecutionContext') -> Dict[str, Any]:
        """
        Execute the module's logic.

        Args:
            inputs: Dictionary of input parameters (already resolved and validated)
            context: Execution context providing access to logger, state, services

        Returns:
            Dictionary mapping output names to their values

        Raises:
            ModuleExecutionError: If execution fails
        """
        pass


class InteractiveModule(ModuleBase):
    """
    Base class for modules requiring user interaction.

    These modules pause execution to collect user input via the UI.
    Examples: text input, confirmation, selection from list, review prompts.

    Subclasses must implement get_interaction_request() and execute_with_response().
    """

    @abstractmethod
    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context: 'ExecutionContext'
    ) -> Optional[InteractionRequest]:
        """
        Build the interaction request for the UI.

        Called by workflow manager to get all information needed to render the UI.

        Args:
            inputs: Dictionary of input parameters (already resolved and validated)
            context: Execution context

        Returns:
            InteractionRequest with all display/input information
        """
        pass

    @abstractmethod
    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context: 'ExecutionContext',
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """
        Execute the module with user's response.

        Called after the UI has collected user input.

        Args:
            inputs: Dictionary of input parameters
            context: Execution context
            response: User's response to the interaction request

        Returns:
            Dictionary mapping output names to their values

        Raises:
            ModuleExecutionError: If execution fails
        """
        pass


# Backward compatibility alias
Module = ModuleBase


class ModuleExecutionError(Exception):
    """Raised when module execution fails"""

    def __init__(self, module_id: str, message: str, original_error: Exception = None):
        self.module_id = module_id
        self.original_error = original_error
        super().__init__(f"Module '{module_id}' failed: {message}")
