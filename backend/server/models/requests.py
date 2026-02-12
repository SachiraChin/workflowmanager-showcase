"""
API Request Models

Pydantic models for API request bodies.
"""

from typing import Dict, Any, List, Optional, Union
from pydantic import BaseModel, Field, model_validator

from .interaction import InteractionResponseData


# =============================================================================
# Base Request Class
# =============================================================================

class BaseWorkflowRequest(BaseModel):
    """
    Base class for all workflow API requests.
    
    Provides common fields that can be used across all endpoints:
    - ai_config: Runtime override for AI configuration (provider, model)
    
    All request models should inherit from this class to ensure consistent
    support for AI configuration across the API.
    """
    ai_config: Optional[Dict[str, Any]] = None  # Runtime override for model/provider


# =============================================================================
# Workflow Start Requests
# =============================================================================

class StartWorkflowByVersionRequest(BaseWorkflowRequest):
    """
    Request to start workflow with an existing version.

    Used with POST /start/{workflow_version_id} endpoint.
    The version_id comes from the path parameter.
    """
    project_name: str  # Unique project identifier within user + template scope
    force_new: bool = False  # Force new workflow even if one exists
    capabilities: List[str] = Field(default_factory=list)  # Client capabilities for resolution selection


class StartWorkflowRequest(BaseWorkflowRequest):
    """
    Request to start workflow with uploaded content.

    Used with POST /start endpoint.
    Workflow content is required - use /start/{version_id} for existing versions.

    Content formats:
    - str: Base64 encoded zip file containing workflow folder
    - dict: Pre-resolved workflow JSON (all $refs already expanded)

    When using zip mode (string), workflow_entry_point specifies the main
    workflow file path within the zip (e.g., "workflow_v3.json").

    Workflow run is identified by: user_id (from access key) + project_name + workflow_template_name
    - project_name: User-provided unique project identifier (e.g., "my_video_project")

    All outputs are stored in the database, not filesystem.
    """
    project_name: str  # Unique project identifier within user + template scope
    workflow_content: Union[str, Dict[str, Any]]  # Workflow: base64 zip or JSON dict (required)
    workflow_entry_point: Optional[str] = None  # Path to main workflow file within zip
    force_new: bool = False  # Force new workflow even if one exists
    capabilities: List[str] = Field(default_factory=list)  # Client capabilities for resolution selection

    @model_validator(mode='after')
    def check_workflow_content(self) -> 'StartWorkflowRequest':
        """Validate workflow content is provided and entry point for zips."""
        if isinstance(self.workflow_content, str) and not self.workflow_entry_point:
            raise ValueError("workflow_entry_point is required when workflow_content is a zip (base64 string)")

        return self


# =============================================================================
# Interaction Requests
# =============================================================================

class RespondRequest(BaseWorkflowRequest):
    """Request to respond to an interaction"""
    workflow_run_id: str
    interaction_id: str
    response: InteractionResponseData


class RetryRequest(BaseWorkflowRequest):
    """Request to retry a module with optional feedback"""
    workflow_run_id: str
    target_module: str
    feedback: Optional[str] = None


class SubActionRequest(BaseWorkflowRequest):
    """
    Request to execute a sub-action within an interaction.

    Sub-actions are operations that can be triggered from within an interactive
    module without completing the interaction.

    The sub_action_id references a sub_action definition in the module's schema.
    The sub_action schema defines what type of action to execute:
    - target_sub_action: Execute a chain of modules as a child workflow
    - self_sub_action: Invoke the module's own sub_action() method

    The response is streamed via SSE with progress updates.
    """
    interaction_id: str  # ID of the current interaction
    sub_action_id: str  # References sub_action.id in module schema
    params: Dict[str, Any] = Field(default_factory=dict)  # Action-specific params
    mock: bool = Field(default=False, description="If true, return mock data instead of real API calls")


# =============================================================================
# Workflow Resume Requests
# =============================================================================

class ResumeWorkflowRequest(BaseWorkflowRequest):
    """
    Optional request body for resume endpoint.

    Can be used in two ways:
    1. Simple resume: No content, loads stored workflow definition
    2. Resume with update: Provide new workflow_content to update before resuming

    When workflow_content is provided:
    - Server compares with stored version
    - If changed, returns requires_confirmation with version diff
    - Client must call /resume/confirm to proceed with the update
    """
    # Optional workflow content for "resume with update"
    workflow_content: Optional[Union[Dict[str, Any], str]] = None  # JSON dict or base64-encoded ZIP
    workflow_entry_point: Optional[str] = None  # Required for ZIP files

    # Client capabilities for resolution selection
    capabilities: List[str] = Field(default_factory=list)


# =============================================================================
# Workflow Control Requests
# =============================================================================

class CancelRequest(BaseWorkflowRequest):
    """
    Request to cancel an active workflow.
    
    Used with POST /workflow/{workflow_run_id}/cancel endpoint.
    The workflow_run_id comes from the path parameter.
    """
    pass  # Only inherits ai_config from base


class ResetRequest(BaseWorkflowRequest):
    """
    Request to reset a workflow to its initial state.
    
    Used with POST /workflow/{workflow_run_id}/reset endpoint.
    The workflow_run_id comes from the path parameter.
    """
    pass  # Only inherits ai_config from base


# =============================================================================
# Workflow Template Requests
# =============================================================================


class PublishGlobalTemplateRequest(BaseWorkflowRequest):
    """Request to publish a workflow version globally."""
    source_version_id: str


# =============================================================================
# Media Requests
# =============================================================================

class MediaPreviewRequest(BaseWorkflowRequest):
    """
    Request to get preview info for a media generation configuration.
    
    Used with POST /workflow/{workflow_run_id}/media/preview endpoint.
    Returns expected resolution and credit cost before generating.
    """
    provider: str  # Media provider (e.g., "ideogram", "runway")
    action_type: str  # Action type (e.g., "generate", "upscale")
    params: Dict[str, Any] = Field(default_factory=dict)  # Provider-specific parameters
