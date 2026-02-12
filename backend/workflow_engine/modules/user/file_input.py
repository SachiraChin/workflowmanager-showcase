"""
File Input Module - Prompt user for file path with validation and retry
"""

import os
import uuid6
from typing import Dict, Any, List, Optional
from ...engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse, SelectOption
)


class FileInputModule(InteractiveModule):
    """
    Module for prompting user for a file path with validation.

    Keeps asking until a valid file is provided or user requests jump back.
    Supports relative paths resolved from project folder.

    Inputs:
        - prompt: Prompt message to display
        - extensions: List of allowed file extensions (optional, e.g., [".png", ".jpg"])
        - retry_trigger_keyword: Keyword to trigger retry options (default: "r")
        - retry_options: Dict of retry option descriptions for jump_back

    Outputs:
        - value: The validated file path (absolute)
        - filename: Just the filename without path
        - jump_back_requested: Boolean if jump back was requested
        - jump_back_target: Target option ID if jump back requested
    """

    @property
    def module_id(self) -> str:
        return "user.file_input"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="prompt",
                type="string",
                required=True,
                description="Prompt message to display"
            ),
            ModuleInput(
                name="extensions",
                type="array",
                required=False,
                default=None,
                description="List of allowed file extensions (e.g., ['.png', '.jpg'])"
            ),
            ModuleInput(
                name="retry_trigger_keyword",
                type="string",
                required=False,
                default="r",
                description="Keyword to trigger retry/jump-back options"
            ),
            ModuleInput(
                name="retry_options",
                type="object",
                required=False,
                default={},
                description="Dict of retry option IDs to descriptions for jump_back"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="value",
                type="string",
                description="Validated absolute file path"
            ),
            ModuleOutput(
                name="filename",
                type="string",
                description="Just the filename without path"
            ),
            ModuleOutput(
                name="jump_back_requested",
                type="boolean",
                description="Whether jump back was requested"
            ),
            ModuleOutput(
                name="jump_back_target",
                type="string",
                description="Target option ID for jump back"
            )
        ]

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context
    ) -> Optional[InteractionRequest]:
        """Build the interaction request for file input"""
        prompt = inputs['prompt']
        extensions = self.get_input_value(inputs, 'extensions')
        retry_options = self.get_input_value(inputs, 'retry_options') or {}

        # Build extra options for jump back
        extra_options = []
        for jump_id, jump_config in retry_options.items():
            description = jump_config.get('description', jump_id) if isinstance(jump_config, dict) else jump_config
            extra_options.append(SelectOption(
                id=f"jump_{jump_id}",
                label=description,
                description=f"Jump back to {description}",
                metadata={'action': 'jump_back', 'target': jump_id}
            ))

        return InteractionRequest(
            interaction_id=f"file_input_{uuid6.uuid7().hex}",
            interaction_type=InteractionType.FILE_INPUT,
            title=prompt,
            options=[],
            min_selections=0,
            max_selections=0,
            allow_custom=True,
            extra_options=extra_options,
            display_data={
                'extensions': extensions
            },
            context={
                'extensions': extensions,
                'retry_options': retry_options
            }
        )

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """Process the user's file input and validate"""
        extensions = self.get_input_value(inputs, 'extensions')

        # Check for jump back selection
        if response.selected_options:
            opt = response.selected_options[0]
            metadata = opt.get('metadata', {}) if isinstance(opt, dict) else getattr(opt, 'metadata', {})
            if metadata.get('action') == 'jump_back':
                return {
                    "value": "",
                    "filename": "",
                    "jump_back_requested": True,
                    "jump_back_target": ""
                }

        # Get file value from response
        file_value = response.value or response.custom_value or ""

        if not file_value:
            raise ModuleExecutionError(
                self.module_id,
                "No file path provided",
                None
            )

        # Check if this is a data URL (sent by TUI after reading file locally)
        if file_value.startswith('data:'):
            # Data URL format: data:mime/type;base64,{data}
            # Extract mime type for extension validation if needed
            if extensions:
                # Parse mime type from data URL
                mime_part = file_value.split(';')[0]  # "data:image/png"
                mime_type = mime_part.replace('data:', '')  # "image/png"

                # Map mime types to extensions
                mime_to_ext = {
                    'image/png': '.png',
                    'image/jpeg': '.jpg',
                    'image/gif': '.gif',
                    'image/webp': '.webp',
                    'image/bmp': '.bmp',
                }
                ext = mime_to_ext.get(mime_type, '')
                ext_lower = ext.lower()
                allowed_lower = [e.lower() for e in extensions]

                if ext and ext_lower not in allowed_lower:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Invalid file type: {ext}. Allowed: {', '.join(extensions)}",
                        None
                    )

            context.logger.debug(f"Received base64 data URL (length: {len(file_value)})")
            return {
                "value": file_value,
                "filename": "uploaded_file",  # No filename available for data URLs
                "jump_back_requested": False,
                "jump_back_target": ""
            }

        # Legacy path: file path string (for backwards compatibility)
        file_path = file_value

        # Get project folder from context
        project_folder = None
        if hasattr(context, 'services') and context.services:
            project_folder = context.services.get('project_folder')

        # Resolve file path
        if not os.path.isabs(file_path):
            if project_folder:
                file_path = os.path.join(project_folder, file_path)
            else:
                file_path = os.path.abspath(file_path)

        # Normalize path
        file_path = os.path.normpath(file_path)

        # Validate file exists
        if not os.path.exists(file_path):
            raise ModuleExecutionError(
                self.module_id,
                f"File not found: {file_path}",
                None
            )

        if not os.path.isfile(file_path):
            raise ModuleExecutionError(
                self.module_id,
                f"Path is not a file: {file_path}",
                None
            )

        # Check extension if specified
        if extensions:
            _, ext = os.path.splitext(file_path)
            ext_lower = ext.lower()
            allowed_lower = [e.lower() for e in extensions]
            if ext_lower not in allowed_lower:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Invalid file type: {ext}. Allowed: {', '.join(extensions)}",
                    None
                )

        filename = os.path.basename(file_path)
        context.logger.debug(f"Valid file selected: {file_path}")

        return {
            "value": file_path,
            "filename": filename,
            "jump_back_requested": False,
            "jump_back_target": ""
        }
