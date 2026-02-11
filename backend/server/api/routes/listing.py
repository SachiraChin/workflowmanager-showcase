"""
Workflow Listing API routes.

Provides endpoints for listing workflow templates and workflow runs.
"""

import logging
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, Depends
from jinja2 import Environment, BaseLoader

from ..dependencies import get_db, get_current_user_id, get_verified_template, require_admin_user
from models import PublishGlobalTemplateRequest

logger = logging.getLogger('workflow.api')

router = APIRouter(tags=["listing"])


@router.get("/workflow-templates")
async def list_workflow_templates(
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    version_limit: int = 20
):
    """
    List available workflow templates for the current user.

    Returns templates with their source versions (excludes resolved versions).
    User must select a specific version to start a workflow.

    Args:
        version_limit: Maximum versions per template (default 20)

    Returns:
        templates: List of templates, each with:
            - template_name: Workflow template name
            - template_id: Template ID
            - download_url: Optional template download URL
            - versions: List of source versions (newest first)
                - workflow_version_id: Version ID to use when starting
                - created_at: When this version was created
                - content_hash: Hash of the workflow content
                - source_type: How it was uploaded (json, zip, stored)
    """
    user_templates = list(db.workflow_templates.find(
        {
            "user_id": user_id,
            "$and": [
                {"$or": [{"scope": {"$exists": False}}, {"scope": "user"}]},
                {"$or": [
                    {"visibility": {"$exists": False}},
                    {"visibility": "visible"},
                ]},
            ],
        },
        {
            "_id": 0,
            "workflow_template_id": 1,
            "workflow_template_name": 1,
            "created_at": 1,
            "scope": 1,
            "visibility": 1,
            "derived_from": 1,
            "download_url": 1,
        }
    ))
    global_templates = list(db.workflow_templates.find(
        {
            "scope": "global",
            "visibility": "public",
        },
        {
            "_id": 0,
            "workflow_template_id": 1,
            "workflow_template_name": 1,
            "created_at": 1,
            "scope": 1,
            "visibility": 1,
            "derived_from": 1,
            "download_url": 1,
        }
    ))
    templates = user_templates + global_templates

    result = []
    for template in templates:
        template_id = template.get("workflow_template_id")
        versions = db.version_repo.get_raw_versions_for_template(template_id, limit=version_limit)

        if versions:
            # Get workflow name from the latest version's resolved_workflow
            workflow_name = None
            latest_version = versions[0] if versions else None
            if latest_version:
                resolved = db.version_repo.get_resolved_workflow(
                    latest_version.get("workflow_version_id")
                )
                if resolved:
                    workflow_name = resolved.get("name")

            result.append({
                "template_name": template.get("workflow_template_name"),
                "template_id": template_id,
                "name": workflow_name,  # Human-readable name from workflow JSON
                "versions": versions,
                "scope": template.get("scope", "user"),
                "visibility": template.get("visibility", "visible"),
                "derived_from": template.get("derived_from"),
                "download_url": template.get("download_url"),
            })
    result.sort(
        key=lambda t: (
            0 if t.get("scope") == "global" else 1,
            t.get("template_name", ""),
        )
    )

    return {"templates": result, "count": len(result)}


# =============================================================================
# Helper: Verify template access
# =============================================================================

