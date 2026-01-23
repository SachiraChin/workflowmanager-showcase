"""
Workflow REST API

Stateless workflow processor with MongoDB event store.

Components:
- Database: MongoDB event store (from db module)
- WorkflowProcessor: Stateless workflow execution (from workflow module)
- app: FastAPI routes
- cli_client: Command-line client

Usage:
    # Run API server
    python -m api.app

    # Run CLI client (direct mode)
    python -m api.cli_client --project /path/to/project --workflow /path/to/workflow.json

    # Run CLI client (HTTP mode)
    python -m api.cli_client --project /path/to/project --workflow /path/to/workflow.json --api-url http://localhost:8000
"""

# Lazy import for app to avoid import errors when FastAPI not installed
def get_app():
    from .app import app
    return app
