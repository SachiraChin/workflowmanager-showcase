"""
Actors Package - Task handlers for the worker.

Actors are the interface between the worker and domain-specific logic.
Each actor handles a specific type of task (e.g., media generation).

Usage:
    from worker.actors import ActorRegistry

    # Get an actor by name
    actor = ActorRegistry.get("media")

    # Execute a task
    result = actor.execute(payload, progress_callback)
"""

from .base import ActorBase, ProgressCallback
from typing import Dict, Optional


class ActorRegistry:
    """Registry of available actors."""

    _actors: Dict[str, ActorBase] = {}

    @classmethod
    def register(cls, actor: ActorBase) -> None:
        """Register an actor instance."""
        cls._actors[actor.name] = actor

    @classmethod
    def get(cls, name: str) -> Optional[ActorBase]:
        """Get actor by name."""
        return cls._actors.get(name)

    @classmethod
    def names(cls) -> list:
        """List registered actor names."""
        return list(cls._actors.keys())

    @classmethod
    def clear(cls) -> None:
        """Clear all registered actors (for testing)."""
        cls._actors.clear()


# Import and register actors after ActorRegistry is defined
# This avoids circular imports
def _register_actors():
    """Register all available actors."""
    from .media import MediaActor
    ActorRegistry.register(MediaActor())


# Defer registration until first access
_actors_registered = False


def ensure_actors_registered():
    """Ensure actors are registered (called by worker loop)."""
    global _actors_registered
    if not _actors_registered:
        _register_actors()
        _actors_registered = True


__all__ = [
    'ActorBase',
    'ActorRegistry',
    'ProgressCallback',
    'ensure_actors_registered',
]
