"""
Render Template Array Module - Renders a template once per array item and concatenates results

A generic module for rendering a Jinja2 template for each item in an array.
"""

from typing import Dict, Any, List
from jinja2 import Environment, BaseLoader, TemplateError
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class RenderTemplateArrayModule(ExecutableModule):
    """
    Module that renders a Jinja2 template once for each item in an array.

    Useful for generating repeated sections (e.g., one prompt block per selection).

    Inputs:
        - items: Array of items to iterate over
        - template: Jinja2 template string to render for each item
        - item_variable: Variable name for current item in template (default: "item")
        - index_variable: Variable name for current index in template (default: "index")
        - separator: String to insert between rendered items (default: newline)
        - extra_context: Additional variables to make available in template (optional)

    Outputs:
        - rendered: Concatenated rendered output
        - sections: Array of individually rendered sections
        - count: Number of items processed
    """

    @property
    def module_id(self) -> str:
        return "transform.render_template_array"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="items",
                type="array",
                required=True,
                description="Array of items to iterate over"
            ),
            ModuleInput(
                name="template",
                type="string",
                required=True,
                description="Jinja2 template string to render for each item"
            ),
            ModuleInput(
                name="item_variable",
                type="string",
                required=False,
                default="item",
                description="Variable name for current item in template"
            ),
            ModuleInput(
                name="index_variable",
                type="string",
                required=False,
                default="index",
                description="Variable name for current index in template"
            ),
            ModuleInput(
                name="separator",
                type="string",
                required=False,
                default="\n\n",
                description="String to insert between rendered items"
            ),
            ModuleInput(
                name="extra_context",
                type="object",
                required=False,
                default={},
                description="Additional variables to make available in template"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="rendered",
                type="string",
                description="Concatenated rendered output"
            ),
            ModuleOutput(
                name="sections",
                type="array",
                description="Array of individually rendered sections"
            ),
            ModuleOutput(
                name="count",
                type="number",
                description="Number of items processed"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute template array rendering"""
        try:
            items = inputs.get('items', [])
            template_str = inputs.get('template', '')
            item_variable = inputs.get('item_variable', 'item')
            index_variable = inputs.get('index_variable', 'index')
            separator = inputs.get('separator', '\n\n')
            extra_context = inputs.get('extra_context', {})

            # Debug logging to trace data flow
            context.logger.info(f"[RENDER_TEMPLATE_ARRAY] Received {len(items) if isinstance(items, list) else 'non-list'} items")
            if items and isinstance(items, list) and len(items) > 0:
                first_item = items[0]
                context.logger.info(f"[RENDER_TEMPLATE_ARRAY] First item type: {type(first_item).__name__}")
                if isinstance(first_item, dict):
                    context.logger.info(f"[RENDER_TEMPLATE_ARRAY] First item keys: {list(first_item.keys())}")
                    if 'aesthetic' in first_item:
                        aesthetic = first_item['aesthetic']
                        context.logger.info(f"[RENDER_TEMPLATE_ARRAY] aesthetic type: {type(aesthetic).__name__}, value: {aesthetic}")
                    context.logger.info(f"[RENDER_TEMPLATE_ARRAY] First item data: {first_item}")

            if not template_str:
                raise ModuleExecutionError(
                    self.module_id,
                    "Template string is required",
                    None
                )

            if not isinstance(items, list):
                raise ModuleExecutionError(
                    self.module_id,
                    f"Items must be an array, got {type(items).__name__}",
                    None
                )

            # Create Jinja2 environment
            env = Environment(loader=BaseLoader())

            # Add custom filters
            env.filters['join'] = lambda x, d=', ': d.join(str(i) for i in x) if isinstance(x, list) else str(x)

            # Compile template
            try:
                template = env.from_string(template_str)
            except TemplateError as e:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Invalid template: {e}",
                    e
                )

            # Render for each item
            sections = []
            for idx, item in enumerate(items):
                try:
                    # Build context for this item
                    render_context = {
                        item_variable: item,
                        index_variable: idx,
                        'loop': {
                            'index': idx + 1,
                            'index0': idx,
                            'first': idx == 0,
                            'last': idx == len(items) - 1,
                            'length': len(items)
                        },
                        **extra_context
                    }

                    # If item is a dict, also expose its keys directly
                    if isinstance(item, dict):
                        for key, value in item.items():
                            if not key.startswith('_'):  # Skip internal fields
                                render_context[key] = value

                    rendered = template.render(**render_context)
                    sections.append(rendered)

                except TemplateError as e:
                    context.logger.warning(f"Failed to render template for item {idx}: {e}")
                    sections.append(f"[Error rendering item {idx}: {e}]")

            # Concatenate sections
            rendered = separator.join(sections)

            context.logger.info(
                f"Rendered template for {len(items)} items, total length: {len(rendered)} chars"
            )

            return {
                "rendered": rendered,
                "sections": sections,
                "count": len(items)
            }

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to render template array: {str(e)}",
                e
            )
