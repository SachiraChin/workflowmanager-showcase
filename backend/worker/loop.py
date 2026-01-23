"""
Worker Loop - Main processing loop for the task queue worker.

This module provides the WorkerLoop class that:
- Polls the database for queued tasks
- Checks concurrency limits per provider
- Claims and processes tasks in parallel
- Updates heartbeat during processing
- Handles stale task recovery on startup
"""

import os
import asyncio
import logging
import socket
import traceback
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Optional, Set

from .queue import TaskQueue, Task
from .actors import ActorRegistry, ensure_actors_registered

logger = logging.getLogger("worker.loop")

# Configuration from environment with defaults
HEARTBEAT_INTERVAL = int(os.environ.get("WORKER_HEARTBEAT_INTERVAL", "5"))
STALE_THRESHOLD = int(os.environ.get("WORKER_STALE_THRESHOLD", "30"))
POLL_INTERVAL = float(os.environ.get("WORKER_POLL_INTERVAL", "1"))


@dataclass
class ActiveTask:
    """Tracks an actively processing task."""
    task: Task
    process_task: asyncio.Task
    heartbeat_task: asyncio.Task


class WorkerLoop:
    """
    Main worker processing loop with parallel task execution.

    The worker continuously:
    1. Checks for stale tasks on startup
    2. Polls for queued tasks per provider
    3. Claims tasks up to each provider's concurrency limit
    4. Executes tasks in parallel via asyncio.create_task()
    5. Updates heartbeat during execution
    6. Marks tasks complete or failed
    7. Cleans up completed tasks

    Usage:
        worker = WorkerLoop()
        await worker.run()  # Runs until stopped
        worker.stop()       # Signal to stop
    """

    def __init__(self):
        self.queue = TaskQueue()
        self.worker_id = self._generate_worker_id()
        self._running = True
        self._active_tasks: Dict[str, ActiveTask] = {}  # task_id -> ActiveTask

    def _generate_worker_id(self) -> str:
        """Generate unique worker identifier."""
        hostname = socket.gethostname()
        pid = os.getpid()
        return f"{hostname}-{pid}"

    def stop(self):
        """Signal worker to stop gracefully."""
        logger.info("Stop requested")
        self._running = False
        # Cancel all heartbeat tasks
        for active in self._active_tasks.values():
            active.heartbeat_task.cancel()

    async def run(self):
        """
        Main worker loop.

        Runs until stop() is called or an unrecoverable error occurs.
        """
        logger.info(f"Worker {self.worker_id} starting")
        logger.info(
            f"Configuration: heartbeat={HEARTBEAT_INTERVAL}s, "
            f"stale_threshold={STALE_THRESHOLD}s, poll_interval={POLL_INTERVAL}s"
        )

        # Ensure actors are registered
        ensure_actors_registered()
        logger.info(f"Registered actors: {ActorRegistry.names()}")

        # Recover stale tasks on startup
        await self._recover_stale_tasks()

        while self._running:
            try:
                # Clean up completed tasks
                await self._cleanup_completed_tasks()

                # Try to claim and start new tasks
                await self._claim_and_start_tasks()

                # Brief sleep before next poll
                await asyncio.sleep(POLL_INTERVAL)

            except asyncio.CancelledError:
                logger.info("Worker loop cancelled")
                break
            except Exception as e:
                logger.exception(f"Error in worker loop: {e}")
                # Wait before retrying to avoid tight error loop
                await asyncio.sleep(POLL_INTERVAL)

        # Wait for active tasks to complete (with timeout)
        if self._active_tasks:
            logger.info(f"Waiting for {len(self._active_tasks)} active task(s) to complete...")
            try:
                pending_tasks = [at.process_task for at in self._active_tasks.values()]
                await asyncio.wait(pending_tasks, timeout=10)
            except Exception as e:
                logger.warning(f"Error waiting for tasks: {e}")

        logger.info(f"Worker {self.worker_id} stopped")

    async def _recover_stale_tasks(self):
        """Reset stale tasks for retry on startup."""
        stale_cutoff = datetime.utcnow() - timedelta(seconds=STALE_THRESHOLD)
        recovered = self.queue.recover_stale_tasks(stale_cutoff)
        if recovered:
            logger.info(f"Recovered {recovered} stale task(s)")

    async def _cleanup_completed_tasks(self):
        """Remove completed tasks from active tracking."""
        completed_ids = []
        for task_id, active in self._active_tasks.items():
            if active.process_task.done():
                completed_ids.append(task_id)
                # Cancel heartbeat if still running
                if not active.heartbeat_task.done():
                    active.heartbeat_task.cancel()
                    try:
                        await active.heartbeat_task
                    except asyncio.CancelledError:
                        pass

        for task_id in completed_ids:
            del self._active_tasks[task_id]
            logger.debug(f"Cleaned up completed task {task_id}")

    async def _claim_and_start_tasks(self):
        """
        Claim and start tasks for all providers with available capacity.

        For each provider:
        1. Get current processing count
        2. Calculate available slots
        3. Get queued tasks for that provider
        4. Claim up to available slots
        5. Start processing (non-blocking)
        """
        # Get actor for media tasks (currently only actor)
        actor = ActorRegistry.get("media")
        if not actor:
            logger.debug("No media actor registered")
            return

        # Get all provider concurrency info
        if not hasattr(actor, 'get_all_provider_concurrency'):
            logger.error("Media actor missing get_all_provider_concurrency method")
            return

        provider_limits = actor.get_all_provider_concurrency()
        logger.debug(f"Provider limits: {provider_limits}")

        for provider_id, max_concurrent in provider_limits.items():
            # Count currently processing for this provider
            current_count = self.queue.count_processing(provider_id)
            available_slots = max_concurrent - current_count

            if available_slots <= 0:
                logger.debug(
                    f"Provider {provider_id}: at capacity "
                    f"({current_count}/{max_concurrent})"
                )
                continue

            # Get queued tasks for this provider
            queued_tasks = self.queue.get_queued_tasks_by_concurrency(
                provider_id, limit=available_slots
            )

            if not queued_tasks:
                logger.debug(f"Provider {provider_id}: no queued tasks")
                continue

            logger.debug(
                f"Provider {provider_id}: {len(queued_tasks)} queued, "
                f"{available_slots} slots available"
            )

            # Claim and start each task
            for task in queued_tasks:
                # Skip if we've already started tracking this task
                if task.task_id in self._active_tasks:
                    continue

                # Get concurrency info for this specific task
                concurrency_id, concurrency_limit = actor.get_concurrency_info(task.payload)

                # Claim the task
                claimed = self.queue.claim_task(
                    task.task_id,
                    self.worker_id,
                    concurrency_id,
                    concurrency_limit
                )

                if not claimed:
                    logger.debug(f"Failed to claim task {task.task_id} (already claimed?)")
                    continue

                logger.info(
                    f"Claimed task {claimed.task_id} "
                    f"(actor={claimed.actor}, provider={provider_id})"
                )

                # Start processing (non-blocking)
                self._start_task(claimed)

    def _start_task(self, task: Task):
        """
        Start processing a task in the background.

        Creates both the processing task and heartbeat task.
        """
        # Create heartbeat task
        heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(task.task_id),
            name=f"heartbeat-{task.task_id}"
        )

        # Create processing task
        process_task = asyncio.create_task(
            self._process_task(task),
            name=f"process-{task.task_id}"
        )

        # Track both
        self._active_tasks[task.task_id] = ActiveTask(
            task=task,
            process_task=process_task,
            heartbeat_task=heartbeat_task
        )

        logger.debug(f"Started task {task.task_id}")

    async def _process_task(self, task: Task):
        """
        Process a claimed task.

        Runs the actor's execute method and handles completion/failure.
        """
        logger.info(f"Processing task {task.task_id} (actor={task.actor})")

        try:
            # Get actor
            actor = ActorRegistry.get(task.actor)
            if not actor:
                raise RuntimeError(f"Actor not found: {task.actor}")

            # Progress callback updates the queue
            def progress_callback(elapsed_ms: int, message: str):
                self.queue.update_progress(task.task_id, elapsed_ms, message)

            # Execute in thread pool (providers are synchronous)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: actor.execute(task.payload, progress_callback)
            )

            # Mark completed
            self.queue.complete_task(task.task_id, result)
            logger.info(f"Task {task.task_id} completed successfully")

        except Exception as e:
            # Mark failed with full error info
            error_type = type(e).__name__
            error_message = str(e)
            error_details = getattr(e, '__dict__', {})
            stack_trace = traceback.format_exc()

            self.queue.fail_task(
                task.task_id,
                error_type=error_type,
                message=error_message,
                details=error_details,
                stack_trace=stack_trace
            )
            logger.error(f"Task {task.task_id} failed: {error_message}")

        finally:
            # Cancel heartbeat task for this specific task
            if task.task_id in self._active_tasks:
                active = self._active_tasks[task.task_id]
                if not active.heartbeat_task.done():
                    active.heartbeat_task.cancel()

    async def _heartbeat_loop(self, task_id: str):
        """
        Update heartbeat periodically while processing a task.

        Runs as a background task and is cancelled when task completes.
        """
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL)
                self.queue.update_heartbeat(task_id)
                logger.debug(f"Heartbeat updated for task {task_id}")
        except asyncio.CancelledError:
            # Expected when task completes
            pass