def _get_template_with_access_check(db, template_id: str, user_id: str):
    """
    Get template and verify user has access to it.
    Returns template or raises HTTPException.
    
    NOTE: For endpoints that need access info (is_owner, can_edit),
    use the get_verified_template dependency instead.
    """
    template = db.version_repo.get_template_by_id(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # Check access: user owns it OR it's a public global template
    is_owner = template.get("user_id") == user_id
    is_public_global = (
        template.get("scope") == "global" and
        template.get("visibility") == "public"
    )

    if not is_owner and not is_public_global:
        raise HTTPException(status_code=403, detail="Access denied")

    return template


# =============================================================================
# Template Detail Endpoints
# =============================================================================

@router.get("/workflow-templates/{template_id}/versions/latest")
async def get_workflow_template_version_latest(
    db = Depends(get_db),
    template: dict = Depends(get_verified_template),
):
    """
    Get the latest version's workflow definition for a template.

    Returns the resolved workflow definition (steps, modules, etc.)
    for the most recent source version.
    
    Also includes access info:
    - is_owner: True if user owns the template
    - is_global: True if template is a global template
    - can_edit: True if user can edit (owner or admin for global)
    """
    template_id = template.get("workflow_template_id")

    # Get latest source version
    versions = db.version_repo.get_raw_versions_for_template(template_id, limit=1)
    if not versions:
        raise HTTPException(status_code=404, detail="No versions found for template")

    latest_version = versions[0]
    version_id = latest_version.get("workflow_version_id")

    can_edit = template.get("_access_can_edit")
    is_global = template.get("_access_is_global")
    user_id = template.get("_access_user_id")

    # For global templates user can't edit, check if user has a clone
    if is_global and not can_edit:
        workflow_template_name = template.get("workflow_template_name")
        content_hash = latest_version.get("content_hash")

        # Check if user has a template with same name
        user_template = db.version_repo.workflow_templates.find_one({
            "workflow_template_name": workflow_template_name,
            "user_id": user_id,
            "scope": "user",
        })

        if user_template:
            user_template_id = user_template.get("workflow_template_id")
            # Check if user has a version with same content hash
            user_version = db.version_repo.workflow_versions.find_one({
                "workflow_template_id": user_template_id,
                "content_hash": content_hash,
            })

            if user_version:
                # User already has this version cloned - redirect to it
                return {
                    "template_id": template_id,
                    "template_name": workflow_template_name,
                    "workflow_version_id": version_id,
                    "created_at": latest_version.get("created_at"),
                    "definition": None,
                    "is_owner": False,
                    "is_global": is_global,
                    "can_edit": False,
                    "redirect_to": {
                        "template_id": user_template_id,
                        "version_id": user_version.get("workflow_version_id"),
                    },
                }

        # No clone exists - user must clone first
        return {
            "template_id": template_id,
            "template_name": template.get("workflow_template_name"),
            "workflow_version_id": version_id,
            "created_at": latest_version.get("created_at"),
            "definition": None,
            "is_owner": False,
            "is_global": is_global,
            "can_edit": False,
            "redirect_to": None,
        }

    # Get the resolved workflow definition
    definition = db.version_repo.get_resolved_workflow(version_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    return {
        "template_id": template_id,
        "template_name": template.get("workflow_template_name"),
        "workflow_version_id": version_id,
        "created_at": latest_version.get("created_at"),
        "definition": definition,
        "is_owner": template.get("_access_is_owner"),
        "is_global": is_global,
        "can_edit": can_edit,
        "redirect_to": None,
    }


@router.get("/workflow-templates/{template_id}/versions/{version_id}")
async def get_workflow_template_version(
    version_id: str,
    db = Depends(get_db),
    template: dict = Depends(get_verified_template),
):
    """
    Get a specific version's workflow definition for a template.

    Returns the resolved workflow definition (steps, modules, etc.)
    for the specified version.
    
    Also includes access info:
    - is_owner: True if user owns the template
    - is_global: True if template is a global template
    - can_edit: True if user can edit (owner or admin for global)
    """
    template_id = template.get("workflow_template_id")

    # Get the version and verify it belongs to this template
    version = db.version_repo.get_workflow_version_by_id(version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if version.get("workflow_template_id") != template_id:
        raise HTTPException(status_code=404, detail="Version not found for this template")

    # Get the resolved workflow definition
    definition = db.version_repo.get_resolved_workflow(version_id)
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    can_edit = template.get("_access_can_edit")
    is_global = template.get("_access_is_global")
    user_id = template.get("_access_user_id")

    # For global templates user can't edit, check if user has a clone
    if is_global and not can_edit:
        workflow_template_name = template.get("workflow_template_name")
        content_hash = version.get("content_hash")

        # Check if user has a template with same name
        user_template = db.version_repo.workflow_templates.find_one({
            "workflow_template_name": workflow_template_name,
            "user_id": user_id,
            "scope": "user",
        })

        if user_template:
            user_template_id = user_template.get("workflow_template_id")
            # Check if user has a version with same content hash
            user_version = db.version_repo.workflow_versions.find_one({
                "workflow_template_id": user_template_id,
                "content_hash": content_hash,
            })

            if user_version:
                # User already has this version cloned - redirect to it
                return {
                    "template_id": template_id,
                    "template_name": workflow_template_name,
                    "workflow_version_id": version_id,
                    "created_at": version.get("created_at"),
                    "definition": None,
                    "is_owner": False,
                    "is_global": is_global,
                    "can_edit": False,
                    "redirect_to": {
                        "template_id": user_template_id,
                        "version_id": user_version.get("workflow_version_id"),
                    },
                }

        # No clone exists - user must clone first
        return {
            "template_id": template_id,
            "template_name": template.get("workflow_template_name"),
            "workflow_version_id": version_id,
            "created_at": version.get("created_at"),
            "definition": None,
            "is_owner": False,
            "is_global": is_global,
            "can_edit": False,
            "redirect_to": None,
        }

    return {
        "template_id": template_id,
        "template_name": template.get("workflow_template_name"),
        "workflow_version_id": version_id,
        "created_at": version.get("created_at"),
        "definition": definition,
        "is_owner": template.get("_access_is_owner"),
        "is_global": is_global,
        "can_edit": can_edit,
        "redirect_to": None,
    }


@router.get("/workflow-templates/{template_id}")
async def get_workflow_template(
    db = Depends(get_db),
    template: dict = Depends(get_verified_template),
    version_limit: int = 20,
):
    """
    Get a specific workflow template with its versions.

    Returns template metadata and list of available versions.
    Also includes access info (is_owner, is_global, can_edit).
    """
    template_id = template.get("workflow_template_id")

    # Get versions for this template
    versions = db.version_repo.get_raw_versions_for_template(
        template_id, limit=version_limit
    )

    # Get workflow name from latest version
    workflow_name = None
    if versions:
        latest_version = versions[0]
        resolved = db.version_repo.get_resolved_workflow(
            latest_version.get("workflow_version_id")
        )
        if resolved:
            workflow_name = resolved.get("name")

    return {
        "template_id": template_id,
        "template_name": template.get("workflow_template_name"),
        "name": workflow_name,
        "scope": template.get("scope", "user"),
        "visibility": template.get("visibility", "visible"),
        "derived_from": template.get("derived_from"),
        "download_url": template.get("download_url"),
        "versions": versions,
        "is_owner": template.get("_access_is_owner"),
        "is_global": template.get("_access_is_global"),
        "can_edit": template.get("_access_can_edit"),
    }


@router.post("/workflow-templates/{template_id}/versions/{version_id}/clone")
async def clone_global_version_to_user(
    version_id: str,
    db = Depends(get_db),
    template: dict = Depends(get_verified_template),
):
    """
    Clone a global template version to the user's own template.

    This allows non-admin users to edit global templates by creating
    a personal copy. Uses the same template name - if user already has
    a template with that name, the version is added there.

    Returns:
    - template_id: The user's template ID (new or existing)
    - version_id: The cloned version ID
    - template_name: The template name
    - is_new_template: True if a new template was created
    """
    global_template_id = template.get("workflow_template_id")
    user_id = template.get("_access_user_id")
    is_global = template.get("_access_is_global")
    workflow_template_name = template.get("workflow_template_name")

    if not is_global:
        raise HTTPException(
            status_code=400,
            detail="This endpoint is only for cloning global templates"
        )

    # Get the source version
    source_version = db.version_repo.get_workflow_version_by_id(version_id)
    if not source_version:
        raise HTTPException(status_code=404, detail="Version not found")

    if source_version.get("workflow_template_id") != global_template_id:
        raise HTTPException(status_code=404, detail="Version not found for this template")

    # Get or create user's template with the same name
    # This uses workflow_template_name + user_id as unique key
    user_template_id, is_new_template = db.version_repo.get_or_create_template(
        workflow_template_name=workflow_template_name,
        user_id=user_id,
    )

    # Clone the version to user's template using process_and_store_workflow_versions
    # This will also handle deduplication by content_hash
    resolved_workflow = source_version.get("resolved_workflow", {})
    content_hash = source_version.get("content_hash")
    source_type = source_version.get("source_type", "json")

    user_version_id, _, is_new_version = db.version_repo.process_and_store_workflow_versions(
        resolved_workflow=resolved_workflow,
        content_hash=content_hash,
        source_type=source_type,
        workflow_template_name=workflow_template_name,
        user_id=user_id,
    )

    return {
        "template_id": user_template_id,
        "version_id": user_version_id,
        "template_name": workflow_template_name,
        "is_new_template": is_new_template,
        "is_new_version": is_new_version,
    }


@router.post("/workflow-templates/global/publish")
async def publish_global_template(
    request: PublishGlobalTemplateRequest,
    db = Depends(get_db),
    admin_user: dict = Depends(require_admin_user),
):
    """
    Publish a user workflow version to the global template list.
    """
    source_version = db.version_repo.get_workflow_version_by_id(
        request.source_version_id
    )
    if not source_version:
        raise HTTPException(status_code=404, detail="Workflow version not found")

    version_type = source_version.get("version_type")
    if version_type == "resolved":
        raise HTTPException(
            status_code=400,
            detail="Cannot publish a resolved version",
        )

    source_template = db.version_repo.get_template_by_id(
        source_version.get("workflow_template_id")
    )
    if not source_template:
        raise HTTPException(status_code=500, detail="Template not found")

    if source_template.get("scope") == "global":
        raise HTTPException(
            status_code=400,
            detail="Source version is already global",
        )

    if source_template.get("user_id") != admin_user.get("user_id"):
        raise HTTPException(status_code=403, detail="Access denied")

    resolved_workflow = source_version.get("resolved_workflow", {})
    workflow_template_name = (
        resolved_workflow.get("workflow_id")
        or source_template.get("workflow_template_name")
    )
    if not workflow_template_name:
        raise HTTPException(status_code=400, detail="Workflow template name missing")

    global_template_id, _ = db.version_repo.get_or_create_global_template(
        workflow_template_name=workflow_template_name,
        owner_user_id=admin_user.get("user_id"),
    )

    sync_result = db.version_repo.copy_version_tree(
        source_version_id=source_version.get("workflow_version_id"),
        target_template_id=global_template_id,
    )
    db.workflow_templates.update_one(
        {"workflow_template_id": global_template_id},
        {"$set": {"updated_at": datetime.utcnow()}},
    )

    return {
        "global_template_id": global_template_id,
        "inserted": sync_result.get("inserted", 0),
        "existing": sync_result.get("existing", 0),
    }


@router.get("/workflows/active")
async def get_active_workflows(
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id)
):
    """
    Get all active (running) workflows with status data for the current user.

    Used by status display app to show running workflows.
    Supports both WebUI (cookie auth) and CLI (X-Access-Key header).
    """
    workflows = db.workflow_repo.get_active_workflows(user_id=user_id)

    results = []
    for wf in workflows:
        workflow_run_id = wf.get("workflow_run_id")
        position = db.state_repo.get_workflow_position(workflow_run_id)

        results.append({
            "workflow_run_id": workflow_run_id,
            "project_name": wf.get("project_name", ""),
            "workflow_template_name": wf.get("workflow_template_name", "default"),
            "status": wf.get("status", "created"),
            "current_step": position.get("current_step"),
            "current_step_name": wf.get("current_step_name"),
            "current_module": wf.get("current_module"),
            "completed_steps": position.get("completed_steps", []),
            "created_at": wf.get("created_at"),
            "updated_at": wf.get("updated_at"),
            "completed_at": wf.get("completed_at"),
            "current_workflow_version_id": wf.get("current_workflow_version_id"),
        })

    return {"workflows": results, "count": len(results)}


@router.get("/workflows/all")
async def get_all_workflows(
    db = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
    limit: int = 10,
    offset: int = 0,
    updated_since_hours: Optional[int] = Query(None, description="Filter to workflows updated in last N hours")
):
    """
    Get all workflows with full status data including display fields and tokens for the current user.

    Used by status display app to show all workflows (including completed).
    Returns complete data to avoid multiple API calls per workflow.
    Supports both WebUI (cookie auth) and CLI (X-Access-Key header).
    """
    updated_since = None
    if updated_since_hours:
        updated_since = datetime.utcnow() - timedelta(hours=updated_since_hours)

    workflows = db.workflow_repo.get_all_workflows(limit=limit, offset=offset, updated_since=updated_since, user_id=user_id)
    total_count = db.workflow_repo.count_all_workflows(updated_since=updated_since, user_id=user_id)

    enriched = []
    for wf in workflows:
        workflow_run_id = wf.get("workflow_run_id")

        # Get position data (same as original get_workflow_status_display)
        position = db.state_repo.get_workflow_position(workflow_run_id)

        # Build status_display format (identical to original)
        status_display = {
            "workflow_run_id": workflow_run_id,
            "project_name": wf.get("project_name", ""),
            "workflow_template_name": wf.get("workflow_template_name", "default"),
            "status": wf.get("status", "created"),
            "current_step": position.get("current_step"),
            "current_step_name": wf.get("current_step_name"),
            "current_module": wf.get("current_module"),
            "completed_steps": position.get("completed_steps", []),
            "created_at": wf.get("created_at"),
            "updated_at": wf.get("updated_at"),
            "completed_at": wf.get("completed_at"),
            "current_workflow_version_id": wf.get("current_workflow_version_id"),
        }

        tokens = db.token_repo.get_token_usage(workflow_run_id)

        display_fields = []
        layout = []
        version_id = wf.get("current_workflow_version_id")

        if version_id:
            try:
                workflow_config = db.version_repo.get_resolved_workflow(version_id)

                if workflow_config:
                    status_display_config = workflow_config.get('status_display', {})
                    fields_config = status_display_config.get('fields', [])
                    layout = status_display_config.get('layout', [])

                    module_outputs = db.state_repo.get_module_outputs(workflow_run_id)
                    current_step_name = wf.get('current_step_name', wf.get('current_step', ''))

                    env = Environment(loader=BaseLoader())

                    for field in fields_config:
                        field_id = field.get('id')
                        label = field.get('label', field_id)
                        template_str = field.get('value', '')

                        try:
                            template = env.from_string(template_str)
                            value = template.render(
                                state=module_outputs,
                                current_step_name=current_step_name
                            )
                            if value and value.strip() and value.strip() != 'None':
                                display_fields.append({
                                    'id': field_id,
                                    'label': label,
                                    'value': value.strip()
                                })
                        except Exception:
                            pass
            except Exception:
                pass

        enriched.append({
            **status_display,
            "tokens": tokens,
            "display_fields": display_fields,
            "layout": layout
        })

    return {"workflows": enriched, "count": len(enriched), "total": total_count}
