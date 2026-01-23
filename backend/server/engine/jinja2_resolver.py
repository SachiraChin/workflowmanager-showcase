"""
Jinja2 Parameter Resolver - Resolves Jinja2 expressions at runtime.

Uses Jinja2's native {{ state.key }} syntax for all parameter references.
Supports complex expressions including array indexing with dynamic indices.

NOTE: This resolver handles ONLY Jinja2 expressions ({{ }} syntax).
$ref resolution is handled at upload time by WorkflowResolver.

Part of Phase 1: Graceful Template Fallback - logs warnings for missing state keys.
See: architecture/2025_12_17_workflow_state_validation_proposal.md
"""

import logging
from typing import Dict, Any
from jinja2 import Environment, BaseLoader, TemplateSyntaxError, UndefinedError, Undefined
from contracts.template_validator import TemplateValidator

_logger = logging.getLogger(__name__)


class SilentUndefined(Undefined):
    """Custom undefined that returns None instead of raising errors."""
    def _fail_with_undefined_error(self, *args, **kwargs):
        return None

    def __str__(self):
        return ''

    def __iter__(self):
        return iter([])

    def __bool__(self):
        return False

    def __getattr__(self, name):
        return SilentUndefined()

    def __getitem__(self, key):
        return SilentUndefined()


