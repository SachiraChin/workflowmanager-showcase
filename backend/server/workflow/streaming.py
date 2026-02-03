"""
Workflow Streaming Support

SSE streaming methods for workflow execution.
"""

import asyncio
import concurrent.futures
import logging
import os
import time
from typing import Dict, Any, TYPE_CHECKING

from models import (
    WorkflowStatus,
    InteractionResponseData,
    SSEEvent,
    SSEEventType,
    WorkflowResponse,
)
from backend.db import DbEventType
from utils import sanitize_error_message

from .workflow_utils import get_workflow_def, rebuild_services

if TYPE_CHECKING:
    from .processor import WorkflowProcessor

# SSE intervals - read at runtime to ensure env vars are set by server.py
def get_progress_interval() -> float:
    return float(os.environ.get("PROGRESS_INTERVAL", "0.1"))

def get_poll_interval() -> float:
    return float(os.environ.get("POLL_INTERVAL", "0.05"))


class WorkflowStreamingMixin:
    """
    Mixin class providing SSE streaming methods for WorkflowProcessor.

    This separates streaming concerns from core workflow execution logic.
    """

    async def execute_stream(
        self: "WorkflowProcessor",
        workflow_run_id: str,
        cancel_event: asyncio.Event
    ):
        """
        Execute workflow with streaming events.

        Yields SSEEvent objects as execution progresses.
        """
        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            yield SSEEvent(type=SSEEventType.ERROR, data={"workflow_run_id": workflow_run_id, "message": "Workflow not found"})
            return

        # Check for pending interaction first
        position = self.db.state_repo.get_workflow_position(workflow_run_id)
        if position.get('pending_interaction'):
            last_interaction = self.db.event_repo.get_latest_event(
                workflow_run_id=workflow_run_id,
                event_type=DbEventType.INTERACTION_REQUESTED
            )
            if last_interaction:
                interaction_data = last_interaction.get('data', {})
                # Ensure workflow_run_id is in the interaction data
                interaction_data["workflow_run_id"] = workflow_run_id
                yield SSEEvent(
                    type=SSEEventType.INTERACTION,
                    data=interaction_data
                )
                return

        # Resume from current position
        workflow_def = get_workflow_def(workflow, self.db, self.logger)
        if workflow_def is None:
            yield SSEEvent(type=SSEEventType.ERROR, data={"workflow_run_id": workflow_run_id, "error": "Workflow definition not found"})
            return
        services = rebuild_services(workflow, workflow_def, self.db, self.logger)

        # Yield started event
        yield SSEEvent(
            type=SSEEventType.STARTED,
            data={
                "workflow_run_id": workflow_run_id,
                "step_id": position.get('current_step'),
                "module_index": position.get('current_module_index', 0)
            }
        )

        # Execute with streaming
        async for event in self._execute_from_position_stream(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            position=position,
            services=services,
            cancel_event=cancel_event
        ):
            yield event

    async def respond_stream(
        self: "WorkflowProcessor",
        workflow_run_id: str,
        interaction_id: str,
        response: InteractionResponseData,
        cancel_event: asyncio.Event
    ):
        """
        Process interaction response and stream execution events.
        """
        self.logger.info(f"[SSE] respond_stream called with cancel_event={cancel_event}")

        yield SSEEvent(
            type=SSEEventType.PROGRESS,
            data={"workflow_run_id": workflow_run_id, "elapsed_ms": 0, "message": "Processing response..."}
        )

        workflow = self.db.workflow_repo.get_workflow(workflow_run_id)
        if not workflow:
            yield SSEEvent(type=SSEEventType.ERROR, data={"workflow_run_id": workflow_run_id, "message": "Workflow not found"})
            return

        # Check for retry response
        if self.navigator.is_retry_response(response):
            async for event in self._handle_retry_stream(workflow_run_id, workflow, response):
                yield event
            return

        # Find interaction request
        interaction_request = self.db.events.find_one({
            "workflow_run_id": workflow_run_id,
            "event_type": DbEventType.INTERACTION_REQUESTED.value,
            "data.interaction_id": interaction_id
        })
        step_id = interaction_request.get("step_id") if interaction_request else None
        module_name = interaction_request.get("module_name") if interaction_request else None
        module_id = interaction_request.get("data", {}).get("module_id") if interaction_request else None

        # Store response event
        response_data = {
            "interaction_id": interaction_id,
            "response": response.model_dump()
        }
        if module_id:
            response_data["module_id"] = module_id
        self.db.event_repo.store_event(
            workflow_run_id=workflow_run_id,
            event_type=DbEventType.INTERACTION_RESPONSE,
            step_id=step_id,
            module_name=module_name,
            data=response_data
        )

        # Get position and continue execution
        position = self.db.state_repo.get_workflow_position(workflow_run_id)
        workflow_def = get_workflow_def(workflow, self.db, self.logger)
        if workflow_def is None:
            yield SSEEvent(type=SSEEventType.ERROR, data={"workflow_run_id": workflow_run_id, "error": "Workflow definition not found"})
            return
        services = rebuild_services(workflow, workflow_def, self.db, self.logger)
        module_outputs = self.db.state_repo.get_module_outputs(workflow_run_id)

        yield SSEEvent(
            type=SSEEventType.STARTED,
            data={
                "workflow_run_id": workflow_run_id,
                "step_id": position.get('current_step'),
                "module_index": position.get('current_module_index', 0)
            }
        )

        # Continue execution with streaming
        async for event in self._continue_after_interaction_stream(
            workflow_run_id=workflow_run_id,
            workflow_def=workflow_def,
            position=position,
            services=services,
            module_outputs=module_outputs,
            interaction_response=response,
            cancel_event=cancel_event
        ):
            yield event

    async def _handle_retry_stream(
        self: "WorkflowProcessor",
        workflow_run_id: str,
        workflow: Dict,
        response: InteractionResponseData
    ):
        """Handle retry when user selects retry option - streaming version."""
        result = self.navigator.handle_retry_from_response(workflow_run_id, workflow, response)

        if result.status == WorkflowStatus.AWAITING_INPUT and result.interaction_request:
            # interaction_request already contains workflow_run_id from model_dump()
            yield SSEEvent(
                type=SSEEventType.INTERACTION,
                data=result.interaction_request.model_dump()
            )
        elif result.status == WorkflowStatus.COMPLETED:
            yield SSEEvent(type=SSEEventType.COMPLETE, data={"workflow_run_id": workflow_run_id, **(result.result or {})})
        elif result.status == WorkflowStatus.ERROR:
            yield SSEEvent(type=SSEEventType.ERROR, data={"workflow_run_id": workflow_run_id, "message": result.error})

    async def _continue_after_interaction_stream(
        self: "WorkflowProcessor",
        workflow_run_id: str,
        workflow_def: Dict,
        position: Dict,
        services: Dict,
        module_outputs: Dict,
        interaction_response: InteractionResponseData,
        cancel_event: asyncio.Event
    ):
        """Continue after interaction with streaming events."""
        self.logger.info("[SSE STREAM] Starting _continue_after_interaction_stream")
        start_time = time.time()

        yield SSEEvent(
            type=SSEEventType.PROGRESS,
            data={"workflow_run_id": workflow_run_id, "elapsed_ms": 0, "message": "Starting execution..."}
        )

        async for event in self._run_sync_with_progress(
            workflow_run_id=workflow_run_id,
            start_time=start_time,
            cancel_event=cancel_event,
            sync_func=lambda: self.interaction_handler.continue_after_interaction(
                workflow_run_id=workflow_run_id,
                workflow_def=workflow_def,
                position=position,
                services=services,
                module_outputs=module_outputs,
                interaction_response=interaction_response,
                cancel_event=cancel_event
            )
        ):
            yield event

    async def _execute_from_position_stream(
        self: "WorkflowProcessor",
        workflow_run_id: str,
        workflow_def: Dict,
        position: Dict,
        services: Dict,
        cancel_event: asyncio.Event
    ):
        """Execute from current position with streaming events."""
        self.logger.info("[SSE STREAM] Starting _execute_from_position_stream")
        start_time = time.time()

        yield SSEEvent(
            type=SSEEventType.PROGRESS,
            data={"workflow_run_id": workflow_run_id, "elapsed_ms": 0, "message": "Starting execution..."}
        )

        async for event in self._run_sync_with_progress(
            workflow_run_id=workflow_run_id,
            start_time=start_time,
            cancel_event=cancel_event,
            sync_func=lambda: self.executor.execute_from_position(
                workflow_run_id=workflow_run_id,
                workflow_def=workflow_def,
                position=position,
                services=services,
                cancel_event=cancel_event
            )
        ):
            yield event

    async def _run_sync_with_progress(
        self: "WorkflowProcessor",
        workflow_run_id: str,
        start_time: float,
        cancel_event: asyncio.Event,
        sync_func
    ):
        """Run a sync function in executor while yielding progress events."""
        loop = asyncio.get_event_loop()
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

        future = loop.run_in_executor(executor, sync_func)

        last_progress_time = time.time()
        progress_count = 0

        try:
            while not future.done():
                if cancel_event.is_set():
                    self.logger.info("[SSE STREAM] Cancellation requested")
                    future.cancel()
                    yield SSEEvent(
                        type=SSEEventType.CANCELLED,
                        data={"workflow_run_id": workflow_run_id, "reason": "user_cancelled"}
                    )
                    return

                now = time.time()
                if now - last_progress_time >= get_progress_interval():
                    progress_count += 1
                    elapsed_ms = int((now - start_time) * 1000)
                    yield SSEEvent(
                        type=SSEEventType.PROGRESS,
                        data={"workflow_run_id": workflow_run_id, "elapsed_ms": elapsed_ms, "message": "Processing..."}
                    )
                    last_progress_time = now

                await asyncio.sleep(get_poll_interval())

            result = future.result()
            elapsed_ms = int((time.time() - start_time) * 1000)
            self.logger.info(f"[SSE STREAM] Complete, status={result.status}, elapsed={elapsed_ms}ms")

            async for event in self._result_to_events(workflow_run_id, result):
                yield event

        except concurrent.futures.CancelledError:
            self.logger.info("[SSE STREAM] Execution cancelled")
            yield SSEEvent(
                type=SSEEventType.CANCELLED,
                data={"workflow_run_id": workflow_run_id, "reason": "execution_cancelled"}
            )
        except Exception as e:
            self.logger.error(f"[SSE STREAM] Error: {e}")
            yield SSEEvent(
                type=SSEEventType.ERROR,
                data={"workflow_run_id": workflow_run_id, "message": sanitize_error_message(str(e))}
            )
        finally:
            executor.shutdown(wait=False)

    async def _result_to_events(self: "WorkflowProcessor", workflow_run_id: str, result: WorkflowResponse):
        """Convert WorkflowResponse to SSE events."""
        if result.status == WorkflowStatus.AWAITING_INPUT and result.interaction_request:
            # interaction_request already contains workflow_run_id from model_dump()
            yield SSEEvent(
                type=SSEEventType.INTERACTION,
                data=result.interaction_request.model_dump()
            )
        elif result.status == WorkflowStatus.COMPLETED:
            yield SSEEvent(
                type=SSEEventType.COMPLETE,
                data={"workflow_run_id": workflow_run_id, **(result.result or {})}
            )
        elif result.status == WorkflowStatus.ERROR:
            yield SSEEvent(
                type=SSEEventType.ERROR,
                data={"workflow_run_id": workflow_run_id, "message": result.error or "Unknown error"}
            )
        elif result.status == WorkflowStatus.VALIDATION_FAILED:
            yield SSEEvent(
                type=SSEEventType.VALIDATION_FAILED,
                data={
                    "workflow_run_id": workflow_run_id,
                    "errors": result.validation_errors,
                    "warnings": result.validation_warnings
                }
            )
        else:
            self.logger.warning(f"[SSE STREAM] Unexpected status: {result.status}")
            yield SSEEvent(
                type=SSEEventType.PROGRESS,
                data={"workflow_run_id": workflow_run_id, "message": f"Status: {result.status}"}
            )
