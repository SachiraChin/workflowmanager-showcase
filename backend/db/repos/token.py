"""
Token Repository - Token/usage tracking for LLM and media providers.

Handles:
- Token usage storage per API call (LLM providers)
- Credit/cost usage storage per generation (media providers)
- Usage queries and aggregation

Schema Design:
Each record has common fields (workflow_run_id, timestamp, step context) plus
a provider-specific node keyed by provider type (e.g., "llm.openai",
"media.leonardo"). This preserves each provider's native billing semantics
while keeping total_cost as the universal field for aggregation.

Example records:

LLM OpenAI:
{
    "workflow_run_id": "wf_xxx",
    "timestamp": ISODate("..."),
    "step_id": "scene_generation",
    "step_name": "Scene Generation",
    "module_name": "generate_scenes",
    "module_index": 0,
    "llm.openai": {
        "model": "gpt-4o",
        "prompt_tokens": 1460,
        "prompt_token_cost": 0.00365,
        "completion_tokens": 395,
        "completion_token_cost": 0.00593,
        "cached_tokens": 0,
        "cached_token_cost": 0.0,
        "total_tokens": 1855,
        "total_cost": 0.00958
    }
}

LLM Anthropic:
{
    ...common fields...,
    "llm.anthropic": {
        "model": "claude-sonnet-4-20250514",
        "input_tokens": 1460,
        "input_token_cost": 0.00438,
        "output_tokens": 395,
        "output_token_cost": 0.00593,
        "cache_read_tokens": 500,
        "cache_read_token_cost": 0.0003,
        "cache_creation_tokens": 0,
        "cache_creation_token_cost": 0.0,
        "total_tokens": 1855,
        "total_cost": 0.01061
    }
}

Media OpenAI (images):
{
    ...common fields...,
    "media.openai": {
        "model": "gpt-image-1.5",
        "action_type": "txt2img",
        "image_count": 2,
        "total_cost": 0.266
    }
}

Media OpenAI (video):
{
    ...common fields...,
    "media.openai": {
        "model": "sora-2",
        "action_type": "img2vid",
        "duration_seconds": 8,
        "total_cost": 0.80
    }
}

Media Leonardo:
{
    ...common fields...,
    "media.leonardo": {
        "model": "phoenix-1.0",
        "action_type": "txt2img",
        "credits": 200,
        "total_cost": 0.04
    }
}

Media ElevenLabs:
{
    ...common fields...,
    "media.elevenlabs": {
        "model": "eleven_multilingual_v2",
        "action_type": "txt2audio",
        "audio_type": "tts",
        "characters": 500,
        "total_cost": 0.015
    }
}
"""

from datetime import datetime
from typing import Dict, Any, List, Optional

from pymongo import ASCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from ..base import BaseRepository


# Provider type constants
PROVIDER_LLM_OPENAI = "llm.openai"
PROVIDER_LLM_ANTHROPIC = "llm.anthropic"
PROVIDER_MEDIA_OPENAI = "media.openai"
PROVIDER_MEDIA_LEONARDO = "media.leonardo"
PROVIDER_MEDIA_MIDJOURNEY = "media.midjourney"
PROVIDER_MEDIA_ELEVENLABS = "media.elevenlabs"


