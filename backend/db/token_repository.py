"""
Token Repository - Token usage tracking.

Handles:
- Token usage storage per API call
- Token usage queries
"""

from datetime import datetime
from typing import Dict, Any, List

from pymongo import ASCENDING
from pymongo.database import Database
from pymongo.collection import Collection

from .base import BaseRepository


class TokenRepository(BaseRepository):
    """
    Repository for token usage tracking.

    Collections:
    - tokens: Token usage per API call
    """

    def __init__(self, db: Database):
        super().__init__(db)
        self.tokens: Collection = db.tokens

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
        Store token usage for a single API call.

        Args:
            workflow_run_id: Workflow ID
            step_id: Step identifier
            step_name: Human-readable step name
            module_name: Module name or "module_{index}" if unnamed
            module_index: Index of module in step
            model: Model name (e.g., "gpt-4o")
            prompt_tokens: Number of prompt tokens
            completion_tokens: Number of completion tokens
            cached_tokens: Number of cached tokens
            total_tokens: Total tokens used
        """
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

    def get_token_usage(self, workflow_run_id: str) -> List[Dict[str, Any]]:
        """
        Get all token usage records for a workflow.

        Returns:
            List of token usage records with step/module context
        """
        return list(
            self.tokens.find(
                {"workflow_run_id": workflow_run_id},
                {"_id": 0},
            ).sort("timestamp", ASCENDING)
        )

    def get_token_summary(self, workflow_run_id: str) -> Dict[str, int]:
        """
        Get aggregated token usage for a workflow.

        Returns:
            Dict with total prompt, completion, cached, and total tokens
        """
        pipeline = [
            {"$match": {"workflow_run_id": workflow_run_id}},
            {"$group": {
                "_id": None,
                "prompt_tokens": {"$sum": "$prompt_tokens"},
                "completion_tokens": {"$sum": "$completion_tokens"},
                "cached_tokens": {"$sum": "$cached_tokens"},
                "total_tokens": {"$sum": "$total_tokens"},
            }}
        ]
        results = list(self.tokens.aggregate(pipeline))
        if results:
            del results[0]["_id"]
            return results[0]
        return {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "cached_tokens": 0,
            "total_tokens": 0,
        }

    def delete_workflow_tokens(self, workflow_run_id: str) -> int:
        """
        Delete all token records for a workflow.

        Returns:
            Number of records deleted
        """
        result = self.tokens.delete_many({"workflow_run_id": workflow_run_id})
        return result.deleted_count
