"""
Addon Base Class and Registry

Addons are pluggable enhancements that add metadata to selection options.
They run during get_interaction_request() and optionally during execute_with_response().

Each addon generates decorators that describe how to render visual enhancements
(borders, badges, swatches) without requiring client-side addon-specific knowledge.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional


@dataclass
class AddonResult:
    """
    Result from addon processing for a single item.

    Attributes:
        data: Raw addon data (e.g., {'last_used': '...', 'color': '#FF00FF'})
        decorators: List of decorator dicts describing visual enhancements
            Each decorator has: type, color/text, priority, source
    """
    data: Dict[str, Any] = field(default_factory=dict)
    decorators: List[Dict[str, Any]] = field(default_factory=list)


class Addon(ABC):
    """
    Base class for all addons.

    Addons enhance selection options with additional metadata (colors, scores, etc.)
    without modifying core module logic.
    """

    @property
    @abstractmethod
    def addon_id(self) -> str:
        """Unique identifier for this addon (e.g., 'addons.usage_history')"""
        pass

    @abstractmethod
    def process(
        self,
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any,
        priority: int = 0
    ) -> Dict[int, AddonResult]:
        """
        Process items and return addon results with data and decorators.

        Args:
            items: List of option/item dicts (with 'label', 'tags', etc.)
            inputs: Addon inputs from step.json config
            context: Execution context (has db, workflow_template_name, step_id, etc.)
            priority: Priority from addon config (default 0). Higher priority decorators
                win for single-instance types (border, swatch).

        Returns:
            Dict mapping item index -> AddonResult with data and decorators.

        Example return:
            {
                0: AddonResult(
                    data={'last_used': '2025-12-05T10:30:00', 'color': '#FF00FF'},
                    decorators=[
                        {'type': 'border', 'color': '#FF00FF', 'priority': 10, 'source': 'usage_history'},
                        {'type': 'badge', 'text': '2d ago', 'priority': 10, 'source': 'usage_history'}
                    ]
                ),
                1: AddonResult(
                    data={'score': 85.5, 'color': '#00FF00'},
                    decorators=[
                        {'type': 'badge', 'text': '85% match', 'priority': 5, 'source': 'compatibility'}
                    ]
                )
            }
        """
        pass

    def on_selection(
        self,
        selected_indices: List[int],
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any
    ) -> None:
        """
        Called after user makes a selection. Override to save data.

        Args:
            selected_indices: Indices of selected items
            items: Original list of items
            inputs: Addon inputs from step.json config
            context: Execution context
        """
        pass

    def get_color_for_value(
        self,
        value: Any,
        colors: List[Dict[str, Any]],
        value_key: str = 'min'
    ) -> Optional[str]:
        """
        Helper to get color from a threshold-based color config.

        Args:
            value: The value to match against thresholds
            colors: List of color rules, e.g.:
                [{'min': 80, 'color': '#00FF00'}, {'min': 60, 'color': '#FFFF00'}, ...]
                or
                [{'max_hours': 24, 'color': '#FF00FF'}, {'max_hours': 72, 'color': '#FFFF00'}, ...]
            value_key: Key to check ('min' for >= threshold, 'max_hours' for <= threshold)

        Returns:
            HEX color string or None
        """
        if not colors or value is None:
            return None

        for rule in colors:
            color = rule.get('color')

            if 'min' in rule:
                # Score-based: value >= min
                if value >= rule['min']:
                    return color
            elif 'max_hours' in rule:
                # Time-based: value <= max_hours
                if value <= rule['max_hours']:
                    return color
            elif color:
                # Default/fallback rule (no threshold)
                return color

        return None


class AddonRegistry:
    """Registry for addon classes."""

    _addons: Dict[str, type] = {}

    @classmethod
    def register(cls, addon_class: type) -> type:
        """Register an addon class. Can be used as decorator."""
        instance = addon_class()
        cls._addons[instance.addon_id] = addon_class
        return addon_class

    @classmethod
    def get(cls, addon_id: str) -> Optional[type]:
        """Get addon class by ID."""
        return cls._addons.get(addon_id)

    @classmethod
    def create(cls, addon_id: str) -> Optional[Addon]:
        """Create addon instance by ID."""
        addon_class = cls.get(addon_id)
        if addon_class:
            return addon_class()
        return None

    @classmethod
    def list_addons(cls) -> List[str]:
        """List all registered addon IDs."""
        return list(cls._addons.keys())
