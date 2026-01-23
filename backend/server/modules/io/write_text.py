"""
Write Text Module - Write text content to database

Stores text data in the workflow_files collection instead of filesystem.
"""

from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class WriteTextModule(ExecutableModule):
    """
    Module for writing text content to database.

    Stores text in workflow_files collection.

    Inputs:
        - content: Text content to write
        - file_path: Filename to use (e.g., 'summary.txt')
        - target_path: Where to save - 'root' for root, or a path like 'outputs/step1' (default: 'outputs')

    Outputs:
        - file_id: Database file ID where content was saved
        - file_path: The filename used (for backward compatibility)
        - bytes_written: Number of bytes written
    """

    @property
    def module_id(self) -> str:
        return "io.write_text"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="content",
                type="string",
                required=True,
                description="Text content to write"
            ),
            ModuleInput(
                name="file_path",
                type="string",
                required=True,
                description="Filename to use (e.g., 'summary.txt')"
            ),
            ModuleInput(
                name="target_path",
                type="string",
                required=False,
                default="outputs",
                description="Where to save - 'root' for root, or a path like 'outputs/step1'"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="file_id",
                type="string",
                description="Database file ID where content was saved"
            ),
            ModuleOutput(
                name="file_path",
                type="string",
                description="The filename used (for backward compatibility)"
            ),
            ModuleOutput(
                name="bytes_written",
                type="number",
                description="Number of bytes written"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute text write to database"""
        try:
            content = inputs['content']
            file_path = inputs['file_path']
            target_path = self.get_input_value(inputs, 'target_path')

            # Determine category and group_id from target_path
            if target_path == "root":
                category = "root"
                group_id = None
            else:
                category = "outputs"
                group_id = target_path if target_path != "outputs" else None

            # Extract just the filename (in case file_path has path separators)
            import os.path
            filename = os.path.basename(file_path)

            # Calculate bytes
            bytes_written = len(content.encode('utf-8'))

            # Store in database
            file_id = context.db.file_repo.store_workflow_file(
                workflow_run_id=context.workflow_run_id,
                category=category,
                group_id=group_id,
                filename=filename,
                content=content,
                content_type="text",
                metadata={
                    "step_id": getattr(context, 'step_id', None),
                    "target_path": target_path
                },
                branch_id=getattr(context, 'branch_id', None)
            )

            context.logger.info(f"Wrote text to database: {filename} (file_id={file_id})")
            context.logger.debug(f"Bytes written: {bytes_written}")

            return {
                "file_id": file_id,
                "file_path": filename,
                "bytes_written": bytes_written
            }

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to write text: {str(e)}",
                e
            )
