"""
Content Repository - Generated content storage and retrieval.

Handles:
- Generation metadata storage (request/response tracking)
- Individual content item storage (images, videos)
- Content retrieval for interactions
"""

from datetime import datetime
from typing import Dict, Any, List, Optional

from pymongo import ASCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from ..base import BaseRepository
from ..utils import uuid7_str


class ContentRepository(BaseRepository):
    """
    Repository for generated content tracking.

    Collections:
    - content_generation_metadata: Generation request metadata
    - generated_content: Individual content items
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.metadata: Collection = db.content_generation_metadata
        self.content: Collection = db.generated_content

    def store_generation(
        self,
        workflow_run_id: str,
        interaction_id: str,
        provider: str,
        prompt_id: str,
        operation: str,
        request_params: Dict[str, Any],
        source_data: Any,
        response_data: Optional[Dict[str, Any]] = None,
        provider_task_id: Optional[str] = None,
    ) -> str:
        """
        Store generation metadata for a media generation request.

        Args:
            workflow_run_id: Workflow run identifier
            interaction_id: Interaction identifier
            provider: Provider name (e.g., "midjourney", "leonardo")
            prompt_id: Prompt identifier within the interaction
            operation: Operation type (e.g., "txt2img", "img2img", "img2vid")
            request_params: Parameters sent to the provider
            source_data: Original prompt data from workflow
            response_data: Raw response from provider (if available)
            provider_task_id: Provider's task/generation ID

        Returns:
            Generated metadata ID
        """
        metadata_id = f"cgm_{uuid7_str()}"

        self.metadata.insert_one({
            "content_generation_metadata_id": metadata_id,
            "workflow_run_id": workflow_run_id,
            "interaction_id": interaction_id,
            "provider": provider,
            "provider_task_id": provider_task_id,
            "prompt_id": prompt_id,
            "operation": operation,
            "created_at": datetime.utcnow(),
            "completed_at": None,
            "status": "pending",
            "request_params": request_params,
            "source_data": source_data,
            "response_data": response_data,
            "error_message": None,
        })

        return metadata_id

    def update_generation_status(
        self,
        metadata_id: str,
        status: str,
        response_data: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
        provider_task_id: Optional[str] = None,
    ) -> None:
        """
        Update generation status after completion or failure.

        Args:
            metadata_id: Generation metadata ID
            status: New status ("pending", "completed", "failed")
            response_data: Raw response from provider
            error_message: Error message if failed
            provider_task_id: Provider's task ID (if not set initially)
        """
        update_fields = {
            "status": status,
        }

        if status in ("completed", "failed"):
            update_fields["completed_at"] = datetime.utcnow()

        if response_data is not None:
            update_fields["response_data"] = response_data

        if error_message is not None:
            update_fields["error_message"] = error_message

        if provider_task_id is not None:
            update_fields["provider_task_id"] = provider_task_id

        self.metadata.update_one(
            {"content_generation_metadata_id": metadata_id},
            {"$set": update_fields}
        )

    def store_content(
        self,
        metadata_id: str,
        workflow_run_id: str,
        index: int,
        provider_url: str,
        content_type: str,
        provider_content_id: Optional[str] = None,
        extension: Optional[str] = None,
    ) -> str:
        """
        Store a single generated content item.

        Args:
            metadata_id: Parent generation metadata ID
            workflow_run_id: Workflow run identifier
            index: Index of this content in the generation batch
            provider_url: URL from provider (may expire)
            content_type: Type of content ("image", "video")
            provider_content_id: Provider's content identifier
            extension: File extension (e.g., "png", "jpg", "mp4")

        Returns:
            Generated content ID
        """
        content_id = f"gc_{uuid7_str()}"

        self.content.insert_one({
            "generated_content_id": content_id,
            "workflow_run_id": workflow_run_id,
            "content_generation_metadata_id": metadata_id,
            "index": index,
            "provider_content_id": provider_content_id,
            "content_type": content_type,
            "provider_url": provider_url,
            "extension": extension,
            "local_path": None,
            "downloaded_at": None,
        })

        return content_id

    def store_content_with_download(
        self,
        content_id: str,
        metadata_id: str,
        workflow_run_id: str,
        index: int,
        provider_url: str,
        content_type: str,
        extension: str,
        local_path: str,
        provider_content_id: Optional[str] = None,
        seed: Optional[int] = None,
    ) -> None:
        """
        Store a generated content item with download information.

        Used when content_id is pre-generated for filename consistency.

        Args:
            content_id: Pre-generated content ID
            metadata_id: Parent generation metadata ID
            workflow_run_id: Workflow run identifier
            index: Index of this content in the generation batch
            provider_url: URL from provider (may expire)
            content_type: Type of content ("image", "video")
            extension: File extension (e.g., "png", "jpg", "mp4")
            local_path: Local file path where content was saved
            provider_content_id: Provider's content identifier
            seed: Generation seed (-1 if not available)
        """
        self.content.insert_one({
            "generated_content_id": content_id,
            "workflow_run_id": workflow_run_id,
            "content_generation_metadata_id": metadata_id,
            "index": index,
            "provider_content_id": provider_content_id,
            "content_type": content_type,
            "provider_url": provider_url,
            "extension": extension,
            "local_path": local_path,
            "downloaded_at": datetime.utcnow(),
            "seed": seed,
        })

    def get_generation(self, metadata_id: str) -> Optional[Dict[str, Any]]:
        """
        Get generation metadata by ID.

        Returns:
            Generation metadata dict or None if not found
        """
        return self.metadata.find_one(
            {"content_generation_metadata_id": metadata_id},
            {"_id": 0}
        )

    def get_generations_for_interaction(
        self,
        interaction_id: str
    ) -> List[Dict[str, Any]]:
        """
        Get all generations for an interaction.

        Returns:
            List of generation metadata dicts with their content items
        """
        generations = list(self.metadata.find(
            {"interaction_id": interaction_id},
            {"_id": 0}
        ).sort("created_at", ASCENDING))

        # Attach content items to each generation
        for gen in generations:
            gen["content_items"] = list(self.content.find(
                {"content_generation_metadata_id": gen["content_generation_metadata_id"]},
                {"_id": 0}
            ).sort("index", ASCENDING))

        return generations

    def get_content_by_id(self, content_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single content item by ID.

        Returns:
            Content item dict or None if not found
        """
        return self.content.find_one(
            {"generated_content_id": content_id},
            {"_id": 0}
        )

    def update_content_local_path(
        self,
        content_id: str,
        local_path: str,
        extension: Optional[str] = None
    ) -> None:
        """
        Update content with local downloaded path.

        Args:
            content_id: Content ID
            local_path: Local file path where content was saved
            extension: File extension (if updating after download)
        """
        update_fields = {
            "local_path": local_path,
            "downloaded_at": datetime.utcnow()
        }
        if extension is not None:
            update_fields["extension"] = extension

        self.content.update_one(
            {"generated_content_id": content_id},
            {"$set": update_fields}
        )

    def delete_workflow_content(self, workflow_run_id: str) -> Dict[str, int]:
        """
        Delete all content and metadata for a workflow.

        Returns:
            Dict with counts of deleted metadata and content records
        """
        metadata_result = self.metadata.delete_many(
            {"workflow_run_id": workflow_run_id}
        )
        content_result = self.content.delete_many(
            {"workflow_run_id": workflow_run_id}
        )

        return {
            "metadata_deleted": metadata_result.deleted_count,
            "content_deleted": content_result.deleted_count
        }
