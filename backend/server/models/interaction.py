"""
Interaction Models

Models for user interactions in workflows.
"""

from typing import Dict, Any, List, Optional, Union
from enum import Enum
from pydantic import BaseModel, Field

# Import contracts for validation bindings
from contracts.interactions import (
    InteractionRequest as ContractInteractionRequest,
    InteractionResponse as ContractInteractionResponse,
)


class ApiInteractionType(str, Enum):
    """Types of user interactions (Pydantic version for API serialization)"""
    TEXT_INPUT = "text_input"
    SELECT_FROM_STRUCTURED = "select_from_structured"
    REVIEW_GROUPED = "review_grouped"
    FILE_INPUT = "file_input"
    FILE_DOWNLOAD = "file_download"
    FORM_INPUT = "form_input"
    MEDIA_GENERATION = "media_generation"
    # Workflow-level interactions (handled by workflow manager, not modules)
    RESUME_CHOICE = "resume_choice"
    RETRY_OPTIONS = "retry_options"


class ApiSelectOption(BaseModel):
    """Option in a selection list (Pydantic version for API serialization)"""
    id: str
    label: str
    description: str = ""
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ApiInteractionRequest(BaseModel):
    """Request for user interaction (Pydantic version for API serialization)"""
    __contract__ = ContractInteractionRequest

    interaction_id: str
    interaction_type: ApiInteractionType
    title: str = ""

    # For selections
    options: List[ApiSelectOption] = Field(default_factory=list)
    min_selections: int = 1
    max_selections: int = 1
    allow_custom: bool = False
    default_selection: Optional[Union[int, List[int]]] = None

    # For structured display
    groups: Dict[str, Any] = Field(default_factory=dict)
    display_data: Dict[str, Any] = Field(default_factory=dict)

    # For text input
    multiline: bool = False
    placeholder: str = ""
    default_value: str = ""
    allow_empty: bool = False

    # For confirm
    yes_label: str = "Yes"
    no_label: str = "No"
    default_confirm: Optional[bool] = None

    # For FILE_INPUT
    accepted_types: List[str] = Field(default_factory=list)
    multiple_files: bool = False
    base_path: str = ""

    # Context
    context: Dict[str, Any] = Field(default_factory=dict)
    extra_options: List[ApiSelectOption] = Field(default_factory=list)

    # Schema for client-side resolution
    resolver_schema: Optional[Dict[str, Any]] = None

    # For FILE_DOWNLOAD (server sends file for TUI to write)
    file_content: Optional[Any] = None
    file_name: str = ""
    file_content_type: str = "text"
    file_destination: str = "root"

    # For FORM_INPUT
    form_schema: Dict[str, Any] = Field(default_factory=dict)
    form_type: str = ""
    form_defaults: List[Dict[str, Any]] = Field(default_factory=list)


class InteractionResponseData(BaseModel):
    """User's response to an interaction"""
    __contract__ = ContractInteractionResponse
    __contract_exclude__ = {'interaction_id'}  # Provided by RespondRequest wrapper

    value: Optional[Any] = None
    selected_indices: List[Any] = Field(default_factory=list)  # Can be int, str, or list (for nested)
    selected_options: List[Dict[str, Any]] = Field(default_factory=list)
    custom_value: Optional[str] = None
    cancelled: bool = False
    retry_requested: bool = False
    retry_groups: List[str] = Field(default_factory=list)
    retry_feedback: str = ""  # User feedback for retry
    jump_back_requested: bool = False
    jump_back_target: str = ""
    # FILE_DOWNLOAD response fields
    file_written: bool = False
    file_path: str = ""
    file_error: str = ""
    # FORM_INPUT response fields
    form_data: List[Dict[str, Any]] = Field(default_factory=list)
    # MEDIA_GENERATION response fields
    selected_content_id: Optional[str] = None
    selected_content: Optional[Dict[str, Any]] = None
    generations: Dict[str, List[Dict[str, Any]]] = Field(default_factory=dict)
