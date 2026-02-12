"""
Media Generate Module - Interactive media generation and selection.

This module presents prompts grouped by provider, allows editing,
triggers generation via sub-actions, and collects selection.

The module works with the WebUI MediaGeneration component to:
1. Display prompts with editable text and generation parameters
2. Execute sub-actions (txt2img, img2img, img2vid) via SSE streaming
3. Allow selection of generated content
4. Return selected content ID and data to workflow state

Provider Metadata Injection:
The module automatically fetches provider metadata (models, styles, etc.)
and injects it into each provider's data node as `_provider_metadata`.
This allows the UI to render dynamic options without hardcoding in schemas.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional

from typing import Optional as TypingOptional
from utils import uuid7_str
from backend.db import TaskQueue
from backend.db.path_utils import resolve_local_path
from backend.providers.media.registry import MediaProviderRegistry

logger = logging.getLogger("modules.media.generate")

# SVG placeholder for mock media generation (512x512 gray with "MOCK" text)
MOCK_PLACEHOLDER_SVG = '''<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#e0e0e0"/>
  <text x="256" y="240" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" fill="#666">MOCK</text>
  <text x="256" y="290" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" fill="#888">Preview Image</text>
</svg>'''

# Base64-encoded data URL for the placeholder
import base64
MOCK_PLACEHOLDER_DATA_URL = f"data:image/svg+xml;base64,{base64.b64encode(MOCK_PLACEHOLDER_SVG.encode()).decode()}"

# =============================================================================
# Singleton TaskQueue (reuse connection to avoid connection pool exhaustion)
# =============================================================================

_task_queue: TypingOptional[TaskQueue] = None


def _get_task_queue() -> TaskQueue:
    """Get singleton TaskQueue instance for this module."""
    global _task_queue
    if _task_queue is None:
        _task_queue = TaskQueue()
    return _task_queue

from engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse
)


class MediaGenerateModule(InteractiveModule):
    """
    Interactive module for media generation workflows.

    Presents prompts grouped by provider, allows editing,
    triggers generation via sub-actions, and collects selection.

    Inputs:
        - prompts: Prompts grouped by provider (e.g., {"midjourney": {...}, "leonardo": {...}})
        - schema: Display schema with _ux hints for rendering
        - title: Interaction title (default: "Generate Media")

    Sub-actions (from module config, passed via context):
        - Defined in workflow JSON under "sub_actions" key
        - Each sub-action has: id, label, action_type, loading_label, result_key
        - Executed via SSE streaming endpoint

    Outputs:
        - selected_content_id: ID of selected generated content
        - selected_content: Full data of selected content (url, metadata_id, prompt_key)
        - generations: All generations by prompt key
    """

    @property
    def module_id(self) -> str:
        return "media.generate"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="prompts",
                type="object",
                required=True,
                description="Prompts grouped by provider (e.g., {midjourney: {...}, leonardo: {...}})"
            ),
            ModuleInput(
                name="schema",
                type="object",
                required=True,
                description="Display schema with _ux hints for rendering"
            ),
            ModuleInput(
                name="title",
                type="string",
                required=False,
                default="Generate Media",
                description="Interaction title"
            ),
            ModuleInput(
                name="action_type",
                type="string",
                required=False,
                default="txt2img",
                description="Action type for provider metadata (txt2img, img2img, img2vid)"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="selected_content_id",
                type="string",
                description="ID of selected generated content"
            ),
            ModuleOutput(
                name="selected_content",
                type="object",
                description="Full data of selected content (url, metadata_id, prompt_key)"
            ),
            ModuleOutput(
                name="generations",
                type="object",
                description="All generations by prompt key"
            )
        ]

    def requires_interaction(self) -> bool:
        return True

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context
    ) -> Optional[InteractionRequest]:
        """Build interaction request with prompts, schema, and sub-actions."""
        prompts = inputs.get('prompts', {})
        schema = inputs.get('schema', {})
        title = self.get_input_value(inputs, 'title')
        action_type = self.get_input_value(inputs, 'action_type') or 'txt2img'

        # Get sub_actions from context (set by executor from module config)
        sub_actions = getattr(context, 'sub_actions', None)

        # Get retryable config from context (set by workflow processor)
        retryable = getattr(context, 'retryable', None)

        # Get source_image for img2vid (optional, from workflow inputs)
        source_image = inputs.get('source_image')

        # Build data object - include source_image if present for schema-driven rendering
        # Handle both array (new style) and dict (legacy grouped by provider) prompt formats
        if isinstance(prompts, list):
            # Array of prompts - convert to dict keyed by provider
            # Each array item must have a "provider" field
            prompts_dict = self._convert_prompts_array_to_dict(prompts)
            enriched_prompts = self._inject_provider_metadata(prompts_dict, action_type)
            data = enriched_prompts
        elif isinstance(prompts, dict):
            # Inject provider metadata into each provider node
            # Keep original structure: data = prompts (not wrapped in "prompts" key)
            enriched_prompts = self._inject_provider_metadata(prompts, action_type)
            data = enriched_prompts
        else:
            data = {}
        if source_image:
            data["_source_image"] = source_image

        return InteractionRequest(
            interaction_type=InteractionType.MEDIA_GENERATION,
            interaction_id=f"media_{uuid7_str()}",
            title=title,
            display_data={
                "data": data,
                "schema": schema,
                "sub_actions": sub_actions,
                "generations": {},
                "retryable": retryable
            },
            context={
                "module_id": self.module_id
            }
        )

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """Process user's selection after generation."""
        # Handle cancellation
        if response.cancelled:
            raise ModuleExecutionError(
                self.module_id,
                "User cancelled media generation",
                None
            )

        # Handle jump back
        if response.jump_back_requested:
            return {
                "selected_content_id": None,
                "selected_content": None,
                "generations": {},
                "jump_back_requested": True,
                "jump_back_target": response.jump_back_target
            }

        # Handle retry
        if response.retry_requested:
            return {
                "selected_content_id": None,
                "selected_content": None,
                "generations": {},
                "retry_requested": True,
                "retry_feedback": response.retry_feedback or "",
                "retry_groups": response.retry_groups or []
            }

        # Get selection from response
        selected_content_id = response.selected_content_id
        generations = response.generations or {}

        # Find selected content data from generations
        selected_content = None
        if selected_content_id:
            selected_content = self._find_selected_content(
                selected_content_id, generations
            )

            # Also check response.selected_content if provided directly
            if not selected_content and response.selected_content:
                selected_content = response.selected_content

            # Enrich with local_path from database if available
            if selected_content and hasattr(context, 'db') and context.db:
                content_record = context.db.content_repo.get_content_by_id(
                    selected_content_id
                )
                if content_record and content_record.get('local_path'):
                    # Resolve relative path to full path using MEDIA_BASE_PATH
                    selected_content['local_path'] = resolve_local_path(
                        content_record['local_path']
                    )

        if hasattr(context, 'logger'):
            context.logger.debug(
                f"Media selection: content_id={selected_content_id}, "
                f"generations_count={sum(len(v) for v in generations.values())}"
            )

        return {
            "selected_content_id": selected_content_id,
            "selected_content": selected_content,
            "generations": generations
        }

    def _find_selected_content(
        self,
        content_id: str,
        generations: Dict[str, List[Dict[str, Any]]]
    ) -> Optional[Dict[str, Any]]:
        """
        Find selected content data from generations by content_id.

        Args:
            content_id: The selected content ID
            generations: All generations keyed by prompt_key

        Returns:
            Dict with content_id, url, metadata_id, prompt_key or None
        """
        for prompt_key, gen_list in generations.items():
            for gen in gen_list:
                content_ids = gen.get('content_ids', [])
                if content_id in content_ids:
                    idx = content_ids.index(content_id)
                    urls = gen.get('urls', [])
                    return {
                        'content_id': content_id,
                        'url': urls[idx] if idx < len(urls) else None,
                        'metadata_id': gen.get('metadata_id'),
                        'prompt_key': prompt_key
                    }
        return None

    def _convert_prompts_array_to_dict(
        self,
        prompts_array: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Convert an array of prompts to a dict keyed by provider.

        Each item in the array must have a "provider" field. The provider
        field is removed from the item and used as the dict key.

        Args:
            prompts_array: List of prompt dicts, each with a "provider" field
                e.g., [{"provider": "midjourney", "prompt": "..."}, ...]

        Returns:
            Dict keyed by provider name
                e.g., {"midjourney": {"prompt": "..."}, ...}

        Raises:
            ModuleExecutionError: If any item is missing the "provider" field
        """
        result = {}

        for idx, item in enumerate(prompts_array):
            if not isinstance(item, dict):
                raise ModuleExecutionError(
                    self.module_id,
                    f"Prompts array item {idx} is not a dict",
                    None
                )

            provider = item.get("provider")
            if not provider:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Prompts array item {idx} is missing required 'provider' field",
                    None
                )

            # Create a copy without the "provider" field
            prompt_data = {k: v for k, v in item.items() if k != "provider"}
            result[provider] = prompt_data

        return result

    def _inject_provider_metadata(
        self,
        data: Dict[str, Any],
        action_type: str
    ) -> Dict[str, Any]:
        """
        Inject provider metadata into each provider's prompt data.

        Handles two data structures:
        1. Flat: {"midjourney": {...}, "leonardo": {...}}
           - Provider name is the key
        2. Nested: {"scene_title": "...", "prompts": {"midjourney": {...}, ...}}
           - Provider data is under "prompts" key

        For each provider found, fetches metadata from the provider interface
        and injects it as `_provider_metadata`. Also adds empty `_generations`
        list for tracking generated content.

        Args:
            data: Dict containing prompts (either flat or nested structure)
            action_type: The action type for metadata lookup
                ("txt2img", "img2img", "img2vid")

        Returns:
            Enriched data dict with _provider_metadata and _generations
            injected into each provider node.
        """
        # Check if this is a nested structure with "prompts" key
        if "prompts" in data and isinstance(data.get("prompts"), dict):
            # Nested structure: inject metadata into data["prompts"]
            enriched_prompts = self._enrich_provider_nodes(
                data["prompts"], action_type
            )
            # Keep other top-level keys (scene_title, key_moment, etc.)
            return {**data, "prompts": enriched_prompts}
        else:
            # Flat structure: inject metadata directly
            return self._enrich_provider_nodes(data, action_type)

    def _enrich_provider_nodes(
        self,
        prompts: Dict[str, Any],
        action_type: str
    ) -> Dict[str, Any]:
        """
        Enrich each provider node with metadata and generations list.

        Args:
            prompts: Dict of prompts keyed by provider name
            action_type: The action type for metadata lookup

        Returns:
            Enriched prompts dict with _provider_metadata and _generations.
        """
        enriched = {}

        for provider_name, provider_data in prompts.items():
            if not isinstance(provider_data, dict):
                # Skip non-dict entries (shouldn't happen, but be safe)
                enriched[provider_name] = provider_data
                continue

            # Fetch provider metadata
            metadata = self._get_provider_metadata(provider_name, action_type)

            # Inject metadata and generations as sibling fields
            enriched[provider_name] = {
                "_provider_metadata": metadata,
                "_generations": [],
                **provider_data
            }

        return enriched

    def _get_provider_metadata(
        self,
        provider_name: str,
        action_type: str
    ) -> Dict[str, Any]:
        """
        Fetch metadata from a provider's get_metadata() method.

        Args:
            provider_name: Provider identifier (e.g., "midjourney", "leonardo")
            action_type: Action type for metadata lookup

        Returns:
            Provider metadata dict, or empty dict if provider not found
            or metadata fetch fails.
        """
        try:
            provider = MediaProviderRegistry.get_optional(provider_name)
            if provider:
                return provider.get_metadata(action_type)
            else:
                logger.warning(
                    f"[MediaGenerate] Provider not found: {provider_name}"
                )
                return {}
        except Exception as e:
            logger.warning(
                f"[MediaGenerate] Failed to get metadata for {provider_name}: {e}"
            )
            return {}

    async def _mock_sub_action(self, context):
        """
        Mock sub-action for preview mode.

        Returns a placeholder image without creating real tasks or
        calling external APIs.

        Args:
            context: SubActionContext with params

        Yields:
            Tuples of (event_type, data) mimicking real sub-action behavior
        """
        params = context.params
        prompt_id = params.get("prompt_id")

        # Simulate brief processing delay
        yield ("progress", {
            "status": "processing",
            "progress": {"elapsed_ms": 200, "message": "Generating mock content..."}
        })
        await asyncio.sleep(0.3)

        # Generate unique mock IDs
        mock_content_id = f"mock-{uuid7_str()[:8]}"
        mock_metadata_id = f"mock-meta-{uuid7_str()[:8]}"

        # Return mock result with data URL placeholder
        yield ("result", {
            "metadata_id": mock_metadata_id,
            "content_ids": [mock_content_id],
            "urls": [MOCK_PLACEHOLDER_DATA_URL],
            "prompt_id": prompt_id,
            "mock": True,
        })

    async def sub_action(self, context):
        """
        Execute media generation sub-action.

        Creates a task via TaskQueue, polls for completion while yielding
        progress events, and finally yields the result.

        In mock mode, returns placeholder data without creating real tasks.

        Args:
            context: SubActionContext with params for generation

        Yields:
            Tuples of (event_type, data):
            - ("progress", {...}) for progress updates
            - ("result", {...}) for the final result
        """
        # Check if running in mock mode
        if getattr(context, 'mock_mode', False):
            async for event in self._mock_sub_action(context):
                yield event
            return

        params = context.params
        workflow_run_id = context.workflow_run_id
        interaction_id = context.interaction_id

        # Extract generation parameters
        provider_name = params.get("provider")
        action_type = params.get("action_type")
        prompt_id = params.get("prompt_id")
        generation_params = params.get("params", {})
        source_data = params.get("source_data")

        # Note: Provider-specific parameter formatting (format_params) is now
        # applied in the worker AFTER storing original params. This ensures
        # request_params contains user's original input for UI restoration.

        logger.info(
            f"[MediaGenerate] sub_action: provider={provider_name}, "
            f"action_type={action_type}, prompt_id={prompt_id}"
        )

        # Create task via TaskQueue (use singleton to avoid connection exhaustion)
        queue = _get_task_queue()
        task_id = queue.enqueue(
            actor="media",
            payload={
                "workflow_run_id": workflow_run_id,
                "interaction_id": interaction_id,
                "provider": provider_name,
                "action_type": action_type,
                "prompt_id": prompt_id,
                "params": generation_params,
                "source_data": source_data,
            }
        )

        logger.info(f"[MediaGenerate] Created task {task_id}")

        # Poll for completion, yielding progress events
        poll_interval = 1.0
        last_progress_hash = None

        while True:
            task = queue.get_task(task_id)

            if not task:
                raise ValueError(f"Task {task_id} not found")

            # Yield progress if changed (same format as tasks.py stream endpoint)
            progress = task.get("progress", {})
            current_hash = f"{task['status']}:{progress.get('elapsed_ms', 0)}:{progress.get('message', '')}"

            if current_hash != last_progress_hash:
                progress_data = {
                    "elapsed_ms": progress.get("elapsed_ms", 0),
                    "message": progress.get("message", ""),
                }
                if progress.get("updated_at"):
                    updated_at = progress["updated_at"]
                    if hasattr(updated_at, 'isoformat'):
                        progress_data["updated_at"] = updated_at.isoformat()
                    else:
                        progress_data["updated_at"] = str(updated_at)

                yield ("progress", {
                    "status": task["status"],
                    "progress": progress_data,
                })
                last_progress_hash = current_hash

            if task["status"] == "completed":
                result = task.get("result", {})

                # Transform filenames to URLs (same as tasks.py)
                if "filenames" in result and "workflow_run_id" in result:
                    wf_id = result["workflow_run_id"]
                    urls = [
                        f"/workflow/{wf_id}/media/{filename}"
                        for filename in result["filenames"]
                    ]
                    result = {
                        "metadata_id": result.get("metadata_id"),
                        "content_ids": result.get("content_ids", []),
                        "urls": urls,
                        "prompt_id": prompt_id,
                    }

                yield ("result", result)
                return

            if task["status"] == "failed":
                error = task.get("error", {})
                raise ValueError(
                    f"Media generation failed: {error.get('message', 'Unknown error')}"
                )

            await asyncio.sleep(poll_interval)
