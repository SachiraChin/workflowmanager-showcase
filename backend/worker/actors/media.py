"""
Media Actor - Task handler for media generation.

This actor handles media generation tasks by:
1. Getting concurrency info from the provider registry
2. Executing generation via the appropriate provider
3. Downloading generated content
4. Storing results in the database
"""

import os
import json
import logging
from typing import Dict, Any, Tuple

from .base import ActorBase, ProgressCallback

# Import from providers package (NOT from server)
from backend.providers.media import (
    MediaProviderRegistry,
    GenerationError,
    download_media,
    DownloadError,
)

# Import Database for content repository access
# The worker creates its own DB connection
from backend.db import Database
from backend.db.path_utils import make_relative_path

logger = logging.getLogger("worker.actors.media")


def _generate_content_id() -> str:
    """Generate a unique content ID."""
    try:
        import uuid6
        return f"gc_{uuid6.uuid7().hex[:24]}"
    except ImportError:
        import uuid
        return f"gc_{uuid.uuid4().hex[:24]}"


class MediaActor(ActorBase):
    """
    Actor for media generation tasks.

    Handles txt2img, img2img, img2vid, and txt2audio operations by:
    1. Calling the appropriate provider
    2. Downloading generated content
    3. Storing metadata and content records in the database

    Required payload fields:
        - workflow_run_id: str
        - interaction_id: str
        - provider: str (e.g., "leonardo", "midjourney", "elevenlabs")
        - action_type: str (e.g., "txt2img", "img2img", "img2vid", "txt2audio")
        - prompt_id: str
        - params: dict (provider-specific parameters including "prompt")
        - source_data: Any (original prompt data from workflow)
    """

    def __init__(self):
        # Create own database connection
        mongo_uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017")
        db_name = os.environ.get("MONGODB_DATABASE", "workflow_db")
        self._db = Database(connection_string=mongo_uri, database_name=db_name)

        # Media storage paths derived from MEDIA_BASE_PATH
        media_base_path = os.environ.get("MEDIA_BASE_PATH")
        if media_base_path:
            self._images_path = os.path.join(media_base_path, "images")
            self._videos_path = os.path.join(media_base_path, "videos")
            self._audios_path = os.path.join(media_base_path, "audios")
        else:
            self._images_path = None
            self._videos_path = None
            self._audios_path = None
            logger.warning("MEDIA_BASE_PATH not set - media downloads will fail")

    @property
    def name(self) -> str:
        return "media"

    def get_concurrency_info(self, payload: Dict[str, Any]) -> Tuple[str, int]:
        """
        Get concurrency based on provider.

        Different providers have different rate limits and capabilities.
        The concurrency is configured in the provider registry.
        """
        provider_name = payload.get("provider", "unknown")
        concurrency = MediaProviderRegistry.get_concurrency(provider_name)
        return (provider_name, concurrency)

    def get_all_provider_concurrency(self) -> Dict[str, int]:
        """
        Get concurrency limits for all registered providers.

        Returns:
            Dict mapping provider_id to max_concurrency
        """
        providers = MediaProviderRegistry.list_providers()
        return {
            provider_id: MediaProviderRegistry.get_concurrency(provider_id)
            for provider_id in providers
        }

    def execute(
        self,
        payload: Dict[str, Any],
        progress_callback: ProgressCallback
    ) -> Dict[str, Any]:
        """
        Execute media generation.

        This method:
        1. Creates a metadata record in the database
        2. Calls the provider to generate content
        3. Downloads the generated content
        4. Stores content records in the database
        5. Returns URLs and IDs for the generated content
        """
        # Log raw payload for debugging
        logger.info(f"[MediaActor] Raw payload received:\n{json.dumps(payload, indent=2, default=str)}")

        # Extract payload fields
        workflow_run_id = payload["workflow_run_id"]
        interaction_id = payload["interaction_id"]
        provider_name = payload["provider"]
        action_type = payload["action_type"]
        prompt_id = payload["prompt_id"]
        params = payload["params"]
        source_data = payload.get("source_data")

        logger.info(
            f"[MediaActor] Starting {action_type} for "
            f"provider={provider_name}, prompt_id={prompt_id}"
        )

        # Get provider instance
        try:
            provider = MediaProviderRegistry.get(provider_name)
        except (ValueError, GenerationError) as e:
            raise GenerationError(str(e))

        # Get the method to call
        method = getattr(provider, action_type, None)
        if method is None:
            raise GenerationError(
                f"Provider {provider_name} does not support {action_type}"
            )

        # Create metadata record in database with ORIGINAL params
        # (before format_params enrichment, so UI can restore user's actual input)
        metadata_id = self._db.content_repo.store_generation(
            workflow_run_id=workflow_run_id,
            interaction_id=interaction_id,
            provider=provider_name,
            prompt_id=prompt_id,
            operation=action_type,
            request_params=params,
            source_data=source_data,
        )

        try:
            # Apply provider-specific parameter formatting AFTER storage
            # This enriches prompts (e.g., Stable Diffusion adds enforcement text)
            # but we store original params so UI can restore user's actual input
            generation_params = provider.format_params(params)

            # Prepare arguments based on action type (using enriched params)
            prompt = generation_params.get("prompt", "")
            method_params = {k: v for k, v in generation_params.items() if k != "prompt"}

            # Extract additional fields from source_data that may not be in params
            # (e.g., negative_prompt for Stable Diffusion)
            if source_data and isinstance(source_data, dict):
                # Fields that should be extracted from source_data if not in params
                extractable_fields = ["negative_prompt"]
                for field in extractable_fields:
                    if field not in method_params and field in source_data:
                        method_params[field] = source_data[field]

            # Inject prompt_id into params for provider-level mapping
            method_params["prompt_id"] = prompt_id

            # Log params being sent to provider
            logger.info(f"[MediaActor] Calling {provider_name}.{action_type} with:\n"
                        f"  prompt: {prompt[:200]}{'...' if len(prompt) > 200 else ''}\n"
                        f"  params: {json.dumps(method_params, indent=2, default=str)}")

            # Call provider (synchronous - this is the long-running operation)
            if action_type == "txt2img":
                result = method(prompt, method_params, progress_callback=progress_callback)
            elif action_type in ("img2img", "img2vid"):
                source_image = generation_params.get("source_image")

                # For img2vid, if source_image not in params, look up from interaction event
                if not source_image and action_type == "img2vid":
                    source_image = self._get_source_image_from_interaction(interaction_id)

                if not source_image:
                    raise GenerationError(f"{action_type} requires source_image")

                result = method(source_image, prompt, method_params, progress_callback=progress_callback)
            elif action_type == "txt2audio":
                # Pass prompt and params to provider - provider handles assembly
                result = method(prompt, method_params, progress_callback=progress_callback)
            else:
                raise GenerationError(f"Unknown action type: {action_type}")

            # Update metadata with completion
            self._db.content_repo.update_generation_status(
                metadata_id=metadata_id,
                status="completed",
                response_data=result.raw_response,
                provider_task_id=result.provider_task_id,
            )

            # Download and store content items
            content_ids = []
            filenames = []
            if action_type == "img2vid":
                content_type = "video"
            elif action_type == "txt2audio":
                content_type = "audio"
            else:
                content_type = "image"

            # For img2vid with cropped preview, store preview image first
            preview_content_id = None
            if action_type == "img2vid" and result.preview_local_path:
                preview_content_id = _generate_content_id()
                preview_extension = os.path.splitext(result.preview_local_path)[1].lstrip(".")

                # Store preview image as its own content entry
                self._db.content_repo.store_content_with_download(
                    content_id=preview_content_id,
                    metadata_id=metadata_id,
                    workflow_run_id=workflow_run_id,
                    index=0,
                    provider_url="",  # No provider URL for cropped image
                    content_type="video.preview",
                    extension=preview_extension,
                    local_path=make_relative_path(result.preview_local_path),
                    seed=-1,
                )
                logger.info(
                    f"[MediaActor] Stored preview image: {preview_content_id}"
                )

            for index, item in enumerate(result.content):
                content_id = _generate_content_id()

                # Download file to local storage
                try:
                    download_result = download_media(
                        url=item.url,
                        metadata_id=metadata_id,
                        content_id=content_id,
                        index=index,
                        content_type=content_type,
                        images_path=self._images_path,
                        videos_path=self._videos_path,
                        audios_path=self._audios_path,
                    )
                except DownloadError as e:
                    logger.error(f"[MediaActor] Download failed: {e}")
                    self._db.content_repo.update_generation_status(
                        metadata_id=metadata_id,
                        status="failed",
                        error_message=f"Download failed: {e}",
                    )
                    raise GenerationError(f"Download failed: {e}")

                # Store content record with download info and seed (relative path)
                self._db.content_repo.store_content_with_download(
                    content_id=content_id,
                    metadata_id=metadata_id,
                    workflow_run_id=workflow_run_id,
                    index=index,
                    provider_url=item.url,
                    content_type=content_type,
                    extension=download_result.extension,
                    local_path=make_relative_path(download_result.local_path),
                    seed=item.seed,
                    preview_content_id=preview_content_id,
                )

                content_ids.append(content_id)
                filenames.append(f"{content_id}.{download_result.extension}")

            logger.info(
                f"[MediaActor] Complete: {len(result.content)} {content_type}s generated, "
                f"metadata_id={metadata_id}"
            )

            # Store token/usage information (if provider returned usage data)
            self._store_token_usage(
                workflow_run_id=workflow_run_id,
                interaction_id=interaction_id,
                provider_name=provider_name,
                action_type=action_type,
                usage=result.usage,
            )

            # Return data only - server constructs URLs
            # Include raw_response for storage in task queue
            return {
                "workflow_run_id": workflow_run_id,
                "metadata_id": metadata_id,
                "content_ids": content_ids,
                "filenames": filenames,
                "raw_response": result.raw_response,
            }

        except Exception as e:
            # Update metadata with failure
            self._db.content_repo.update_generation_status(
                metadata_id=metadata_id,
                status="failed",
                error_message=str(e),
            )
            raise

    def _get_source_image_from_interaction(self, interaction_id: str) -> str | None:
        """
        Look up source_image from the interaction event's _resolved_inputs.

        For img2vid, the source image is stored in _resolved_inputs when
        the interaction was created. This allows the workflow to specify
        the source image without the client needing to send it back.

        Args:
            interaction_id: The interaction ID to look up

        Returns:
            The source_image data or None if not found
        """
        try:
            interaction_event = self._db.events.find_one({
                "data.interaction_id": interaction_id
            })
            if interaction_event:
                resolved_inputs = interaction_event.get("data", {}).get("_resolved_inputs", {})
                source_image = resolved_inputs.get("source_image")
                if source_image:
                    logger.info(f"[MediaActor] Found source_image in interaction _resolved_inputs")
                    return source_image
        except Exception as e:
            logger.warning(f"[MediaActor] Failed to look up source_image: {e}")
        return None

    def _get_step_context_from_interaction(
        self,
        interaction_id: str
    ) -> Dict[str, Any] | None:
        """
        Look up step context from the interaction event.

        The step context is stored in _step_context when the interaction
        was created. This provides step_id, step_name, module_name, and
        module_index for token tracking.

        Args:
            interaction_id: The interaction ID to look up

        Returns:
            Dict with step_id, step_name, module_name, module_index or None
        """
        try:
            interaction_event = self._db.events.find_one({
                "data.interaction_id": interaction_id
            })
            if interaction_event:
                step_context = interaction_event.get("data", {}).get("_step_context")
                if step_context:
                    logger.info(
                        f"[MediaActor] Found step_context: "
                        f"step_id={step_context.get('step_id')}, "
                        f"module_name={step_context.get('module_name')}"
                    )
                    return step_context
        except Exception as e:
            logger.warning(f"[MediaActor] Failed to look up step_context: {e}")
        return None

    def _store_token_usage(
        self,
        workflow_run_id: str,
        interaction_id: str,
        provider_name: str,
        action_type: str,
        usage,  # UsageInfo from provider
    ) -> None:
        """
        Store token/usage information for a media generation.

        Args:
            workflow_run_id: Workflow run ID
            interaction_id: Interaction ID (to look up step context)
            provider_name: Provider name (e.g., "openai", "leonardo")
            action_type: Action type (e.g., "txt2img", "img2vid")
            usage: UsageInfo object from the provider (or None)
        """
        if usage is None:
            logger.warning(
                f"[MediaActor] No usage info returned from provider {provider_name}"
            )
            return

        # Get step context from interaction event
        step_context = self._get_step_context_from_interaction(interaction_id)
        if not step_context:
            logger.warning(
                f"[MediaActor] No step context found for interaction {interaction_id}, "
                "skipping token storage"
            )
            return

        step_id = step_context.get("step_id", "unknown")
        step_name = step_context.get("step_name", step_id)
        module_name = step_context.get("module_name", "unknown")
        module_index = step_context.get("module_index", 0)

        try:
            # Store usage based on provider type
            if provider_name == "openai":
                if action_type == "img2vid":
                    self._db.token_repo.store_media_openai_usage(
                        workflow_run_id=workflow_run_id,
                        step_id=step_id,
                        step_name=step_name,
                        module_name=module_name,
                        module_index=module_index,
                        model=usage.model,
                        action_type=action_type,
                        total_cost=usage.total_cost,
                        duration_seconds=usage.duration_seconds,
                    )
                else:
                    self._db.token_repo.store_media_openai_usage(
                        workflow_run_id=workflow_run_id,
                        step_id=step_id,
                        step_name=step_name,
                        module_name=module_name,
                        module_index=module_index,
                        model=usage.model,
                        action_type=action_type,
                        total_cost=usage.total_cost,
                        image_count=usage.image_count,
                    )
            elif provider_name == "leonardo":
                self._db.token_repo.store_media_leonardo_usage(
                    workflow_run_id=workflow_run_id,
                    step_id=step_id,
                    step_name=step_name,
                    module_name=module_name,
                    module_index=module_index,
                    model=usage.model,
                    action_type=action_type,
                    credits=usage.credits or 0,
                    total_cost=usage.total_cost,
                )
            elif provider_name == "midjourney":
                self._db.token_repo.store_media_midjourney_usage(
                    workflow_run_id=workflow_run_id,
                    step_id=step_id,
                    step_name=step_name,
                    module_name=module_name,
                    module_index=module_index,
                    model=usage.model,
                    action_type=action_type,
                    credits=usage.credits or 0,
                    total_cost=usage.total_cost,
                )
            elif provider_name == "elevenlabs":
                self._db.token_repo.store_media_elevenlabs_usage(
                    workflow_run_id=workflow_run_id,
                    step_id=step_id,
                    step_name=step_name,
                    module_name=module_name,
                    module_index=module_index,
                    model=usage.model,
                    action_type=action_type,
                    audio_type=usage.audio_type or "music",
                    total_cost=usage.total_cost,
                    characters=usage.characters,
                    credits=usage.credits,
                )
            else:
                logger.warning(
                    f"[MediaActor] Unknown provider {provider_name}, using generic storage"
                )
                # Use generic storage for unknown providers
                self._db.token_repo.store_usage(
                    workflow_run_id=workflow_run_id,
                    step_id=step_id,
                    step_name=step_name,
                    module_name=module_name,
                    module_index=module_index,
                    provider_key=f"media.{provider_name}",
                    provider_data={
                        "model": usage.model,
                        "action_type": action_type,
                        "total_cost": usage.total_cost,
                    },
                )

            logger.info(
                f"[MediaActor] Stored token usage: provider={provider_name}, "
                f"total_cost=${usage.total_cost:.4f}"
            )

        except Exception as e:
            logger.warning(f"[MediaActor] Failed to store token usage: {e}")
