"""
Media Generate Module - Interactive media generation and selection.

This module presents prompts grouped by provider, allows editing,
triggers generation via sub-actions, and collects selection.

The module works with the WebUI MediaGeneration component to:
1. Display prompts with editable text and generation parameters
2. Execute sub-actions (txt2img, img2img, img2vid) via SSE streaming
3. Allow selection of generated content
4. Return selected content ID and data to workflow state
"""

from typing import Dict, Any, List, Optional

from utils import uuid7_str

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

        # Get sub_actions from context (set by executor from module config)
        sub_actions = getattr(context, 'sub_actions', None)

        # Get retryable config from context (set by workflow processor)
        retryable = getattr(context, 'retryable', None)

        # Get source_image for img2vid (optional, from workflow inputs)
        source_image = inputs.get('source_image')

        # Build data object - include source_image if present for schema-driven rendering
        data = dict(prompts) if isinstance(prompts, dict) else {}
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
                    selected_content['local_path'] = content_record['local_path']

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
