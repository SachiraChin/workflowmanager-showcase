"""
Shared Models

Pydantic models used across server components (api, workflow, etc).
"""

from .workflow import (
    WorkflowStatus,
    WorkflowResponse,
    WorkflowProgress,
)
from .interaction import (
    ApiInteractionType,
    ApiSelectOption,
    ApiInteractionRequest,
    InteractionResponseData,
)
from .sse import (
    SSEEventType,
    SSEEvent,
)
from .requests import (
    BaseWorkflowRequest,
    StartWorkflowByVersionRequest,
    StartWorkflowRequest,
    RespondRequest,
    RetryRequest,
    ResumeWorkflowRequest,
    SubActionRequest,
    CancelRequest,
    ResetRequest,
    MediaPreviewRequest,
    PublishGlobalTemplateRequest,
)
from .responses import (
    WorkflowStatusResponse,
    EventResponse,
    EventsResponse,
    CompletedInteraction,
    InteractionHistoryResponse,
)
from .sub_action import (
    SubActionStarted,
    SubActionProgress,
    SubActionComplete,
    SubActionError,
    SubActionEvent,
)
from .execution import (
    ExecutionTarget,
)

# Rebuild models with forward references now that all types are available
WorkflowResponse.model_rebuild()

__all__ = [
    # Workflow
    'WorkflowStatus',
    'WorkflowResponse',
    'WorkflowProgress',
    # Interaction
    'ApiInteractionType',
    'ApiSelectOption',
    'ApiInteractionRequest',
    'InteractionResponseData',
    # SSE
    'SSEEventType',
    'SSEEvent',
    # Requests
    'BaseWorkflowRequest',
    'StartWorkflowByVersionRequest',
    'StartWorkflowRequest',
    'RespondRequest',
    'RetryRequest',
    'ResumeWorkflowRequest',
    'SubActionRequest',
    'CancelRequest',
    'ResetRequest',
    'MediaPreviewRequest',
    'PublishGlobalTemplateRequest',
    # Responses
    'WorkflowStatusResponse',
    'EventResponse',
    'EventsResponse',
    'CompletedInteraction',
    'InteractionHistoryResponse',
    # Sub-action events
    'SubActionStarted',
    'SubActionProgress',
    'SubActionComplete',
    'SubActionError',
    'SubActionEvent',
    # Execution controls
    'ExecutionTarget',
]
