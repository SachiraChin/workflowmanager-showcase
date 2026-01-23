"""
Addons - Pluggable enhancements for selection modules.

Addons add metadata to selection options (colors, scores, timestamps, etc.)
without modifying core module logic.

Usage in step.json:
    {
        "module_id": "user.select",
        "inputs": {...},
        "addons": [
            {
                "addon_id": "addons.usage_history",
                "inputs": {
                    "track_key_format": "{label}",
                    "colors": [
                        {"max_hours": 24, "color": "#FF00FF"},
                        {"max_hours": 72, "color": "#FFFF00"},
                        {"color": "#00FF00"}
                    ]
                }
            },
            {
                "addon_id": "addons.compatibility",
                "inputs": {
                    "source": "{{ state.previous_selections }}",
                    "colors": [
                        {"min": 80, "color": "#00FF00"},
                        {"min": 60, "color": "#00FFFF"},
                        {"min": 40, "color": "#FFFF00"},
                        {"color": "#808080"}
                    ]
                }
            }
        ]
    }

Each addon:
- Receives list of options/items and context
- Returns dict mapping item index -> addon data
- Addon data includes raw values + computed color

Processing order: last addon wins for color (but all data is preserved).
"""

from .base import Addon, AddonRegistry
from .usage_history import UsageHistoryAddon
from .compatibility import CompatibilityAddon

__all__ = [
    'Addon',
    'AddonRegistry',
    'UsageHistoryAddon',
    'CompatibilityAddon',
]
