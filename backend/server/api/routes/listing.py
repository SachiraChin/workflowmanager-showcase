"""
Workflow Listing API routes.

Provides endpoints for listing workflow templates and workflow runs.
"""

import logging
from typing import Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query, Depends
from jinja2 import Environment, BaseLoader

from ..dependencies import get_db, get_current_user_id, require_admin_user
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
