"""
Path Utilities - Resolve relative paths from database with base path prefix.

The database stores relative paths (e.g., "images/file.png") and the
MEDIA_BASE_PATH environment variable provides the base directory where these
files are located.

This module provides utilities to resolve full paths when reading from the
database.
"""

import os
from typing import Optional

# Cache the base path to avoid repeated env lookups
_media_base_path: Optional[str] = None


def get_media_base_path() -> str:
    """
    Get the MEDIA_BASE_PATH from environment.

    Returns:
        The base path string, or empty string if not set.
    """
    global _media_base_path
    if _media_base_path is None:
        _media_base_path = os.environ.get("MEDIA_BASE_PATH", "")
    return _media_base_path


def resolve_local_path(relative_path: Optional[str]) -> Optional[str]:
    """
    Resolve a relative local_path from the database to a full path.

    Prefixes the MEDIA_BASE_PATH environment variable to the relative path
    stored in the database.

    Args:
        relative_path: Relative path from database (e.g., "media/images/file.png")
                      Can also be None or already absolute.

    Returns:
        Full path with MEDIA_BASE_PATH prefix, or None if input is None.
        If path is already absolute, returns it unchanged.

    Example:
        # MEDIA_BASE_PATH="/mnt/g/wm"
        resolve_local_path("images/file.png")
        # Returns: "/mnt/g/wm/images/file.png"

        resolve_local_path(None)
        # Returns: None

        resolve_local_path("/absolute/path/file.png")
        # Returns: "/absolute/path/file.png" (unchanged)
    """
    if not relative_path:
        return relative_path

    # If already absolute, return as-is
    if os.path.isabs(relative_path):
        return relative_path

    base_path = get_media_base_path()
    if not base_path:
        # No base path configured - return relative path as-is
        # This may cause issues, but allows backward compatibility
        return relative_path

    return os.path.join(base_path, relative_path)


def make_relative_path(absolute_path: str, base_path: Optional[str] = None) -> str:
    """
    Convert an absolute path to relative by removing the base path prefix.

    Used when storing paths in the database.

    Args:
        absolute_path: Full absolute path
        base_path: Base path to remove (defaults to MEDIA_BASE_PATH env var)

    Returns:
        Relative path with base prefix removed.
        If path doesn't start with base, returns unchanged.

    Example:
        # MEDIA_BASE_PATH="/mnt/g/wm"
        make_relative_path("/mnt/g/wm/images/file.png")
        # Returns: "images/file.png"
    """
    if base_path is None:
        base_path = get_media_base_path()

    if not base_path:
        return absolute_path

    # Ensure base_path ends with separator for clean removal
    if not base_path.endswith(os.sep):
        base_path = base_path + os.sep

    if absolute_path.startswith(base_path):
        return absolute_path[len(base_path):]

    return absolute_path