class TokenRepository(BaseRepository):
    """
    Repository for token/usage tracking across LLM and media providers.

    Collections:
    - tokens: Usage records per API call with provider-specific data nodes
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.tokens: Collection = db.tokens

    def store_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        provider_key: str,
        provider_data: Dict[str, Any],
    ) -> None:
        """
        Store usage record with provider-specific data.

        This is the generic method for storing any provider's usage data.
        The provider_key determines which provider node is created.

        Args:
            workflow_run_id: Workflow run ID
            step_id: Step identifier
            step_name: Human-readable step name
            module_name: Module name or "module_{index}" if unnamed
            module_index: Index of module in step
            provider_key: Provider type key (e.g., "llm.openai", "media.leonardo")
            provider_data: Provider-specific usage data (must include total_cost)
        """
        record = {
            "workflow_run_id": workflow_run_id,
            "timestamp": datetime.utcnow(),
            "step_id": step_id,
            "step_name": step_name,
            "module_name": module_name,
            "module_index": module_index,
            provider_key: provider_data,
        }
        self.tokens.insert_one(record)

    # =========================================================================
    # Convenience methods for specific providers
    # =========================================================================

    def store_llm_openai_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        prompt_tokens: int,
        prompt_token_cost: float,
        completion_tokens: int,
        completion_token_cost: float,
        cached_tokens: int,
        cached_token_cost: float,
        total_tokens: int,
        total_cost: float,
    ) -> None:
        """Store usage for OpenAI LLM API calls."""
        self.store_usage(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            step_name=step_name,
            module_name=module_name,
            module_index=module_index,
            provider_key=PROVIDER_LLM_OPENAI,
            provider_data={
                "model": model,
                "prompt_tokens": prompt_tokens,
                "prompt_token_cost": prompt_token_cost,
                "completion_tokens": completion_tokens,
                "completion_token_cost": completion_token_cost,
                "cached_tokens": cached_tokens,
                "cached_token_cost": cached_token_cost,
                "total_tokens": total_tokens,
                "total_cost": total_cost,
            },
        )

    def store_llm_anthropic_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        input_tokens: int,
        input_token_cost: float,
        output_tokens: int,
        output_token_cost: float,
        cache_read_tokens: int,
        cache_read_token_cost: float,
        cache_creation_tokens: int,
        cache_creation_token_cost: float,
        total_tokens: int,
        total_cost: float,
    ) -> None:
        """Store usage for Anthropic LLM API calls."""
        self.store_usage(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            step_name=step_name,
            module_name=module_name,
            module_index=module_index,
            provider_key=PROVIDER_LLM_ANTHROPIC,
            provider_data={
                "model": model,
                "input_tokens": input_tokens,
                "input_token_cost": input_token_cost,
                "output_tokens": output_tokens,
                "output_token_cost": output_token_cost,
                "cache_read_tokens": cache_read_tokens,
                "cache_read_token_cost": cache_read_token_cost,
                "cache_creation_tokens": cache_creation_tokens,
                "cache_creation_token_cost": cache_creation_token_cost,
                "total_tokens": total_tokens,
                "total_cost": total_cost,
            },
        )

    def store_media_openai_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        action_type: str,
        total_cost: float,
        image_count: Optional[int] = None,
        duration_seconds: Optional[int] = None,
    ) -> None:
        """
        Store usage for OpenAI media generation (images or video).

        For images: provide image_count
        For video: provide duration_seconds
        """
        provider_data = {
            "model": model,
            "action_type": action_type,
            "total_cost": total_cost,
        }
        if image_count is not None:
            provider_data["image_count"] = image_count
        if duration_seconds is not None:
            provider_data["duration_seconds"] = duration_seconds

        self.store_usage(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            step_name=step_name,
            module_name=module_name,
            module_index=module_index,
            provider_key=PROVIDER_MEDIA_OPENAI,
            provider_data=provider_data,
        )

    def store_media_leonardo_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        action_type: str,
        credits: int,
        total_cost: float,
    ) -> None:
        """Store usage for Leonardo media generation."""
        self.store_usage(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            step_name=step_name,
            module_name=module_name,
            module_index=module_index,
            provider_key=PROVIDER_MEDIA_LEONARDO,
            provider_data={
                "model": model,
                "action_type": action_type,
                "credits": credits,
                "total_cost": total_cost,
            },
        )

    def store_media_midjourney_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        action_type: str,
        credits: int,
        total_cost: float,
    ) -> None:
        """Store usage for MidJourney media generation."""
        self.store_usage(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            step_name=step_name,
            module_name=module_name,
            module_index=module_index,
            provider_key=PROVIDER_MEDIA_MIDJOURNEY,
            provider_data={
                "model": model,
                "action_type": action_type,
                "credits": credits,
                "total_cost": total_cost,
            },
        )

    def store_media_elevenlabs_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        action_type: str,
        audio_type: str,
        total_cost: float,
        characters: Optional[int] = None,
        credits: Optional[int] = None,
    ) -> None:
        """
        Store usage for ElevenLabs audio generation.

        For TTS: provide characters
        For music/SFX: provide credits
        """
        provider_data = {
            "model": model,
            "action_type": action_type,
            "audio_type": audio_type,
            "total_cost": total_cost,
        }
        if characters is not None:
            provider_data["characters"] = characters
        if credits is not None:
            provider_data["credits"] = credits

        self.store_usage(
            workflow_run_id=workflow_run_id,
            step_id=step_id,
            step_name=step_name,
            module_name=module_name,
            module_index=module_index,
            provider_key=PROVIDER_MEDIA_ELEVENLABS,
            provider_data=provider_data,
        )

    # =========================================================================
    # Legacy method for backwards compatibility
    # =========================================================================

    def store_token_usage(
        self,
        workflow_run_id: str,
        step_id: str,
        step_name: str,
        module_name: str,
        module_index: int,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        cached_tokens: int,
        total_tokens: int,
    ) -> None:
        """
        Legacy method for storing token usage (OpenAI format without costs).

        DEPRECATED: Use store_llm_openai_usage() or store_llm_anthropic_usage()
        instead to include cost information.

        This method stores in the old flat format for backwards compatibility
        during transition. New code should use the provider-specific methods.
        """
        # Store in old format for backwards compatibility
        self.tokens.insert_one(
            {
                "workflow_run_id": workflow_run_id,
                "timestamp": datetime.utcnow(),
                "step_id": step_id,
                "step_name": step_name,
                "module_name": module_name,
                "module_index": module_index,
                "model": model,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "cached_tokens": cached_tokens,
                "total_tokens": total_tokens,
            }
        )

    # =========================================================================
    # Query methods
    # =========================================================================

    def get_usage(self, workflow_run_id: str) -> List[Dict[str, Any]]:
        """
        Get all usage records for a workflow.

        Returns:
            List of usage records with step/module context and provider data
        """
        return list(
            self.tokens.find(
                {"workflow_run_id": workflow_run_id},
                {"_id": 0},
            ).sort("timestamp", ASCENDING)
        )

    def get_token_usage(self, workflow_run_id: str) -> List[Dict[str, Any]]:
        """Alias for get_usage() for backwards compatibility."""
        return self.get_usage(workflow_run_id)

    def get_total_cost(self, workflow_run_id: str) -> float:
        """
        Get total cost for a workflow across all providers.

        Sums total_cost from all provider nodes.

        Returns:
            Total cost in USD
        """
        # Define all provider keys to check
        provider_keys = [
            PROVIDER_LLM_OPENAI,
            PROVIDER_LLM_ANTHROPIC,
            PROVIDER_MEDIA_OPENAI,
            PROVIDER_MEDIA_LEONARDO,
            PROVIDER_MEDIA_MIDJOURNEY,
            PROVIDER_MEDIA_ELEVENLABS,
        ]

        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {
                "$project": {
                    "total_cost": {
                        "$sum": [
                            {"$ifNull": [f"${key}.total_cost", 0]}
                            for key in provider_keys
                        ]
                    }
                }
            },
            {"$group": {"_id": None, "total": {"$sum": "$total_cost"}}},
        ]

        results = list(self.tokens.aggregate(pipeline))
        if results:
            return results[0].get("total", 0.0)
        return 0.0

    def get_cost_by_provider(self, workflow_run_id: str) -> Dict[str, float]:
        """
        Get cost breakdown by provider for a workflow.

        Returns:
            Dict mapping provider key to total cost (e.g., {"llm.openai": 0.05})
        """
        provider_keys = [
            PROVIDER_LLM_OPENAI,
            PROVIDER_LLM_ANTHROPIC,
            PROVIDER_MEDIA_OPENAI,
            PROVIDER_MEDIA_LEONARDO,
            PROVIDER_MEDIA_MIDJOURNEY,
            PROVIDER_MEDIA_ELEVENLABS,
        ]

        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {
                "$group": {
                    "_id": None,
                    **{
                        key.replace(".", "_"): {
                            "$sum": {"$ifNull": [f"${key}.total_cost", 0]}
                        }
                        for key in provider_keys
                    },
                }
            },
        ]

        results = list(self.tokens.aggregate(pipeline))
        if results:
            result = results[0]
            del result["_id"]
            # Convert keys back to dotted format
            return {
                key: result.get(key.replace(".", "_"), 0.0)
                for key in provider_keys
                if result.get(key.replace(".", "_"), 0.0) > 0
            }
        return {}

    def get_token_summary(self, workflow_run_id: str) -> Dict[str, Any]:
        """
        Get aggregated token/usage summary for a workflow.

        Returns summary with both legacy token counts (for backwards compat)
        and new total_cost field.

        Returns:
            Dict with aggregated usage data
        """
        # First, try to get cost from new format
        total_cost = self.get_total_cost(workflow_run_id)
        cost_by_provider = self.get_cost_by_provider(workflow_run_id)

        # Also aggregate legacy token fields for backwards compatibility
        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {
                "$group": {
                    "_id": None,
                    "prompt_tokens": {"$sum": {"$ifNull": ["$prompt_tokens", 0]}},
                    "completion_tokens": {
                        "$sum": {"$ifNull": ["$completion_tokens", 0]}
                    },
                    "cached_tokens": {"$sum": {"$ifNull": ["$cached_tokens", 0]}},
                    "total_tokens": {"$sum": {"$ifNull": ["$total_tokens", 0]}},
                }
            },
        ]
        results = list(self.tokens.aggregate(pipeline))

        summary = {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cached_tokens": 0,
            "total_tokens": 0,
            "total_cost": total_cost,
            "cost_by_provider": cost_by_provider,
        }

        if results:
            result = results[0]
            summary["prompt_tokens"] = result.get("prompt_tokens", 0)
            summary["completion_tokens"] = result.get("completion_tokens", 0)
            summary["cached_tokens"] = result.get("cached_tokens", 0)
            summary["total_tokens"] = result.get("total_tokens", 0)

        return summary

    def delete_workflow_tokens(self, workflow_run_id: str) -> int:
        """
        Delete all usage records for a workflow.

        Returns:
            Number of records deleted
        """
        result = self.tokens.delete_many({"workflow_run_id": workflow_run_id})
        return result.deleted_count
