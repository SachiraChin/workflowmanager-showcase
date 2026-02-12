"""
API Call Logger - Handles saving API requests and responses to MongoDB

Stores API call data in the workflow_files collection with category='api_calls'.
Each API call gets a unique group_id (e.g., 'image_analysis_openai_20251220_144020_594802')
and related files (request.json, response.json, schema.json, extracted content) are
stored as separate documents linked by that group_id.
"""

import json
import copy
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass


# Provider-specific extraction rules for nice file naming
# Format: (json_path_pattern, file_prefix)
EXTRACTION_RULES = {
    "openai": {
        "request": [
            # Chat Completions API: messages[i].content (when string)
            ("messages[].content", "message_{i}_content"),
            # Chat Completions API: messages[i].content[j].text (when array of content blocks)
            ("messages[].content[].text", "message_{i}_content_{j}"),
            # Responses API: input[i].content (when string)
            ("input[].content", "input_{i}_content"),
            # Responses API: input[i].content[j].text (when array of content blocks)
            ("input[].content[].text", "input_{i}_content_{j}"),
        ],
        "response": [
            # Chat Completions API: choices[i].message.content
            ("choices[].message.content", "response_{i}"),
            # Responses API: output[i].content[j].text
            ("output[].content[].text", "output_{i}_content_{j}"),
            # Responses API: output.content[i].text (single output object)
            ("output.content[].text", "output_content_{i}"),
        ]
    },
    "anthropic": {
        "request": [
            # system (when string)
            ("system", "system"),
            # system[i].text (when array)
            ("system[].text", "system_{i}"),
            # messages[i].content (when string)
            ("messages[].content", "message_{i}_content"),
            # messages[i].content[j].text (when array)
            ("messages[].content[].text", "message_{i}_content_{j}"),
        ],
        "response": [
            # content[i].text
            ("content[].text", "response_content_{i}"),
        ]
    }
}


@dataclass
class APICallContext:
    """
    Context for a single API call, returned by save_request() and passed to save_response().

    This ensures request/response pairs are correctly matched even with concurrent calls,
    avoiding state leakage between different API calls.
    """
    group_id: str
    provider: str
    metadata: Dict[str, Any]
    context: Any  # Execution context with db access


