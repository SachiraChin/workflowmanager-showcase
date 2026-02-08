"""
Virtual Workflow Execution API routes.

Provides endpoints for running modules in virtual context using mongomock.
These endpoints mirror the real workflow endpoints for exact parity:

    Real                        Virtual
    POST /workflow/start    →   POST /workflow/virtual/start
    POST /workflow/respond  →   POST /workflow/virtual/respond

The virtual database state is transferred as a gzip-compressed, base64-encoded
string to minimize bandwidth usage.
"""

import logging
import uuid6
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional

from ..dependencies import get_current_user_id
from models import (
    WorkflowResponse,
    WorkflowStatus,
    WorkflowProgress,
    InteractionResponseData,
)
from backend.db.virtual import VirtualDatabase, VIRTUAL_USER_ID
from engine.module_registry import ModuleRegistry
from engine.jinja2_resolver import Jinja2Resolver as ParameterResolver
from engine.module_interface import (
    InteractiveModule,
    ExecutableModule,
    InteractionResponse as EngineInteractionResponse,
)
from workflow.workflow_context import WorkflowExecutionContext, StateProxy
from workflow.workflow_utils import (
    serialize_interaction_request,
    convert_interaction_request,
)

logger = logging.getLogger('workflow.virtual')

router = APIRouter(prefix="/workflow/virtual", tags=["virtual"])

# Shared module registry
_registry: Optional[ModuleRegistry] = None


def get_registry() -> ModuleRegistry:
    """Get or create the module registry."""
    global _registry
    if _registry is None:
        _registry = ModuleRegistry()
        _registry.discover_modules()
    return _registry


class VirtualStartRequest(BaseModel):
    """Request to start virtual module execution."""
    workflow: Dict[str, Any] = Field(
        ...,
        description="Full resolved workflow JSON"
    )
    virtual_db: Optional[str] = Field(
        default=None,
        description="Base64-encoded gzip of virtual database JSON. "
                    "If null, creates fresh state."
    )
    target_step_id: str = Field(
        ...,
        description="Step ID containing target module"
    )
    target_module_name: str = Field(
        ...,
        description="Module name to execute"
    )


class VirtualRespondRequest(BaseModel):
    """Request to respond to virtual interaction."""
    workflow: Dict[str, Any] = Field(
        ...,
        description="Full resolved workflow JSON"
    )
    virtual_db: str = Field(
        ...,
        description="Base64-encoded gzip of virtual database JSON from start response"
    )
    target_step_id: str = Field(
        ...,
        description="Step ID containing target module"
    )
    target_module_name: str = Field(
        ...,
        description="Module name"
    )
    interaction_id: str = Field(
        ...,
        description="Interaction ID from start response"
    )
    response: InteractionResponseData = Field(
        ...,
        description="User's response to the interaction"
    )


class VirtualExecutionError(Exception):
    """Error during virtual module execution."""

    def __init__(
        self,
        error_type: str,
        message: str,
        details: Optional[Dict[str, Any]] = None
    ):
        self.error_type = error_type
        self.message = message
        self.details = details or {}
        super().__init__(message)


def find_step_and_module(
    workflow: Dict[str, Any],
    step_id: str,
    module_name: str
) -> tuple:
    """
    Find step and module in workflow definition.

    Returns:
        (step, step_index, module_config, module_index)

    Raises:
        VirtualExecutionError if step or module not found
    """
    steps = workflow.get("steps", [])

    # Find step
    step = None
    step_index = 0
    for i, s in enumerate(steps):
        if s.get("step_id") == step_id:
            step = s
            step_index = i
            break

    if not step:
        available_steps = [s.get("step_id") for s in steps]
        raise VirtualExecutionError(
            "step_not_found",
            f"Step '{step_id}' not found in workflow",
            {"step_id": step_id, "available_steps": available_steps}
        )

    # Find module
    modules = step.get("modules", [])
    module_config = None
    module_index = 0
    for i, m in enumerate(modules):
        if m.get("name", m.get("module_id")) == module_name:
            module_config = m
            module_index = i
            break

    if not module_config:
        available_modules = [
            m.get("name", m.get("module_id")) for m in modules
        ]
        raise VirtualExecutionError(
            "module_not_found",
            f"Module '{module_name}' not found in step '{step_id}'",
            {
                "step_id": step_id,
                "module_name": module_name,
                "available_modules": available_modules
            }
        )

    return step, step_index, module_config, module_index