class Jinja2Resolver:
    """
    Resolves Jinja2 expressions at runtime.

    Supports the following reference formats:
    - {{ state.key }}           - Get from workflow state
    - {{ module.output_name }}  - Get from previous module output
    - {{ step.key }}            - Get from current step configuration
    - {{ config.key }}          - Get from workflow config
    - {{ state.array[state.index] }} - Dynamic array indexing

    NOTE: $ref resolution is handled at upload time by WorkflowResolver.
    This resolver only handles {{ }} Jinja2 expressions at runtime.
    """

    def __init__(
        self,
        state_manager,
        config: Dict[str, Any] = None
    ):
        """
        Initialize Jinja2 resolver.

        Args:
            state_manager: StateManager/StateProxy instance for state access
            config: Workflow configuration dictionary
        """
        self.state = state_manager
        self.config = config or {}

        # Template validator for logging warnings about missing state keys
        self._validator = TemplateValidator()

        # Create Jinja2 environment
        # Note: trim_blocks and lstrip_blocks are False to preserve newlines in templates
        self._env = Environment(
            loader=BaseLoader(),
            autoescape=False,
            undefined=SilentUndefined,
            trim_blocks=False,
            lstrip_blocks=False
        )

    def resolve_with_schema(
        self,
        value: Dict[str, Any],
        module_outputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Resolve inputs according to embedded resolver_schema.

        Looks for resolver_schema field inside value to determine resolution behavior.
        - Fields with resolver: "server" are resolved by this method
        - Fields with resolver: "client" pass through for TUI to resolve
        - Fields not in schema inherit from parent (if parent was resolved)

        The resolver_schema field itself is removed from the result.

        Args:
            value: Input dictionary to resolve (may contain resolver_schema)
            module_outputs: Dictionary of outputs from previous modules

        Returns:
            Dictionary with server fields resolved, resolver_schema removed
        """
        if module_outputs is None:
            module_outputs = {}

        return self._resolve_object(value, module_outputs, parent_resolved=False)

    def _resolve_object(
        self,
        value: Any,
        module_outputs: Dict[str, Any],
        parent_resolved: bool
    ) -> Any:
        """
        Recursively resolve an object, checking for embedded resolver_schema.

        Args:
            value: Value to resolve
            module_outputs: Module outputs for Jinja2 context
            parent_resolved: Whether parent field was marked for resolution
        """
        if not isinstance(value, dict):
            # For non-dict values, resolve if parent was resolved
            if parent_resolved and isinstance(value, str):
                return self._resolve_string(value, module_outputs)
            return value

        # Check for embedded resolver_schema
        resolver_schema = value.get('resolver_schema')
        schema_properties = resolver_schema.get('properties', {}) if resolver_schema else {}

        result = {}
        for key, val in value.items():
            # Skip resolver_schema itself - don't include in result
            if key == 'resolver_schema':
                continue

            field_schema = schema_properties.get(key, {})
            resolver_type = field_schema.get('resolver')

            if resolver_type == 'server':
                # Server-resolved: resolve recursively with parent_resolved=True
                result[key] = self._resolve_field(val, module_outputs, parent_resolved=True)
            elif resolver_type == 'client':
                # Client-resolved: pass through unchanged
                result[key] = val
            elif parent_resolved:
                # No resolver_schema for this field but parent was resolved - inherit
                result[key] = self._resolve_field(val, module_outputs, parent_resolved=True)
            else:
                # Not in schema and parent not resolved - pass through
                result[key] = val

        return result

    def _resolve_field(
        self,
        value: Any,
        module_outputs: Dict[str, Any],
        parent_resolved: bool
    ) -> Any:
        """
        Resolve a field value based on parent resolution status.

        Args:
            value: Field value to resolve
            module_outputs: Module outputs for Jinja2 context
            parent_resolved: Whether to resolve this field
        """
        if isinstance(value, str):
            return self._resolve_string(value, module_outputs) if parent_resolved else value
        elif isinstance(value, dict):
            return self._resolve_object(value, module_outputs, parent_resolved)
        elif isinstance(value, list):
            return [self._resolve_field(item, module_outputs, parent_resolved) for item in value]
        else:
            return value

    def resolve_value(self, value: Any, module_outputs: Dict[str, Any] = None) -> Any:
        """
        Recursively resolve all Jinja2 expressions in a value.

        Use this for values that should always be fully resolved (e.g., addons).
        For module inputs, use resolve_with_schema() instead.
        """
        if module_outputs is None:
            module_outputs = {}
        if isinstance(value, str):
            return self._resolve_string(value, module_outputs)
        elif isinstance(value, dict):
            return {k: self.resolve_value(v, module_outputs) for k, v in value.items()}
        elif isinstance(value, list):
            return [self.resolve_value(item, module_outputs) for item in value]
        else:
            # Primitive types pass through
            return value

    def _resolve_string(self, value: str, module_outputs: Dict[str, Any], location: str = "unknown") -> Any:
        """
        Resolve a string with Jinja2 expressions.

        Handles:
        1. Pure Jinja2 expression: "{{ state.key }}" -> returns actual value (any type)
        2. Mixed content: "Hello {{ state.name }}!" -> interpolated string

        Note: Display templates (for TUI rendering) should be marked as resolver: "client"
        in the resolver_schema so they are not passed to this method.
        """
        # Check if string contains any Jinja2 expressions
        if '{{' not in value and '{%' not in value:
            return value

        # Build template context
        context = self._build_context(module_outputs)

        # Log warnings for missing state references (Phase 1: Graceful Template Fallback)
        self._validator.log_missing_refs(value, context, location)

        # Check if this is a pure expression (just {{ expr }})
        stripped = value.strip()
        if stripped.startswith('{{') and stripped.endswith('}}'):
            inner = stripped[2:-2]
            # Ensure it's a single expression (no nested {{ }})
            if '{{' not in inner and '}}' not in inner:
                # Pure expression - return the actual value, not string
                return self._eval_expression(inner.strip(), context)

        # Mixed content or complex template - render as string
        try:
            template = self._env.from_string(value)
            return template.render(**context)
        except TemplateSyntaxError as e:
            raise ValueError(f"Jinja2 syntax error: {e.message}")
        except UndefinedError as e:
            raise ValueError(f"Jinja2 undefined variable: {e.message}")

    def _eval_expression(self, expr: str, context: Dict[str, Any]) -> Any:
        """
        Evaluate a simple expression to get its actual value (not stringified).

        This allows {{ state.items[0] }} to return the actual dict/list,
        not just a string representation.
        """
        try:
            compiled = self._env.compile_expression(expr)
            return compiled(**context)
        except Exception:
            # Fallback to string rendering
            template = self._env.from_string('{{ ' + expr + ' }}')
            return template.render(**context)

    def _build_context(self, module_outputs: Dict[str, Any]) -> Dict[str, Any]:
        """Build the Jinja2 template context."""
        state_dict = self.state.get_all_state() if hasattr(self.state, 'get_all_state') else dict(self.state)

        return {
            'state': state_dict,
            'module': module_outputs,
            'step': self.state.get_step_config() if hasattr(self.state, 'get_step_config') else {},
            'config': self.config
        }



# Alias for backwards compatibility with imports
ParameterResolver = Jinja2Resolver
