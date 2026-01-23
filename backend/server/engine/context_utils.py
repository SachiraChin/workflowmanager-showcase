"""
Context Utilities - Helper functions for accessing required context values.

These functions ensure that required context values are present and raise
clear errors when they're missing, rather than silently using fallback values.
"""


def require_step_id(context) -> str:
    """
    Get step_id from context, raise error if missing.

    Args:
        context: Execution context object

    Returns:
        The step_id string

    Raises:
        ValueError: If step_id is not set on context
    """
    step_id = getattr(context, 'step_id', None)
    if not step_id:
        raise ValueError(
            "context.step_id is not set - this indicates a bug in the workflow processor"
        )
    return step_id


def require_module_name(context) -> str:
    """
    Get current_module_name from context, raise error if missing.

    Args:
        context: Execution context object

    Returns:
        The module_name string

    Raises:
        ValueError: If current_module_name is not set on context
    """
    module_name = getattr(context, 'current_module_name', None)
    if not module_name:
        raise ValueError(
            "context.current_module_name is not set - this indicates a bug in the workflow processor"
        )
    return module_name


def require_step_id_from_metadata(metadata: dict) -> str:
    """
    Get step_id from metadata dict, raise error if missing.

    Args:
        metadata: Metadata dictionary

    Returns:
        The step_id string

    Raises:
        ValueError: If step_id is not in metadata
    """
    step_id = metadata.get('step_id') if metadata else None
    if not step_id:
        raise ValueError(
            "metadata.step_id is not set - this indicates a bug in the workflow processor"
        )
    return step_id
