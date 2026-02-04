"""
API Response Models

Pydantic models for API response bodies.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from .workflow import WorkflowStatus, WorkflowProgress
from .interaction import ApiInteractionRequest


class WorkflowStatusResponse(BaseModel):
    """Response for status query"""
    workflow_run_id: str
    project_name: str
    workflow_template_name: str
    status: WorkflowStatus
    progress: WorkflowProgress
    interaction_request: Optional[ApiInteractionRequest] = None
    created_at: datetime
    updated_at: datetime


class EventResponse(BaseModel):
    """Single event in event list"""
    event_id: str
    event_type: str
    timestamp: datetime
    step_id: Optional[str] = None
    module_name: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class EventsResponse(BaseModel):
    """Response for events query"""
    workflow_run_id: str
    events: List[EventResponse]
    total_count: int


class CompletedInteraction(BaseModel):
    """A completed interaction with request and response paired"""
    interaction_id: str
    request: Dict[str, Any]  # Full InteractionRequest data
    response: Dict[str, Any]  # Full InteractionResponseData
    timestamp: datetime
    step_id: Optional[str] = None
    module_name: Optional[str] = None


class InteractionHistoryResponse(BaseModel):
    """Response for interaction history endpoint"""
    workflow_run_id: str
    interactions: List[CompletedInteraction]
    pending_interaction: Optional[ApiInteractionRequest] = None


# =============================================================================
# Models Configuration Response
# =============================================================================

class ModelInfo(BaseModel):
    """Information about a single model"""
    id: str
    name: str


class ProviderConfig(BaseModel):
    """Configuration for a single provider"""
    name: str
    default: str
    models: List[ModelInfo]


class ModelsResponse(BaseModel):
    """Response for GET /models endpoint"""
    default_provider: str
    default_model: str
    providers: Dict[str, ProviderConfig]
