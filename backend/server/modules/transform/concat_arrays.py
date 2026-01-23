"""
Concatenate Arrays Module - Concatenate multiple arrays into one
"""

from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class ConcatArraysModule(ExecutableModule):
    """
    Module for concatenating multiple arrays into a single array.

    Inputs:
        - arrays: List of arrays to concatenate

    Outputs:
        - result: Concatenated array
    """

    @property
    def module_id(self) -> str:
        return "transform.concat_arrays"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="arrays",
                type="array",
                required=True,
                description="List of arrays to concatenate"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="result",
                type="array",
                description="Concatenated array"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute array concatenation"""
        try:
            arrays = inputs['arrays']

            # Validate input is a list
            if not isinstance(arrays, list):
                raise ModuleExecutionError(
                    self.module_id,
                    f"Expected list of arrays, got {type(arrays).__name__}",
                    None
                )

            # Concatenate all arrays
            result = []
            for arr in arrays:
                if isinstance(arr, list):
                    result.extend(arr)
                else:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Expected array element, got {type(arr).__name__}",
                        None
                    )

            context.logger.debug(f"✓ Concatenated {len(arrays)} arrays into {len(result)} items")

            return {
                "result": result
            }

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to concatenate arrays: {str(e)}",
                e
            )
