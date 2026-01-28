"""
Migration 11: Remove hardcoded path prefix from generated_content.local_path

This migration updates the generated_content collection to store relative paths
instead of absolute paths. The prefix "/mnt/g/wm" is removed from all local_path
values, allowing the system to use MEDIA_BASE_PATH environment variable for
path resolution.

Before: /mnt/g/wm/media/images/file.png
After:  media/images/file.png

The MEDIA_BASE_PATH env variable will be prefixed at runtime when accessing files.
"""

from pymongo.database import Database
from . import backup_database

MIGRATION_ID = 11
DESCRIPTION = "Remove hardcoded path prefix from generated_content.local_path"

# The prefix to remove from local_path values
PATH_PREFIX_TO_REMOVE = "/mnt/g/wm/"


def apply(db: Database) -> None:
    """Apply migration to remove path prefix from local_path."""

    # Create backup before making changes
    backup_database(db)
    print("  Database backup created")

    # Count documents that will be affected
    affected_count = db.generated_content.count_documents({
        "local_path": {"$regex": f"^{PATH_PREFIX_TO_REMOVE}"}
    })
    print(f"  Found {affected_count} documents with prefix to remove")

    if affected_count == 0:
        print("  No documents need updating, migration complete")
        return

    # Update all documents that have the prefix
    # Use aggregation pipeline update to substring the path
    result = db.generated_content.update_many(
        {"local_path": {"$regex": f"^{PATH_PREFIX_TO_REMOVE}"}},
        [
            {
                "$set": {
                    "local_path": {
                        "$substr": [
                            "$local_path",
                            len(PATH_PREFIX_TO_REMOVE),
                            {"$strLenCP": "$local_path"}
                        ]
                    }
                }
            }
        ]
    )

    print(f"  Updated {result.modified_count} documents")

    # Verify the update
    remaining = db.generated_content.count_documents({
        "local_path": {"$regex": f"^{PATH_PREFIX_TO_REMOVE}"}
    })

    if remaining > 0:
        raise RuntimeError(
            f"Migration verification failed: {remaining} documents still have prefix"
        )

    print("  Migration 11 complete: path prefix removed from local_path")
