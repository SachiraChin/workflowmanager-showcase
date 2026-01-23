"""
Server Utilities

Generic, context-agnostic utility functions.
"""

import re
import uuid
from typing import Dict, Any

# Try Python's uuid.uuid7() first (3.14+), fall back to uuid6 package
if hasattr(uuid, "uuid7"):
    _uuid7_func = uuid.uuid7
else:
    import uuid6
    _uuid7_func = uuid6.uuid7


def uuid7_str() -> str:
    """
    Generate a UUID v7 string (time-sortable UUID).

    Uses Python's uuid.uuid7() if available (3.14+),
    otherwise falls back to the uuid6 package.

    Returns a 32-character hex string (no hyphens).
    """
    return _uuid7_func().hex


def sanitize_error_message(error: Exception | str) -> str:
    """
    Sanitize error message to prevent sensitive info leakage.
    Removes API keys, tokens, file paths with usernames.
    """
    msg = str(error)

    # Replace potential API keys (32+ char alphanumeric strings)
    msg = re.sub(r'sk-[a-zA-Z0-9]{20,}', '[API_KEY_REDACTED]', msg)
    msg = re.sub(r'api[_-]?key["\']?\s*[:=]\s*["\']?[a-zA-Z0-9_-]+', 'api_key=[REDACTED]', msg, flags=re.IGNORECASE)

    # Remove full file paths that might contain usernames
    msg = re.sub(r'/home/[^/\s]+', '/home/[USER]', msg)
    msg = re.sub(r'/Users/[^/\s]+', '/Users/[USER]', msg)
    msg = re.sub(r'C:\\Users\\[^\\]+', r'C:\\Users\\[USER]', msg)

    return msg


def make_json_serializable(obj: Any) -> Any:
    """
    Convert an object to be JSON serializable.

    Handles:
    - Enums (converts to value)
    - Sets (converts to lists)
    - Dataclasses/Pydantic models (converts to dict)
    - Nested structures (recursively processes)
    """
    if obj is None:
        return None

    # Handle Enums
    if hasattr(obj, 'value'):
        return obj.value

    # Handle sets
    if isinstance(obj, set):
        return list(obj)

    # Handle dicts
    if isinstance(obj, dict):
        return {k: make_json_serializable(v) for k, v in obj.items()}

    # Handle lists/tuples
    if isinstance(obj, (list, tuple)):
        return [make_json_serializable(item) for item in obj]

    # Handle objects with to_dict or model_dump
    if hasattr(obj, 'model_dump'):
        return make_json_serializable(obj.model_dump())
    if hasattr(obj, 'to_dict'):
        return make_json_serializable(obj.to_dict())

    # Primitives
    if isinstance(obj, (str, int, float, bool)):
        return obj

    # Fallback: convert to string
    return str(obj)


def get_nested_value(obj: Dict, path: str) -> Any:
    """Get value from nested dict using dot notation."""
    keys = path.split('.')
    value = obj
    for key in keys:
        if isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value
