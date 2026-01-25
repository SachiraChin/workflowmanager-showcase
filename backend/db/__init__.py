"""
Database Layer - Shared database infrastructure.

This package provides:
- Database: Connection manager with repository access
- DbEventType: Event type constants
- TaskQueue: Task queue for async job processing
- Repository classes for data operations

Usage:
    from backend.db import Database, DbEventType, TaskQueue

    db = Database(connection_string, database_name)
    workflow = db.workflow_repo.get_workflow(workflow_run_id)
    db.event_repo.store_event(...)

    queue = TaskQueue(connection_string, database_name)
    task_id = queue.enqueue(actor="media", payload={...})
"""

from .database import Database, DbEventType
from .base import BaseRepository
from .queue import TaskQueue, Task
from .repos import (
    UserRepository,
    EventRepository,
    WorkflowRepository,
    BranchRepository,
    FileRepository,
    StateRepository,
    TokenRepository,
    VersionRepository,
    ContentRepository,
)

__all__ = [
    # Core
    "Database",
    "DbEventType",
    "BaseRepository",
    # Task Queue
    "TaskQueue",
    "Task",
    # Repositories
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
