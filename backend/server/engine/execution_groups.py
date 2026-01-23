"""
Execution Groups Processor - Handles pipeline.execution_groups meta-module.

The execution_groups meta-module defines client-specific execution paths within
a workflow. This processor:

1. Scans a resolved workflow for execution_groups modules
2. Generates all possible path combinations using itertools.product
3. Flattens each combination into a separate workflow by inlining selected modules
4. Returns flattened workflows with their capability requirements

This processing happens at workflow upload time. At runtime, clients receive
pre-flattened workflows based on their declared capabilities.
"""

import copy
import logging
from itertools import product
from typing import Dict, Any, List, Tuple, Optional

_logger = logging.getLogger(__name__)

# Module ID for execution groups meta-module
EXECUTION_GROUPS_MODULE_ID = "pipeline.execution_groups"


class ExecutionGroupsProcessor:
    """
    Processes pipeline.execution_groups meta-modules in workflows.

    Execution groups allow workflow authors to define alternative module sequences
    for different client capabilities (e.g., WebUI vs TUI paths).
    """

    def find_execution_groups(self, workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Find all execution_groups modules in a workflow.

        Args:
            workflow: Resolved workflow dictionary

        Returns:
            List of execution_groups module definitions with their location info:
            [
                {
                    "step_index": int,
                    "module_index": int,
                    "step_id": str,
                    "module": dict  # The execution_groups module definition
                }
            ]
        """
        groups = []

        for step_idx, step in enumerate(workflow.get("steps", [])):
            for mod_idx, module in enumerate(step.get("modules", [])):
                if module.get("module_id") == EXECUTION_GROUPS_MODULE_ID:
                    groups.append({
                        "step_index": step_idx,
                        "module_index": mod_idx,
                        "step_id": step.get("step_id", f"step_{step_idx}"),
                        "module": module
                    })

        return groups

    def generate_combinations(
        self,
        execution_groups: List[Dict[str, Any]]
    ) -> List[Dict[str, str]]:
        """
        Generate all path combinations from execution groups.

        Uses itertools.product to create cartesian product of all path choices.

        Args:
            execution_groups: List of execution group info from find_execution_groups()

        Returns:
            List of path selection dicts: [{group_name: path_name}, ...]

        Example:
            For groups with paths:
                group1: [webui_path, tui_path]
                group2: [webui_path, tui_path]

            Returns:
                [
                    {"group1": "webui_path", "group2": "webui_path"},
                    {"group1": "webui_path", "group2": "tui_path"},
                    {"group1": "tui_path", "group2": "webui_path"},
                    {"group1": "tui_path", "group2": "tui_path"},
                ]
        """
        if not execution_groups:
            return [{}]  # Single empty selection (no groups)

        # Build list of (group_name, [path_names]) for each group
        group_paths = []
        for eg in execution_groups:
            module = eg["module"]
            group_name = module.get("name", f"unnamed_group_{eg['step_index']}_{eg['module_index']}")
            paths = [g["name"] for g in module.get("groups", [])]
            group_paths.append((group_name, paths))

        # Generate cartesian product
        path_lists = [paths for _, paths in group_paths]
        group_names = [name for name, _ in group_paths]

        combinations = []
        for combo in product(*path_lists):
            selection = dict(zip(group_names, combo))
            combinations.append(selection)

        _logger.debug(f"Generated {len(combinations)} path combinations from {len(group_paths)} groups")
        return combinations

    def flatten_workflow(
        self,
        workflow: Dict[str, Any],
        selected_paths: Dict[str, str]
    ) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, str]]:
        """
        Flatten a workflow by inlining selected execution paths.

        Replaces each pipeline.execution_groups module with the modules from
        the selected path. Adds _group_origin metadata to inlined modules for
        debugging. Optionally adds io.validate module at group exit.

        Args:
            workflow: Resolved workflow dictionary
            selected_paths: Dict mapping group names to selected path names

        Returns:
            Tuple of:
                - Flattened workflow dict (deep copy, original unchanged)
                - Merged requires list: [{"capability": str, "priority": int}, ...]
                - Selected paths mapping (same as input, for reference)
        """
        result = copy.deepcopy(workflow)
        all_requires = []

        for step in result.get("steps", []):
            new_modules = []

            for module in step.get("modules", []):
                if module.get("module_id") == EXECUTION_GROUPS_MODULE_ID:
                    group_name = module.get("name")
                    output_schema = module.get("output_schema")

                    # Get selected path
                    selected_path_name = selected_paths.get(group_name)
                    if not selected_path_name:
                        _logger.warning(
                            f"No path selected for group '{group_name}', "
                            f"using first available"
                        )
                        selected_path_name = module["groups"][0]["name"]

                    # Find the selected group
                    selected_group = None
                    for g in module.get("groups", []):
                        if g["name"] == selected_path_name:
                            selected_group = g
                            break

                    if not selected_group:
                        raise ValueError(
                            f"Path '{selected_path_name}' not found in group '{group_name}'"
                        )

                    # Collect requires from selected group
                    group_requires = selected_group.get("requires", [])
                    all_requires.extend(group_requires)

                    # Inline modules from selected path with metadata
                    for i, inner_module in enumerate(selected_group.get("modules", [])):
                        inner_copy = copy.deepcopy(inner_module)
                        # Add expansion metadata inside _metadata for consistency
                        # expanded_from: generic field for any meta-module expansion
                        # _group_origin: detailed context specific to execution_groups
                        inner_copy["_metadata"] = {
                            **inner_copy.get("_metadata", {}),
                            "expanded_from": group_name,
                            "expanded_index": i,
                            "_group_origin": {
                                "group_name": group_name,
                                "path_name": selected_path_name,
                                "requires": group_requires,
                            }
                        }
                        new_modules.append(inner_copy)

                    # Add io.validate at group exit if output_schema defined
                    if output_schema:
                        validator = self._create_validator_module(
                            group_name, selected_path_name, output_schema
                        )
                        new_modules.append(validator)
                else:
                    # Regular module, keep as-is
                    new_modules.append(module)

            step["modules"] = new_modules

        return result, all_requires, selected_paths

    def _create_validator_module(
        self,
        group_name: str,
        path_name: str,
        output_schema: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Create an io.validate module for group exit validation.

        Args:
            group_name: Name of the execution group
            path_name: Name of the selected path
            output_schema: JSON Schema to validate against

        Returns:
            Module definition for io.validate
        """
        # Extract state keys from schema properties
        state_keys = list(output_schema.get("properties", {}).keys())

        return {
            "module_id": "io.validate",
            "name": f"_{group_name}_validator",
            "inputs": {
                "schema": output_schema,
                "state_keys": state_keys
            },
            "_metadata": {
                "expanded_from": group_name,
                "expanded_index": -1,  # -1 indicates auto-generated at end
                "_group_origin": {
                    "group_name": group_name,
                    "path_name": path_name,
                    "is_group_exit": True,
                    "auto_generated": True
                }
            }
        }

    def process_workflow(
        self,
        workflow: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Process a workflow and generate all flattened variations.

        This is the main entry point for execution groups processing.

        Args:
            workflow: Resolved workflow dictionary (after $ref resolution)

        Returns:
            List of flattening results, each containing:
            {
                "flattened_workflow": dict,     # The flattened workflow
                "requires": list,               # Capability requirements
                "selected_paths": dict          # Path selections for this variation
            }

            For workflows without execution_groups, returns single item
            with requires=[] and selected_paths={}.
        """
        # Find all execution groups
        execution_groups = self.find_execution_groups(workflow)

        if not execution_groups:
            # No execution groups - return single "resolution" with original workflow
            _logger.debug("No execution_groups found, returning original workflow")
            return [{
                "flattened_workflow": workflow,
                "requires": [],
                "selected_paths": {}
            }]

        _logger.info(f"Found {len(execution_groups)} execution_groups modules")

        # Generate all combinations
        combinations = self.generate_combinations(execution_groups)
        _logger.info(f"Generated {len(combinations)} path combinations")

        # Flatten workflow for each combination
        results = []
        for selected_paths in combinations:
            flattened, requires, paths = self.flatten_workflow(workflow, selected_paths)
            results.append({
                "flattened_workflow": flattened,
                "requires": requires,
                "selected_paths": paths
            })

            _logger.debug(
                f"Flattened for paths {paths}: "
                f"{len(requires)} capability requirements"
            )

        return results


def process_execution_groups(workflow: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Convenience function to process execution groups in a workflow.

    Args:
        workflow: Resolved workflow dictionary

    Returns:
        List of flattening results (see ExecutionGroupsProcessor.process_workflow)
    """
    processor = ExecutionGroupsProcessor()
    return processor.process_workflow(workflow)
