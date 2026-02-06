"""
Token Repository - Token/usage tracking for LLM and media providers.

Handles:
- Usage storage per API call
- Usage queries and aggregation

Schema Design:
Each record has common fields (workflow_run_id, timestamp, step context) plus
a "usage" array containing usage entries. Each entry must have display_name
and total_cost. All other fields are caller-defined and stored as-is.

Example record:
{
    "workflow_run_id": "wf_xxx",
    "timestamp": ISODate("..."),
    "step_id": "scene_generation",
    "step_name": "Scene Generation",
    "module_name": "generate_scenes",
    "module_index": 0,
    "usage": [
        {
            "provider": "openai",
            "model": "gpt-4o",
            "display_name": "OpenAI GPT-4o",
            "prompt_tokens": 1460,
            "completion_tokens": 395,
            "total_tokens": 1855,
            "total_cost": 0.00958
        }
    ]
}

The caller is responsible for constructing complete usage entries with all
fields they want stored. This repo only validates required fields exist.
"""

from datetime import datetime
from typing import Dict, Any, List

from pymongo import ASCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from ..base import BaseRepository


class TokenRepository(BaseRepository):
    """
    Repository for token/usage tracking across LLM and media providers.

    Collections:
    - tokens: Usage records with step context and usage array
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
        usage: List[Dict[str, Any]],
    ) -> None:
        """
        Store usage record.

        Args:
            workflow_run_id: Workflow run ID
            step_id: Step identifier
            step_name: Human-readable step name
            module_name: Module name or "module_{index}" if unnamed
            module_index: Index of module in step
            usage: List of usage entries. Each entry must have:
                   - display_name (str): User-friendly display name
                   - total_cost (float): Cost in USD
                   All other fields are stored as-is.
        """
        if not usage:
            raise ValueError("Usage list cannot be empty")

        for i, entry in enumerate(usage):
            if "display_name" not in entry:
                raise ValueError(
                    f"Usage entry {i} missing required field: display_name"
                )
            if "total_cost" not in entry:
                raise ValueError(
                    f"Usage entry {i} missing required field: total_cost"
                )

        record = {
            "workflow_run_id": workflow_run_id,
            "timestamp": datetime.utcnow(),
            "step_id": step_id,
            "step_name": step_name,
            "module_name": module_name,
            "module_index": module_index,
            "usage": usage,
        }
        self.tokens.insert_one(record)

    # =========================================================================
    # Query methods
    # =========================================================================

    def get_usage(self, workflow_run_id: str) -> List[Dict[str, Any]]:
        """
        Get all usage records for a workflow.

        Returns:
            List of usage records with step/module context and usage array
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
        Get total cost for a workflow.

        Returns:
            Total cost in USD
        """
        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {"$unwind": "$usage"},
            {"$group": {"_id": None, "total": {"$sum": "$usage.total_cost"}}},
        ]

        results = list(self.tokens.aggregate(pipeline))
        if results:
            return results[0].get("total", 0.0)
        return 0.0

    def get_cost_by_provider(self, workflow_run_id: str) -> Dict[str, float]:
        """
        Get cost breakdown by provider for a workflow.

        Returns:
            Dict mapping provider name to total cost
        """
        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {"$unwind": "$usage"},
            {
                "$group": {
                    "_id": "$usage.provider",
                    "total": {"$sum": "$usage.total_cost"},
                }
            },
        ]

        results = list(self.tokens.aggregate(pipeline))
        return {r["_id"]: r["total"] for r in results if r["_id"]}

    def get_cost_by_model(self, workflow_run_id: str) -> Dict[str, Dict[str, Any]]:
        """
        Get cost breakdown by display_name for a workflow.

        Returns:
            Dict mapping display_name to {total_cost, count}
        """
        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {"$unwind": "$usage"},
            {
                "$group": {
                    "_id": "$usage.display_name",
                    "total_cost": {"$sum": "$usage.total_cost"},
                    "count": {"$sum": 1},
                }
            },
        ]

        results = list(self.tokens.aggregate(pipeline))
        return {
            r["_id"]: {
                "total_cost": r["total_cost"],
                "count": r["count"],
            }
            for r in results
            if r["_id"]
        }

    def get_token_summary(self, workflow_run_id: str) -> Dict[str, Any]:
        """
        Get aggregated usage summary for a workflow.

        Returns:
            Dict with total_cost, cost_by_provider, and cost_by_model
        """
        return {
            "total_cost": self.get_total_cost(workflow_run_id),
            "cost_by_provider": self.get_cost_by_provider(workflow_run_id),
            "cost_by_model": self.get_cost_by_model(workflow_run_id),
        }

    def delete_workflow_tokens(self, workflow_run_id: str) -> int:
        """
        Delete all usage records for a workflow.

        Returns:
            Number of records deleted
        """
        result = self.tokens.delete_many({"workflow_run_id": workflow_run_id})
        return result.deleted_count
