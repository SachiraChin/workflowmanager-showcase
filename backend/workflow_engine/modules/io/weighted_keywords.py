"""
Weighted Keywords Module - Store and retrieve weighted keywords for duplicate prevention.

Keywords are scoped by workflow_template_id only. User pipelines are sandboxed
via stage whitelisting to prevent access to other collections or data.
"""

from datetime import datetime
from typing import Dict, Any, List, Set
from ...engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError
from ...utils import make_json_serializable


# Allowed MongoDB aggregation stages (safe for user input)
ALLOWED_STAGES: Set[str] = {
    '$match',       # Filter documents
    '$sort',        # Order results
    '$project',     # Shape output fields
    '$limit',       # Cap result count
    '$skip',        # Pagination
    '$group',       # Aggregate values
    '$unwind',      # Flatten arrays
    '$addFields',   # Add computed fields
    '$set',         # Alias for $addFields
    '$count',       # Count documents
    '$replaceRoot', # Reshape document root
    '$sample',      # Random sample
    '$bucket',      # Bucket by ranges
    '$bucketAuto',  # Auto-bucket
    '$sortByCount', # Group and count
    '$facet',       # Multi-facet aggregation (sub-pipelines validated recursively)
}

# Blocked stages that could escape sandbox
BLOCKED_STAGES: Set[str] = {
    '$lookup',       # Access other collections
    '$unionWith',    # Merge from other collections
    '$merge',        # Write to collections
    '$out',          # Write results to collection
    '$function',     # Execute JavaScript
    '$accumulator',  # Execute JavaScript
    '$graphLookup',  # Recursive lookup across collections
}


