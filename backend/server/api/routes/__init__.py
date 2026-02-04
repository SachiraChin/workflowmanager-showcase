"""
Route modules for the Workflow API.

Each module contains related endpoints that are mounted on the main app.
"""

from .execution import router as execution_router
from .streaming import router as streaming_router
from .state import router as state_router
from .management import router as management_router
from .files import router as files_router
from .listing import router as listing_router
from .media import router as media_router
from .tasks import router as tasks_router
from .models import router as models_router
from . import auth

__all__ = [
    "auth",
    "execution_router",
    "streaming_router",
    "state_router",
    "management_router",
    "files_router",
    "listing_router",
    "media_router",
    "tasks_router",
    "models_router",
]