def create_virtual_context(
    vdb: VirtualDatabase,
    workflow: Dict[str, Any],
    virtual_run_id: str,
    step: Dict[str, Any],
    module_config: Dict[str, Any],
    module_index: int,
    target_step_id: str,
    target_module_name: str,
) -> tuple:
    """
    Create execution context for virtual module execution.

    Returns:
        (context, resolved_inputs)
    """
    config = workflow.get("config", {})
    workflow_id = workflow.get("workflow_id", "virtual")

    # Get current state from virtual DB
    module_outputs = vdb.state_repo.get_module_outputs(virtual_run_id)

    # Create state proxy and resolver
    state_proxy = StateProxy(module_outputs, virtual_run_id, "")
    state_proxy.set_step_config(step)
    resolver = ParameterResolver(state_proxy, config=config)

    # Resolve module inputs
    raw_inputs = module_config.get("inputs", {}).copy()
    resolved_inputs = resolver.resolve_with_schema(raw_inputs, module_outputs)

    # Create execution context
    context = WorkflowExecutionContext(
        workflow_run_id=virtual_run_id,
        db=vdb,
        module_outputs=module_outputs,
        services={
            "workflow_template_name": workflow_id,
            "user_id": VIRTUAL_USER_ID,
        },
        config=config,
        workflow_dir="",
        workflow_path="",
        workflow_template_name=workflow_id,
        workflow_template_id=None,
        user_id=VIRTUAL_USER_ID,
        branch_id=None,
        logger=logger
    )
    context.step_id = target_step_id
    context.current_module_name = target_module_name
    context.current_module_index = module_index
    context.retryable = module_config.get("retryable")
    context.sub_actions = module_config.get("sub_actions")

    return context, resolved_inputs


def build_error_response(
    virtual_run_id: str,
    error: VirtualExecutionError,
    vdb: Optional[VirtualDatabase] = None
) -> WorkflowResponse:
    """Build error response with details."""
    return WorkflowResponse(
        workflow_run_id=virtual_run_id,
        status=WorkflowStatus.ERROR,
        error=error.message,
        result={
            "error_type": error.error_type,
            "details": error.details,
            "virtual_db": vdb.export_state() if vdb else None
        }
    )


