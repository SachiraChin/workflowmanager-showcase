"""
Workflow Diff - Compute structured diff between workflow versions.

Uses DeepDiff for robust comparison. Returns raw data for client display.
"""

from deepdiff import DeepDiff
from typing import Dict, Any, List
import re
import fnmatch


# Default file patterns to ignore in zip/hash
DEFAULT_IGNORE_PATTERNS = [
    # macOS
    '.DS_Store', '._*', '.Spotlight-V100', '.Trashes',
    # Windows
    'Thumbs.db', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN',
    # Linux
    '*~', '.directory',
    # IDE/Editor
    '.idea/', '.vscode/', '*.swp', '*.swo', '.project', '.settings/',
    # Python
    '__pycache__/', '*.pyc', '*.pyo', '.Python', 'venv/', '.env',
    # Git
    '.git/', '.gitignore',
]

# Binary extensions to skip in diffs
BINARY_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
    '.mp3', '.wav', '.ogg', '.mp4', '.avi', '.mov', '.webm',
    '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
}


def should_ignore_file(filename: str, patterns: List[str] = None) -> bool:
    """Check if a file should be ignored based on patterns."""
    if patterns is None:
        patterns = DEFAULT_IGNORE_PATTERNS

    for pattern in patterns:
        if pattern.endswith('/'):
            dir_pattern = pattern[:-1]
            if filename == dir_pattern or filename.startswith(dir_pattern + '/'):
                return True
        else:
            if fnmatch.fnmatch(filename, pattern):
                return True
            basename = filename.split('/')[-1].split('\\')[-1]
            if fnmatch.fnmatch(basename, pattern):
                return True
    return False


def _normalize_whitespace(value: Any) -> Any:
    """Normalize whitespace in strings for comparison."""
    if isinstance(value, str):
        lines = value.splitlines()
        return '\n'.join(line.rstrip() for line in lines).strip()
    return value


def _preprocess_workflow(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize whitespace throughout workflow for comparison."""
    import copy

    def normalize_recursive(obj):
        if isinstance(obj, dict):
            return {k: normalize_recursive(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [normalize_recursive(item) for item in obj]
        elif isinstance(obj, str):
            return _normalize_whitespace(obj)
        return obj

    return normalize_recursive(copy.deepcopy(workflow))


def _is_binary_path(path: str) -> bool:
    """Check if path references binary content."""
    for ext in BINARY_EXTENSIONS:
        if ext in path.lower():
            return True
    return 'data:image' in str(path) or 'data:application' in str(path)


def _simplify_path(path: str) -> str:
    """Convert DeepDiff path to readable format."""
    # root['steps'][0]['modules'][1] -> steps[0].modules[1]
    path = re.sub(r"^root\['?", "", path)
    path = re.sub(r"'\]", "]", path)
    path = re.sub(r"\['", ".", path)
    return path


def compute_workflow_diff(
    old_workflow: Dict[str, Any],
    new_workflow: Dict[str, Any],
    ignore_order: bool = True
) -> Dict[str, Any]:
    """
    Compute diff between workflow versions using DeepDiff.

    Args:
        old_workflow: Previous workflow (fully resolved)
        new_workflow: New workflow (fully resolved)
        ignore_order: Ignore list ordering

    Returns:
        {
            "has_changes": bool,
            "summary": str,
            "changes": [
                {
                    "type": "changed" | "added" | "removed",
                    "path": str,
                    "old_value": any,  # for changed/removed
                    "new_value": any,  # for changed/added
                }
            ]
        }
    """
    old_processed = _preprocess_workflow(old_workflow)
    new_processed = _preprocess_workflow(new_workflow)

    diff = DeepDiff(
        old_processed,
        new_processed,
        ignore_order=ignore_order,
        verbose_level=2,
        view='tree'
    )

    if not diff:
        return {
            "has_changes": False,
            "summary": "No changes",
            "changes": []
        }

    changes = []
    counts = {"changed": 0, "added": 0, "removed": 0}

    # Values changed
    for item in diff.get('values_changed', []):
        path = _simplify_path(item.path())
        if _is_binary_path(path):
            continue
        changes.append({
            "type": "changed",
            "path": path,
            "old_value": item.t1,
            "new_value": item.t2
        })
        counts["changed"] += 1

    # Dictionary items added
    for item in diff.get('dictionary_item_added', []):
        path = _simplify_path(item.path())
        if _is_binary_path(path):
            continue
        changes.append({
            "type": "added",
            "path": path,
            "new_value": item.t2
        })
        counts["added"] += 1

    # Dictionary items removed
    for item in diff.get('dictionary_item_removed', []):
        path = _simplify_path(item.path())
        if _is_binary_path(path):
            continue
        changes.append({
            "type": "removed",
            "path": path,
            "old_value": item.t1
        })
        counts["removed"] += 1

    # Iterable items added
    for item in diff.get('iterable_item_added', []):
        path = _simplify_path(item.path())
        changes.append({
            "type": "added",
            "path": path,
            "new_value": item.t2
        })
        counts["added"] += 1

    # Iterable items removed
    for item in diff.get('iterable_item_removed', []):
        path = _simplify_path(item.path())
        changes.append({
            "type": "removed",
            "path": path,
            "old_value": item.t1
        })
        counts["removed"] += 1

    # Type changes
    for item in diff.get('type_changes', []):
        path = _simplify_path(item.path())
        changes.append({
            "type": "changed",
            "path": path,
            "old_value": item.t1,
            "new_value": item.t2
        })
        counts["changed"] += 1

    # Generate summary
    parts = []
    if counts["changed"]:
        parts.append(f"{counts['changed']} changed")
    if counts["added"]:
        parts.append(f"{counts['added']} added")
    if counts["removed"]:
        parts.append(f"{counts['removed']} removed")

    return {
        "has_changes": True,
        "summary": ", ".join(parts),
        "changes": changes
    }
