"""
Build Grouped Prompt Module - Dynamically builds system prompt from selected groups
"""

from typing import Dict, Any, List
from ...engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class BuildGroupedPromptModule(ExecutableModule):
    """
    Module for building dynamic system prompts by merging group-specific instructions.

    Merges shared instructions with instructions for each selected group.

    Inputs:
        - shared_instructions: Shared instructions content (resolved via $ref)
        - data: Group data object where each group has 'prompt_instructions' content
        - selected_indices: Array of selected group keys

    Outputs:
        - merged_prompt: Combined prompt with shared + selected group instructions
    """

    @property
    def module_id(self) -> str:
        return "prompt.build_grouped_prompt"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="shared_instructions",
                type="string",
                required=True,
                description="Shared instructions content (resolved via $ref)"
            ),
            ModuleInput(
                name="data",
                type="object",
                required=False,
                description="Raw data object containing groups with prompt_instructions content"
            ),
            ModuleInput(
                name="selected_indices",
                type="array",
                required=False,
                description="Array of selected keys/indices to extract from data"
            ),
            ModuleInput(
                name="selected_group_configs",
                type="array",
                required=False,
                description="Array of selected group config objects (legacy)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="merged_prompt",
                type="string",
                description="Merged system prompt with shared + group instructions"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute prompt building"""
        try:
            shared_instructions = self.get_input_value(inputs, 'shared_instructions')
            data = self.get_input_value(inputs, 'data')
            selected_indices = self.get_input_value(inputs, 'selected_indices')
            selected_group_configs = self.get_input_value(inputs, 'selected_group_configs')

            if not shared_instructions:
                raise ModuleExecutionError(
                    self.module_id,
                    "shared_instructions is required"
                )

            # Start with shared instructions
            merged_prompt = shared_instructions

            context.logger.info(f"Starting with shared instructions ({len(shared_instructions)} chars)")

            # Build list of groups to process
            groups_to_process = []

            # Preferred: data + selected_indices
            if data and selected_indices:
                for idx in selected_indices:
                    if isinstance(data, dict) and idx in data:
                        groups_to_process.append((idx, data[idx]))
                    elif isinstance(data, list) and isinstance(idx, int) and 0 <= idx < len(data):
                        groups_to_process.append((idx, data[idx]))
            # Legacy: selected_group_configs array
            elif selected_group_configs:
                configs = selected_group_configs if isinstance(selected_group_configs, list) else [selected_group_configs]
                for group in configs:
                    groups_to_process.append((group.get('label', 'unknown'), group))

            # Process each group
            for group_key, group in groups_to_process:
                prompt_instructions = group.get('prompt_instructions')
                if not prompt_instructions:
                    context.logger.warning(f"No prompt_instructions for group '{group_key}', skipping")
                    continue

                merged_prompt += f"\n\n{prompt_instructions}"
                context.logger.info(f"Appended instructions for group: {group_key}")

            context.logger.info(
                f"Built merged prompt with {len(groups_to_process)} groups "
                f"({len(merged_prompt)} characters)"
            )

            return {
                "merged_prompt": merged_prompt
            }

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to build grouped prompt: {str(e)}",
                e
            )