class WeightedKeywordsModule(ExecutableModule):
    """
    Store and retrieve weighted keywords for duplicate prevention.

    Keywords are scoped by workflow_template_id. Weight accumulates by default.
    Load mode supports MongoDB aggregation pipelines with stage whitelisting
    for security.

    Modes:
        - save: Store keywords with weights
        - load: Retrieve keywords with optional pipeline filtering

    Inputs (save mode):
        - weighted_keywords: Array of {keyword, weight, ...optional fields}
        - accumulate_weight: If true (default), add weight to existing

    Inputs (load mode):
        - pipeline: MongoDB aggregation stages (whitelisted only)

    Outputs:
        - weighted_keywords: Retrieved keywords (load mode)
        - count: Number of keywords returned (load mode)
        - saved_count: Number of keywords saved (save mode)
    """

    @property
    def module_id(self) -> str:
        return "io.weighted_keywords"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="mode",
                type="string",
                required=True,
                description="Operation: 'save' or 'load'"
            ),
            # Save mode inputs
            ModuleInput(
                name="weighted_keywords",
                type="array",
                required=False,
                description="Array of keyword objects. Required fields: keyword, weight."
            ),
            ModuleInput(
                name="accumulate_weight",
                type="boolean",
                required=False,
                default=True,
                description="If true (default), weight adds to existing. If false, replaces."
            ),
            # Load mode inputs
            ModuleInput(
                name="pipeline",
                type="array",
                required=False,
                default=[],
                description="MongoDB aggregation pipeline. Only safe stages allowed."
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            # Load mode outputs
            ModuleOutput(
                name="weighted_keywords",
                type="array",
                description="Array of keyword objects after pipeline"
            ),
            ModuleOutput(
                name="count",
                type="number",
                description="Number of keywords returned"
            ),
            # Save mode output
            ModuleOutput(
                name="saved_count",
                type="number",
                description="Number of keywords saved/updated"
            )
        ]

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute based on mode."""
        mode = inputs.get('mode')
        if not mode:
            raise ModuleExecutionError(self.module_id, "Missing required input: mode")

        if mode == 'save':
            return self._execute_save(inputs, context)
        elif mode == 'load':
            return self._execute_load(inputs, context)
        else:
            raise ModuleExecutionError(
                self.module_id,
                f"Invalid mode: {mode}. Must be 'save' or 'load'"
            )

    def _validate_pipeline(self, pipeline: List[Dict], context) -> None:
        """
        Validate user pipeline for security.

        Raises ModuleExecutionError if:
        - Any stage is not in ALLOWED_STAGES
        - Any $match tries to override workflow_template_id
        - Any $facet contains disallowed stages
        """
        for stage in pipeline:
            if not isinstance(stage, dict):
                raise ModuleExecutionError(
                    self.module_id,
                    f"Pipeline stage must be an object, got {type(stage).__name__}"
                )

            if len(stage) != 1:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Pipeline stage must have exactly one key, got {len(stage)}"
                )

            stage_name = list(stage.keys())[0]

            # Check if stage is explicitly blocked
            if stage_name in BLOCKED_STAGES:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Pipeline stage '{stage_name}' is not allowed (security restriction)"
                )

            # Check if stage is in allowed list
            if stage_name not in ALLOWED_STAGES:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Pipeline stage '{stage_name}' is not allowed"
                )

            # Block workflow_template_id override in $match
            if stage_name == '$match':
                match_doc = stage['$match']
                if isinstance(match_doc, dict) and 'workflow_template_id' in match_doc:
                    raise ModuleExecutionError(
                        self.module_id,
                        "Cannot override workflow_template_id filter in $match"
                    )

            # Recursively validate $facet sub-pipelines
            if stage_name == '$facet':
                facet_doc = stage['$facet']
                if isinstance(facet_doc, dict):
                    for facet_name, sub_pipeline in facet_doc.items():
                        if isinstance(sub_pipeline, list):
                            self._validate_pipeline(sub_pipeline, context)

        context.logger.debug(f"Pipeline validated: {len(pipeline)} stages")

    def _execute_load(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Load keywords with optional pipeline filtering."""
        try:
            user_pipeline = inputs.get('pipeline', [])

            # Get workflow_template_id from context (already resolved during workflow start)
            workflow_template_id = getattr(context, 'workflow_template_id', None)

            if not workflow_template_id:
                raise ModuleExecutionError(
                    self.module_id,
                    "context.workflow_template_id is required"
                )

            db = getattr(context, 'db', None)
            if not db:
                raise ModuleExecutionError(self.module_id, "context.db is required")

            # Validate user pipeline
            if user_pipeline:
                self._validate_pipeline(user_pipeline, context)

            # Build final pipeline with enforced scope
            enforced_match = {
                "$match": {
                    "workflow_template_id": workflow_template_id
                }
            }

            # Enforced match is ALWAYS first - user cannot bypass
            full_pipeline = [enforced_match] + user_pipeline

            context.logger.debug(f"Executing pipeline with {len(full_pipeline)} stages")

            # Execute on database
            results = list(db.weighted_keywords.aggregate(full_pipeline))

            # Remove MongoDB _id and internal fields, ensure JSON-serializable
            for doc in results:
                doc.pop('_id', None)
                # Also remove workflow_template_id from output (internal field)
                doc.pop('workflow_template_id', None)

            # Convert any non-JSON-serializable types (datetime, ObjectId, etc.)
            results = make_json_serializable(results)

            context.logger.info(f"Loaded {len(results)} keywords")

            return {
                "weighted_keywords": results,
                "count": len(results),
                "saved_count": 0
            }

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to load keywords: {str(e)}",
                e
            )

    def _execute_save(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Save keywords with weight accumulation."""
        try:
            keywords = inputs.get('weighted_keywords', [])
            accumulate = self.get_input_value(inputs, 'accumulate_weight')

            if not keywords:
                context.logger.debug("No keywords provided, skipping save")
                return {"saved_count": 0, "weighted_keywords": [], "count": 0}

            # Get workflow_template_id from context
            workflow_template_id = getattr(context, 'workflow_template_id', None)

            if not workflow_template_id:
                raise ModuleExecutionError(
                    self.module_id,
                    "context.workflow_template_id is required"
                )

            db = getattr(context, 'db', None)
            if not db:
                raise ModuleExecutionError(self.module_id, "context.db is required")

            now = datetime.utcnow()
            saved_count = 0

            for kw in keywords:
                if not isinstance(kw, dict):
                    context.logger.warning(f"Skipping non-dict keyword: {type(kw)}")
                    continue

                keyword_str = kw.get('keyword')
                weight = kw.get('weight', 0)

                if not keyword_str:
                    context.logger.warning("Skipping keyword with no 'keyword' field")
                    continue

                # Normalize keyword
                keyword_normalized = str(keyword_str).lower().strip()

                if not keyword_normalized:
                    continue

                # Build filter (unique key)
                filter_doc = {
                    "workflow_template_id": workflow_template_id,
                    "keyword": keyword_normalized
                }

                # Build extra fields (everything except keyword and weight)
                extra_fields = {
                    k: v for k, v in kw.items()
                    if k not in ['keyword', 'weight']
                }

                # Build update based on accumulate flag
                if accumulate:
                    update_doc = {
                        "$inc": {"weight": weight},
                        "$set": {
                            "last_used": now,
                            **extra_fields
                        },
                        "$setOnInsert": {
                            "keyword": keyword_normalized,
                            "workflow_template_id": workflow_template_id
                        }
                    }
                else:
                    update_doc = {
                        "$set": {
                            "keyword": keyword_normalized,
                            "weight": weight,
                            "last_used": now,
                            "workflow_template_id": workflow_template_id,
                            **extra_fields
                        }
                    }

                db.weighted_keywords.update_one(filter_doc, update_doc, upsert=True)
                saved_count += 1

            context.logger.info(f"Saved {saved_count} keywords (accumulate={accumulate})")

            return {"saved_count": saved_count, "weighted_keywords": [], "count": 0}

        except ModuleExecutionError:
            raise
        except Exception as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Failed to save keywords: {str(e)}",
                e
            )
