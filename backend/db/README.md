# Database Layer (`backend/db/`)

Shared database layer used by both server and worker.

## Overview

This package provides MongoDB connection management, repositories for data operations, and the task queue. It is designed to be imported by both `backend/server/` and `backend/worker/` without creating circular dependencies.

## Structure

```
backend/db/
├── __init__.py          # Package exports
├── database.py          # Database connection manager + DbEventType
├── base.py              # BaseRepository class
├── utils.py             # Shared utilities (uuid7_str)
├── queue/               # Task queue
│   ├── __init__.py
│   └── task_queue.py    # TaskQueue class
├── repos/               # Repository classes
│   ├── __init__.py
│   ├── branch.py        # BranchRepository
│   ├── content.py       # ContentRepository
│   ├── event.py         # EventRepository
│   ├── file.py          # FileRepository
│   ├── state.py         # StateRepository
│   ├── token.py         # TokenRepository
│   ├── user.py          # UserRepository
│   ├── version.py       # VersionRepository
│   └── workflow.py      # WorkflowRepository
├── mixins/              # Database class mixins
│   ├── config.py        # Configuration operations
│   ├── history.py       # History operations
│   ├── migrations.py    # Migration runner mixin
│   └── recovery.py      # Recovery operations
└── migrations/          # Database migration scripts
    ├── __init__.py
    └── m_*.py           # Individual migrations
```

## Usage

```python
from backend.db import Database, DbEventType, TaskQueue

# Database connection
db = Database(connection_string, database_name)
workflow = db.workflow_repo.get_workflow(workflow_run_id)
db.event_repo.store_event(...)

# Task queue
queue = TaskQueue(connection_string, database_name)
task_id = queue.enqueue(actor="media", payload={...})
```

## Design Principles

1. **Shared Infrastructure**: Both server and worker import from this package
2. **No Circular Dependencies**: This package does not import from server or worker
3. **Full Path Imports**: All internal imports use full paths (e.g., `from backend.db.base import BaseRepository`)
4. **Repository Pattern**: Data access is encapsulated in repository classes
