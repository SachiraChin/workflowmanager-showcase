"""
Task Queue - Database-backed task queue operations.

This module provides the TaskQueue class for managing tasks in a MongoDB
collection. It handles enqueueing, claiming, progress updates, completion,
and stale task recovery.

The queue is designed to be used by both:
- Worker process: claim and process tasks
- Server API: enqueue tasks and query status
"""

import os
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, Any, Optional, List

from pymongo import MongoClient, ASCENDING, DESCENDING, ReturnDocument
from pymongo.database import Database
from pymongo.collection import Collection

logger = logging.getLogger("worker.queue")


def _generate_task_id() -> str:
    """Generate a unique task ID."""
    # Use uuid7 for time-ordered IDs if available, fallback to uuid4
    try:
        import uuid6
        return f"tq_{uuid6.uuid7().hex[:24]}"
    except ImportError:
        import uuid
        return f"tq_{uuid.uuid4().hex[:24]}"


@dataclass
class Task:
    """Task data from queue."""
    task_id: str
    actor: str
    payload: Dict[str, Any]
    status: str
    priority: int
    concurrency_identifier: Optional[str]
    concurrency_limit: Optional[int]
    retry_count: int
    max_retries: int


class TaskQueue:
    """
    Database-backed task queue operations.

    Provides methods for:
    - Enqueueing new tasks
    - Claiming tasks for processing
    - Updating progress and heartbeat
    - Completing or failing tasks
    - Recovering stale tasks

    Usage:
        queue = TaskQueue()
        task_id = queue.enqueue("media", {"provider": "leonardo", ...})
        task = queue.claim_task(task_id, worker_id, "leonardo", 3)
        queue.update_progress(task_id, 5000, "Generating...")
        queue.complete_task(task_id, {"urls": [...]})
    """

    def __init__(
        self,
        connection_string: Optional[str] = None,
        database_name: Optional[str] = None,
    ):
        """
        Initialize TaskQueue with database connection.

        Args:
            connection_string: MongoDB URI (default: MONGODB_URI env var or localhost)
            database_name: Database name (default: MONGODB_DATABASE env var or workflow_db)
        """
        self.connection_string = connection_string or os.environ.get(
            "MONGODB_URI", "mongodb://localhost:27017"
        )
        self.database_name = database_name or os.environ.get(
            "MONGODB_DATABASE", "workflow_db"
        )

        self.client: MongoClient = MongoClient(
            self.connection_string,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=10000,
        )
        self.db: Database = self.client[self.database_name]
        self.collection: Collection = self.db.task_queue

        self._ensure_indexes()

    def _ensure_indexes(self):
        """Create required indexes."""
        # For polling queued tasks (with concurrency check)
        self.collection.create_index([
            ("status", ASCENDING),
            ("concurrency_identifier", ASCENDING),
            ("priority", DESCENDING),
            ("created_at", ASCENDING),
        ], name="poll_tasks_idx")

        # For stale task detection
        self.collection.create_index([
            ("status", ASCENDING),
            ("heartbeat_at", ASCENDING),
        ], name="stale_tasks_idx")

        # For task lookup
        self.collection.create_index("task_id", unique=True, name="task_id_idx")

        # For listing tasks by workflow
        self.collection.create_index([
            ("payload.workflow_run_id", ASCENDING),
            ("created_at", DESCENDING),
        ], name="workflow_tasks_idx")

        # For listing tasks by interaction
        self.collection.create_index([
            ("payload.interaction_id", ASCENDING),
            ("created_at", DESCENDING),
        ], name="interaction_tasks_idx")

    def enqueue(
        self,
        actor: str,
        payload: Dict[str, Any],
        priority: int = 0,
        max_retries: int = 3,
    ) -> str:
        """
        Add a task to the queue.

        Args:
            actor: Actor name to handle this task (e.g., "media")
            payload: Task-specific input data
            priority: Higher priority tasks are processed first (default: 0)
            max_retries: Maximum retry attempts on failure (default: 3)

        Returns:
            Generated task_id
        """
        task_id = _generate_task_id()

        self.collection.insert_one({
            "task_id": task_id,
            "actor": actor,
            "status": "queued",
            "priority": priority,
            "concurrency_identifier": None,
            "concurrency_limit": None,
            "payload": payload,
            "result": None,
            "response": None,
            "error": None,
            "progress": {
                "elapsed_ms": 0,
                "message": "Queued",
                "updated_at": datetime.utcnow(),
            },
            "created_at": datetime.utcnow(),
            "started_at": None,
            "completed_at": None,
            "worker_id": None,
            "heartbeat_at": None,
            "retry_count": 0,
            "max_retries": max_retries,
        })

        logger.info(f"Enqueued task {task_id} (actor={actor})")
        return task_id

    def peek_next_task(self) -> Optional[Task]:
        """
        Get next queued task without claiming it.

        Returns:
            Task data or None if no tasks available
        """
        doc = self.collection.find_one(
            {"status": "queued"},
            sort=[("priority", DESCENDING), ("created_at", ASCENDING)]
        )

        if not doc:
            return None

        return Task(
            task_id=doc["task_id"],
            actor=doc["actor"],
            payload=doc["payload"],
            status=doc["status"],
            priority=doc["priority"],
            concurrency_identifier=doc.get("concurrency_identifier"),
            concurrency_limit=doc.get("concurrency_limit"),
            retry_count=doc["retry_count"],
            max_retries=doc["max_retries"],
        )

    def count_processing(self, concurrency_identifier: str) -> int:
        """
        Count tasks currently processing with given identifier.

        Args:
            concurrency_identifier: Identifier to count (e.g., provider name)

        Returns:
            Number of currently processing tasks with this identifier
        """
        return self.collection.count_documents({
            "status": "processing",
            "concurrency_identifier": concurrency_identifier,
        })

    def claim_task(
        self,
        task_id: str,
        worker_id: str,
        concurrency_identifier: str,
        concurrency_limit: int,
    ) -> Optional[Task]:
        """
        Atomically claim a task for processing.

        Args:
            task_id: Task to claim
            worker_id: Worker claiming the task
            concurrency_identifier: Concurrency group identifier
            concurrency_limit: Max concurrent tasks for this identifier

        Returns:
            Claimed Task or None if already claimed
        """
        doc = self.collection.find_one_and_update(
            {
                "task_id": task_id,
                "status": "queued",
            },
            {
                "$set": {
                    "status": "processing",
                    "worker_id": worker_id,
                    "concurrency_identifier": concurrency_identifier,
                    "concurrency_limit": concurrency_limit,
                    "started_at": datetime.utcnow(),
                    "heartbeat_at": datetime.utcnow(),
                    "progress.message": "Processing",
                    "progress.updated_at": datetime.utcnow(),
                }
            },
            return_document=ReturnDocument.AFTER
        )

        if not doc:
            return None

        logger.info(f"Claimed task {task_id} (worker={worker_id})")

        return Task(
            task_id=doc["task_id"],
            actor=doc["actor"],
            payload=doc["payload"],
            status=doc["status"],
            priority=doc["priority"],
            concurrency_identifier=doc.get("concurrency_identifier"),
            concurrency_limit=doc.get("concurrency_limit"),
            retry_count=doc["retry_count"],
            max_retries=doc["max_retries"],
        )

    def update_progress(self, task_id: str, elapsed_ms: int, message: str):
        """
        Update task progress.

        Args:
            task_id: Task to update
            elapsed_ms: Milliseconds elapsed since start
            message: Progress message
        """
        self.collection.update_one(
            {"task_id": task_id},
            {
                "$set": {
                    "progress.elapsed_ms": elapsed_ms,
                    "progress.message": message,
                    "progress.updated_at": datetime.utcnow(),
                }
            }
        )

    def update_heartbeat(self, task_id: str):
        """
        Update task heartbeat timestamp.

        Args:
            task_id: Task to update
        """
        self.collection.update_one(
            {"task_id": task_id},
            {"$set": {"heartbeat_at": datetime.utcnow()}}
        )

    def complete_task(
        self,
        task_id: str,
        result: Dict[str, Any],
        response: Optional[Dict[str, Any]] = None,
    ):
        """
        Mark task as completed with result.

        Args:
            task_id: Task to complete
            result: Task result data (processed/picked data)
            response: Raw response from provider (optional)
        """
        self.collection.update_one(
            {"task_id": task_id},
            {
                "$set": {
                    "status": "completed",
                    "result": result,
                    "response": response,
                    "completed_at": datetime.utcnow(),
                    "progress.message": "Completed",
                    "progress.updated_at": datetime.utcnow(),
                }
            }
        )
        logger.info(f"Completed task {task_id}")

    def fail_task(
        self,
        task_id: str,
        error_type: str,
        message: str,
        details: Dict[str, Any],
        stack_trace: str,
    ):
        """
        Mark task as failed with error information.

        Args:
            task_id: Task to fail
            error_type: Exception type name
            message: Error message
            details: Additional error details
            stack_trace: Full stack trace
        """
        self.collection.update_one(
            {"task_id": task_id},
            {
                "$set": {
                    "status": "failed",
                    "error": {
                        "type": error_type,
                        "message": message,
                        "details": details,
                        "stack_trace": stack_trace,
                    },
                    "completed_at": datetime.utcnow(),
                    "progress.message": f"Failed: {message}",
                    "progress.updated_at": datetime.utcnow(),
                }
            }
        )
        logger.error(f"Failed task {task_id}: {message}")

    def recover_stale_tasks(self, stale_cutoff: datetime) -> int:
        """
        Reset stale tasks for retry.

        Tasks are considered stale if:
        - Status is "processing"
        - heartbeat_at is older than stale_cutoff

        Args:
            stale_cutoff: Tasks with heartbeat before this are stale

        Returns:
            Number of tasks recovered
        """
        recovered = 0

        stale_tasks = list(self.collection.find({
            "status": "processing",
            "heartbeat_at": {"$lt": stale_cutoff}
        }))

        for task in stale_tasks:
            task_id = task["task_id"]

            if task["retry_count"] < task["max_retries"]:
                # Reset for retry
                self.collection.update_one(
                    {"task_id": task_id},
                    {
                        "$set": {
                            "status": "queued",
                            "worker_id": None,
                            "heartbeat_at": None,
                            "concurrency_identifier": None,
                            "progress.message": f"Retrying (attempt {task['retry_count'] + 2})",
                            "progress.updated_at": datetime.utcnow(),
                        },
                        "$inc": {"retry_count": 1}
                    }
                )
                logger.warning(f"Reset stale task {task_id} for retry")
                recovered += 1
            else:
                # Max retries exceeded
                self.collection.update_one(
                    {"task_id": task_id},
                    {
                        "$set": {
                            "status": "failed",
                            "error": {
                                "type": "MaxRetriesExceeded",
                                "message": f"Task failed after {task['max_retries']} retries",
                                "details": {},
                                "stack_trace": "",
                            },
                            "completed_at": datetime.utcnow(),
                            "progress.message": "Failed: max retries exceeded",
                            "progress.updated_at": datetime.utcnow(),
                        }
                    }
                )
                logger.error(f"Task {task_id} exceeded max retries")

        return recovered

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Get task by ID.

        Args:
            task_id: Task identifier

        Returns:
            Task document or None if not found
        """
        return self.collection.find_one(
            {"task_id": task_id},
            {"_id": 0}
        )

    def get_tasks_for_workflow(
        self,
        workflow_run_id: str,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get tasks for a workflow.

        Args:
            workflow_run_id: Workflow run identifier
            limit: Maximum tasks to return

        Returns:
            List of task documents
        """
        return list(self.collection.find(
            {"payload.workflow_run_id": workflow_run_id},
            {"_id": 0}
        ).sort("created_at", DESCENDING).limit(limit))

    def get_tasks_for_interaction(
        self,
        interaction_id: str,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get tasks for an interaction.

        Args:
            interaction_id: Interaction identifier
            limit: Maximum tasks to return

        Returns:
            List of task documents
        """
        return list(self.collection.find(
            {"payload.interaction_id": interaction_id},
            {"_id": 0}
        ).sort("created_at", DESCENDING).limit(limit))

    def get_queued_tasks_by_concurrency(
        self,
        concurrency_identifier: str,
        limit: int = 10
    ) -> List[Task]:
        """
        Get queued tasks for a specific concurrency identifier (provider).

        Used by parallel worker to claim tasks per provider.

        Args:
            concurrency_identifier: Provider/concurrency group identifier
            limit: Maximum tasks to return

        Returns:
            List of Task objects sorted by priority (desc) then created_at (asc)
        """
        docs = list(self.collection.find(
            {
                "status": "queued",
                "payload.provider": concurrency_identifier,
            },
            {"_id": 0}
        ).sort([
            ("priority", DESCENDING),
            ("created_at", ASCENDING)
        ]).limit(limit))

        return [
            Task(
                task_id=doc["task_id"],
                actor=doc["actor"],
                payload=doc["payload"],
                status=doc["status"],
                priority=doc["priority"],
                concurrency_identifier=doc.get("concurrency_identifier"),
                concurrency_limit=doc.get("concurrency_limit"),
                retry_count=doc["retry_count"],
                max_retries=doc["max_retries"],
            )
            for doc in docs
        ]

    def update_queue_positions(self, concurrency_identifier: str):
        """
        Update progress message with queue position for all queued tasks.

        Called by worker when a provider is at capacity to inform waiting
        tasks of their position in the queue.

        Args:
            concurrency_identifier: Provider/concurrency group identifier
        """
        # Get all queued tasks for this provider, sorted by priority and time
        queued_docs = list(self.collection.find(
            {
                "status": "queued",
                "payload.provider": concurrency_identifier,
            },
            {"task_id": 1}
        ).sort([
            ("priority", DESCENDING),
            ("created_at", ASCENDING)
        ]))

        if not queued_docs:
            return

        total = len(queued_docs)
        logger.info(
            f"Updating queue positions for {total} queued {concurrency_identifier} task(s)"
        )

        # Update each task with its position
        for position, doc in enumerate(queued_docs, start=1):
            task_id = doc["task_id"]
            message = f"Queued (position {position} of {total})"
            logger.info(f"  {task_id}: {message}")
            self.collection.update_one(
                {"task_id": task_id},
                {
                    "$set": {
                        "progress.message": message,
                        "progress.updated_at": datetime.utcnow(),
                    }
                }
            )

    def close(self):
        """Close database connection."""
        self.client.close()
