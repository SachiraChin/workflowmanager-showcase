"""
Sub-Action Event Models

Domain events yielded by sub-action handlers. These are module-agnostic
and used by the API endpoint to format SSE responses.
"""

from typing import List, Optional
from dataclasses import dataclass


@dataclass
class SubActionStarted:
    """Sub-action execution has started."""
    action_id: str


@dataclass
class SubActionProgress:
    """Progress update from provider."""
    elapsed_ms: int
    message: str


@dataclass
class SubActionComplete:
    """Sub-action completed successfully."""
    urls: List[str]
    metadata_id: str
    content_ids: List[str]


@dataclass
class SubActionError:
    """Sub-action failed with error."""
    message: str
    retry_after: Optional[int] = None


# Type alias for all sub-action events
SubActionEvent = SubActionStarted | SubActionProgress | SubActionComplete | SubActionError
