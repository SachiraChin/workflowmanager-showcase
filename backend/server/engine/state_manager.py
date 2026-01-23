"""
State Manager - Centralized workflow state storage
"""

import json
import os
from typing import Dict, Any, Optional


class StateManager:
    """
    Manages workflow state with persistence support.

    State is stored in memory and optionally persisted to disk as JSON.
    Provides centralized storage for:
    - Workflow variables
    - Step outputs
    - Module outputs within steps
    """

    def __init__(self, storage_path: Optional[str] = None):
        """
        Initialize state manager

        Args:
            storage_path: Optional path to persist state as JSON
        """
        self.state: Dict[str, Any] = {}
        self.step_outputs: Dict[str, Dict[str, Any]] = {}
        self.storage_path = storage_path
        self.current_step_id: Optional[str] = None  # Track which step is currently executing
        self.state_step_mapping: Dict[str, str] = {}  # Maps state key -> step_id that created it
        self._step_config: Dict[str, Any] = {}  # Current step's configuration for $step references

        # Load from disk if exists
        if storage_path and os.path.exists(storage_path):
            self.load_from_disk()

    def set(self, key: str, value: Any) -> None:
        """
        Set a state variable

        Args:
            key: Variable name
            value: Variable value
        """
        self.state[key] = value
        # Track which step created this state variable
        if self.current_step_id is not None:
            self.state_step_mapping[key] = self.current_step_id

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a state variable

        Args:
            key: Variable name
            default: Default value if key doesn't exist

        Returns:
            Variable value or default
        """
        return self.state.get(key, default)

    def has(self, key: str) -> bool:
        """
        Check if state variable exists

        Args:
            key: Variable name

        Returns:
            True if variable exists
        """
        return key in self.state

    def delete(self, key: str) -> None:
        """
        Delete a state variable

        Args:
            key: Variable name
        """
        if key in self.state:
            del self.state[key]
        if key in self.state_step_mapping:
            del self.state_step_mapping[key]

    def set_current_step(self, step_id: str) -> None:
        """
        Set the current step ID for tracking which step creates state variables

        Args:
            step_id: Current step identifier
        """
        self.current_step_id = step_id

    def set_step_config(self, step_config: Dict[str, Any]) -> None:
        """
        Set current step configuration for $step references

        Args:
            step_config: Step configuration dictionary (the full step object)
        """
        self._step_config = step_config or {}

    def get_step_config(self) -> Dict[str, Any]:
        """
        Get current step configuration for $step references

        Returns:
            Current step's configuration dictionary
        """
        return self._step_config

    def get_state_grouped_by_step(self) -> Dict[str, Dict[str, Any]]:
        """
        Get state variables grouped by the step that created them

        Returns:
            Dictionary mapping step_id -> {state variables}

        Raises:
            ValueError: If a state key has no step_id mapping
        """
        grouped = {}
        for key, value in self.state.items():
            if key.startswith('_'):
                continue  # Skip internal variables
            step_id = self.state_step_mapping.get(key)
            if not step_id:
                raise ValueError(
                    f"State key '{key}' has no step_id mapping - "
                    "this indicates a bug in state management"
                )
            if step_id not in grouped:
                grouped[step_id] = {}
            grouped[step_id][key] = value
        return grouped

    def save_step_output(self, step_id: str, data: Dict[str, Any]) -> None:
        """
        Save output data for a step

        Args:
            step_id: Step identifier
            data: Output data dictionary
        """
        self.step_outputs[step_id] = data
        if self.storage_path:
            self.persist_to_disk()

    def get_step_output(self, step_id: str) -> Dict[str, Any]:
        """
        Get output data for a step

        Args:
            step_id: Step identifier

        Returns:
            Step output dictionary (empty dict if not found)
        """
        return self.step_outputs.get(step_id, {})

    def has_step_output(self, step_id: str) -> bool:
        """
        Check if step output exists

        Args:
            step_id: Step identifier

        Returns:
            True if step has output
        """
        return step_id in self.step_outputs

    def get_all_state(self) -> Dict[str, Any]:
        """
        Get all state variables

        Returns:
            Dictionary of all state variables
        """
        return self.state.copy()

    def get_all_step_outputs(self) -> Dict[str, Dict[str, Any]]:
        """
        Get all step outputs

        Returns:
            Dictionary mapping step IDs to their outputs
        """
        return self.step_outputs.copy()

    def persist_to_disk(self) -> None:
        """
        Save state to disk as JSON

        Raises:
            IOError: If save fails
        """
        if not self.storage_path:
            return

        data = {
            'state': self.state,
            'step_outputs': self.step_outputs
        }

        # Create directory if needed
        os.makedirs(os.path.dirname(self.storage_path), exist_ok=True)

        with open(self.storage_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def load_from_disk(self) -> None:
        """
        Load state from disk JSON

        Raises:
            IOError: If load fails
        """
        if not self.storage_path or not os.path.exists(self.storage_path):
            return

        with open(self.storage_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        self.state = data.get('state', {})
        self.step_outputs = data.get('step_outputs', {})

    def clear(self) -> None:
        """Clear all state and step outputs"""
        self.state.clear()
        self.step_outputs.clear()
