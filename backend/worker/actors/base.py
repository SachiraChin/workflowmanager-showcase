"""
Actor Base Class - Abstract interface for task handlers.

Actors are the interface between the worker and domain-specific logic.
Each actor handles a specific type of task (e.g., media generation).

The worker loop calls actor methods via a standard interface, while
the actor implementation handles the domain-specific details.
"""

from abc import ABC, abstractmethod
from typing import Callable, Dict, Any, Tuple

# Type alias for progress callback
# Called with (elapsed_ms: int, message: str) to report progress
ProgressCallback = Callable[[int, str], None]


class ActorBase(ABC):
    """
    Abstract base class for task actors.

    Actors handle specific types of tasks in the worker. They provide:
    - Concurrency information for task scheduling
    - Task execution logic

    Each actor implementation:
    - Lives in worker/actors/{name}.py
    - Implements the abstract methods
    - Is registered with ActorRegistry

    Example:
        class MediaActor(ActorBase):
            @property
            def name(self) -> str:
                return "media"

            def get_concurrency_info(self, payload):
                provider = payload.get("provider", "unknown")
                concurrency = ProviderRegistry.get_concurrency(provider)
                return (provider, concurrency)

            def execute(self, payload, progress_callback):
                # Do the work
                return {"result": "..."}
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """
        Actor name for registration and task routing.

        This must match the 'actor' field in task_queue documents.

        Returns:
            Actor name string (e.g., "media")
        """
        pass

    @abstractmethod
    def get_concurrency_info(self, payload: Dict[str, Any]) -> Tuple[str, int]:
        """
        Determine concurrency constraints for a task.

        Called by worker before claiming a task to check if it can run.
        This allows actors to implement provider-specific or payload-specific
        concurrency limits.

        Args:
            payload: Task payload from task_queue document

        Returns:
            Tuple of (concurrency_identifier, max_concurrent):
            - concurrency_identifier: Groups tasks for concurrency limiting
              (e.g., provider name like "midjourney")
            - max_concurrent: Maximum tasks with this identifier that can
              run simultaneously

        Example:
            # Only 1 midjourney task at a time
            payload = {"provider": "midjourney", ...}
            return ("midjourney", 1)

            # Up to 3 leonardo tasks at a time
            payload = {"provider": "leonardo", ...}
            return ("leonardo", 3)
        """
        pass

    @abstractmethod
    def execute(
        self,
        payload: Dict[str, Any],
        progress_callback: ProgressCallback
    ) -> Dict[str, Any]:
        """
        Execute the task.

        This is the main entry point for task processing. The actor should:
        1. Extract necessary data from payload
        2. Perform the work (e.g., call external APIs)
        3. Report progress via progress_callback
        4. Return the result

        Args:
            payload: Task-specific input data from the task queue
            progress_callback: Call with (elapsed_ms, message) to update
                progress. The worker stores these updates in the task document.

        Returns:
            Task-specific result dict. This is stored in task.result
            and returned to the client.

        Raises:
            Exception: Any exception is caught by the worker and stored
                in task.error with full stack trace.

        Example:
            def execute(self, payload, progress_callback):
                progress_callback(0, "Starting...")

                # Do some work
                result = external_api.call(payload["params"])

                progress_callback(5000, "Processing result...")

                # Process and return
                return {"output": result.data}
        """
        pass
