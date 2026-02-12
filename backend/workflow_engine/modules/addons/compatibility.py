"""
Compatibility Addon

Calculates tag-based compatibility scores between options and previous selections.
Helps users choose options that match their earlier choices.
"""

from typing import Dict, Any, List, Optional

from .base import Addon, AddonRegistry, AddonResult


@AddonRegistry.register
class CompatibilityAddon(Addon):
    """
    Addon that calculates compatibility scores based on tag matching.

    Inputs:
        source: Reference to previous selections (e.g., '{{ state.previous_selections }}')
                This should be resolved by the module before passing to addon.
        colors: List of score-based color rules:
            [
                {'min': 95, 'color': '#00D7AF'},  # Excellent
                {'min': 85, 'color': '#00FF00'},  # Very high
                {'min': 60, 'color': '#00FFFF'},  # High
                {'min': 40, 'color': '#FFFF00'},  # Medium
                {'min': 20, 'color': '#808080'},  # Low
                {'color': '#808080'}               # Very low / default
            ]

    Output per item:
        {
            'score': 85.5,
            'color': '#00FF00'
        }
    """

    @property
    def addon_id(self) -> str:
        return "addons.compatibility"

    def process(
        self,
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any,
        priority: int = 0
    ) -> Dict[int, AddonResult]:
        """Calculate compatibility scores and generate decorators for each item."""
        result = {}

        # 'source' is already resolved to actual data by workflow_processor
        previous_selections = inputs.get('source', [])
        colors = inputs.get('colors', [])

        if not previous_selections:
            # No previous selections - return empty (no colors applied)
            return result

        # Aggregate tags from all previous selections
        aggregated_tags = self._aggregate_selected_tags(previous_selections)

        if not aggregated_tags:
            return result

        for idx, item in enumerate(items):
            if not isinstance(item, dict) or 'tags' not in item:
                continue

            score = self._calculate_tag_compatibility(aggregated_tags, item['tags'])
            color = self.get_color_for_value(score, colors, 'min')

            data = {'score': round(score, 1), 'color': color}
            decorators = [
                {'type': 'border', 'color': color, 'priority': priority, 'source': 'compatibility'},
                {'type': 'swatch', 'color': color, 'priority': priority, 'source': 'compatibility'},
                {'type': 'badge', 'text': f"{int(score)}% match", 'priority': priority, 'source': 'compatibility'}
            ]

            result[idx] = AddonResult(data=data, decorators=decorators)

        return result

    def _flatten_selections(self, selections: List) -> List[Dict]:
        """
        Flatten a mixed list of selections (arrays and single objects) into a flat list.
        Handles: [array_of_options, single_option, array_of_options, ...]
        """
        flattened = []
        for item in selections:
            if isinstance(item, list):
                flattened.extend(item)
            elif isinstance(item, dict):
                flattened.append(item)
        return flattened

    def _aggregate_selected_tags(self, selected_options: List) -> Dict[str, List[Dict]]:
        """
        Aggregate tags from multiple selected options.
        For each category, combine tags by taking the max value for each unique tag.
        """
        flat_options = self._flatten_selections(selected_options)

        aggregated = {}

        for option in flat_options:
            if not isinstance(option, dict) or 'tags' not in option:
                continue

            for category, tag_list in option['tags'].items():
                if category not in aggregated:
                    aggregated[category] = {}

                for tag_entry in tag_list:
                    tag_name = tag_entry['tag']
                    tag_value = tag_entry['value']

                    if tag_name not in aggregated[category]:
                        aggregated[category][tag_name] = tag_value
                    else:
                        aggregated[category][tag_name] = max(
                            aggregated[category][tag_name],
                            tag_value
                        )

        # Convert back to list format
        result = {}
        for category, tag_dict in aggregated.items():
            result[category] = [{'tag': k, 'value': v} for k, v in tag_dict.items()]

        return result

    def _calculate_tag_compatibility(
        self,
        source_tags: Dict[str, List[Dict]],
        target_tags: Dict[str, List[Dict]]
    ) -> float:
        """
        Calculate compatibility score between two tag sets using AVG method.

        For each category present in both source and target:
        1. Find matching tags (same tag name in both)
        2. Calculate match score as: min(source_value, target_value) for each matching tag
        3. Sum all match scores for the category
        4. Average across all categories

        Returns: float between 0-100 representing compatibility percentage
        """
        if not source_tags or not target_tags:
            return 0.0

        category_scores = []

        for category, source_tag_list in source_tags.items():
            if category not in target_tags:
                continue

            target_tag_list = target_tags[category]

            # Build lookup for target tags
            target_lookup = {t['tag']: t['value'] for t in target_tag_list}

            # Calculate match score for this category
            category_score = 0.0
            for source_tag in source_tag_list:
                tag_name = source_tag['tag']
                source_value = source_tag['value']

                if tag_name in target_lookup:
                    target_value = target_lookup[tag_name]
                    category_score += min(source_value, target_value)

            category_scores.append(category_score)

        if not category_scores:
            return 0.0

        return sum(category_scores) / len(category_scores)
