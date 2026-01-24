"""
Database Config Mixin - Configuration storage for application settings.

Provides a flexible key-value store for configuration with type categorization.
Used for db.query schemas, table schemas, and other app-level config.
"""

from datetime import datetime
from typing import Dict, Any, Optional, List, TYPE_CHECKING

if TYPE_CHECKING:
    from backend.db import Database


class DatabaseConfigMixin:
    """
    Mixin providing config collection methods.

    Config documents have structure:
    {
        "type": str,       # Category (e.g., "db.query", "db.table_schema")
        "name": str,       # Unique name within type
        "value": dict,     # Configuration data
        "updated_at": datetime
    }

    Unique constraint on (type, name).
    """

    def get_config(
        self: "Database",
        config_type: str,
        name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get a config value by type and name.

        Args:
            config_type: Config category (e.g., "db.query", "db.table_schema")
            name: Config name within type

        Returns:
            The config value dict, or None if not found
        """
        doc = self.config.find_one({
            "type": config_type,
            "name": name
        })

        if doc:
            return doc.get("value")
        return None

    def set_config(
        self: "Database",
        config_type: str,
        name: str,
        value: Dict[str, Any]
    ) -> None:
        """
        Set a config value (upsert).

        Args:
            config_type: Config category
            name: Config name within type
            value: Configuration data
        """
        self.config.update_one(
            {
                "type": config_type,
                "name": name
            },
            {
                "$set": {
                    "value": value,
                    "updated_at": datetime.now().isoformat()
                },
                "$setOnInsert": {
                    "type": config_type,
                    "name": name,
                    "created_at": datetime.now().isoformat()
                }
            },
            upsert=True
        )

    def delete_config(
        self: "Database",
        config_type: str,
        name: str
    ) -> bool:
        """
        Delete a config entry.

        Args:
            config_type: Config category
            name: Config name within type

        Returns:
            True if deleted, False if not found
        """
        result = self.config.delete_one({
            "type": config_type,
            "name": name
        })
        return result.deleted_count > 0

    def list_configs(
        self: "Database",
        config_type: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        List config entries, optionally filtered by type.

        Args:
            config_type: Optional filter by type

        Returns:
            List of config documents (type, name, value, updated_at)
        """
        query = {}
        if config_type:
            query["type"] = config_type

        return list(self.config.find(
            query,
            {"_id": 0}  # Exclude MongoDB _id
        ))

    def get_configs_by_type(
        self: "Database",
        config_type: str
    ) -> Dict[str, Dict[str, Any]]:
        """
        Get all configs of a specific type as a dict keyed by name.

        Uses MongoDB aggregation to build name->value dict.

        Args:
            config_type: Config category

        Returns:
            Dict mapping name -> value
        """
        pipeline = [
            {"$match": {"type": config_type}},
            {
                "$group": {
                    "_id": None,
                    "entries": {
                        "$push": {"k": "$name", "v": "$value"}
                    }
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "result": {"$arrayToObject": "$entries"}
                }
            }
        ]

        results = list(self.config.aggregate(pipeline))
        return results[0]["result"] if results else {}

    # =========================================================================
    # Convenience methods for db.query module
    # =========================================================================

    def get_query_schema(self: "Database") -> Optional[Dict[str, Any]]:
        """Get the global query schema config."""
        return self.get_config("db.query", "query_schema")

    def get_table_schema(
        self: "Database",
        table_name: str
    ) -> Optional[Dict[str, Any]]:
        """Get a table schema config by table name."""
        return self.get_config("db.table_schema", table_name)

    def get_all_table_schemas(self: "Database") -> Dict[str, Dict[str, Any]]:
        """Get all table schemas as a dict keyed by table name."""
        return self.get_configs_by_type("db.table_schema")
