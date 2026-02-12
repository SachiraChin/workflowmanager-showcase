"""
Query Transform Module - MongoDB aggregation pipeline for in-memory arrays.

Uses mongomock to provide full MongoDB aggregation pipeline support
on Python lists without requiring a database connection.

SECURITY: This module handles potentially sensitive data. Key safeguards:
- Unique collection per execution prevents cross-request data leakage
- Collection is ALWAYS dropped in finally block, even on exceptions
- No data persisted beyond function scope
- Singleton client contains no persistent data (collections are dropped)

PERFORMANCE: Optimized for repeated use:
- Singleton MongoClient avoids repeated instantiation overhead
- Collection create/drop is O(1) in mongomock (just dict key operations)
- UUID generation is ~1 microsecond
"""

import copy
import uuid
from typing import Dict, Any, List
import mongomock
from ...engine.module_interface import (
    ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError
)


# Singleton client - lazy initialized, reused across all queries.
# Contains no persistent data as collections are dropped after each use.
_client: mongomock.MongoClient | None = None


def _get_client() -> mongomock.MongoClient:
    """
    Get or create the singleton MongoClient.

    Thread-safety note: Python's GIL makes this assignment atomic.
    Worst case in race condition: two clients created, one becomes garbage.
    This is acceptable as mongomock clients are lightweight.
    """
    global _client
    if _client is None:
        _client = mongomock.MongoClient()
    return _client


class QueryModule(ExecutableModule):
    """
    Execute MongoDB aggregation pipeline on in-memory arrays.

    This module provides full MongoDB aggregation pipeline support for
    transforming arrays without requiring a database. Useful for filtering,
    projecting, grouping, and aggregating data.

    Inputs:
        - data: Array of objects to query
        - pipeline: MongoDB aggregation pipeline stages

    Outputs:
        - result: Array output from pipeline execution

    Example:
        data: [
            {"name": "Alice", "score": 85, "dept": "eng"},
            {"name": "Bob", "score": 45, "dept": "eng"},
            {"name": "Carol", "score": 92, "dept": "sales"}
        ]

        pipeline: [
            {"$match": {"score": {"$gte": 50}}},
            {"$project": {"_id": 0, "name": 1, "score": 1}}
        ]

        result: [
            {"name": "Alice", "score": 85},
            {"name": "Carol", "score": 92}
        ]

    Supported pipeline stages (via mongomock):
        $addFields, $bucket, $count, $facet, $group, $limit, $lookup,
        $match, $project, $replaceRoot, $sample, $set, $skip, $sort, $unwind

    Supported operators in $match:
        Comparison: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin
        Logical: $and, $or, $not, $nor
        Element: $exists, $type
        Array: $all, $size, $elemMatch
        Evaluation: $regex, $mod
    """

    @property
    def module_id(self) -> str:
        return "transform.query"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="data",
                type="array",
                required=True,
                description="Array of objects to query"
            ),
            ModuleInput(
                name="pipeline",
                type="array",
                required=True,
                description="MongoDB aggregation pipeline stages"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="result",
                type="array",
                description="Array output from pipeline execution"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """
        Execute aggregation pipeline on data array.

        Data safety:
        - Collection created with unique UUID name
        - Collection ALWAYS dropped in finally block
        - No references to data persist after function returns
        """
        data = inputs.get("data")
        pipeline = inputs.get("pipeline")

        # Validate inputs before any mongomock operations
        if data is None:
            raise ModuleExecutionError(
                self.module_id,
                "data is required",
                None
            )

        if not isinstance(data, list):
            raise ModuleExecutionError(
                self.module_id,
                f"data must be an array, got {type(data).__name__}",
                None
            )

        if pipeline is None:
            raise ModuleExecutionError(
                self.module_id,
                "pipeline is required",
                None
            )

        if not isinstance(pipeline, list):
            raise ModuleExecutionError(
                self.module_id,
                f"pipeline must be an array, got {type(pipeline).__name__}",
                None
            )

        # Handle empty data - no need to create collection
        if len(data) == 0:
            context.logger.debug("Empty data array, returning empty result")
            return {"result": []}

        # Generate unique collection name for this execution.
        # UUID4 provides sufficient uniqueness for concurrent executions.
        collection_id = uuid.uuid4().hex
        collection_name = f"_query_{collection_id}"

        # Get reference to collection (does not create until first write)
        client = _get_client()
        collection = client.transform_query_db[collection_name]

        try:
            # Insert data into temporary collection.
            # insert_many creates the collection implicitly.
            # Deep copy to avoid mutating original state (insert_many adds _id in-place)
            collection.insert_many(copy.deepcopy(data))

            context.logger.debug(
                f"Executing pipeline with {len(pipeline)} stages "
                f"on {len(data)} documents"
            )

            # Execute aggregation pipeline
            cursor = collection.aggregate(pipeline)

            # Materialize cursor to list before collection is dropped.
            # This ensures all data is extracted while collection exists.
            result = list(cursor)

            # Strip mongomock's _id (ObjectId not JSON serializable, not user data)
            for doc in result:
                doc.pop('_id', None)

            context.logger.info(
                f"Query complete: {len(data)} input → {len(result)} output"
            )

            return {"result": result}

        except Exception as e:
            # Log error with context but don't expose internal details
            context.logger.error(f"Pipeline execution failed: {e}")

            # Re-raise as ModuleExecutionError for consistent handling
            if isinstance(e, ModuleExecutionError):
                raise
            raise ModuleExecutionError(
                self.module_id,
                f"Pipeline execution failed: {str(e)}",
                e
            )

        finally:
            # CRITICAL: Always drop collection to prevent data leaks.
            # This runs even if an exception occurred above.
            # drop() is idempotent - safe even if collection wasn't created.
            try:
                collection.drop()
            except Exception as drop_error:
                # Log but don't raise - we don't want cleanup failure
                # to mask the original error or prevent return
                context.logger.warning(
                    f"Failed to drop temporary collection: {drop_error}"
                )
