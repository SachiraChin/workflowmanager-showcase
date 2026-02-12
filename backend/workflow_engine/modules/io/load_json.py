"""
Load JSON Module - Load data from database

Loads JSON data from the workflow_files collection.
"""

import json
from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError


class LoadJSONModule(ExecutableModule):
    """
    Module for loading data from database.

    Loads JSON from workflow_files collection by filename.

    Inputs:
        - file_path: Filename to load (e.g., 'scene_summary.json')
        - target_path: Where to look - 'root' for root, or a path like 'outputs/step1' (default: 'outputs')
        - default: Default value to return if file doesn't exist (optional)
        - required: Whether file must exist (default: True)

    Outputs:
        - data: Loaded JSON data
        - file_exists: Boolean indicating if file was found
        - file_id: Database file ID (if found)
    """

    @property
    def module_id(self) -> str:
        return "io.load_json"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="file_path",
                type="string",
                required=True,
                description="Filename to load (e.g., 'scene_summary.json')"
            ),
            ModuleInput(
                name="target_path",
                type="string",
                required=False,
                default="outputs",
                description="Where to look - 'root' for root, or a path like 'outputs/step1'"
            ),
            ModuleInput(
                name="default",
                type="object",
                required=False,
                default=None,
                description="Default value if file doesn't exist"
            ),
            ModuleInput(
                name="required",
                type="boolean",
                required=False,
                default=True,
                description="Whether file must exist"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="data",
                type="object",
                description="Loaded JSON data"
            ),
            ModuleOutput(
                name="file_exists",
                type="boolean",
                description="Whether file was found"
            ),
            ModuleOutput(
                name="file_id",
                type="string",
                description="Database file ID (if found)"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute JSON load from database"""
        try:
            file_path = inputs['file_path']
            target_path = self.get_input_value(inputs, 'target_path')
            default = self.get_input_value(inputs, 'default')
            required = self.get_input_value(inputs, 'required')

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

            # Query database for the file
            file_doc = context.db.file_repo.get_workflow_file_by_name(
                workflow_run_id=context.workflow_run_id,
                filename=filename,
                category=category,
                group_id=group_id,
                branch_id=getattr(context, 'branch_id', None)
            )

            # Check if file exists
            if not file_doc:
                if required:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Required file not found: {filename} (target_path={target_path})",
                        None
                    )
                else:
                    context.logger.debug(f"File not found, using default: {filename}")
                    return {
                        "data": default,
                        "file_exists": False,
                        "file_id": None
                    }

            # Get data from document
            data = file_doc.get("content")
            file_id = file_doc.get("file_id")

            # If content_type is text but we expected JSON, parse it
            if file_doc.get("content_type") == "text" and isinstance(data, str):
                try:
                    data = json.loads(data)
                except json.JSONDecodeError as e:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Content is not valid JSON: {str(e)}",
                        e
                    )

            context.logger.debug(f"✓ Loaded JSON from database: {filename} (file_id={file_id})")

            return {
                "data": data,
                "file_exists": True,
                "file_id": file_id
            }

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Unexpected error: {str(e)}",
                e
            )
