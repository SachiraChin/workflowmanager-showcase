"""
Pause Module - Block execution until user presses Enter to continue
"""

from typing import Dict, Any, List, Optional
import json
import uuid6
from ...engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse
)


class PauseModule(InteractiveModule):
    """
    Module that pauses workflow execution until user presses Enter.

    Useful for:
    - Debugging workflows
    - Checkpoints before expensive operations
    - Reviewing intermediate state
    - Testing Jinja2 templates before using in prompts

    Inputs:
        - message: Message to display (optional)
        - show_state: List of state keys to display (optional)
        - jinja2_test: Jinja2 template to render and display (optional)

    Outputs:
        - confirmed: Always True when user continues
    """

    @property
    def module_id(self) -> str:
        return "user.pause"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="message",
                type="string",
                required=False,
                default="Press Enter to continue...",
                description="Message to display to user"
            ),
            ModuleInput(
                name="show_state",
                type="array",
                required=False,
                default=[],
                description="List of state keys to display before pausing"
            ),
            ModuleInput(
                name="jinja2_test",
                type="string",
                required=False,
                default=None,
                description="Jinja2 template to render and display (has access to 'state' variable)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="confirmed",
                type="boolean",
                description="True when user confirms to continue"
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
        """Build the interaction request for pause confirmation"""
        message = self.get_input_value(inputs, 'message')
        show_state = self.get_input_value(inputs, 'show_state') or []
        jinja2_test = inputs.get('jinja2_test')

        state = getattr(context, 'state', {})

        # Build display message with optional state info
        display_parts = []

        # Show raw state values
        if show_state:
            display_parts.append("=== State Debug ===")
            for key in show_state:
                value = state.get(key, "<not set>")
                # Format value nicely
                try:
                    if isinstance(value, (dict, list)):
                        value_str = json.dumps(value, indent=2, ensure_ascii=False)
                    else:
                        value_str = str(value)
                except Exception:
                    value_str = str(value)

                # Truncate very long values
                if len(value_str) > 1000:
                    value_str = value_str[:1000] + "\n... (truncated)"

                display_parts.append(f"\n[{key}]:")
                display_parts.append(value_str)
            display_parts.append("\n===================\n")

        # Render and show Jinja2 template
        if jinja2_test:
            display_parts.append("=== Jinja2 Template Test ===")
            display_parts.append(f"Template: {jinja2_test[:100]}{'...' if len(jinja2_test) > 100 else ''}")
            display_parts.append("\nRendered output:")
            display_parts.append("-" * 40)

            try:
                from jinja2 import Template
                template = Template(jinja2_test)
                # Convert StateProxy to dict for Jinja2 attribute access
                state_dict = state.get_all_state() if hasattr(state, 'get_all_state') else dict(state)
                rendered = template.render(state=state_dict)
                display_parts.append(rendered)
            except Exception as e:
                display_parts.append(f"ERROR: {e}")

            display_parts.append("-" * 40)
            display_parts.append("============================\n")

        display_parts.append(message)
        full_message = "\n".join(display_parts)

        # Use TEXT_INPUT with allow_empty=True for simple "press Enter" behavior
        # Content is shown via default_value with multiline=True for proper display
        return InteractionRequest(
            interaction_type=InteractionType.TEXT_INPUT,
            interaction_id=f"pause_{uuid6.uuid7().hex}",
            title="Preview",
            default_value=full_message,
            allow_empty=True,
            multiline=True,
            context={
                "module_id": self.module_id,
                "pause": True
            }
        )

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """Execute after user confirms"""
        if response.cancelled:
            raise ModuleExecutionError(
                self.module_id,
                "User cancelled",
                None
            )

        return {
            "confirmed": True
        }
