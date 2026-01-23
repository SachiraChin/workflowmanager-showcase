"""
Usage History Addon

Tracks when options were last selected and applies time-based colors.
Helps users avoid recently used options for variety.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional

from .base import Addon, AddonRegistry, AddonResult


# Conversion factors to hours
UNIT_TO_HOURS = {
    'minute': 1 / 60,
    'minutes': 1 / 60,
    'hour': 1,
    'hours': 1,
    'day': 24,
    'days': 24,
    'week': 24 * 7,
    'weeks': 24 * 7,
    'month': 24 * 30,
    'months': 24 * 30,
}


@AddonRegistry.register
class UsageHistoryAddon(Addon):
    """
    Addon that tracks and displays usage history for selection options.

    Inputs:
        track_key_format: Format string for option key (e.g., '{label}', '{id}')
        colors: List of time-based color rules with explicit min/max ranges:
            [
                {'max': 12, 'unit': 'hour', 'color': '#9AA1A4'},   # 0-12 hours
                {'min': 12, 'max': 24, 'unit': 'hour', 'color': '#BFC5C8'},  # 12-24 hours
                {'min': 1, 'max': 2, 'unit': 'day', 'color': '#D9E7D0'},  # 1-2 days
                {'min': 2, 'unit': 'day', 'color': '#7CFFB2'}   # 2+ days (no max = infinity)
            ]

        Supported units: minute, hour, day, week, month

    Output per item:
        {
            'last_used': '2025-12-05T10:30:00' or None,
            'color': '#FF00FF' or None
        }
    """

    @property
    def addon_id(self) -> str:
        return "addons.usage_history"

    def process(
        self,
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any,
        priority: int = 0
    ) -> Dict[int, AddonResult]:
        """Load usage history, compute colors, and generate decorators for each item."""
        result = {}

        track_key_format = inputs.get('track_key_format', '{label}')
        colors = inputs.get('colors', [])

        # Get context values
        step_id = getattr(context, 'step_id', None)
        module_name = getattr(context, 'current_module_name', None)
        db = getattr(context, 'db', None)
        workflow_template_name = getattr(context, 'workflow_template_name', None)
        user_id = getattr(context, 'user_id', None)

        if not step_id:
            raise ValueError("UsageHistoryAddon: context.step_id is required")
        if not db:
            raise ValueError("UsageHistoryAddon: context.db is required")
        if not workflow_template_name:
            raise ValueError("UsageHistoryAddon: context.workflow_template_name is required")
        if not user_id:
            raise ValueError("UsageHistoryAddon: context.user_id is required")

        # Load usage history from DB
        usage_history = db.get_option_usage(workflow_template_name, step_id, module_name, user_id)

        for idx, item in enumerate(items):
            option_key = self._get_option_key(item, track_key_format)
            last_used = usage_history.get(option_key)

            if last_used:
                hours_ago = self._get_hours_ago(last_used)
                color = self._get_color_for_hours(hours_ago, colors)
                time_ago_text = self._format_time_ago(last_used)

                data = {'last_used': last_used, 'color': color}
                decorators = [
                    {'type': 'border', 'color': color, 'priority': priority, 'source': 'usage_history'},
                    {'type': 'swatch', 'color': color, 'priority': priority, 'source': 'usage_history'},
                ]
                if time_ago_text:
                    decorators.append({
                        'type': 'badge', 'text': time_ago_text, 'priority': priority, 'source': 'usage_history'
                    })
                result[idx] = AddonResult(data=data, decorators=decorators)
            else:
                # Never used - get default color (rule with only 'min' or no bounds)
                default_color = self._get_never_used_color(colors)
                data = {'last_used': None, 'color': default_color}
                decorators = []
                if default_color:
                    decorators = [
                        {'type': 'border', 'color': default_color, 'priority': priority, 'source': 'usage_history'},
                        {'type': 'swatch', 'color': default_color, 'priority': priority, 'source': 'usage_history'},
                    ]
                result[idx] = AddonResult(data=data, decorators=decorators)

        return result

    def _get_color_for_hours(self, hours: float, colors: List[Dict[str, Any]]) -> Optional[str]:
        """
        Get color for a given number of hours ago.

        Supports both new format (min/max/unit) and legacy format (max_hours).
        """
        if not colors or hours is None:
            return None

        for rule in colors:
            color = rule.get('color')

            # New format: min/max with unit
            if 'unit' in rule:
                unit = rule['unit']
                multiplier = UNIT_TO_HOURS.get(unit, 1)

                min_val = rule.get('min')
                max_val = rule.get('max')

                min_hours = min_val * multiplier if min_val is not None else None
                max_hours = max_val * multiplier if max_val is not None else None

                # Check if hours falls within range
                in_range = True
                if min_hours is not None and hours < min_hours:
                    in_range = False
                if max_hours is not None and hours >= max_hours:
                    in_range = False

                if in_range:
                    return color

            # Legacy format: max_hours only
            elif 'max_hours' in rule:
                if hours <= rule['max_hours']:
                    return color

            # Default/fallback rule (no threshold)
            elif color:
                return color

        return None

    def _get_never_used_color(self, colors: List[Dict[str, Any]]) -> Optional[str]:
        """Get color for items that have never been used (oldest category)."""
        if not colors:
            return None

        # Find rule with highest min value or no bounds (the "oldest" category)
        # Or a rule that only has 'min' without 'max' (infinity)
        best_color = None
        best_min_hours = -1

        for rule in colors:
            color = rule.get('color')

            if 'unit' in rule:
                unit = rule['unit']
                multiplier = UNIT_TO_HOURS.get(unit, 1)
                min_val = rule.get('min')
                max_val = rule.get('max')

                # Rule with min but no max = oldest category
                if min_val is not None and max_val is None:
                    min_hours = min_val * multiplier
                    if min_hours > best_min_hours:
                        best_min_hours = min_hours
                        best_color = color

            # Legacy: rule without max_hours is fallback
            elif 'max_hours' not in rule and color:
                return color

        return best_color

    def on_selection(
        self,
        selected_indices: List[int],
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any
    ) -> None:
        """Save usage timestamp for selected items."""
        track_key_format = inputs.get('track_key_format', '{label}')

        step_id = getattr(context, 'step_id', None)
        module_name = getattr(context, 'current_module_name', None)
        db = getattr(context, 'db', None)
        workflow_template_name = getattr(context, 'workflow_template_name', None)
        user_id = getattr(context, 'user_id', None)

        if not step_id:
            raise ValueError("UsageHistoryAddon.on_selection: context.step_id is required")
        if not db:
            raise ValueError("UsageHistoryAddon.on_selection: context.db is required")
        if not workflow_template_name:
            raise ValueError("UsageHistoryAddon.on_selection: context.workflow_template_name is required")
        if not user_id:
            raise ValueError("UsageHistoryAddon.on_selection: context.user_id is required")

        now = datetime.now().isoformat()

        for idx in selected_indices:
            if idx < len(items):
                item = items[idx]
                option_key = self._get_option_key(item, track_key_format)
                db.update_option_usage(workflow_template_name, step_id, module_name, option_key, now, user_id)

    def _get_option_key(self, item: Dict[str, Any], key_format: str) -> str:
        """Extract key from item using format string."""
        if not isinstance(item, dict):
            return str(item)

        key = key_format
        for field, value in item.items():
            placeholder = f'{{{field}}}'
            if placeholder in key:
                key = key.replace(placeholder, str(value))
        return key

    def _get_hours_ago(self, timestamp_str: str) -> Optional[float]:
        """Calculate hours since timestamp."""
        if not timestamp_str:
            return None

        try:
            timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            now = datetime.now(timestamp.tzinfo) if timestamp.tzinfo else datetime.now()
            delta = now - timestamp
            return delta.total_seconds() / 3600
        except:
            return None

    def _format_time_ago(self, timestamp_str: str) -> Optional[str]:
        """Convert ISO timestamp to human-readable relative time string."""
        if not timestamp_str:
            return None

        try:
            timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            now = datetime.now(timestamp.tzinfo) if timestamp.tzinfo else datetime.now()
            delta = now - timestamp

            if delta.days > 30:
                months = delta.days // 30
                return f"{months}mo ago"
            elif delta.days > 0:
                return f"{delta.days}d ago"
            elif delta.seconds > 3600:
                hours = delta.seconds // 3600
                return f"{hours}h ago"
            elif delta.seconds > 60:
                minutes = delta.seconds // 60
                return f"{minutes}m ago"
            else:
                return "just now"
        except:
            return None
