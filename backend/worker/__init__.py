"""
Worker Package - Background task queue worker process.

This package provides a separate worker process that executes tasks
from a database-backed queue. It runs independently of the FastAPI
server and handles long-running operations like media generation.

Usage:
    python -m worker

Components:
    - TaskQueue: Database-backed task queue operations
    - WorkerLoop: Main worker processing loop
    - Actors: Task handlers for different task types (media, etc.)
"""

__version__ = "0.1.0"
