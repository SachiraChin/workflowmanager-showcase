"""
Workflow Resolver - Resolves $ref references at upload time.

Takes a virtual filesystem (in-memory dict from extracted zip) and resolves
all $ref nodes into a fully-populated JSON structure. The resolved JSON is
stored in the database and used at runtime - no file access needed during
workflow execution.

$ref resolution:
- {"$ref": "path/to/file.json", "type": "json"} → inlines the parsed JSON object
- {"$ref": "path/to/file.txt", "type": "text"} → inlines the string content
- {"$ref": "path/to/file.j2", "type": "jinja2"} → inlines the template string
- {"$ref": "path/to/file.txt", "type": "raw"} → inlines the raw string content

All paths are relative to the workflow root directory.
"""

import json
import logging
from typing import Dict, Any, Optional, Set
from pathlib import PurePosixPath

_logger = logging.getLogger(__name__)


class WorkflowResolver:
    """
    Resolves all $ref references in a workflow definition.

    Converts a workflow with file references into a fully-populated
    JSON structure that can be stored in the database and used at
    runtime without any file access.
    """

    def __init__(self, virtual_fs: Dict[str, str]):
        """
        Initialize the resolver.

        Args:
            virtual_fs: Dictionary mapping file paths to their contents.
                       All paths should be normalized (forward slashes, no leading ./).
        """
        self.virtual_fs = virtual_fs
        self._resolved_refs: Set[str] = set()  # Track resolved refs to detect cycles

    def resolve(self, entry_point: str) -> Dict[str, Any]:
        """
        Resolve all $refs starting from the entry point workflow file.

        Args:
            entry_point: Path to the main workflow JSON file within virtual_fs

        Returns:
            Fully-resolved workflow JSON with all $refs inlined

        Raises:
            FileNotFoundError: If entry point or referenced file not found
            ValueError: If circular reference detected or invalid $ref format
            json.JSONDecodeError: If JSON parsing fails
        """
        # Normalize entry point path
        normalized_path = self._normalize_path(entry_point)

        if normalized_path not in self.virtual_fs:
            available = list(self.virtual_fs.keys())[:10]
            raise FileNotFoundError(
                f"Entry point not found: {entry_point} (normalized: {normalized_path}). "
                f"Available files: {available}..."
            )

        # Load and parse the entry point
        content = self.virtual_fs[normalized_path]
        try:
            workflow = json.loads(content)
        except json.JSONDecodeError as e:
            raise json.JSONDecodeError(
                f"Invalid JSON in entry point '{entry_point}': {e.msg}",
                e.doc, e.pos
            )

        # Get base directory for relative path resolution
        base_dir = str(PurePosixPath(normalized_path).parent)
        if base_dir == '.':
            base_dir = ''

        # Resolve all $refs recursively
        self._resolved_refs.clear()
        return self._resolve_value(workflow, base_dir)

    def _resolve_value(self, value: Any, base_dir: str) -> Any:
        """
        Recursively resolve $refs in a value.

        Args:
            value: Any JSON value (dict, list, string, etc.)
            base_dir: Base directory for resolving relative paths

        Returns:
            Resolved value with all $refs inlined
        """
        if isinstance(value, dict):
            # Check if this is a $ref node
            if '$ref' in value:
                return self._resolve_ref(value, base_dir)

            # Recursively resolve all values in the dict
            return {k: self._resolve_value(v, base_dir) for k, v in value.items()}

        elif isinstance(value, list):
            # Recursively resolve all items in the list
            return [self._resolve_value(item, base_dir) for item in value]

        else:
            # Primitive value, return as-is
            return value

    def _resolve_ref(self, ref_node: Dict[str, Any], base_dir: str) -> Any:
        """
        Resolve a single $ref node.

        Args:
            ref_node: Dict containing $ref and optional type
            base_dir: Base directory for resolving relative paths

        Returns:
            Resolved content (object for json type, string for others)

        Raises:
            FileNotFoundError: If referenced file not found
            ValueError: If circular reference or invalid format
        """
        ref_path = ref_node.get('$ref')
        ref_type = ref_node.get('type', 'text')

        if not isinstance(ref_path, str):
            raise ValueError(f"$ref value must be a string, got {type(ref_path).__name__}")

        if ref_type not in ('text', 'json', 'jinja2', 'raw', 'template'):
            raise ValueError(
                f"$ref type must be 'text', 'json', 'jinja2', 'raw', or 'template', "
                f"got '{ref_type}'"
            )

        # Resolve the path relative to base_dir
        if ref_path.startswith('/'):
            # Absolute path within virtual_fs
            full_path = ref_path[1:]  # Remove leading /
        else:
            # Relative path
            if base_dir:
                full_path = f"{base_dir}/{ref_path}"
            else:
                full_path = ref_path

        # Normalize the path
        full_path = self._normalize_path(full_path)

        # Check for circular references
        if full_path in self._resolved_refs:
            raise ValueError(f"Circular reference detected: {full_path}")

        # Look up in virtual filesystem
        if full_path not in self.virtual_fs:
            available = [p for p in self.virtual_fs.keys() if ref_path in p][:5]
            raise FileNotFoundError(
                f"Referenced file not found: {ref_path} (resolved to: {full_path}). "
                f"Similar files: {available}"
            )

        # Mark as being resolved (for cycle detection)
        self._resolved_refs.add(full_path)

        try:
            content = self.virtual_fs[full_path]

            if ref_type == 'json':
                # Parse JSON and recursively resolve any nested $refs
                try:
                    parsed = json.loads(content)
                except json.JSONDecodeError as e:
                    raise json.JSONDecodeError(
                        f"Invalid JSON in '{ref_path}': {e.msg}",
                        e.doc, e.pos
                    )

                # Get the new base_dir for this file
                new_base_dir = str(PurePosixPath(full_path).parent)
                if new_base_dir == '.':
                    new_base_dir = ''

                # Recursively resolve any $refs in the loaded JSON
                return self._resolve_value(parsed, new_base_dir)

            else:
                # text, jinja2, raw, template - return as string
                # Note: template_data in ref_node is preserved but not processed here
                # (template variables are resolved at runtime by Jinja2Resolver)
                return content

        finally:
            # Remove from resolved refs after processing
            self._resolved_refs.discard(full_path)

    def _normalize_path(self, path: str) -> str:
        """
        Normalize a file path for consistent lookups.

        - Convert backslashes to forward slashes
        - Remove leading ./
        - Collapse .. and redundant slashes
        - Remove leading/trailing whitespace
        - SECURITY: Reject paths that would escape the virtual filesystem root

        Raises:
            ValueError: If path would escape the virtual filesystem root
        """
        # Strip whitespace and convert backslashes
        path = path.strip().replace('\\', '/')

        # Remove leading ./
        while path.startswith('./'):
            path = path[2:]

        # Track depth to detect root escape attempts
        # We traverse the path and track the minimum depth reached
        current_depth = 0
        min_depth = 0
        parts = []

        for part in path.split('/'):
            if part == '..':
                current_depth -= 1
                min_depth = min(min_depth, current_depth)
                if parts:
                    parts.pop()
                # If parts is empty, we'd be escaping root - tracked by min_depth
            elif part and part != '.':
                parts.append(part)
                current_depth += 1

        # If min_depth went negative, the path tried to escape the root
        if min_depth < 0:
            raise ValueError(
                f"Path traversal not allowed: '{path}' attempts to escape root directory"
            )

        return '/'.join(parts)


def resolve_workflow_from_zip(
    virtual_fs: Dict[str, str],
    entry_point: str
) -> Dict[str, Any]:
    """
    Convenience function to resolve a workflow from virtual filesystem.

    Args:
        virtual_fs: Dictionary mapping file paths to contents (from extracted zip)
        entry_point: Path to main workflow file

    Returns:
        Fully-resolved workflow JSON
    """
    resolver = WorkflowResolver(virtual_fs)
    return resolver.resolve(entry_point)
