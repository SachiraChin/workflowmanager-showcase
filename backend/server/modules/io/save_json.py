"""
Save JSON Module - Save data to database

Stores JSON data in the workflow_files collection instead of filesystem.
"""

import json
from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class SaveJSONModule(ExecutableModule):
    """
    Module for saving data to database.

    Stores JSON in workflow_files collection.

    Inputs:
        - data: Data to save (can be JSON string or object)
        - file_path: Filename to use (e.g., 'scene_summary.json')
        - target_path: Where to save - 'root' for root, or a path like 'outputs/step1' (default: 'outputs')

    Outputs:
        - file_id: Database file ID where data was saved
        - file_path: The filename used (for backward compatibility)
        - success: Boolean indicating success
    """

    @property
    def module_id(self) -> str:
        return "io.save_json"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="data",
                type="object",
                required=True,
                description="Data to save (can be JSON string or object)"
            ),
            ModuleInput(
                name="file_path",
                type="string",
                required=True,
                description="Filename to use (e.g., 'scene_summary.json')"
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
                description="Database file ID where data was saved"
            ),
            ModuleOutput(
                name="file_path",
                type="string",
                description="The filename used (for backward compatibility)"
            ),
            ModuleOutput(
                name="success",
                type="boolean",
                description="Whether save was successful"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute JSON save to database"""
        try:
            data = inputs['data']
            file_path = inputs['file_path']
            target_path = self.get_input_value(inputs, 'target_path')

            # Parse data if it's a JSON string
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except json.JSONDecodeError as e:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Data is a string but not valid JSON: {str(e)}",
                        e
                    )

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

            # Store in database
            file_id = context.db.file_repo.store_workflow_file(
                workflow_run_id=context.workflow_run_id,
                category=category,
                group_id=group_id,
                filename=filename,
                content=data,
                content_type="json",
                metadata={
                    "step_id": getattr(context, 'step_id', None),
                    "target_path": target_path
                },
                branch_id=getattr(context, 'branch_id', None)
            )

            context.logger.info(f"Saved JSON to database: {filename} (file_id={file_id})")

            return {
                "file_id": file_id,
                "file_path": filename,
                "success": True
            }

        except (TypeError, ValueError) as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Data is not JSON-serializable: {str(e)}",
                e
            )
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Unexpected error: {str(e)}",
                e
            )
