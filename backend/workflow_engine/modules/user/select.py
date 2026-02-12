"""
Unified Select Module - Schema-based selection from any data structure

This module handles all selection scenarios using JSON Schema with display hints:
- Flat list selection (single or multi)
- Nested parent->child selection
- Object key selection
- Review/approval mode with retry

The schema defines:
- Structure (standard JSON Schema)
- Display hints (display, display_label)
- Selectability (selectable: true on arrays/objects that can be selected from)

Addons can enhance selections with additional metadata (colors, scores, etc.):
- addons.usage_history: Track when options were last used
- addons.compatibility: Calculate tag-based compatibility scores

Server sends raw data + schema + _metadata to clients.
Clients display according to schema, render decorators from _metadata, return indices only.
Workflow uses indices to access original raw data.
"""

import uuid6
from typing import Dict, Any, List, Optional
from ...engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse, SelectOption
)
from ..addons.processor import AddonProcessor


class SelectModule(InteractiveModule):
    """
    Unified selection module using JSON Schema with display hints.

    Inputs:
        - data: Raw data to select from
        - schema: JSON Schema with display hints
        - prompt: Prompt text for user
        - multi_select: Allow multiple selections (default: false)
        - mode: "select" (default) or "review" (shows all, allows retry)

    Addons (configured in step.json, not as inputs):
        - addons.usage_history: Track option usage
        - addons.compatibility: Show tag-based compatibility

    Outputs:
        - selected_indices: Array of indices/keys representing selection
          Examples:
          - [0, 2] for selecting items 0 and 2 from flat array
          - ["sora", "midjourney"] for selecting keys from object
          - [["planned", 0], ["detected", 1]] for multi-source selection
          - [0, 1] for nested [parent_idx, child_idx]
    """

    def __init__(self):
        super().__init__()
        self._addon_processor: Optional[AddonProcessor] = None  # Set by workflow processor

    @property
    def module_id(self) -> str:
        return "user.select"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="data",
                type="object",
                required=True,
                description="Raw data to select from (object or array)"
            ),
            ModuleInput(
                name="schema",
                type="object",
                required=True,
                description="JSON Schema with display hints (display, display_label, selectable)"
            ),
            ModuleInput(
                name="prompt",
                type="string",
                required=False,
                default="Make a selection",
                description="Prompt text for user"
            ),
            ModuleInput(
                name="multi_select",
                type="boolean",
                required=False,
                default=False,
                description="Allow multiple selections"
            ),
            ModuleInput(
                name="mode",
                type="string",
                required=False,
                default="select",
                description="Mode: 'select' for selection, 'review' for review with retry option"
            ),
            ModuleInput(
                name="min_selections",
                type="integer",
                required=False,
                default=1,
                description="Minimum number of selections required"
            ),
            ModuleInput(
                name="max_selections",
                type="integer",
                required=False,
                default=None,
                description="Maximum number of selections allowed (None = unlimited for multi_select)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="selected_indices",
                type="array",
                description="Selection indices/keys - use to access original data"
            ),
            ModuleOutput(
                name="selected_data",
                type="array",
                description="The actual selected items (with all fields including tags)"
            ),
            ModuleOutput(
                name="retry_requested",
                type="boolean",
                description="Whether retry was requested (review mode)"
            ),
            ModuleOutput(
                name="retry_feedback",
                type="string",
                description="Feedback text for retry"
            ),
            ModuleOutput(
                name="retry_groups",
                type="array",
                description="Groups selected for retry (review mode)"
            ),
            ModuleOutput(
                name="jump_back_requested",
                type="boolean",
                description="Whether jump back was requested"
            ),
            ModuleOutput(
                name="jump_back_target",
                type="string",
                description="Target for jump back"
            )
        ]

    def set_addon_processor(self, processor: AddonProcessor) -> None:
        """Set addon processor. Called by workflow processor."""
        self._addon_processor = processor

    def requires_interaction(self) -> bool:
        return True

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context
    ) -> Optional[InteractionRequest]:
        """Build interaction request with schema for TUI to render."""
        data = inputs['data']
        schema = inputs['schema']
        prompt = self.get_input_value(inputs, 'prompt')
        multi_select = self.get_input_value(inputs, 'multi_select')
        mode = self.get_input_value(inputs, 'mode')
        min_selections = self.get_input_value(inputs, 'min_selections')
        max_selections = self.get_input_value(inputs, 'max_selections')

        # Get retryable and sub_actions config from context (set by workflow processor)
        retryable = getattr(context, 'retryable', None)
        sub_actions = getattr(context, 'sub_actions', None)

        # Process addons and embed _metadata into items
        if self._addon_processor:
            items = self._get_item_references(data, schema)
            if items:
                self._addon_processor.process_items(items)

        # Determine interaction type based on mode
        if mode == "review":
            interaction_type = InteractionType.REVIEW_GROUPED
        else:
            interaction_type = InteractionType.SELECT_FROM_STRUCTURED

        # Determine effective max_selections (-1 means unlimited)
        effective_max = max_selections
        if effective_max is None:
            effective_max = -1 if multi_select else 1

        return InteractionRequest(
            interaction_type=interaction_type,
            interaction_id=f"select_{uuid6.uuid7().hex}",
            title=prompt,
            options=[],  # TUI will build options from data + schema
            extra_options=[],
            min_selections=min_selections,
            max_selections=effective_max,
            display_data={
                "data": data,
                "schema": schema,
                "multi_select": multi_select,
                "mode": mode,
                "retryable": retryable,
                "sub_actions": sub_actions
            },
            context={
                "module_id": self.module_id
            }
        )

    def _get_item_references(
        self,
        data: Any,
        schema: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Get references to actual data items for addon processing.

        Returns references (not copies) so addons can embed _metadata directly.
        Only includes dict items since addons need fields like 'tags', 'label', etc.
        """
        refs = []
        schema_type = schema.get('type')

        if schema_type == 'array':
            # Root is array - items are direct elements
            if isinstance(data, list):
                for item in data:
                    if isinstance(item, dict):
                        refs.append(item)

        elif schema_type == 'object':
            properties = schema.get('properties', {})
            additional_props = schema.get('additionalProperties', {})
            is_root_selectable = schema.get('selectable', False)

            # Object with dynamic keys (additionalProperties)
            if is_root_selectable and additional_props and isinstance(data, dict):
                for key, item_data in data.items():
                    if isinstance(item_data, dict):
                        refs.append(item_data)

            # Check properties for selectable arrays
            for key, prop_schema in properties.items():
                if prop_schema.get('type') == 'array' and prop_schema.get('selectable'):
                    array_data = data.get(key, []) if isinstance(data, dict) else []
                    for item in array_data:
                        if isinstance(item, dict):
                            refs.append(item)

        return refs

    def _flatten_selection_indices(self, selected_indices: List) -> List[int]:
        """
        Convert selection indices to flat item indices.

        Handles both [0, 1] and [[0], [1]] formats for flat arrays,
        and nested [key, index] format for object structures.
        """
        flat_indices = []
        for idx in selected_indices:
            if isinstance(idx, list):
                # Nested index - take first element for flat item lookup
                flat_indices.append(idx[0] if idx else 0)
            elif isinstance(idx, int):
                flat_indices.append(idx)
        return flat_indices

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """Process selection response - just return indices."""
        # Handle cancellation
        if response.cancelled:
            raise ModuleExecutionError(
                self.module_id,
                "User cancelled selection",
                None
            )

        # Handle jump back
        if response.jump_back_requested:
            return {
                "selected_indices": [],
                "retry_requested": False,
                "retry_feedback": "",
                "retry_groups": [],
                "jump_back_requested": True,
                "jump_back_target": response.jump_back_target
            }

        # Handle retry (review mode)
        if response.retry_requested:
            return {
                "selected_indices": [],
                "retry_requested": True,
                "retry_feedback": response.retry_feedback or "",
                "retry_groups": response.retry_groups or [],
                "jump_back_requested": False,
                "jump_back_target": ""
            }

        # Get indices from response
        selected_indices = response.selected_indices or []

        # Also check for indices in selected_options metadata (fallback)
        if not selected_indices and response.selected_options:
            for opt in response.selected_options:
                if isinstance(opt, dict):
                    idx = opt.get('metadata', {}).get('indices')
                    if idx:
                        selected_indices = idx if isinstance(idx, list) else [idx]
                        break
                    idx = opt.get('metadata', {}).get('_index')
                    if idx is not None:
                        selected_indices = [idx] if isinstance(idx, int) else idx
                        break

        # Run addon on_selection callbacks
        data = inputs.get('data')
        schema = inputs.get('schema', {})
        if self._addon_processor and data and schema:
            items = self._get_item_references(data, schema)
            if items:
                # Convert indices to flat item indices
                flat_indices = self._flatten_selection_indices(selected_indices)
                self._addon_processor.call_on_selection(flat_indices, items)

        # Extract selected data from indices
        multi_select = self.get_input_value(inputs, 'multi_select')
        selected_data = self._extract_selected_data(data, schema, selected_indices, multi_select)

        if hasattr(context, 'logger'):
            context.logger.debug(f"Selection indices: {selected_indices}")

        return {
            "selected_indices": selected_indices,
            "selected_data": selected_data,
            "retry_requested": False,
            "retry_feedback": "",
            "retry_groups": [],
            "jump_back_requested": False,
            "jump_back_target": ""
        }

    def _extract_selected_data(
        self,
        data: Any,
        schema: Dict[str, Any],
        selected_indices: List,
        multi_select: bool = True
    ) -> Any:
        """
        Extract the actual selected items from data based on indices.

        Args:
            data: The original data (array or object)
            schema: JSON Schema describing the data structure
            selected_indices: List of indices/keys from user selection
            multi_select: If False and single item selected, return object instead of array

        Returns:
            For multi_select=True: List of selected item dicts
            For multi_select=False with single selection: Single item dict
        """
        if not selected_indices or not data:
            return [] if multi_select else None

        schema_type = schema.get('type')

        # Normalize indices format for single-select
        # WebUI may send unwrapped path ["key", 0] instead of [["key", 0]]
        # Detect and wrap if needed for consistent processing
        normalized_indices = self._normalize_indices(selected_indices, multi_select)

        # Dispatch to appropriate extractor based on schema type
        if schema_type == 'array' and isinstance(data, list):
            selected_items = self._extract_from_array(data, normalized_indices)
        elif schema_type == 'object' and isinstance(data, dict):
            selected_items = self._extract_from_object(data, normalized_indices)
        else:
            selected_items = []

        # For single-select, return single object instead of array
        if not multi_select and len(selected_items) == 1:
            return selected_items[0]

        return selected_items

    def _normalize_indices(
        self,
        selected_indices: List,
        multi_select: bool
    ) -> List:
        """
        Normalize selected_indices to consistent format.

        For single-select, WebUI may send an unwrapped path like ["key", 0]
        instead of [["key", 0]]. This detects and wraps such cases.

        Detection logic for unwrapped path:
        - multi_select is False
        - First element is a string (indicating a key, not a wrapped path)
        - Has 2+ elements (a path, not a single key selection)

        Args:
            selected_indices: Raw indices from client
            multi_select: Whether multi-select mode is enabled

        Returns:
            Normalized indices as list of selections
        """
        if not selected_indices:
            return selected_indices

        # For multi-select, indices should already be properly formatted
        if multi_select:
            return selected_indices

        # For single-select, check if indices look like an unwrapped path
        # Unwrapped path: ["key", 0] or ["key", 0, "nested", 1]
        # Wrapped path: [["key", 0]] or [0]
        first_element = selected_indices[0]

        # If first element is a string and we have 2+ elements, it's an unwrapped path
        # e.g., ["text_sets", 1] should become [["text_sets", 1]]
        if isinstance(first_element, str) and len(selected_indices) >= 2:
            return [selected_indices]

        return selected_indices

    def _extract_from_array(self, data: List, selected_indices: List) -> List:
        """
        Extract items from array data based on indices.

        Args:
            data: Source array
            selected_indices: List of indices (can be [idx] or idx format)

        Returns:
            List of selected items with _addon fields removed
        """
        selected_items = []

        for idx in selected_indices:
            # Handle both [idx] and idx formats
            actual_idx = idx[0] if isinstance(idx, list) else idx

            if isinstance(actual_idx, int) and 0 <= actual_idx < len(data):
                item = self._clean_item(data[actual_idx])
                selected_items.append(item)

        return selected_items

    def _extract_from_object(self, data: Dict, selected_indices: List) -> List:
        """
        Extract items from object data based on keys or nested paths.

        Args:
            data: Source object/dict
            selected_indices: List of keys (str) or nested paths ([key, idx])

        Returns:
            List of selected items with _addon fields removed
        """
        selected_items = []

        for idx in selected_indices:
            item = self._extract_object_item(data, idx)
            if item is not None:
                selected_items.append(item)

        return selected_items

    def _extract_object_item(self, data: Dict, idx: Any) -> Any:
        """
        Extract a single item from object data.

        Args:
            data: Source object/dict
            idx: Key (str) or nested path ([key, sub_idx])

        Returns:
            Cleaned item or None if not found
        """
        if isinstance(idx, str):
            # Direct key selection
            if idx in data:
                return self._clean_item(data[idx])
        elif isinstance(idx, list) and len(idx) >= 2:
            # Nested selection [key, index]
            key, sub_idx = idx[0], idx[1]
            if key in data and isinstance(data[key], list):
                if 0 <= sub_idx < len(data[key]):
                    return self._clean_item(data[key][sub_idx])
        return None

    def _clean_item(self, item: Any) -> Any:
        """
        Remove internal _metadata field from item if present.

        Args:
            item: Item to clean

        Returns:
            Item with _metadata removed (if dict), otherwise unchanged
        """
        if isinstance(item, dict):
            return {k: v for k, v in item.items() if k != '_metadata'}
        return item
