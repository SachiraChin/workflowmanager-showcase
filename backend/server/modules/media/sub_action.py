"""
Media Sub-Action Handler - Execute media generation sub-actions.

This module provides the media-specific sub-action execution logic.
It yields domain events that the API endpoint formats for SSE streaming.
"""

import asyncio
import logging
import concurrent.futures
from typing import Any, Dict, AsyncGenerator, List
from dataclasses import dataclass

from backend.db import Database
from models import (
    SubActionStarted,
    SubActionProgress,
    SubActionComplete,
    SubActionError,
    SubActionEvent,
)
from backend.providers.media import (
    MediaProviderRegistry,
    ProviderError,
    AuthenticationError,
    InsufficientCreditsError,
    RateLimitError,
    GenerationError,
    TimeoutError as ProviderTimeoutError,
    download_media,
    DownloadError,
)
from api.dependencies import get_media_images_path, get_media_videos_path
from utils import uuid7_str
from backend.db.path_utils import make_relative_path

logger = logging.getLogger(__name__)


@dataclass
class MediaSubActionRequest:
    """Request data for a media sub-action execution."""
    interaction_id: str
    provider: str           # "midjourney", "leonardo"
    action_type: str        # "txt2img", "img2img", "img2vid"
    prompt_id: str          # Identifier for the prompt being processed
    params: Dict[str, Any]  # Generation parameters including 'prompt'
    source_data: Any        # Original prompt data from workflow


