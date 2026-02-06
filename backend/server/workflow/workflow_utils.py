"""
Workflow Helper Functions

Shared utilities used across workflow components.
"""

from datetime import datetime
from typing import Dict, Any, Optional, Tuple
import os

from models import (
    WorkflowProgress,
    ApiInteractionRequest,
    ApiSelectOption,
    ApiInteractionType,
)
from engine.module_interface import InteractionRequest as EngineInteractionRequest


def find_module_in_workflow(
    workflow_def: Dict,
    module_name: str
) -> Tuple[Optional[str], int]:
    """Find step_id and module_index for a module by name"""
    for step in workflow_def.get('steps', []):
        step_id = step.get('step_id')
        for i, module in enumerate(step.get('modules', [])):
            if module.get('name') == module_name or module.get('module_id') == module_name:
                return step_id, i
    return None, 0


def serialize_interaction_request(request: EngineInteractionRequest) -> Dict:
    """Convert engine InteractionRequest to serializable dict"""
    return {
        "interaction_id": request.interaction_id,
        "interaction_type": request.interaction_type.value,
        "title": request.title,
        "options": [
            {
                "id": opt.id,
                "label": opt.label,
                "description": opt.description,
                "metadata": opt.metadata
            }
            for opt in request.options
        ],
        "min_selections": request.min_selections,
        "max_selections": request.max_selections,
        "allow_custom": request.allow_custom,
        "default_selection": request.default_selection,
        "groups": request.groups,
        "display_data": request.display_data,
        "multiline": request.multiline,
        "placeholder": request.placeholder,
        "default_value": request.default_value,
        "allow_empty": request.allow_empty,
        "context": request.context,
        "extra_options": [
            {
                "id": opt.id,
                "label": opt.label,
                "description": opt.description,
                "metadata": opt.metadata
            }
            for opt in request.extra_options
        ],
        # FILE_DOWNLOAD fields
        "file_content": request.file_content,
        "file_name": request.file_name,
        "file_content_type": request.file_content_type,
        "file_destination": request.file_destination,
    }


def convert_interaction_request(data: Dict) -> ApiInteractionRequest:
    """Convert dict to API InteractionRequest model"""
    return ApiInteractionRequest(
        interaction_id=data.get("interaction_id", ""),
        interaction_type=ApiInteractionType(data.get("interaction_type", "text_input")),
        title=data.get("title", ""),
        prompt=data.get("prompt", ""),
        description=data.get("description", ""),
        options=[
            ApiSelectOption(**opt) for opt in data.get("options", [])
        ],
        min_selections=data.get("min_selections", 1),
        max_selections=data.get("max_selections", 1),
        allow_custom=data.get("allow_custom", False),
        default_selection=data.get("default_selection"),
        groups=data.get("groups", {}),
        display_data=data.get("display_data", {}),
        multiline=data.get("multiline", False),
        placeholder=data.get("placeholder", ""),
        default_value=data.get("default_value", ""),
        allow_empty=data.get("allow_empty", False),
        context=data.get("context", {}),
        extra_options=[
            ApiSelectOption(**opt) for opt in data.get("extra_options", [])
        ],
        # FILE_DOWNLOAD fields
        file_content=data.get("file_content"),
        file_name=data.get("file_name", ""),
        file_content_type=data.get("file_content_type", "text"),
        file_destination=data.get("file_destination", "root"),
        # FORM_INPUT fields
        form_schema=data.get("form_schema", {}),
        form_type=data.get("form_type", ""),
        form_defaults=data.get("form_defaults", []),
    )


def build_progress(workflow_def: Dict, position: Dict) -> WorkflowProgress:
    """Build progress info from workflow and position"""
    steps = workflow_def.get('steps', [])
    return WorkflowProgress(
        current_step=position.get('current_step'),
        completed_steps=position.get('completed_steps', []),
        total_steps=len(steps),
        step_index=len(position.get('completed_steps', []))
    )


def rebuild_services(
    workflow: Dict,
    workflow_def: Dict[str, Any],
    db,
    logger
) -> Dict:
    """
    Rebuild services dict from workflow metadata and definition.

    Args:
        workflow: Workflow document from database
        workflow_def: Resolved workflow definition
        db: Database instance
        logger: Logger instance

    Returns:
        Services dictionary for module execution
    """
    workflow_run_id = workflow.get('workflow_run_id', '')
    project_name = workflow.get('project_name', '')
    user_id = workflow.get('user_id', '')
    branch_id = workflow.get('current_branch_id', '')
    logger.info(f"[REBUILD] project_name from workflow: {project_name}, branch_id: {branch_id}")

    # Get workflow_template_name from the resolved workflow definition
    workflow_template_name = workflow_def.get('workflow_id')
    if not workflow_template_name:
        raise ValueError("Workflow definition missing 'workflow_id' field")

    # Get workflow_template_id for db.query context filtering
    workflow_template_id = workflow.get("workflow_template_id")
    if not workflow_template_id:
        template = db.get_workflow_template_by_name(workflow_template_name, user_id)
        workflow_template_id = template['workflow_template_id'] if template else None

    # Get ai_config from stored workflow document
    ai_config = workflow.get('ai_config', {})
    logger.info(f"[REBUILD] ai_config from workflow: model={ai_config.get('model')}, "
                f"has_api_key={bool(ai_config.get('openai_api_key') or ai_config.get('anthropic_api_key') or ai_config.get('api_key'))}")

    # Set API keys in environment if provided
    if ai_config.get('api_key'):
        provider = ai_config.get('provider', 'openai')
        if provider == 'openai':
            ai_config['openai_api_key'] = ai_config['api_key']
            os.environ['OPENAI_API_KEY'] = ai_config['api_key']
        elif provider == 'anthropic':
            ai_config['anthropic_api_key'] = ai_config['api_key']
            os.environ['ANTHROPIC_API_KEY'] = ai_config['api_key']

    return {
        'ai_config': ai_config,
        'workflow_run_id': workflow_run_id,
        'project_name': project_name,
        'workflow_template_name': workflow_template_name,
        'workflow_template_id': workflow_template_id,
        'user_id': user_id,
        'branch_id': branch_id,
        'session_timestamp': datetime.now().strftime('%Y%m%d_%H%M%S'),
    }


def get_workflow_def(workflow: Dict, db, logger) -> Dict[str, Any]:
    """
    Get workflow definition from database.

    Uses current_workflow_version_id to get the active version (must be raw or resolved).

    Args:
        workflow: Workflow document from database
        db: Database instance
        logger: Logger instance

    Returns:
        Resolved workflow definition

    Raises:
        ValueError: If version ID is not set, version not found, or version is unresolved
    """
    workflow_run_id = workflow.get('workflow_run_id')

    current_version_id = workflow.get('current_workflow_version_id')
    if not current_version_id:
        raise ValueError(f"Workflow {workflow_run_id} has no current_workflow_version_id set")

    version = db.get_workflow_version_by_id(current_version_id)
    if not version:
        raise ValueError(f"Workflow version {current_version_id} not found for workflow {workflow_run_id}")

    version_type = version.get('version_type', 'raw')
    if version_type == 'unresolved':
        raise ValueError(
            f"Workflow version {current_version_id} is 'unresolved' and cannot be executed. "
            f"This indicates a bug - unresolved versions should never be assigned to workflow runs."
        )

    resolved_workflow = version.get('resolved_workflow')
    if not resolved_workflow:
        raise ValueError(f"Workflow version {current_version_id} has no resolved_workflow")

    logger.debug(f"[GET_WORKFLOW_DEF] Using version ({version_type}): {current_version_id}")
    return resolved_workflow
