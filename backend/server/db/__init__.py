"""
Database Layer - MongoDB connection and repositories.

This package provides:
- Database: Connection manager with repository access
- Repository classes for data operations
- DbEventType: Event type constants

Usage:
    from backend.server.db import Database, DbEventType

    db = Database(connection_string, database_name)
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    db.event_repo.store_event(...)
"""

import logging
from enum import Enum

from pymongo import MongoClient
from pymongo.database import Database as MongoDatabase
from pymongo.collection import Collection

from .base import BaseRepository
from .user_repository import UserRepository
from .event_repository import EventRepository
from .workflow_repository import WorkflowRepository
from .branch_repository import BranchRepository
from .file_repository import FileRepository
from .state_repository import StateRepository
from .token_repository import TokenRepository
from .version_repository import VersionRepository
from .content_repository import ContentRepository

# Import mixins
from .mixins.config import DatabaseConfigMixin
from .mixins.history import DatabaseHistoryMixin
from .mixins.migrations import DatabaseMigrationsMixin
from .mixins.recovery import DatabaseRecoveryMixin

logger = logging.getLogger(__name__)


class DbEventType(str, Enum):
    """Types of events stored in the database (for audit/replay purposes)."""

    # Workflow lifecycle
    WORKFLOW_CREATED = "workflow_created"
    WORKFLOW_RESUMED = "workflow_resumed"
    WORKFLOW_COMPLETED = "workflow_completed"
    WORKFLOW_ERROR = "workflow_error"
    WORKFLOW_RECOVERED = "workflow_recovered"

    # Step/Module execution
    STEP_STARTED = "step_started"
    STEP_COMPLETED = "step_completed"
    MODULE_STARTED = "module_started"
    MODULE_COMPLETED = "module_completed"
    MODULE_ERROR = "module_error"

    # User interactions
    INTERACTION_REQUESTED = "interaction_requested"
    INTERACTION_RESPONSE = "interaction_response"

    # Retry / Jump
    RETRY_REQUESTED = "retry_requested"
    JUMP_REQUESTED = "jump_requested"

    # Data events
    OUTPUT_STORED = "output_stored"


class Database(DatabaseHistoryMixin, DatabaseMigrationsMixin, DatabaseConfigMixin, DatabaseRecoveryMixin):
    """
    MongoDB database connection with repository access.

    Use repositories directly for all operations:
        db.workflow_repo.get_workflow(id)
        db.event_repo.store_event(...)
        db.branch_repo.create_branch(...)
    """

    def __init__(
        self,
        connection_string: str = "mongodb://localhost:27017",
        database_name: str = "workflow_db",
    ):
        self.client = MongoClient(
            connection_string,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=10000,
        )
        self.db: MongoDatabase = self.client[database_name]

        # Initialize repositories
        self.user_repo = UserRepository(self.db)
        self.event_repo = EventRepository(self.db)
        self.workflow_repo = WorkflowRepository(self.db)
        self.branch_repo = BranchRepository(self.db)
        self.file_repo = FileRepository(self.db)
        self.state_repo = StateRepository(self.db)
        self.token_repo = TokenRepository(self.db)
        self.version_repo = VersionRepository(self.db)
        self.content_repo = ContentRepository(self.db)

        # Direct collection access (for mixins)
        self.users: Collection = self.db.users
        self.access_keys: Collection = self.db.access_keys
        self.refresh_tokens: Collection = self.db.refresh_tokens
        self.workflow_runs: Collection = self.db.workflow_runs
        self.branches: Collection = self.db.branches
        self.events: Collection = self.db.events
        self.tokens: Collection = self.db.tokens
        self.workflow_templates: Collection = self.db.workflow_templates
        self.workflow_versions: Collection = self.db.workflow_versions
        self.workflow_files: Collection = self.db.workflow_files
        self.workflow_run_version_history: Collection = self.db.workflow_run_version_history
        self.option_usage: Collection = self.db.option_usage
        self.weighted_keywords: Collection = self.db.weighted_keywords
        self.config: Collection = self.db.config
        self.content_generation_metadata: Collection = self.db.content_generation_metadata
        self.generated_content: Collection = self.db.generated_content

        # Run migrations
        self._run_migrations()

    def _run_migrations(self):
        """Run database migrations on startup."""
        from .migrations import run_migrations

        try:
            stats = run_migrations(self.db)
            if stats["applied"]:
                logger.info(f"Applied migrations: {stats['applied']}")
            if stats["already_applied"]:
                logger.debug(f"Already applied: {stats['already_applied']}")
        except Exception as e:
            logger.error(f"Migration failed: {e}")
            raise

    def close(self):
        """Close database connection."""
        self.client.close()


__all__ = [
    "Database",
    "DbEventType",
    "BaseRepository",
    "UserRepository",
    "EventRepository",
    "WorkflowRepository",
    "BranchRepository",
    "FileRepository",
    "StateRepository",
    "TokenRepository",
    "VersionRepository",
    "ContentRepository",
]
