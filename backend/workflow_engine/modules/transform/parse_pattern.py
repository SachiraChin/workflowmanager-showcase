"""
Parse Pattern Transform Module - Parse structured text input using configurable patterns

A generic module for parsing text input with regex patterns, lookups, mappings, and computed fields.
"""

import re
import math
from typing import Dict, Any, List, Optional, Union
from ...engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError

# Try to import simpleeval for safe expression evaluation
try:
    from simpleeval import simple_eval, EvalWithCompoundTypes
    SIMPLEEVAL_AVAILABLE = True
except ImportError:
    SIMPLEEVAL_AVAILABLE = False


class ParsePatternModule(ExecutableModule):
    """
    Module that parses structured text input using configurable patterns.

    Supports:
    - Regex-based parsing with named groups
    - Multi-value input with configurable separator
    - Type casting (int, float, bool, string)
    - Value lookups from external data
    - Value mappings (e.g., 'p' -> 'with_person')
    - Computed fields using safe expressions (simpleeval)
    - Validation rules

    Inputs:
        - input: Raw input string to parse
        - pattern: Pattern configuration object
            - regex: Regex pattern with named groups
            - separator: Multi-value separator (optional)
            - trim: Trim whitespace (default: true)
        - field_types: Type casting per field (optional)
        - lookups: Lookup configurations per field (optional)
        - mappings: Value mappings per field (optional)
        - computed: Array of computed field definitions (optional)
        - validation: Validation rules per field (optional)
        - sum_field: Field name to sum for total (optional)

    Outputs:
        - items: Array of parsed items
        - count: Number of parsed items
        - total: Sum of sum_field values (if specified)
        - valid: Whether all items passed validation
        - errors: Array of validation error messages
    """

    @property
    def module_id(self) -> str:
        return "transform.parse_pattern"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="input",
                type="string",
                required=True,
                description="Raw input string to parse"
            ),
            ModuleInput(
                name="pattern",
                type="object",
                required=True,
                description="Pattern configuration: {regex, separator?, trim?}"
            ),
            ModuleInput(
                name="field_types",
                type="object",
                required=False,
                default={},
                description="Type casting per field: {field: 'int'|'float'|'bool'|'string'}"
            ),
            ModuleInput(
                name="lookups",
                type="object",
                required=False,
                default={},
                description="Lookup configurations per field"
            ),
            ModuleInput(
                name="mappings",
                type="object",
                required=False,
                default={},
                description="Value mappings per field: {field: {old: new, ...}}"
            ),
            ModuleInput(
                name="computed",
                type="array",
                required=False,
                default=[],
                description="Computed field definitions: [{field, expression}, ...]"
            ),
            ModuleInput(
                name="validation",
                type="object",
                required=False,
                default={},
                description="Validation rules per field: {field: {min?, max?, in?, pattern?, required?}}"
            ),
            ModuleInput(
                name="sum_field",
                type="string",
                required=False,
                default=None,
                description="Field name to sum for total output"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="items",
                type="array",
                description="Array of parsed items with all fields"
            ),
            ModuleOutput(
                name="count",
                type="number",
                description="Number of parsed items"
            ),
            ModuleOutput(
                name="total",
                type="number",
                description="Sum of sum_field values (if specified)"
            ),
            ModuleOutput(
                name="valid",
                type="boolean",
                description="Whether all items passed validation"
            ),
            ModuleOutput(
                name="errors",
                type="array",
                description="Array of validation error messages"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute pattern parsing"""
        try:
            raw_input = inputs.get('input', '')
            pattern_config = inputs.get('pattern', {})
            field_types = inputs.get('field_types', {})
            lookups = inputs.get('lookups', {})
            mappings = inputs.get('mappings', {})
            computed = inputs.get('computed', [])
            validation = inputs.get('validation', {})
            sum_field = inputs.get('sum_field')

            # Extract pattern config
            regex_pattern = pattern_config.get('regex', '')
            separator = pattern_config.get('separator')
            separator_is_regex = pattern_config.get('separator_is_regex', False)
            trim = pattern_config.get('trim', True)

            if not regex_pattern:
                raise ModuleExecutionError(
                    self.module_id,
                    "Pattern regex is required",
                    None
                )

            # Compile regex
            try:
                compiled_pattern = re.compile(regex_pattern)
            except re.error as e:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Invalid regex pattern: {e}",
                    e
                )

            # Split input if separator provided
            if separator:
                if separator_is_regex:
                    raw_items = re.split(separator, raw_input)
                else:
                    raw_items = raw_input.split(separator)
            else:
                raw_items = [raw_input]

            # Trim if enabled
            if trim:
                raw_items = [item.strip() for item in raw_items]

            # Filter out empty items
            raw_items = [item for item in raw_items if item]

            # Parse each item
            items = []
            errors = []

            for idx, raw_item in enumerate(raw_items):
                item_result = self._parse_item(
                    raw_item=raw_item,
                    item_index=idx,
                    compiled_pattern=compiled_pattern,
                    field_types=field_types,
                    lookups=lookups,
                    mappings=mappings,
                    computed=computed,
                    validation=validation,
                    context=context
                )

                if item_result.get('_errors'):
                    errors.extend(item_result['_errors'])
                    del item_result['_errors']

                items.append(item_result)

            # Calculate total if sum_field specified
            total = 0
            if sum_field:
                for item in items:
                    if sum_field in item and isinstance(item[sum_field], (int, float)):
                        total += item[sum_field]

            valid = len(errors) == 0

            context.logger.info(
                f"Parsed {len(items)} items from input, valid={valid}, errors={len(errors)}"
            )

            # Debug: log item structure
            if items:
                first_item = items[0]
                item_keys = list(first_item.keys()) if isinstance(first_item, dict) else 'not a dict'
                has_aesthetic = 'aesthetic' in first_item if isinstance(first_item, dict) else False
                aesthetic_type = type(first_item.get('aesthetic')).__name__ if isinstance(first_item, dict) else 'N/A'
                context.logger.info(f"[PARSE_PATTERN] First item keys: {item_keys}, has_aesthetic: {has_aesthetic}, aesthetic_type: {aesthetic_type}")
                if has_aesthetic and isinstance(first_item.get('aesthetic'), dict):
                    context.logger.info(f"[PARSE_PATTERN] aesthetic keys: {list(first_item['aesthetic'].keys())}")

            return {
                "items": items,
                "count": len(items),
                "total": total,
                "valid": valid,
                "errors": errors
            }

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to parse pattern: {str(e)}",
                e
            )

    def _parse_item(
        self,
        raw_item: str,
        item_index: int,
        compiled_pattern: re.Pattern,
        field_types: Dict[str, str],
        lookups: Dict[str, Any],
        mappings: Dict[str, Dict[str, Any]],
        computed: List[Dict[str, str]],
        validation: Dict[str, Any],
        context
    ) -> Dict[str, Any]:
        """Parse a single item from the input"""
        result = {'_raw': raw_item, '_index': item_index}
        errors = []

        # Match pattern
        match = compiled_pattern.match(raw_item)
        if not match:
            errors.append(f"Item '{raw_item}' does not match pattern")
            result['_errors'] = errors
            return result

        # Extract named groups
        groups = match.groupdict()
        for field, value in groups.items():
            result[field] = value

        # Apply type casting
        for field, type_name in field_types.items():
            if field in result and result[field] is not None:
                try:
                    result[field] = self._cast_type(result[field], type_name)
                except (ValueError, TypeError) as e:
                    errors.append(f"Item '{raw_item}': Cannot cast '{field}' to {type_name}")

        # Apply mappings (before lookups, so mapped values can be used in lookups)
        for field, mapping in mappings.items():
            if field in result and result[field] in mapping:
                original = result[field]
                result[field] = mapping[result[field]]
                # Keep original value with _original suffix
                result[f"{field}_original"] = original

        # Apply lookups
        for field, lookup_config in lookups.items():
            if field in result:
                lookup_result = self._apply_lookup(
                    value=result[field],
                    config=lookup_config,
                    context=context
                )
                if lookup_result is not None:
                    output_field = lookup_config.get('output_field', f"{field}_resolved")
                    result[output_field] = lookup_result
                elif lookup_config.get('required', False):
                    errors.append(f"Item '{raw_item}': Lookup failed for '{field}'={result[field]}")

        # Apply computed fields
        for comp in computed:
            field_name = comp.get('field')
            expression = comp.get('expression')
            if field_name and expression:
                try:
                    computed_value = self._evaluate_expression(expression, result)
                    result[field_name] = computed_value
                except Exception as e:
                    errors.append(f"Item '{raw_item}': Failed to compute '{field_name}': {e}")

        # Apply validation
        for field, rules in validation.items():
            if field in result:
                field_errors = self._validate_field(field, result[field], rules, raw_item)
                errors.extend(field_errors)
            elif rules.get('required', False):
                errors.append(f"Item '{raw_item}': Missing required field '{field}'")

        if errors:
            result['_errors'] = errors

        return result

    def _cast_type(self, value: Any, type_name: str) -> Any:
        """Cast a value to the specified type"""
        if value is None:
            return None

        type_name = type_name.lower()

        if type_name == 'int' or type_name == 'integer':
            return int(value)
        elif type_name == 'float' or type_name == 'number':
            return float(value)
        elif type_name == 'bool' or type_name == 'boolean':
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ('true', 'yes', '1', 'on')
            return bool(value)
        elif type_name == 'string' or type_name == 'str':
            return str(value)
        else:
            return value

    def _apply_lookup(
        self,
        value: Any,
        config: Dict[str, Any],
        context
    ) -> Optional[Any]:
        """Apply a lookup to resolve a value"""
        source = config.get('source', [])

        # Debug logging
        context.logger.debug(f"[LOOKUP] value={value}, source type={type(source).__name__}, source len={len(source) if isinstance(source, list) else 'N/A'}")
        if isinstance(source, dict):
            context.logger.warning(f"[LOOKUP] source is dict (unresolved $ref?): {list(source.keys())}")

        # Source should already be resolved by Jinja2 at this point
        if not isinstance(source, list):
            return None

        if not source:
            return None

        # Lookup by position (1-indexed)
        if config.get('match_by_position', False):
            offset = config.get('position_offset', -1)  # Default -1 for 1-indexed
            try:
                index = int(value) + offset
                if 0 <= index < len(source):
                    return source[index]
            except (ValueError, TypeError):
                pass
            return None

        # Lookup by field value
        match_field = config.get('match_field', 'id')
        for item in source:
            if isinstance(item, dict) and item.get(match_field) == value:
                return item

        return None

    def _evaluate_expression(self, expression: str, variables: Dict[str, Any]) -> Any:
        """Safely evaluate an expression using simpleeval"""
        if not SIMPLEEVAL_AVAILABLE:
            raise ModuleExecutionError(
                self.module_id,
                "simpleeval package is required for computed fields. Install with: pip install simpleeval",
                None
            )

        # Create evaluator with math functions available directly
        evaluator = EvalWithCompoundTypes(
            names=variables,
            functions={
                'ceil': math.ceil,
                'floor': math.floor,
                'sqrt': math.sqrt,
                'pow': math.pow,
                'min': min,
                'max': max,
                'abs': abs,
                'round': round,
                'len': len,
            }
        )

        return evaluator.eval(expression)

    def _validate_field(
        self,
        field: str,
        value: Any,
        rules: Dict[str, Any],
        raw_item: str
    ) -> List[str]:
        """Validate a field value against rules"""
        errors = []

        # Min/max validation for numbers
        if 'min' in rules and isinstance(value, (int, float)):
            min_val = rules['min']
            if isinstance(min_val, (int, float)) and value < min_val:
                errors.append(f"Item '{raw_item}': '{field}' ({value}) is less than minimum ({min_val})")

        if 'max' in rules and isinstance(value, (int, float)):
            max_val = rules['max']
            if isinstance(max_val, (int, float)) and value > max_val:
                errors.append(f"Item '{raw_item}': '{field}' ({value}) exceeds maximum ({max_val})")

        # Allowed values validation
        if 'in' in rules:
            allowed = rules['in']
            if isinstance(allowed, list) and value not in allowed:
                errors.append(f"Item '{raw_item}': '{field}' ({value}) not in allowed values {allowed}")

        # Pattern validation for strings
        if 'pattern' in rules and isinstance(value, str):
            pattern = rules['pattern']
            if not re.match(pattern, value):
                errors.append(f"Item '{raw_item}': '{field}' ({value}) does not match pattern '{pattern}'")

        return errors
