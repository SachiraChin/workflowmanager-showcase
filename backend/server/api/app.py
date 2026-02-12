"""
Workflow REST API - FastAPI application setup.

This module sets up the FastAPI application and includes all route modules.
The actual route handlers are in the routes/ subpackage.

Endpoints are organized by function:
- execution: Start, confirm, respond, retry workflows
- streaming: SSE streaming for execution and state updates
- state: Workflow state queries
- management: Status, resume, events, history, delete, reset
- files: File access for TUI debug mode
- listing: Template and workflow listing
"""

import os
import asyncio
import logging

# Load .env file if it exists (before other imports that might use env vars)
try:
    from dotenv import load_dotenv
    from pathlib import Path
    # Look for .env in the server directory (parent of api/)
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"[ENV] Loaded .env from {env_path}")
    else:
        load_dotenv()  # Fall back to current directory
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import convertors first - must be done before route imports that use custom convertors
from . import convertors  # noqa: F401

from . import dependencies
from .routes import auth
from backend.db import Database
from backend.workflow_engine import WorkflowProcessor
from .contract_validation import validate_all_contracts
from .routes.streaming import active_streams, active_state_streams
from .routes import (
    execution_router,
    streaming_router,
    state_router,
    management_router,
    files_router,
    listing_router,
    media_router,
    tasks_router,
    models_router,
    virtual_router,
)

# Configure logger for API
logger = logging.getLogger('workflow.api')


# =============================================================================
# Contract Validation (fail fast at startup)
# =============================================================================

validate_all_contracts()


# =============================================================================
# App Configuration
# =============================================================================

app = FastAPI(
    title="Workflow API",
    description="REST API for stateless workflow execution with MongoDB event sourcing",
    version="1.0.0"
)

# CORS middleware for web clients
# Note: When using credentials (cookies), we must specify exact origins, not "*"
# Set CORS_ORIGINS env var as comma-separated list
cors_origins_str = os.environ.get("CORS_ORIGINS", "")
CORS_ORIGINS = [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()] if cors_origins_str else ["http://localhost:5173", "http://localhost:3000"]
print(f"[CORS] Allowed origins: {CORS_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database and processor - initialized on startup
db = None
processor = None


@app.on_event("startup")
async def startup():
    """Initialize database connection and processor on startup"""
    global db, processor

    # Get MongoDB connection from environment or use default
    mongo_uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
    db_name = os.environ.get("MONGODB_DATABASE", "workflow_db")

    db = Database(connection_string=mongo_uri, database_name=db_name)
    processor = WorkflowProcessor(db)

    # Set database and processor for dependencies module
    dependencies.set_db(db)
    dependencies.set_processor(processor)

    # Set media base path from environment
    media_base_path = os.environ.get("MEDIA_BASE_PATH")
    dependencies.set_media_base_path(media_base_path)

    if media_base_path:
        logger.info(f"[STARTUP] Media base path: {media_base_path}")
        logger.info(f"[STARTUP] Media images: {media_base_path}/images")
        logger.info(f"[STARTUP] Media videos: {media_base_path}/videos")

    # Set server base URL for constructing media URLs
    server_base_url = os.environ.get("SERVER_BASE_URL", "http://localhost:9000")
    dependencies.set_server_base_url(server_base_url)
    logger.info(f"[STARTUP] Server base URL: {server_base_url}")

    # Set database for auth routes
    auth.set_database(db)


@app.on_event("shutdown")
async def shutdown():
    """Close all active connections and database on shutdown"""
    global db

    # Signal all active SSE streams to close
    logger.info(f"[SHUTDOWN] Closing {len(active_streams)} workflow streams and {len(active_state_streams)} state streams...")

    # Cancel workflow execution streams
    for workflow_run_id, cancel_event in list(active_streams.items()):
        logger.info(f"[SHUTDOWN] Cancelling stream for workflow {workflow_run_id[:8]}...")
        cancel_event.set()

    # Cancel state streams
    for stream_key, stream_info in list(active_state_streams.items()):
        cancel_event = stream_info.get("cancel_event")
        if cancel_event:
            logger.info(f"[SHUTDOWN] Cancelling state stream {stream_key[:16]}...")
            cancel_event.set()

    # Give streams a moment to clean up
    await asyncio.sleep(0.5)

    # Close database connection
    if db:
        db.close()

    logger.info("[SHUTDOWN] Server shutdown complete")


# =============================================================================
# Include Route Modules
# =============================================================================

app.include_router(execution_router)
# Virtual router MUST be before streaming_router and management_router because:
# - streaming has /{workflow_run_id}/sub-action which would match /virtual/sub-action
# - management has /{workflow_run_id}/resume/confirm which would match /virtual/resume/confirm
app.include_router(virtual_router)
app.include_router(streaming_router)
app.include_router(state_router)
app.include_router(management_router)
app.include_router(files_router)
app.include_router(listing_router)
app.include_router(media_router)
app.include_router(tasks_router)
app.include_router(models_router)
app.include_router(auth.router)


# =============================================================================
# Config Endpoints
# =============================================================================

@app.get("/config/ignore-patterns")
async def get_ignore_patterns():
    """
    Get file ignore patterns for workflow packaging and hash computation.

    These patterns are used to exclude files from zip archives and hashing.
    Returns default patterns if none are configured in the database.
    """
    from .workflow_diff_utils import DEFAULT_IGNORE_PATTERNS

    config = db.get_config("workflow.patterns", "ignore_patterns") if db else None

    if config and config.get("value"):
        patterns = config["value"]
    else:
        patterns = DEFAULT_IGNORE_PATTERNS

    return {
        "patterns": patterns,
        "source": "database" if config else "default"
    }


# =============================================================================
# Health Check
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "database": "connected" if db else "not connected"
    }


# =============================================================================
# CLI Entry Point
# =============================================================================

def run_server(host: str = "0.0.0.0", port: int = 8000):
    """Run the API server"""
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_server()
