"""
Base Repository - Common database connection handling.

Provides base class for all repositories with shared MongoDB connection.
"""

from typing import Optional
from pymongo.database import Database
from pymongo.collection import Collection


class BaseRepository:
    """
    Base class for all repositories.

    Repositories are initialized with a MongoDB database instance
    and provide access to specific collections.
    """

    def __init__(self, db: Database):
        """
        Initialize repository with database connection.

        Args:
            db: MongoDB database instance
        """
        self.db = db

    def _get_collection(self, name: str) -> Collection:
        """Get a collection by name."""
        return self.db[name]
