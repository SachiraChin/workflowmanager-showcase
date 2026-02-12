"""
Client Write Module - Write files to client's project folder

Sends file content to TUI via FILE_DOWNLOAD interaction. The TUI writes the file
to the project folder and responds with success/failure. This ensures the file
is written before the workflow continues.
"""

import json
import uuid6
from typing import Dict, Any, List, Optional
from ...engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse
)


class ClientWriteModule(InteractiveModule):
    """
    Module for writing files to the client's project folder.

    Sends file content to TUI via FILE_DOWNLOAD interaction. TUI writes the file
    and responds with confirmation, ensuring the file is written before workflow
    continues.

    Inputs:
        - content: Data to write (string or object)
        - filename: Target filename (e.g., 'workflow_summary.txt')
        - format: Optional format hint - "json" or "text" (default: auto-detect)
        - destination: Where to write - "root" (project folder) or "ws" (default: "root")

    Outputs:
        - file_path: Absolute path where file was written
        - filename: The filename used
        - success: Boolean indicating success
    """

    @property
    def module_id(self) -> str:
        return "io.client_write"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="content",
                type="any",
                required=True,
                description="Data to write (string or object)"
            ),
            ModuleInput(
                name="filename",
                type="string",
                required=True,
                description="Target filename (e.g., 'workflow_summary.txt')"
            ),
            ModuleInput(
                name="format",
                type="string",
                required=False,
                default=None,
                description="Format hint: 'json' or 'text' (default: auto-detect from filename)"
            ),
            ModuleInput(
                name="destination",
                type="string",
                required=False,
                default="root",
                description="Where to write: 'root' (project folder) or 'ws' (ws subfolder)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="file_path",
                type="string",
                description="Absolute path where file was written"
            ),
            ModuleOutput(
                name="filename",
                type="string",
                description="The filename used"
            ),
            ModuleOutput(
                name="success",
                type="boolean",
                description="Whether write was successful"
            )
        ]

    def requires_interaction(self) -> bool:
        """This module always requires TUI interaction to write the file"""
        return True

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context
    ) -> Optional[InteractionRequest]:
        """Build the interaction request for file download"""
        content = inputs['content']
        filename = inputs['filename']
        format_hint = self.get_input_value(inputs, 'format')
        destination = self.get_input_value(inputs, 'destination')

        # Auto-detect format from filename if not specified
        if format_hint is None:
            if filename.endswith('.json'):
                format_hint = 'json'
            else:
                format_hint = 'text'

        # Process content based on format
        if format_hint == 'json':
            # Ensure content is JSON-serializable
            if isinstance(content, str):
                try:
                    content = json.loads(content)
                except json.JSONDecodeError:
                    # Not valid JSON string, keep as-is
                    pass
            content_type = "json"
        else:
            # Convert to string if needed
            if not isinstance(content, str):
                content = str(content)
            content_type = "text"

        context.logger.info(f"Requesting TUI to write file: {filename}")

        return InteractionRequest(
            interaction_type=InteractionType.FILE_DOWNLOAD,
            interaction_id=f"file_download_{uuid6.uuid7().hex}",
            title=f"Writing {filename} to project folder",
            file_content=content,
            file_name=filename,
            file_content_type=content_type,
            file_destination=destination,
            context={
                "module_id": self.module_id,
                "step_id": getattr(context, 'step_id', None)
            }
        )

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """Execute with the TUI's file write response"""
        filename = inputs['filename']

        if response.cancelled:
            raise ModuleExecutionError(
                self.module_id,
                f"File write cancelled: {filename}",
                None
            )

        if not response.file_written:
            error_msg = response.file_error or "Unknown error"
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to write file {filename}: {error_msg}",
                None
            )

        context.logger.info(f"File written successfully: {response.file_path}")

        return {
            "file_path": response.file_path,
            "filename": filename,
            "success": True
        }
