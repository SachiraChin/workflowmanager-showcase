"""
Database Utilities

Shared utility functions for the database layer.
"""

import uuid

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
