"""
Virtual Server FastAPI application setup.

This module sets up the FastAPI application for virtual workflow execution.
Virtual server uses a separate MongoDB instance (mongo-virtual) for workflow
data isolation and shares authentication with the main server (same user database).

Endpoints:
- POST /workflow/start - Start virtual module execution
- POST /workflow/respond - Respond to virtual interaction
- POST /workflow/resume/confirm - Resume with updated workflow
- POST /workflow/state - Get workflow state
- POST /workflow/interaction-history - Get interaction history
- POST /workflow/sub-action - Execute sub-action (SSE streaming)
- POST /workflow/generations - Get generations
- POST /workflow/media/preview - Get media preview info
"""

import os
import logging

# Load .env file if it exists (before other imports that might use env vars)
try:
    from dotenv import load_dotenv
    from pathlib import Path
    # Look for .env in the virtual-server directory (parent of api/)
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"[ENV] Loaded .env from {env_path}")
    else:
        # Try parent directory (backend/)
        env_path = Path(__file__).parent.parent.parent / ".env"
        if env_path.exists():
            load_dotenv(env_path)
            print(f"[ENV] Loaded .env from {env_path}")
        else:
            load_dotenv()  # Fall back to current directory
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db import Database
from . import dependencies
from .routes.workflow import router as workflow_router

# Configure logger
logger = logging.getLogger("workflow.virtual")


# =============================================================================
# App Configuration
# =============================================================================

app = FastAPI(
    title="Virtual Workflow API",
    description="REST API for virtual workflow execution using isolated MongoDB",
    version="1.0.0",
)

# CORS middleware - virtual server needs same CORS config as main server
# since it's called from the same editor UI
cors_origins_str = os.environ.get("CORS_ORIGINS", "")
CORS_ORIGINS = (
    [origin.strip() for origin in cors_origins_str.split(",") if origin.strip()]
    if cors_origins_str
    else ["http://localhost:5173", "http://localhost:3000"]
)
print(f"[CORS] Allowed origins: {CORS_ORIGINS}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth database - connects to same MongoDB as main server for user authentication
auth_db = None


@app.on_event("startup")
async def startup():
    """Initialize auth database connection on startup."""
    global auth_db

    # Get MongoDB connection from environment (same as main server)
    mongo_uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
    db_name = os.environ.get("MONGODB_DATABASE", "workflow_db")

    auth_db = Database(connection_string=mongo_uri, database_name=db_name)

    # Set auth database for dependencies module
    dependencies.set_auth_db(auth_db)

    logger.info("[STARTUP] Virtual server started")
    logger.info(f"[STARTUP] Auth database: {db_name}")


@app.on_event("shutdown")
async def shutdown():
    """Close auth database connection on shutdown."""
    global auth_db

    if auth_db:
        auth_db.close()

    logger.info("[SHUTDOWN] Virtual server shutdown complete")


# =============================================================================
# Include Route Modules
# =============================================================================

app.include_router(workflow_router)


# =============================================================================
# Health Check
# =============================================================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "virtual-server",
        "auth_database": "connected" if auth_db else "not connected",
    }


# =============================================================================
# CLI Entry Point
# =============================================================================

def run_server(host: str = "0.0.0.0", port: int = 9001):
    """Run the virtual API server."""
    import uvicorn
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_server()
