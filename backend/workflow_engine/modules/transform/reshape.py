"""
Reshape Transform Module - Generic data transformation using templates

Transforms data from one format to another using templates with Jinja2 expressions.
Primary use case: Converting generic user.form output to workflow-specific format.
"""

from typing import Dict, Any, List
from jinja2 import Environment, BaseLoader, Undefined
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


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


class ReshapeModule(ExecutableModule):
    """
    Module for transforming data structures using templates.

    Supports:
    - Object-to-object transformation (apply template to single object)
    - Array transformation using _for_each (apply template to each item)
    - Nested template expressions using Jinja2 syntax
    - Access to source item via configurable variable name

    Inputs:
        - source: Source data to transform (object or array)
        - template: Transformation template
            - For array: {"_for_each": "$item", "_output": {...}}
            - For object: Direct template object
        - context_vars: Additional variables available in templates (optional)

    Outputs:
        - result: Transformed data

    Example (array transformation):
        Input:
            source: [{"_item": {"name": "A"}, "count": 5}, {"_item": {"name": "B"}, "count": 3}]
            template:
                _for_each: "$item"
                _output:
                    name: "{{ $item._item.name }}"
                    total: "{{ $item.count * 2 }}"

        Output:
            result: [{"name": "A", "total": 10}, {"name": "B", "total": 6}]
    """

    @property
    def module_id(self) -> str:
        return "transform.reshape"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="source",
                type="any",
                required=True,
                description="Source data to transform (object or array)"
            ),
            ModuleInput(
                name="template",
                type="object",
                required=True,
                description="Transformation template with optional _for_each for arrays"
            ),
            ModuleInput(
                name="context_vars",
                type="object",
                required=False,
                default={},
                description="Additional variables available in templates"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="result",
                type="any",
                description="Transformed data"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute data transformation."""
        try:
            source = inputs["source"]
            template = inputs["template"]
            context_vars = self.get_input_value(inputs, "context_vars") or {}

            # Check if this is an array transformation
            if "_for_each" in template:
                result = self._transform_array(source, template, context_vars, context)
            else:
                result = self._transform_object(source, template, context_vars, context)

            context.logger.debug(
                f"Reshaped data: {type(source).__name__} -> {type(result).__name__}"
            )

            return {"result": result}

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Transformation failed: {str(e)}",
                e
            )

    def _transform_array(
        self,
        source: Any,
        template: Dict[str, Any],
        context_vars: Dict[str, Any],
        context
    ) -> List[Any]:
        """
        Transform an array using _for_each template.

        Args:
            source: Source array (or single item to wrap)
            template: Template with _for_each and _output
            context_vars: Additional context variables
            context: Execution context

        Returns:
            Array of transformed items
        """
        # Get item variable name (e.g., "$item")
        item_var = template.get("_for_each", "$item")
        output_template = template.get("_output", {})

        # Ensure source is iterable
        if not isinstance(source, (list, tuple)):
            source = [source]

        result = []
        for idx, item in enumerate(source):
            # Build context for this item
            item_context = {
                **context_vars,
                item_var: item,
                "$index": idx
            }

            # Transform using the output template
            transformed = self._apply_template(output_template, item_context, context)
            result.append(transformed)

        return result

    def _transform_object(
        self,
        source: Any,
        template: Dict[str, Any],
        context_vars: Dict[str, Any],
        context
    ) -> Any:
        """
        Transform a single object using template.

        Args:
            source: Source object
            template: Template object
            context_vars: Additional context variables
            context: Execution context

        Returns:
            Transformed object
        """
        # Build context with source available
        item_context = {
            **context_vars,
            "$source": source,
            "source": source
        }

        return self._apply_template(template, item_context, context)

    def _apply_template(
        self,
        template: Any,
        item_context: Dict[str, Any],
        context
    ) -> Any:
        """
        Apply Jinja2 templates recursively to a template structure.

        Args:
            template: Template value (dict, list, string, or primitive)
            item_context: Variables available in templates
            context: Execution context

        Returns:
            Template with all Jinja2 expressions resolved
        """
        if isinstance(template, str):
            # Check if it's a Jinja2 template
            if "{{" in template or "{%" in template:
                return self._resolve_template_string(template, item_context, context)
            return template

        elif isinstance(template, dict):
            # Skip special keys, apply template to all others
            result = {}
            for key, value in template.items():
                if key in ("_for_each", "_output"):
                    continue

                # Resolve the key if it contains templates
                resolved_key = key
                if isinstance(key, str) and ("{{" in key or "{%" in key):
                    resolved_key = self._resolve_template_string(key, item_context, context)

                # Recursively apply to value
                result[resolved_key] = self._apply_template(value, item_context, context)

            return result

        elif isinstance(template, list):
            return [self._apply_template(item, item_context, context) for item in template]

        else:
            # Primitive value, return as-is
            return template

    def _sanitize_for_jinja(self, key: str) -> str:
        """
        Convert variable names to valid Jinja2 identifiers.

        Replaces $ prefix with _ to make valid Python identifiers.
        """
        if key.startswith('$'):
            return '_' + key[1:]  # $item -> _item, $index -> _index
        return key

    def _prepare_jinja_context(self, item_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Prepare context for Jinja2 by sanitizing variable names.

        Adds both original ($item) and sanitized (_item) versions.
        """
        result = {}
        for key, value in item_context.items():
            # Add sanitized version
            sanitized_key = self._sanitize_for_jinja(key)
            result[sanitized_key] = value
            # Also keep original if it's different
            if sanitized_key != key:
                result[key] = value
        return result

    def _sanitize_template_string(self, template_str: str) -> str:
        """
        Replace $variable with _variable in template strings for Jinja2 compatibility.
        """
        import re
        # Replace $var with _var (but not inside strings already)
        return re.sub(r'\$([a-zA-Z_][a-zA-Z0-9_]*)', r'_\1', template_str)

    def _resolve_template_string(
        self,
        template_str: str,
        item_context: Dict[str, Any],
        context
    ) -> Any:
        """
        Resolve a Jinja2 template string.

        Args:
            template_str: Template string with {{ }} expressions
            item_context: Variables available in template
            context: Execution context

        Returns:
            Resolved value (may be string or other type if template is pure expression)
        """
        try:
            # Create Jinja2 environment
            env = Environment(
                loader=BaseLoader(),
                autoescape=False,
                undefined=SilentUndefined
            )

            # Sanitize template string ($item -> _item)
            sanitized_template = self._sanitize_template_string(template_str)

            # Prepare context with sanitized variable names
            jinja_context = self._prepare_jinja_context(item_context)

            # Check if this is a pure expression (just {{ expr }})
            stripped = sanitized_template.strip()
            if stripped.startswith('{{') and stripped.endswith('}}'):
                inner = stripped[2:-2]
                # Ensure it's a single expression (no nested {{ }})
                if '{{' not in inner and '}}' not in inner:
                    # Pure expression - return the actual value, not string
                    try:
                        compiled = env.compile_expression(inner.strip())
                        return compiled(**jinja_context)
                    except Exception:
                        pass  # Fall through to template rendering

            # Mixed content or complex template - render as string
            template = env.from_string(sanitized_template)
            return template.render(**jinja_context)

        except Exception as e:
            context.logger.warning(
                f"Template resolution failed for '{template_str[:50]}...': {e}"
            )
            # Return original on failure
            return template_str
