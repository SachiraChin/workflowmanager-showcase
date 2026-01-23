"""
AddonProcessor - Centralized addon processing.

Handles all addon iteration logic in one place, allowing any module to use
addons with a single method call.
"""

from typing import Dict, Any, List

# Import the full package to ensure all addons are registered
from . import AddonRegistry
from .base import AddonResult


class AddonProcessor:
    """
    Centralized addon processing.

    Processes all configured addons and embeds results into items.
    Each item gets _metadata.addons (per-addon data) and _metadata.decorators
    (combined decorator list for rendering).

    Usage:
        processor = AddonProcessor(addon_configs, context)
        processor.process_items(items)
        # items now have _metadata.addons and _metadata.decorators
    """

    def __init__(self, addon_configs: List[Dict[str, Any]], context: Any):
        """
        Initialize addon processor.

        Args:
            addon_configs: List of addon configs from step.json, e.g.:
                [
                    {"addon_id": "addons.usage_history", "priority": 10, "inputs": {...}},
                    {"addon_id": "addons.compatibility", "priority": 5, "inputs": {...}}
                ]
            context: Execution context (has db, workflow_template_name, step_id, etc.)
        """
        self.addon_configs = addon_configs or []
        self.context = context

    def process_items(self, items: List[Dict[str, Any]]) -> None:
        """
        Process all configured addons and embed results into items.

        Each item gets:
            item['_metadata'] = {
                'addons': {
                    'usage_history': {data from addon},
                    'compatibility': {data from addon}
                },
                'decorators': [
                    {type, color, priority, source},
                    ...
                ]
            }

        Args:
            items: List of item dicts. Modified in place.
        """
        if not self.addon_configs or not items:
            return

        for addon_config in self.addon_configs:
            addon_id = addon_config.get('addon_id')
            addon_inputs = addon_config.get('inputs', {})
            priority = addon_config.get('priority', 0)

            addon = AddonRegistry.create(addon_id)
            if not addon:
                continue

            try:
                results = addon.process(items, addon_inputs, self.context, priority=priority)

                if results:
                    for idx, addon_result in results.items():
                        if idx < len(items):
                            item = items[idx]
                            self._embed_result(item, addon_id, addon_result)

            except Exception as e:
                if hasattr(self.context, 'logger'):
                    self.context.logger.warning(f"Addon {addon_id} failed: {e}")

    def _embed_result(self, item: Dict, addon_id: str, addon_result: AddonResult) -> None:
        """
        Embed addon result into item's _metadata.

        Args:
            item: Item dict to modify
            addon_id: Full addon ID (e.g., "addons.usage_history")
            addon_result: AddonResult with data and decorators
        """
        if '_metadata' not in item:
            item['_metadata'] = {'addons': {}, 'decorators': []}

        # Ensure addons and decorators keys exist
        if 'addons' not in item['_metadata']:
            item['_metadata']['addons'] = {}
        if 'decorators' not in item['_metadata']:
            item['_metadata']['decorators'] = []

        # Merge addon data flat - later addons override earlier for same keys
        item['_metadata']['addons'].update(addon_result.data)

        # Collect decorators
        item['_metadata']['decorators'].extend(addon_result.decorators)

    def call_on_selection(
        self,
        selected_indices: List[int],
        items: List[Dict[str, Any]]
    ) -> None:
        """
        Call on_selection for all addons after user makes a selection.

        Args:
            selected_indices: Indices of selected items
            items: Original list of items
        """
        for addon_config in self.addon_configs:
            addon_id = addon_config.get('addon_id')
            addon_inputs = addon_config.get('inputs', {})

            addon = AddonRegistry.create(addon_id)
            if not addon:
                continue

            try:
                addon.on_selection(selected_indices, items, addon_inputs, self.context)
            except Exception as e:
                if hasattr(self.context, 'logger'):
                    self.context.logger.warning(f"Addon {addon_id} on_selection failed: {e}")
