"""
API Fetch Module - HTTP client for external API calls from workflows.

This module provides a simple way to fetch data from external HTTP APIs
and store the response in workflow state for use by subsequent modules.

Primary use case: Fetching dynamic data (like available models, options)
before displaying interactive UI elements.
"""

import logging
import requests
from typing import Dict, Any, List, Optional
from urllib.parse import urljoin

from engine.module_interface import (
    ExecutableModule, ModuleInput, ModuleOutput, ModuleExecutionError
)
from utils.mock_generator import generate_lorem_sentence

logger = logging.getLogger(__name__)


class APIFetchModule(ExecutableModule):
    """
    HTTP fetch module for external API calls.

    Inputs:
        - url: Full URL or path (combined with base_url)
        - base_url: Base URL (optional, can use env var)
        - base_url_env: Environment variable name for base URL
        - method: HTTP method (GET, POST, etc.)
        - headers: Request headers
        - body: Request body (for POST/PUT)
        - params: Query parameters
        - timeout: Request timeout in seconds
        - extract_path: JSON path to extract from response (e.g., "models" or "data.items")

    Outputs:
        - response: Full response data (or extracted portion if extract_path specified)
        - status_code: HTTP status code
        - success: Boolean indicating success (2xx status)
    """

    @property
    def module_id(self) -> str:
        return "api.fetch"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="url",
                type="string",
                required=True,
                description="URL or path to fetch (combined with base_url if relative)"
            ),
            ModuleInput(
                name="base_url",
                type="string",
                required=False,
                default=None,
                description="Base URL for the API"
            ),
            ModuleInput(
                name="method",
                type="string",
                required=False,
                default="GET",
                description="HTTP method (GET, POST, PUT, DELETE)"
            ),
            ModuleInput(
                name="headers",
                type="object",
                required=False,
                default=None,
                description="Request headers"
            ),
            ModuleInput(
                name="body",
                type="object",
                required=False,
                default=None,
                description="Request body (for POST/PUT)"
            ),
            ModuleInput(
                name="params",
                type="object",
                required=False,
                default=None,
                description="Query parameters"
            ),
            ModuleInput(
                name="timeout",
                type="number",
                required=False,
                default=30,
                description="Request timeout in seconds"
            ),
            ModuleInput(
                name="extract_path",
                type="string",
                required=False,
                default=None,
                description="JSON path to extract from response (e.g., 'models' or 'data.items')"
            ),
            ModuleInput(
                name="error_on_failure",
                type="boolean",
                required=False,
                default=True,
                description="Raise error on non-2xx status codes"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="response",
                type="object",
                description="Response data (full or extracted portion)"
            ),
            ModuleOutput(
                name="status_code",
                type="number",
                description="HTTP status code"
            ),
            ModuleOutput(
                name="success",
                type="boolean",
                description="True if request succeeded (2xx status)"
            )
        ]

    def get_mock_output(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generate mock output for preview mode.

        Returns a mock successful response without making an HTTP request.
        """
        return {
            "response": {
                "mock": True,
                "message": generate_lorem_sentence()
            },
            "status_code": 200,
            "success": True
        }

    def execute(self, inputs: Dict[str, Any], context) -> Dict[str, Any]:
        """Execute HTTP request and return response."""
        # Check mock mode first - return mock data without making HTTP request
        if getattr(context, 'mock_mode', False):
            return self.get_mock_output(inputs)

        # Build URL
        url = self._build_url(inputs)
        method = self.get_input_value(inputs, 'method').upper()
        headers = self.get_input_value(inputs, 'headers') or {}
        body = self.get_input_value(inputs, 'body')
        params = self.get_input_value(inputs, 'params')
        timeout = self.get_input_value(inputs, 'timeout')
        extract_path = self.get_input_value(inputs, 'extract_path')
        error_on_failure = self.get_input_value(inputs, 'error_on_failure')

        # Set default content-type for JSON body
        if body and 'Content-Type' not in headers:
            headers['Content-Type'] = 'application/json'

        context.logger.info(f"[api.fetch] {method} {url}")

        try:
            response = requests.request(
                method=method,
                url=url,
                headers=headers,
                json=body if body else None,
                params=params,
                timeout=timeout
            )
        except requests.Timeout:
            raise ModuleExecutionError(
                self.module_id,
                f"Request timed out after {timeout}s: {url}"
            )
        except requests.ConnectionError as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Connection failed: {url} - {str(e)}"
            )
        except requests.RequestException as e:
            raise ModuleExecutionError(
                self.module_id,
                f"Request failed: {url} - {str(e)}"
            )

        status_code = response.status_code
        success = 200 <= status_code < 300

        # Parse response
        try:
            response_data = response.json()
        except ValueError:
            # Non-JSON response
            response_data = {"text": response.text}

        context.logger.info(
            f"[api.fetch] Response: status={status_code}, success={success}"
        )

        # Check for error
        if not success and error_on_failure:
            error_msg = response_data.get('error', response.text[:200])
            raise ModuleExecutionError(
                self.module_id,
                f"API request failed ({status_code}): {error_msg}"
            )

        # Extract nested path if specified
        if extract_path and success:
            response_data = self._extract_path(response_data, extract_path)

        return {
            "response": response_data,
            "status_code": status_code,
            "success": success
        }

    def _build_url(self, inputs: Dict[str, Any]) -> str:
        """Build full URL from inputs."""
        url = self.get_input_value(inputs, 'url')
        base_url = self.get_input_value(inputs, 'base_url')

        # Combine base URL with path
        if base_url and not url.startswith(('http://', 'https://')):
            url = urljoin(base_url.rstrip('/') + '/', url.lstrip('/'))

        return url

    def _extract_path(self, data: Any, path: str) -> Any:
        """
        Extract nested value from response using dot notation.

        Examples:
            - "models" -> data["models"]
            - "data.items" -> data["data"]["items"]
        """
        parts = path.split('.')
        result = data

        for part in parts:
            if isinstance(result, dict):
                if part not in result:
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Path '{path}' not found in response. "
                        f"Available keys at '{part}': {list(result.keys())}"
                    )
                result = result[part]
            elif isinstance(result, list) and part.isdigit():
                idx = int(part)
                if idx >= len(result):
                    raise ModuleExecutionError(
                        self.module_id,
                        f"Index {idx} out of range in path '{path}'. "
                        f"Array length: {len(result)}"
                    )
                result = result[idx]
            else:
                raise ModuleExecutionError(
                    self.module_id,
                    f"Cannot extract '{part}' from path '{path}'. "
                    f"Value is not a dict or list."
                )

        return result
