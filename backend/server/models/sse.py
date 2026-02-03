"""
SSE Streaming Models

Models for Server-Sent Events in workflow streaming.
"""

from typing import Dict, Any
from enum import Enum
from pydantic import BaseModel, Field


class SSEEventType(str, Enum):
    """Types of SSE events for workflow streaming"""
    STARTED = "started"           # Module execution started
    PROGRESS = "progress"         # Progress update (tokens, elapsed time)
    INTERACTION = "interaction"   # User input needed (complete InteractionRequest)
    COMPLETE = "complete"         # Workflow/module completed
    ERROR = "error"               # Error occurred
    CANCELLED = "cancelled"       # Request was cancelled
    VALIDATION_FAILED = "validation_failed"  # Response validation failed
    # State streaming events
    STATE_SNAPSHOT = "state_snapshot"  # Full state snapshot (on connect)
    STATE_UPDATE = "state_update"      # Incremental state update


class SSEEvent(BaseModel):
    """Server-Sent Event data"""
    type: SSEEventType
    data: Dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> str:
        """Format as SSE message"""
        import json
        return f"event: {self.type.value}\ndata: {json.dumps(self.data)}\n\n"