@router.post("/start", response_model=WorkflowResponse)
async def start_virtual_module(
    request: VirtualStartRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    Start virtual execution of a module.

    Mirrors POST /workflow/start for real workflows.

    If module is interactive, returns interaction_request.
    If module is non-interactive, executes and returns outputs.

    The virtual_db in the response contains the database state
    that must be sent back in the respond request.
    """
    virtual_run_id = f"virtual_{uuid6.uuid7().hex[:16]}"
    vdb = None

    try:
        # Create virtual database
        vdb = VirtualDatabase(request.virtual_db)

        # Find step and module
        step, step_index, module_config, module_index = find_step_and_module(
            request.workflow,
            request.target_step_id,
            request.target_module_name
        )

        # Get module from registry
        registry = get_registry()
        module_id = module_config.get("module_id")
        module = registry.get_module(module_id)

        if not module:
            raise VirtualExecutionError(
                "module_not_registered",
                f"Module '{module_id}' not found in registry",
                {"module_id": module_id}
            )

        # Create context
        context, resolved_inputs = create_virtual_context(
            vdb=vdb,
            workflow=request.workflow,
            virtual_run_id=virtual_run_id,
            step=step,
            module_config=module_config,
            module_index=module_index,
            target_step_id=request.target_step_id,
            target_module_name=request.target_module_name,
        )

        # Handle interactive modules
        if isinstance(module, InteractiveModule):
            interaction_req = module.get_interaction_request(
                resolved_inputs, context
            )

            if interaction_req:
                # Convert to API format
                request_data = serialize_interaction_request(interaction_req)
                api_request = convert_interaction_request(request_data)

                # Build progress
                progress = WorkflowProgress(
                    current_step=request.target_step_id,
                    current_module=request.target_module_name,
                    completed_steps=[],
                    total_steps=len(request.workflow.get("steps", [])),
                    step_index=step_index
                )

                return WorkflowResponse(
                    workflow_run_id=virtual_run_id,
                    status=WorkflowStatus.AWAITING_INPUT,
                    message="Virtual module awaiting input",
                    progress=progress,
                    interaction_request=api_request,
                    result={"virtual_db": vdb.export_state()}
                )

        # Handle non-interactive modules (ExecutableModule)
        if isinstance(module, ExecutableModule):
            outputs = module.execute(resolved_inputs, context)

            return WorkflowResponse(
                workflow_run_id=virtual_run_id,
                status=WorkflowStatus.COMPLETED,
                message="Virtual module executed successfully",
                result={
                    "module_outputs": outputs,
                    "virtual_db": vdb.export_state()
                }
            )

        raise VirtualExecutionError(
            "unsupported_module_type",
            f"Module type not supported: {type(module).__name__}",
            {"module_id": module_id}
        )

    except VirtualExecutionError as e:
        return build_error_response(virtual_run_id, e, vdb)

    except Exception as e:
        logger.exception(f"Virtual start failed: {e}")
        return WorkflowResponse(
            workflow_run_id=virtual_run_id,
            status=WorkflowStatus.ERROR,
            error=str(e),
            result={
                "error_type": "execution_failed",
                "details": {"exception": str(e)},
                "virtual_db": vdb.export_state() if vdb else None
            }
        )


@router.post("/respond", response_model=WorkflowResponse)
async def respond_virtual_module(
    request: VirtualRespondRequest,
    user_id: str = Depends(get_current_user_id)
):
    """
    Process response to a virtual interaction.

    Mirrors POST /workflow/respond for real workflows.

    Requires virtual_db from the start response to reconstruct state.
    Returns module outputs and updated virtual_db.
    """
    virtual_run_id = f"virtual_{uuid6.uuid7().hex[:16]}"
    vdb = None

    try:
        # Create virtual database from provided state
        vdb = VirtualDatabase(request.virtual_db)

        # Find step and module
        step, step_index, module_config, module_index = find_step_and_module(
            request.workflow,
            request.target_step_id,
            request.target_module_name
        )

        # Get module from registry
        registry = get_registry()
        module_id = module_config.get("module_id")
        module = registry.get_module(module_id)

        if not module:
            raise VirtualExecutionError(
                "module_not_registered",
                f"Module '{module_id}' not found in registry",
                {"module_id": module_id}
            )

        if not isinstance(module, InteractiveModule):
            raise VirtualExecutionError(
                "module_not_interactive",
                f"Module '{module_id}' is not interactive",
                {"module_id": module_id}
            )

        # Create context
        context, resolved_inputs = create_virtual_context(
            vdb=vdb,
            workflow=request.workflow,
            virtual_run_id=virtual_run_id,
            step=step,
            module_config=module_config,
            module_index=module_index,
            target_step_id=request.target_step_id,
            target_module_name=request.target_module_name,
        )

        # Convert response to engine format
        engine_response = EngineInteractionResponse(
            interaction_id=request.interaction_id,
            value=request.response.value,
            selected_indices=request.response.selected_indices,
            selected_options=request.response.selected_options,
            cancelled=request.response.cancelled,
            retry_requested=request.response.retry_requested,
            retry_groups=request.response.retry_groups,
            retry_feedback=request.response.retry_feedback,
            jump_back_requested=request.response.jump_back_requested,
            jump_back_target=request.response.jump_back_target,
            form_data=request.response.form_data,
        )

        # Execute module with response
        outputs = module.execute_with_response(
            resolved_inputs, context, engine_response
        )

        return WorkflowResponse(
            workflow_run_id=virtual_run_id,
            status=WorkflowStatus.COMPLETED,
            message="Virtual module executed successfully",
            result={
                "module_outputs": outputs,
                "virtual_db": vdb.export_state()
            }
        )

    except VirtualExecutionError as e:
        return build_error_response(virtual_run_id, e, vdb)

    except Exception as e:
        logger.exception(f"Virtual respond failed: {e}")
        return WorkflowResponse(
            workflow_run_id=virtual_run_id,
            status=WorkflowStatus.ERROR,
            error=str(e),
            result={
                "error_type": "execution_failed",
                "details": {"exception": str(e)},
                "virtual_db": vdb.export_state() if vdb else None
            }
        )