async def execute_media_sub_action(
    workflow_run_id: str,
    request: MediaSubActionRequest,
    db: Database
) -> AsyncGenerator[SubActionEvent, None]:
    """
    Execute a media sub-action and yield domain events.

    This async generator yields domain events as the sub-action executes:
    - SubActionStarted: Execution began
    - SubActionProgress: Progress update from provider polling
    - SubActionComplete: Generation finished with results
    - SubActionError: Error occurred

    Args:
        workflow_run_id: The workflow run this sub-action belongs to
        request: Sub-action request data
        db: Database instance for storing results

    Yields:
        SubActionEvent dataclass instances
    """
    action_id = f"sa_{uuid7_str()[:16]}"

    logger.info(
        f"[MediaSubAction] Starting {request.action_type} for "
        f"provider={request.provider}, prompt_id={request.prompt_id}"
    )

    yield SubActionStarted(action_id=action_id)

    # Create metadata record in database
    metadata_id = db.content_repo.store_generation(
        workflow_run_id=workflow_run_id,
        interaction_id=request.interaction_id,
        provider=request.provider,
        prompt_id=request.prompt_id,
        operation=request.action_type,
        request_params=request.params,
        source_data=request.source_data,
    )

    try:
        # Get provider instance
        try:
            provider = MediaProviderRegistry.get(request.provider)
        except (ValueError, GenerationError) as e:
            raise GenerationError(str(e))

        # Get the method to call
        method = getattr(provider, request.action_type, None)
        if method is None:
            raise GenerationError(
                f"Provider {request.provider} does not support {request.action_type}"
            )

        # Create event loop and progress queue for bridging sync->async
        loop = asyncio.get_event_loop()
        progress_queue: asyncio.Queue = asyncio.Queue()

        def progress_callback(elapsed_ms: int, message: str):
            """Callback for provider progress updates - bridges sync to async."""
            loop.call_soon_threadsafe(
                progress_queue.put_nowait,
                {"elapsed_ms": elapsed_ms, "message": message}
            )

        # Run provider method in thread pool (providers use sync requests)
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1)

        # Prepare arguments based on action type
        prompt = request.params.get("prompt", "")
        params = {k: v for k, v in request.params.items() if k != "prompt"}

        # Inject prompt_id into params for provider-level mapping (e.g., model selection)
        params["prompt_id"] = request.prompt_id

        if request.action_type == "txt2img":
            future = loop.run_in_executor(
                executor,
                lambda: method(prompt, params, progress_callback=progress_callback)
            )
        elif request.action_type == "img2img":
            source_image = request.params.get("source_image", "")
            future = loop.run_in_executor(
                executor,
                lambda: method(source_image, prompt, params, progress_callback=progress_callback)
            )
        elif request.action_type == "img2vid":
            source_image = request.params.get("source_image", "")
            # Provider handles cropping/resizing using source_image.local_path directory
            future = loop.run_in_executor(
                executor,
                lambda: method(source_image, prompt, params, progress_callback=progress_callback)
            )
        else:
            raise GenerationError(f"Unknown action type: {request.action_type}")

        # Stream progress while waiting for completion
        while not future.done():
            try:
                # Check for progress with timeout
                progress = await asyncio.wait_for(progress_queue.get(), timeout=0.5)
                yield SubActionProgress(
                    elapsed_ms=progress["elapsed_ms"],
                    message=progress["message"]
                )
            except asyncio.TimeoutError:
                # No progress update, just continue waiting
                pass

        # Get the result (may raise exception)
        result = await future
        executor.shutdown(wait=False)

        # Update metadata with completion
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="completed",
            response_data=result.raw_response,
            provider_task_id=result.provider_task_id,
        )

        # Store individual content items and download files
        content_ids: List[str] = []
        server_urls: List[str] = []
        content_type = "video" if request.action_type == "img2vid" else "image"

        # Get media storage paths
        images_path = get_media_images_path()
        videos_path = get_media_videos_path()

        for index, provider_url in enumerate(result.urls):
            # Generate content_id first so we can use it for both filename and DB
            content_id = f"gc_{uuid7_str()}"

            # Download file to local storage
            try:
                download_result = download_media(
                    url=provider_url,
                    metadata_id=metadata_id,
                    content_id=content_id,
                    index=index,
                    content_type=content_type,
                    images_path=images_path,
                    videos_path=videos_path,
                )
            except DownloadError as e:
                logger.error(f"[MediaSubAction] Download failed: {e}")
                db.content_repo.update_generation_status(
                    metadata_id=metadata_id,
                    status="failed",
                    error_message=f"Download failed: {e}",
                )
                yield SubActionError(message=f"Download failed: {e}")
                return

            # Store content record with extension and local path (relative)
            db.content_repo.store_content_with_download(
                content_id=content_id,
                metadata_id=metadata_id,
                workflow_run_id=workflow_run_id,
                index=index,
                provider_url=provider_url,
                content_type=content_type,
                extension=download_result.extension,
                local_path=make_relative_path(download_result.local_path),
            )

            content_ids.append(content_id)

            # Build relative path - client will prepend API_URL
            server_url = f"/workflow/{workflow_run_id}/media/{content_id}.{download_result.extension}"
            server_urls.append(server_url)

        logger.info(
            f"[MediaSubAction] Complete: {len(result.urls)} {content_type}s generated and downloaded, "
            f"metadata_id={metadata_id}"
        )

        yield SubActionComplete(
            urls=server_urls,
            metadata_id=metadata_id,
            content_ids=content_ids,
        )

    except AuthenticationError as e:
        logger.error(f"[MediaSubAction] Auth error: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(message=f"Authentication failed: {e.message}")

    except InsufficientCreditsError as e:
        logger.error(f"[MediaSubAction] Credits error: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(message=f"Insufficient credits: {e.message}")

    except RateLimitError as e:
        logger.error(f"[MediaSubAction] Rate limit: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(
            message=f"Rate limited: {e.message}",
            retry_after=e.retry_after
        )

    except ProviderTimeoutError as e:
        logger.error(f"[MediaSubAction] Timeout: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(message=f"Generation timed out: {e.message}")

    except GenerationError as e:
        logger.error(f"[MediaSubAction] Generation error: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(message=f"Generation failed: {e.message}")

    except NotImplementedError as e:
        logger.error(f"[MediaSubAction] Not implemented: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(message=str(e))

    except Exception as e:
        logger.exception(f"[MediaSubAction] Unexpected error: {e}")
        db.content_repo.update_generation_status(
            metadata_id=metadata_id,
            status="failed",
            error_message=str(e),
        )
        yield SubActionError(message=f"Unexpected error: {str(e)}")
