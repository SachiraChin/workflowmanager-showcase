"""
Text Input Module - Get text input from user
"""

import re
import uuid6
from typing import Dict, Any, List, Optional
from ...engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse, SelectOption
)


class TextInputModule(InteractiveModule):
    """
    Module for getting text input from user via terminal.

    Inputs:
        - prompt: Text prompt to display to user
        - default: Default value if user presses Enter (optional)
        - allow_empty: Whether to allow empty input (default: False)

    Outputs:
        - value: User's input as string
    """

    @property
    def module_id(self) -> str:
        return "user.text_input"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="prompt",
                type="string",
                required=True,
                description="Prompt text to display to user"
            ),
            ModuleInput(
                name="default",
                type="string",
                required=False,
                default="",
                description="Default value if user presses Enter"
            ),
            ModuleInput(
                name="allow_empty",
                type="boolean",
                required=False,
                default=False,
                description="Whether to allow empty input"
            ),
            ModuleInput(
                name="retry_trigger_keyword",
                type="string",
                required=False,
                default=None,
                description="Keyword to trigger retry menu (e.g., 'r'). If provided and user enters this keyword, a retry menu will be shown"
            ),
            ModuleInput(
                name="retry_options",
                type="object",
                required=False,
                default={},
                description="Dict of retry/jump_back options to show when retry trigger is activated. Format: {option_id: {description, ...}}"
            ),
            ModuleInput(
                name="validation_pattern",
                type="string",
                required=False,
                default=None,
                description="Regex pattern to validate input. If multi-value, validates each segment after splitting."
            ),
            ModuleInput(
                name="validation_separator",
                type="string",
                required=False,
                default=None,
                description="Separator to split input before validation (e.g., ' ' or ','). If None, validates entire input as one."
            ),
            ModuleInput(
                name="validation_separator_is_regex",
                type="boolean",
                required=False,
                default=False,
                description="Whether validation_separator is a regex pattern"
            ),
            ModuleInput(
                name="validation_error",
                type="string",
                required=False,
                default="Invalid format. Please check your input and try again.",
                description="Custom error message when validation fails"
            ),
            ModuleInput(
                name="require_at_least_one_match",
                type="boolean",
                required=False,
                default=True,
                description="Require at least one valid match when using multi-value validation"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="value",
                type="string",
                description="User's input text"
            ),
            ModuleOutput(
                name="jump_back_requested",
                type="boolean",
                description="Whether jump back was requested via retry trigger"
            ),
            ModuleOutput(
                name="jump_back_target",
                type="string",
                description="Target for jump back (option ID from retry menu)"
            )
        ]

    def requires_interaction(self) -> bool:
        """This module always requires user interaction"""
        return True

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context
    ) -> Optional[InteractionRequest]:
        """Build the interaction request for text input"""
        prompt = inputs['prompt']
        default = self.get_input_value(inputs, 'default')
        allow_empty = self.get_input_value(inputs, 'allow_empty')
        retry_options = self.get_input_value(inputs, 'retry_options')

        # Validation config
        validation_pattern = self.get_input_value(inputs, 'validation_pattern')
        validation_separator = self.get_input_value(inputs, 'validation_separator')
        validation_separator_is_regex = self.get_input_value(inputs, 'validation_separator_is_regex')
        validation_error = self.get_input_value(inputs, 'validation_error')
        require_at_least_one_match = self.get_input_value(inputs, 'require_at_least_one_match')

        # Build extra options from retry_options
        extra_opts = []
        if retry_options:
            for opt_id, opt_config in retry_options.items():
                extra_opts.append(SelectOption(
                    id=opt_id,
                    label=opt_config.get('description', opt_id),
                    description="",
                    metadata=opt_config
                ))

        # Build context with validation config
        request_context = {
            "module_id": self.module_id
        }

        if validation_pattern:
            request_context["validation"] = {
                "pattern": validation_pattern,
                "separator": validation_separator,
                "separator_is_regex": validation_separator_is_regex,
                "error": validation_error,
                "require_at_least_one_match": require_at_least_one_match
            }

        return InteractionRequest(
            interaction_type=InteractionType.TEXT_INPUT,
            interaction_id=f"text_input_{uuid6.uuid7().hex}",
            title=prompt,
            default_value=default or "",
            allow_empty=allow_empty,
            multiline=False,
            extra_options=extra_opts,
            context=request_context
        )

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """Execute with the user's text input response"""
        if response.cancelled:
            raise ModuleExecutionError(
                self.module_id,
                "User cancelled input",
                None
            )

        # Check for jump back
        if response.jump_back_requested:
            return {
                "value": "",
                "jump_back_requested": True,
                "jump_back_target": response.jump_back_target
            }

        # Normal text input
        value = response.value if response.value else ""
        default = self.get_input_value(inputs, 'default')

        # Apply default if empty
        if not value and default:
            value = default

        # Validate if pattern provided
        validation_pattern = self.get_input_value(inputs, 'validation_pattern')
        if validation_pattern and value:
            is_valid, error_msg, invalid_segments = self._validate_input(value, inputs)
            if not is_valid:
                # Build feedback message
                feedback = error_msg
                if invalid_segments:
                    feedback += f" Invalid: {', '.join(invalid_segments)}"
                context.logger.warning(f"Validation failed: {feedback}")

                return {
                    "value": value,
                    "retry_requested": True,
                    "retry_feedback": feedback,
                    "jump_back_requested": False,
                    "jump_back_target": ""
                }

        return {
            "value": value,
            "retry_requested": False,
            "retry_feedback": "",
            "jump_back_requested": False,
            "jump_back_target": ""
        }

    def _validate_input(self, user_input: str, inputs: Dict[str, Any]) -> tuple:
        """
        Validate user input against pattern.

        Returns:
            (is_valid, error_message, invalid_segments)
        """
        pattern = self.get_input_value(inputs, 'validation_pattern')
        separator = self.get_input_value(inputs, 'validation_separator')
        separator_is_regex = self.get_input_value(inputs, 'validation_separator_is_regex')
        error_msg = self.get_input_value(inputs, 'validation_error')
        require_at_least_one = self.get_input_value(inputs, 'require_at_least_one_match')

        if not pattern:
            return True, "", []

        try:
            compiled_pattern = re.compile(pattern)
        except re.error:
            # Invalid pattern - skip validation
            return True, "", []

        # Split input if separator provided
        if separator:
            if separator_is_regex:
                segments = re.split(separator, user_input)
            else:
                segments = user_input.split(separator)
            # Clean up segments
            segments = [s.strip() for s in segments if s.strip()]
        else:
            segments = [user_input.strip()]

        if not segments:
            return False, error_msg, []

        # Validate each segment
        valid_count = 0
        invalid_segments = []

        for segment in segments:
            if compiled_pattern.match(segment):
                valid_count += 1
            else:
                invalid_segments.append(f"'{segment}'")

        # Check validation result
        if invalid_segments:
            return False, error_msg, invalid_segments

        if require_at_least_one and valid_count == 0:
            return False, error_msg, []

        return True, "", []

    def _show_retry_menu(self, retry_options: Dict[str, Dict[str, str]], context) -> Optional[str]:
        """
        Display retry menu and get user selection (legacy CLI mode)

        Args:
            retry_options: Dict mapping option IDs to {description, target_step_id, target_module_name}
            context: Execution context

        Returns:
            Selected option ID or None if cancelled
        """
        # No logging - UI content handled by TUI
        options_list = list(retry_options.items())

        while True:
            if hasattr(context, 'router') and context.router:
                user_input = context.router.prompt(f"Select option (1-{len(options_list) + 1}): ").strip()
            else:
                user_input = input(f"Select option (1-{len(options_list) + 1}): ").strip()

            try:
                selection = int(user_input)
                if 1 <= selection <= len(options_list):
                    option_id = options_list[selection - 1][0]
                    return option_id
                elif selection == len(options_list) + 1:
                    # Cancel - return None
                    return None
                else:
                    context.logger.warning(f"Please enter a number between 1 and {len(options_list) + 1}.")
            except ValueError:
                context.logger.warning(f"Invalid input. Please enter a number.")
