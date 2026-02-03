"""
Workflow Models

Core workflow status and response models.
"""

from typing import Dict, Any, List, Optional, TYPE_CHECKING
from enum import Enum
from pydantic import BaseModel, Field

if TYPE_CHECKING:
    from .interaction import ApiInteractionRequest


class WorkflowStatus(str, Enum):
    """Workflow execution status"""
    CREATED = "created"
    PROCESSING = "processing"
    AWAITING_INPUT = "awaiting_input"
    COMPLETED = "completed"
    ERROR = "error"
    VALIDATION_FAILED = "validation_failed"


class WorkflowProgress(BaseModel):
    """Progress information"""
    current_step: Optional[str] = None
    current_module: Optional[str] = None
    completed_steps: List[str] = Field(default_factory=list)
    total_steps: int = 0
    step_index: int = 0


class WorkflowResponse(BaseModel):
    """Standard workflow response"""
    workflow_run_id: str
    status: WorkflowStatus
    message: str = ""
    progress: Optional[WorkflowProgress] = None
    interaction_request: Optional["ApiInteractionRequest"] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    # Validation failure fields
    validation_errors: List[Dict[str, Any]] = Field(default_factory=list)
    validation_warnings: List[Dict[str, Any]] = Field(default_factory=list)


# Note: model_rebuild() is called in __init__.py after ApiInteractionRequest is imported
