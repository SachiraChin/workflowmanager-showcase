"""
Build Dynamic Schema Module - Dynamically builds JSON schema from selected groups
"""

from typing import Dict, Any, List
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError
import json


class BuildDynamicSchemaModule(ExecutableModule):
    """
    Module for building dynamic JSON schemas by merging group-specific schemas.

    Merges schema content for each selected group into a single schema.
    All schemas must be resolved via $ref before execution.

    Inputs:
        - data: Raw data object containing groups with resolved 'schema' content
        - selected_indices: Array of selected keys/indices
        - schema_key: Key in group config for schema content (default: 'schema')
        - root_property: Wrapper property name (default: 'prompts')

    Outputs:
        - merged_schema: Combined schema with all selected models
    """

    @property
    def module_id(self) -> str:
        return "transform.build_dynamic_schema"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="data",
                type="object",
                required=False,
                description="Raw data object containing groups with resolved 'schema' content"
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
            ),
            ModuleInput(
                name="schema_key",
                type="string",
                required=False,
                description="Key in group config for schema content (default: 'schema')"
            ),
            ModuleInput(
                name="root_property",
                type="string",
                required=False,
                description="Wrapper property name in schema (default: 'prompts')"
            ),
            ModuleInput(
                name="schema_paths",
                type="object",
                required=False,
                description="Mapping of group keys to resolved schema objects (via $ref)"
            ),
            ModuleInput(
                name="wrapper_schema",
                type="object",
                required=False,
                description="Base wrapper schema - selected group schemas will be merged into properties.<root_property>.properties"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="merged_schema",
                type="object",
                description="Merged JSON schema with all selected models"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute schema building"""
        try:
            data = self.get_input_value(inputs, 'data')
            selected_indices = self.get_input_value(inputs, 'selected_indices')
            selected_group_configs = self.get_input_value(inputs, 'selected_group_configs')
            schema_key = self.get_input_value(inputs, 'schema_key') or 'schema'
            root_property = self.get_input_value(inputs, 'root_property') or 'prompts'
            schema_paths = self.get_input_value(inputs, 'schema_paths') or {}
            wrapper_schema = self.get_input_value(inputs, 'wrapper_schema')

            context.logger.debug(f"inputs keys: {list(inputs.keys())}")
            context.logger.debug(f"wrapper_schema: {wrapper_schema}")
            context.logger.debug(f"schema_paths: {schema_paths}")
            context.logger.debug(f"selected_indices: {selected_indices} (type: {type(selected_indices).__name__})")
            context.logger.debug(f"data: {data}")

            # Initialize merged schema structure
            merged_properties = {}
            merged_required = []

            # Build list of groups to process
            groups_to_process = []

            context.logger.debug(f"Building groups_to_process: schema_paths={bool(schema_paths)}, selected_indices={selected_indices}, data={bool(data)}")

            # Option 1: schema_paths + selected_indices (no data needed)
            if schema_paths and selected_indices:
                for idx in selected_indices:
                    if idx in schema_paths:
                        groups_to_process.append((idx, None))  # group data not needed when using schema_paths
            # Option 2: data + selected_indices
            elif data and selected_indices:
                for idx in selected_indices:
                    if isinstance(data, dict) and idx in data:
                        groups_to_process.append((idx, data[idx]))
                    elif isinstance(data, list) and isinstance(idx, int) and 0 <= idx < len(data):
                        groups_to_process.append((idx, data[idx]))
            # Legacy: selected_group_configs array
            elif selected_group_configs:
                configs = selected_group_configs if isinstance(selected_group_configs, list) else [selected_group_configs]
                groups_to_process = [(g.get('label', 'unknown'), g) for g in configs]

            # Merge each group's schema
            context.logger.debug(f"schema_paths keys: {list(schema_paths.keys()) if schema_paths else 'None'}")
            context.logger.debug(f"groups_to_process: {[g[0] for g in groups_to_process]}")

            for group_key, group in groups_to_process:
                group_schema = None

                # Check schema_paths first (must be pre-resolved dict via $ref)
                if schema_paths and group_key in schema_paths:
                    schema_source = schema_paths[group_key]
                    context.logger.debug(f"schema_source for {group_key}: type={type(schema_source).__name__}, keys={list(schema_source.keys()) if isinstance(schema_source, dict) else 'N/A'}")
                    if isinstance(schema_source, dict):
                        group_schema = schema_source
                    else:
                        raise ModuleExecutionError(
                            self.module_id,
                            f"schema_paths['{group_key}'] must be a resolved schema object, not {type(schema_source).__name__}. Use $ref to resolve."
                        )
                elif isinstance(group, dict) and schema_key in group:
                    # Get schema from group config (must be pre-resolved via $ref)
                    schema_content = group[schema_key]
                    if isinstance(schema_content, dict):
                        group_schema = schema_content
                    else:
                        raise ModuleExecutionError(
                            self.module_id,
                            f"group['{schema_key}'] must be a resolved schema object, not {type(schema_content).__name__}. Use $ref to resolve."
                        )

                if not group_schema:
                    context.logger.warning(f"No schema for group '{group_key}', skipping")
                    continue

                # Extract properties and required from group schema
                # Expected structure: { "properties": { "<root_property>": { "properties": {...}, "required": [...] } } }
                context.logger.debug(f"group_schema keys: {list(group_schema.keys())}")
                root_schema = group_schema.get('properties', {}).get(root_property, {})
                context.logger.debug(f"root_schema keys for {root_property}: {list(root_schema.keys()) if root_schema else 'empty'}")
                group_properties = root_schema.get('properties', {})
                context.logger.debug(f"group_properties keys: {list(group_properties.keys())}")
                group_required = root_schema.get('required', [])

                # Merge into combined schema
                merged_properties.update(group_properties)
                merged_required.extend(group_required)

                context.logger.debug(
                    f"Merged schema for group '{group_key}': "
                    f"{len(group_properties)} properties, {len(group_required)} required"
                )

            # Build final merged schema
            if wrapper_schema:
                # Use provided wrapper schema and inject merged properties
                merged_schema = json.loads(json.dumps(wrapper_schema))  # Deep copy
                root_obj = merged_schema.get('properties', {}).get(root_property, {})
                root_obj['properties'] = merged_properties
                root_obj['required'] = merged_required
            else:
                # Build default wrapper (for API schemas)
                merged_schema = {
                    "type": "object",
                    "properties": {
                        root_property: {
                            "type": "object",
                            "properties": merged_properties,
                            "required": merged_required,
                            "additionalProperties": False
                        }
                    },
                    "required": [root_property],
                    "additionalProperties": False
                }
            context.logger.debug(f"Final merged_schema properties keys: {list(merged_properties.keys())}")
            # Log a sample of the first property to verify structure
            if merged_properties:
                first_key = list(merged_properties.keys())[0]
                first_val = merged_properties[first_key]
                context.logger.debug(f"Sample property '{first_key}' keys: {list(first_val.keys()) if isinstance(first_val, dict) else 'not a dict'}")

            context.logger.debug(
                f"Built merged schema with {len(merged_properties)} total properties, "
                f"{len(merged_required)} required fields"
            )

            return {
                "merged_schema": merged_schema
            }

        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to build dynamic schema: {str(e)}",
                e
            )