class APICallLogger:
    """
    Handles logging of API requests and responses to MongoDB.

    This class provides a centralized way to save API call data for debugging,
    auditing, and analysis. Stores data in the workflow_files collection.

    Features:
    - Stores request/response as documents in MongoDB workflow_files collection
    - Extracts large text content to separate documents
    - Provider-aware extraction with nice file naming
    - Base64 image truncation for readable logs
    - Thread-safe: no per-call state stored on instance

    Usage:
        logger = APICallLogger()
        call_ctx = logger.save_request(context, step_id, provider, model, request_params, schema, metadata)
        # ... make API call ...
        logger.save_response(call_ctx, response)
    """

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Initialize the API call logger.

        Args:
            config: Optional configuration dict with settings like:
                - enabled: bool - Whether logging is enabled (default: True)
                - save_schema: bool - Whether to save output schema (default: True)
                - truncate_base64: bool - Whether to truncate base64 images (default: True)
                - extract_content: bool - Whether to extract large content to files (default: True)
        """
        self.config = config or {}

    @property
    def enabled(self) -> bool:
        """Check if logging is enabled."""
        return self.config.get('enabled', True)

    @property
    def save_schema(self) -> bool:
        """Check if schema should be saved."""
        return self.config.get('save_schema', True)

    @property
    def truncate_base64(self) -> bool:
        """Check if base64 images should be truncated."""
        return self.config.get('truncate_base64', True)

    @property
    def extract_content(self) -> bool:
        """Check if large content should be extracted to separate files."""
        return self.config.get('extract_content', True)


    def save_request(
        self,
        context,
        step_id: str,
        provider: str,
        model: str,
        request_params: Dict[str, Any],
        output_schema: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[APICallContext]:
        """
        Save API request to MongoDB workflow_files collection.

        Args:
            context: Execution context with db and workflow_run_id
            step_id: Current workflow step ID
            provider: Provider name (e.g., 'openai', 'anthropic')
            model: Model name being used
            request_params: The request parameters being sent to the API
            output_schema: Optional JSON schema for structured output
            metadata: Optional additional metadata to save

        Returns:
            APICallContext to pass to save_response(), or None if saving failed/disabled
        """
        if not self.enabled:
            return None

        try:
            # Check if we have database access
            if not hasattr(context, 'db') or context.db is None:
                if hasattr(context, 'logger'):
                    context.logger.debug("[CALL_LOGGER] No database access, skipping save")
                return None

            workflow_run_id = getattr(context, 'workflow_run_id', None)
            if not workflow_run_id:
                if hasattr(context, 'logger'):
                    context.logger.debug("[CALL_LOGGER] No workflow_run_id, skipping save")
                return None

            # Generate group_id for this API call
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            group_id = f"{step_id}_{provider}_{timestamp}"

            if hasattr(context, 'logger'):
                context.logger.info(f"[CALL_LOGGER] save_request: group_id={group_id}")

            # Build metadata for this call
            call_metadata = {
                'step_id': step_id,
                'provider': provider,
                'model': model,
                'timestamp': timestamp,
                **(metadata or {})
            }

            # Make a deep copy to avoid modifying original
            params_copy = copy.deepcopy(request_params)

            # Sanitize base64 images first
            if self.truncate_base64:
                self._sanitize_recursive(params_copy)

            # Extract large content to separate documents
            if self.extract_content:
                self._extract_and_replace_content_db(
                    params_copy, context, workflow_run_id, group_id, provider, "request", call_metadata
                )

            # Get branch_id for file isolation
            branch_id = getattr(context, 'branch_id', None)

            # Store main request document
            context.db.file_repo.store_workflow_file(
                workflow_run_id=workflow_run_id,
                category="api_calls",
                group_id=group_id,
                filename="request.json",
                content=params_copy,
                content_type="json",
                metadata={
                    "step_id": step_id,
                    "provider": provider,
                    "model": model,
                    "file_role": "request"
                },
                branch_id=branch_id
            )

            # Save schema if provided and enabled
            if output_schema and self.save_schema:
                context.db.file_repo.store_workflow_file(
                    workflow_run_id=workflow_run_id,
                    category="api_calls",
                    group_id=group_id,
                    filename="schema.json",
                    content=output_schema,
                    content_type="json",
                    metadata={
                        "step_id": step_id,
                        "provider": provider,
                        "file_role": "schema"
                    },
                    branch_id=branch_id
                )

            # Save metadata
            if call_metadata:
                context.db.file_repo.store_workflow_file(
                    workflow_run_id=workflow_run_id,
                    category="api_calls",
                    group_id=group_id,
                    filename="metadata.json",
                    content=call_metadata,
                    content_type="json",
                    metadata={
                        "step_id": step_id,
                        "provider": provider,
                        "file_role": "metadata"
                    },
                    branch_id=branch_id
                )

            # Return call context for save_response (no instance state stored)
            return APICallContext(
                group_id=group_id,
                provider=provider,
                metadata=call_metadata,
                context=context
            )

        except Exception as e:
            if hasattr(context, 'logger'):
                context.logger.debug(f"Failed to save API request: {e}")
            return None

    def save_response(
        self,
        call_ctx: Optional[APICallContext],
        response: Any,
        usage: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ) -> bool:
        """
        Save API response to MongoDB workflow_files collection.

        Args:
            call_ctx: APICallContext returned by save_request()
            response: The API response object
            usage: Optional token usage information
            error: Optional error message if the call failed

        Returns:
            True if saved successfully, False otherwise
        """
        if not self.enabled:
            return False

        if not call_ctx:
            return False

        try:
            ctx = call_ctx.context
            if not ctx or not hasattr(ctx, 'db') or ctx.db is None:
                return False

            workflow_run_id = getattr(ctx, 'workflow_run_id', None)
            if not workflow_run_id:
                return False

            group_id = call_ctx.group_id
            provider = call_ctx.provider
            step_id = call_ctx.metadata.get('step_id', 'unknown')

            # Convert response to dict
            response_dict = self._serialize_response(response)

            # Add usage info if provided
            if usage:
                response_dict['_usage'] = usage

            # Add error info if provided
            if error:
                response_dict['_error'] = error

            # Extract large content to separate documents
            if self.extract_content:
                self._extract_and_replace_content_db(
                    response_dict, ctx, workflow_run_id, group_id, provider, "response", call_ctx.metadata
                )

            # Get branch_id for file isolation
            branch_id = getattr(ctx, 'branch_id', None)

            # Store response document
            ctx.db.file_repo.store_workflow_file(
                workflow_run_id=workflow_run_id,
                category="api_calls",
                group_id=group_id,
                filename="response.json",
                content=response_dict,
                content_type="json",
                metadata={
                    "step_id": step_id,
                    "provider": provider,
                    "file_role": "response"
                },
                branch_id=branch_id
            )

            return True

        except Exception as e:
            if hasattr(call_ctx.context, 'logger'):
                call_ctx.context.logger.debug(f"Failed to save API response: {e}")
            return False

    def _extract_and_replace_content_db(
        self,
        data: Dict[str, Any],
        context,
        workflow_run_id: str,
        group_id: str,
        provider: str,
        data_type: str,  # "request" or "response"
        call_metadata: Dict[str, Any]
    ) -> None:
        """
        Extract large text content to separate MongoDB documents and replace with $ref.

        Args:
            data: The data dict to process (modified in place)
            context: Execution context with db access
            workflow_run_id: Workflow run ID
            group_id: API call group ID
            provider: Provider name for extraction rules
            data_type: "request" or "response"
            call_metadata: Metadata for this API call
        """
        rules = EXTRACTION_RULES.get(provider, {}).get(data_type, [])
        step_id = call_metadata.get('step_id', 'unknown')

        for path_pattern, name_template in rules:
            extractions = self._find_content_by_pattern(data, path_pattern)

            for path_indices, value, parent, key in extractions:
                if not isinstance(value, str):
                    continue

                # Generate filename from template
                filename = self._generate_filename(name_template, path_indices, value)

                # Determine file role based on data_type
                file_role = "input" if data_type == "request" else "output"

                # Get branch_id for file isolation
                branch_id = getattr(context, 'branch_id', None)

                # Store content as separate document
                context.db.file_repo.store_workflow_file(
                    workflow_run_id=workflow_run_id,
                    category="api_calls",
                    group_id=group_id,
                    filename=filename,
                    content=value,
                    content_type="text",
                    metadata={
                        "step_id": step_id,
                        "provider": provider,
                        "file_role": file_role
                    },
                    branch_id=branch_id
                )

                # Replace in data with $ref
                parent[key] = {"$ref": filename, "type": "text"}

    def _find_content_by_pattern(
        self,
        data: Any,
        pattern: str
    ) -> List[Tuple[List[int], Any, Dict, str]]:
        """
        Find content matching a path pattern.

        Args:
            data: Data to search
            pattern: Path pattern like "messages[].content[].text"

        Returns:
            List of (indices, value, parent_dict, key) tuples
        """
        results = []
        parts = pattern.replace("[]", "[*]").split(".")
        self._find_by_parts(data, parts, [], results)
        return results

    def _find_by_parts(
        self,
        data: Any,
        parts: List[str],
        indices: List[int],
        results: List[Tuple[List[int], Any, Dict, str]]
    ) -> None:
        """Recursive helper for pattern matching."""
        if not parts:
            return

        part = parts[0]
        remaining = parts[1:]

        # Handle array wildcard
        if part.endswith("[*]"):
            field_name = part[:-3]
            if field_name:
                # Access field first, then iterate
                if isinstance(data, dict) and field_name in data:
                    arr = data[field_name]
                    if isinstance(arr, list):
                        for i, item in enumerate(arr):
                            self._find_by_parts(item, remaining, indices + [i], results)
            else:
                # Just [*] - data itself is array
                if isinstance(data, list):
                    for i, item in enumerate(data):
                        self._find_by_parts(item, remaining, indices + [i], results)
        else:
            # Regular field access
            if isinstance(data, dict) and part in data:
                if not remaining:
                    # This is the target field
                    results.append((indices, data[part], data, part))
                else:
                    self._find_by_parts(data[part], remaining, indices, results)

    def _generate_filename(
        self,
        template: str,
        indices: List[int],
        content: str
    ) -> str:
        """
        Generate filename from template and indices.

        Args:
            template: Name template like "message_{i}_content_{j}"
            indices: List of array indices
            content: The content string (to determine extension)

        Returns:
            Filename like "message_0_content_1.txt"
        """
        # Replace {i}, {j}, etc. with actual indices
        name = template
        placeholders = ['{i}', '{j}', '{k}', '{l}']
        for idx, placeholder in zip(indices, placeholders):
            name = name.replace(placeholder, str(idx))

        # Remove any unreplaced placeholders
        for placeholder in placeholders:
            name = name.replace(placeholder, '0')

        # Determine extension based on content
        ext = self._get_content_extension(content)
        return f"{name}{ext}"

    def _get_content_extension(self, content: str) -> str:
        """
        Determine file extension based on content type.

        Args:
            content: The text content

        Returns:
            Extension like ".txt" or ".json"
        """
        # Try to parse as JSON
        try:
            json.loads(content)
            return ".json"
        except (json.JSONDecodeError, TypeError):
            return ".txt"

    def _serialize_response(self, response: Any) -> Dict[str, Any]:
        """
        Serialize a response object to a dictionary.

        Args:
            response: The response object (Pydantic model, dict, or other)

        Returns:
            Dictionary representation of the response
        """
        if response is None:
            return {"_error": "Response was None"}

        if isinstance(response, dict):
            return copy.deepcopy(response)

        # Try Pydantic v2 method
        try:
            return response.model_dump()
        except AttributeError:
            pass

        # Try Pydantic v1 method
        try:
            return response.dict()
        except AttributeError:
            pass

        # Try __dict__
        try:
            return dict(response.__dict__)
        except (AttributeError, TypeError):
            pass

        # Last resort: str representation
        return {"_raw": str(response)}

    def _sanitize_for_logging(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize data for logging by truncating large content like base64 images.

        Args:
            data: The data dictionary to sanitize

        Returns:
            Sanitized copy of the data
        """
        if not self.truncate_base64:
            return data

        sanitized = copy.deepcopy(data)
        self._sanitize_recursive(sanitized)
        return sanitized

    def _sanitize_recursive(self, obj: Any) -> None:
        """
        Recursively sanitize an object by truncating base64 content.

        Args:
            obj: Object to sanitize in place
        """
        if isinstance(obj, dict):
            for key, value in obj.items():
                # Handle base64 image URLs
                if key in ("url", "image_url", "data") and isinstance(value, str):
                    if value.startswith("data:image/") and "base64," in value:
                        prefix = value.split("base64,")[0] + "base64,"
                        obj[key] = prefix + "...[truncated]"
                elif isinstance(value, (dict, list)):
                    self._sanitize_recursive(value)
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    self._sanitize_recursive(item)


# Default singleton instance
_default_logger: Optional[APICallLogger] = None


def get_api_call_logger(config: Optional[Dict[str, Any]] = None) -> APICallLogger:
    """
    Get the API call logger instance.

    Args:
        config: Optional configuration to use when creating a new instance

    Returns:
        APICallLogger instance
    """
    global _default_logger
    if _default_logger is None:
        _default_logger = APICallLogger(config)
    return _default_logger


def set_api_call_logger(logger: APICallLogger) -> None:
    """
    Set a custom API call logger instance.

    Args:
        logger: Custom APICallLogger instance or subclass
    """
    global _default_logger
    _default_logger = logger
