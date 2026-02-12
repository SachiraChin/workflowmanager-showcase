"""
Conditional Text Transform Module - Returns different text based on whether a value is empty
"""

from typing import Dict, Any, List
from ...engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class ConditionalTextModule(ExecutableModule):
    """
    Module that returns different text based on whether a condition value is empty/None.

    Inputs:
        - condition_value: The value to check (if empty/None, use text_if_empty)
        - text_if_not_empty: Text to return when condition_value is not empty
        - text_if_empty: Text to return when condition_value is empty (default: "")

    Outputs:
        - result: The selected text based on condition
    """

    @property
    def module_id(self) -> str:
        return "transform.conditional_text"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="condition_value",
                type="string",
                required=True,
                description="Value to check for emptiness"
            ),
            ModuleInput(
                name="text_if_not_empty",
                type="string",
                required=True,
                description="Text to return when condition_value is not empty"
            ),
            ModuleInput(
                name="text_if_empty",
                type="string",
                required=False,
                default="",
                description="Text to return when condition_value is empty"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="result",
                type="string",
                description="The selected text based on condition"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute conditional text selection"""
        try:
            condition_value = inputs.get('condition_value')
            text_if_not_empty = inputs['text_if_not_empty']
            text_if_empty = inputs.get('text_if_empty', '')

            # Check if condition_value is empty
            # Treat None, empty string, or whitespace-only as empty
            is_empty = (
                condition_value is None or
                condition_value == '' or
                (isinstance(condition_value, str) and condition_value.strip() == '')
            )

            # Select appropriate text
            result = text_if_empty if is_empty else text_if_not_empty

            # Replace $state.condition_value placeholder with actual value if not empty
            if not is_empty:
                if '$state.condition_value' in result:
                    context.logger.debug(f"Found placeholder '$state.condition_value' in result, replacing with: {repr(condition_value)}")
                    result = result.replace('$state.condition_value', str(condition_value))
                else:
                    context.logger.warning(f"Placeholder '$state.condition_value' NOT found in result! Result preview: {repr(result[:100])}")

            context.logger.debug(
                f"Conditional text: {'empty' if is_empty else 'not empty'} -> "
                f"{len(result)} chars (condition_value: {repr(condition_value)})"
            )

            return {"result": result}

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to process conditional text: {str(e)}",
                e
            )
