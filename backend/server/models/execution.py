"""Execution control models."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ExecutionTarget:
    """Stop execution when this step/module boundary is reached."""

    step_id: str
    module_name: str
