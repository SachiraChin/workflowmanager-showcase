"""
Database Query Module - Safe, schema-validated database queries from workflow JSON.

Allows flexible queries while blocking dangerous operators and enforcing
data isolation between workflows through context_filters.
"""

from datetime import datetime
from typing import Dict, Any, List, Optional, Set
from engine.module_interface import ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError
from utils.mock_generator import generate_lorem_sentence


class DatabaseQueryModule(ExecutableModule):
    """
    Safe database query module with schema validation.

    Loads query_schema and table_schema from config collection,
    validates the query against both schemas, then executes.

    Security features:
    - Operator whitelist (blocks $where, $function, etc.)
    - Field whitelist per table (queryable_fields, filterable_fields)
    - Context filters auto-injected (workflow_template_id)
    - Limit cap to prevent DoS
    """

    @property
    def module_id(self) -> str:
        return "db.query"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="table_schema",
                type="string",
                required=True,
                description="Name of the table schema to use (e.g., 'keyword_history')"
            ),
            ModuleInput(
                name="query",
                type="object",
                required=True,
                description="Query object with filter, fields, sort, limit"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="results",
                type="array",
                description="Array of matching documents with requested fields"
            ),
            ModuleOutput(
                name="count",
                type="number",
                description="Number of results returned"
            )
        ]

    def get_mock_output(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate mock output for preview mode.

        Returns mock query results without accessing the database.
        Generates 2 mock records with lorem ipsum data.
        """
        return {
            "results": [
                {"_id": "mock-001", "title": generate_lorem_sentence()},
                {"_id": "mock-002", "title": generate_lorem_sentence()}
            ],
            "count": 2
        }

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute a validated database query"""
        # Check mock mode first - return mock data without database access
        if getattr(context, 'mock_mode', False):
            return self.get_mock_output(inputs)

        table_schema_name = inputs.get("table_schema")
        query = inputs.get("query", {})

        if not table_schema_name:
            raise ModuleExecutionError(self.module_id, "Missing required input: table_schema")

        # Get database access
        db = getattr(context, "db", None)
        if not db:
            raise ModuleExecutionError(self.module_id, "context.db is required for database queries")

        # Load schemas from config
        query_schema = db.get_query_schema()
        if not query_schema:
            raise ModuleExecutionError(
                self.module_id,
                "Query schema not found in config. Run seed_config.py to initialize."
            )

        table_schema = db.get_table_schema(table_schema_name)
        if not table_schema:
            available = list(db.get_all_table_schemas().keys())
            raise ModuleExecutionError(
                self.module_id,
                f"Table schema '{table_schema_name}' not found. "
                f"Available tables: {', '.join(available) if available else 'none'}"
            )

        # Extract query components
        user_filter = query.get("filter", {})
        fields = query.get("fields", [])
        sort = query.get("sort", {})
        limit = query.get("limit")

        # Validate fields list is provided
        if not fields:
            raise ModuleExecutionError(
                self.module_id,
                "query.fields is required - specify which fields to return"
            )

        # Validate operators in filter
        allowed_operators = set(query_schema.get("allowed_operators", []))
        blocked_operators = set(query_schema.get("blocked_operators", []))
        self._validate_operators(user_filter, allowed_operators, blocked_operators, "filter")

        # Validate filter fields
        filterable_fields = set(table_schema.get("filterable_fields", []))
        context_filters = table_schema.get("context_filters", {})
        self._validate_filter_fields(user_filter, filterable_fields, context_filters)

        # Validate output fields
        queryable_fields = set(table_schema.get("queryable_fields", []))
        self._validate_output_fields(fields, queryable_fields)

        # Validate sort fields
        if sort:
            self._validate_sort_fields(sort, queryable_fields)

        # Apply limit cap
        max_limit = query_schema.get("max_limit", 1000)
        default_limit = query_schema.get("default_limit", 100)
        if limit is None:
            limit = default_limit
        else:
            limit = min(limit, max_limit)

        # Resolve variables in filter
        resolved_filter = self._resolve_variables(user_filter, inputs, context)

        # Inject context filters (cannot be overridden)
        final_filter = self._inject_context_filters(resolved_filter, context_filters, context)

        # Build projection from fields list
        projection = {field: 1 for field in fields}
        projection["_id"] = 0  # Exclude MongoDB _id

        # Execute query
        collection_name = table_schema.get("collection", table_schema_name)
        collection = db.db[collection_name]

        context.logger.debug(
            f"db.query: collection={collection_name}, "
            f"filter={final_filter}, fields={fields}, limit={limit}"
        )

        cursor = collection.find(final_filter, projection)

        if sort:
            # Convert sort dict to list of tuples for pymongo
            sort_list = [(k, v) for k, v in sort.items()]
            cursor = cursor.sort(sort_list)

        cursor = cursor.limit(limit)

        results = list(cursor)

        context.logger.info(f"db.query: returned {len(results)} results from {collection_name}")

        return {
            "results": results,
            "count": len(results)
        }

    def _validate_operators(
        self,
        obj: Any,
        allowed: Set[str],
        blocked: Set[str],
        path: str
    ) -> None:
        """Recursively validate all operators in a filter object"""
        if not isinstance(obj, dict):
            return

        for key, value in obj.items():
            current_path = f"{path}.{key}" if path else key

            if key.startswith("$"):
                if key in blocked:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Operator '{key}' is blocked for security reasons at {current_path}. "
                        f"This operator can execute arbitrary code."
                    )
                if key not in allowed:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Unknown operator '{key}' at {current_path}. "
                        f"Allowed operators: {', '.join(sorted(allowed))}"
                    )

            # Recurse into nested objects
            if isinstance(value, dict):
                self._validate_operators(value, allowed, blocked, current_path)
            elif isinstance(value, list):
                for i, item in enumerate(value):
                    if isinstance(item, dict):
                        self._validate_operators(item, allowed, blocked, f"{current_path}[{i}]")

    def _validate_filter_fields(
        self,
        filter_obj: Dict[str, Any],
        filterable: Set[str],
        context_filters: Dict[str, str]
    ) -> None:
        """Validate all fields in filter are allowed"""
        context_filter_fields = set(context_filters.keys())

        # Operators that have their own parameter structure (not field references)
        parameter_operators = {
            "$dateSubtract", "$dateAdd", "$dateDiff", "$dateFromString",
            "$dateToString", "$dateTrunc"
        }

        def validate_field_reference(value: str, path: str) -> None:
            """Validate a $field reference is allowed"""
            if value.startswith("$$"):
                # System variables like $$NOW, $$CLUSTER_TIME are allowed
                return
            if value.startswith("$"):
                field_name = value[1:]  # Remove $
                if field_name in context_filter_fields:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Field reference '{value}' at {path} cannot be used. "
                        f"This field is automatically injected from context."
                    )
                if field_name not in filterable:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Field reference '{value}' at {path} is not allowed. "
                        f"Allowed fields: {', '.join(sorted(filterable))}"
                    )

        def check_fields(obj: Any, path: str = "", inside_param_operator: bool = False) -> None:
            if not isinstance(obj, dict):
                return

            for key, value in obj.items():
                current_path = f"{path}.{key}" if path else key

                # Skip operators
                if key.startswith("$"):
                    is_param_op = key in parameter_operators
                    # Recurse into operator values
                    if isinstance(value, dict):
                        check_fields(value, current_path, inside_param_operator=is_param_op)
                    elif isinstance(value, list):
                        for i, item in enumerate(value):
                            if isinstance(item, dict):
                                check_fields(item, f"{current_path}[{i}]", inside_param_operator=is_param_op)
                            elif isinstance(item, str):
                                validate_field_reference(item, f"{current_path}[{i}]")
                    continue

                # If inside a parameter operator, validate any field references in values
                if inside_param_operator:
                    if isinstance(value, str):
                        validate_field_reference(value, current_path)
                    elif isinstance(value, dict):
                        check_fields(value, current_path, inside_param_operator=False)
                    continue

                # This is a field name
                if key in context_filter_fields:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Field '{key}' cannot be used in filter. "
                        f"This field is automatically injected from context."
                    )

                if key not in filterable:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Field '{key}' is not filterable. "
                        f"Filterable fields: {', '.join(sorted(filterable))}"
                    )

                # Recurse into nested values (for nested field conditions)
                if isinstance(value, dict):
                    check_fields(value, current_path)

        check_fields(filter_obj)

    def _validate_output_fields(self, fields: List[str], queryable: Set[str]) -> None:
        """Validate all output fields are allowed"""
        for field in fields:
            if field not in queryable:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Field '{field}' is not queryable. "
                    f"Queryable fields: {', '.join(sorted(queryable))}"
                )

    def _validate_sort_fields(self, sort: Dict[str, int], queryable: Set[str]) -> None:
        """Validate all sort fields are allowed"""
        for field in sort.keys():
            if field not in queryable:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Cannot sort by field '{field}' - not in queryable fields. "
                    f"Queryable fields: {', '.join(sorted(queryable))}"
                )

    def _resolve_variables(
        self,
        obj: Any,
        inputs: Dict[str, Any],
        context
    ) -> Any:
        """Resolve special variables like $NOW, $state.*, $input.*"""
        if isinstance(obj, str):
            if obj == "$NOW":
                return datetime.now().isoformat()
            elif obj.startswith("$context."):
                attr_name = obj[9:]  # Remove "$context."
                return getattr(context, attr_name, None)
            elif obj.startswith("$state."):
                field_name = obj[7:]  # Remove "$state."
                state = getattr(context, "state", {})
                return state.get(field_name)
            elif obj.startswith("$input."):
                field_name = obj[7:]  # Remove "$input."
                return inputs.get(field_name)
            return obj

        elif isinstance(obj, dict):
            return {k: self._resolve_variables(v, inputs, context) for k, v in obj.items()}

        elif isinstance(obj, list):
            return [self._resolve_variables(item, inputs, context) for item in obj]

        return obj

    def _inject_context_filters(
        self,
        filter_obj: Dict[str, Any],
        context_filters: Dict[str, str],
        context
    ) -> Dict[str, Any]:
        """Inject context filters that cannot be overridden"""
        result = dict(filter_obj)

        for field, variable in context_filters.items():
            # Resolve the variable
            if variable.startswith("$context."):
                attr_name = variable[9:]
                value = getattr(context, attr_name, None)
            else:
                value = variable

            if value is None:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Context filter '{field}' resolved to None. "
                    f"Variable '{variable}' not available in context."
                )

            result[field] = value

        return result
