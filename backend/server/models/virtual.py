"""
Virtual Workflow Models

Models specific to virtual workflow execution endpoints.
"""

from typing import Any, Dict, Optional

from .workflow import WorkflowResponse


class VirtualWorkflowResponse(WorkflowResponse):
    """
    Response from virtual workflow endpoints.
    
    Extends WorkflowResponse with virtual-specific fields that are always
    present in virtual endpoint responses regardless of status.
    """
    # Virtual run ID for subsequent requests (same as workflow_run_id but
    # explicitly named for clarity in virtual context)
    virtual_run_id: str = ""
    # Compressed database state (base64-encoded gzip JSON) - opaque to client,
    # must be sent back in subsequent requests
    virtual_db: Optional[str] = None
    # Current module outputs as plain dict - readable by UI for state display
    state: Optional[Dict[str, Any]] = None
