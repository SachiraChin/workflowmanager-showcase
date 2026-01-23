"""
Extract Transform Module - Passthrough for storing computed values to state

A generic module that takes any named inputs and outputs them unchanged.
Use with outputs_to_state to store computed Jinja2 expressions to workflow state.
"""

from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class ExtractModule(ExecutableModule):
    """
    Generic passthrough module for storing values to state.

    Takes arbitrary named inputs and outputs them unchanged. This allows
    storing computed Jinja2 expressions to state via outputs_to_state.

    Example usage in step.json:
        {
            "module_id": "transform.extract",
            "inputs": {
                "my_value": "{{ state.some_computed_expression }}",
                "another": "{{ state.items | first }}"
            },
            "outputs_to_state": {
                "my_value": "stored_value",
                "another": "stored_another"
            }
        }

    Inputs:
        - Any named inputs (all passed through to outputs)

    Outputs:
        - Same named outputs as inputs (passthrough)
    """

    @property
    def module_id(self) -> str:
        return "transform.extract"

    @property
    def inputs(self) -> List[ModuleInput]:
        # Dynamic inputs - accepts any named inputs
        return []

    @property
    def outputs(self) -> List[ModuleOutput]:
        # Dynamic outputs - matches inputs
        return []

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Passthrough all inputs as outputs"""
        try:
            # Filter out any internal/reserved keys (starting with _)
            outputs = {}
            for key, value in inputs.items():
                if not key.startswith('_'):
                    outputs[key] = value
                    value_type = type(value).__name__
                    if value is None:
                        context.logger.warning(f"Extracted '{key}': None (Jinja2 expression may have failed)")
                    elif isinstance(value, dict):
                        keys_preview = list(value.keys())[:5]
                        context.logger.debug(f"Extracted '{key}': {value_type} with keys {keys_preview}")
                    elif isinstance(value, list):
                        context.logger.debug(f"Extracted '{key}': {value_type} with {len(value)} items")
                    else:
                        context.logger.debug(f"Extracted '{key}': {value_type} = {str(value)[:100]}")

            context.logger.info(f"Extracted {len(outputs)} value(s) for state storage")

            return outputs

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to extract values: {str(e)}",
                e
            )
