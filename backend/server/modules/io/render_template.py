"""
Render Template Module - Renders a Jinja2 template and returns the result
"""

from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class RenderTemplateModule(ExecutableModule):
    """
    Module for rendering Jinja2 templates.

    This module takes an already-resolved template string (from $ref with type: jinja2)
    and passes it through. The actual Jinja2 rendering happens in the parameter resolver.

    Inputs:
        - template: Pre-rendered template content (resolved by parameter_resolver)

    Outputs:
        - rendered: The rendered template string
    """

    @property
    def module_id(self) -> str:
        return "io.render_template"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="template",
                type="string",
                required=True,
                description="Template content (pre-rendered by parameter resolver)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="rendered",
                type="string",
                description="The rendered template string"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute template rendering (pass-through since resolver did the work)"""
        try:
            template_content = inputs.get('template', '')

            # The parameter resolver already rendered the Jinja2 template
            # This module just passes it through to outputs

            context.logger.debug(f"Template rendered, length: {len(template_content)} chars")

            return {
                "rendered": template_content
            }

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to process template: {str(e)}",
                e
            )
