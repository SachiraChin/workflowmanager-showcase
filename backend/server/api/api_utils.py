"""
Helper functions for workflow API.

Contains utility functions used by multiple route modules.
"""

import os
import json
import base64
import hashlib
import zipfile
import io
import logging
from typing import Dict, Any, Tuple, Optional

# Import workflow resolver for $ref resolution
import sys
_engine_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _engine_dir not in sys.path:
    sys.path.insert(0, _engine_dir)
from engine.workflow_resolver import WorkflowResolver

logger = logging.getLogger('workflow.api')


def extract_zip_to_virtual_fs(zip_bytes: bytes) -> Dict[str, str]:
    """
    Extract a zip file to an in-memory virtual filesystem.

    Args:
        zip_bytes: Raw bytes of the zip file

    Returns:
        Dictionary mapping file paths to their content (as strings)

    Raises:
        ValueError: If zip extraction fails or contains invalid content
    """
    virtual_fs = {}

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
            for name in zf.namelist():
                # Skip directories
                if name.endswith('/'):
                    continue

                # Normalize path (forward slashes, no leading ./)
                normalized = name.replace('\\', '/')
                while normalized.startswith('./'):
                    normalized = normalized[2:]

                # Read file content
                try:
                    content = zf.read(name)
                    # Try to decode as UTF-8 text
                    try:
                        virtual_fs[normalized] = content.decode('utf-8')
                    except UnicodeDecodeError:
                        # Binary files are stored as base64
                        virtual_fs[normalized] = base64.b64encode(content).decode('ascii')
                        logger.debug(f"Stored binary file as base64: {normalized}")
                except Exception as e:
                    logger.warning(f"Could not read file {name} from zip: {e}")

    except zipfile.BadZipFile as e:
        raise ValueError(f"Invalid zip file: {e}")
    except Exception as e:
        raise ValueError(f"Failed to extract zip: {e}")

    return virtual_fs


def resolve_workflow_from_content(
    workflow_content: Any,
    entry_point: Optional[str]
) -> Tuple[Dict[str, Any], str, str]:
    """
    Resolve workflow from content (zip or JSON dict).

    Args:
        workflow_content: Either base64-encoded zip string or JSON dict
        entry_point: Path to main workflow file (required for zip)

    Returns:
        Tuple of (resolved_workflow, content_hash, source_type)

    Raises:
        ValueError: If content is invalid
        FileNotFoundError: If entry point not found in zip
    """
    if isinstance(workflow_content, dict):
        # Already resolved JSON
        # Compute hash from JSON string
        json_str = json.dumps(workflow_content, sort_keys=True)
        content_hash = f"sha256:{hashlib.sha256(json_str.encode()).hexdigest()}"
        return workflow_content, content_hash, "json"

    elif isinstance(workflow_content, str):
        # Base64 encoded zip
        try:
            zip_bytes = base64.b64decode(workflow_content)
        except Exception as e:
            raise ValueError(f"Invalid base64 encoding: {e}")

        # Compute hash from raw zip bytes
        content_hash = f"sha256:{hashlib.sha256(zip_bytes).hexdigest()}"

        # Extract to virtual filesystem
        virtual_fs = extract_zip_to_virtual_fs(zip_bytes)
        logger.info(f"Extracted {len(virtual_fs)} files from zip")
        logger.info(f"Files in zip: {list(virtual_fs.keys())[:20]}...")

        if not entry_point:
            raise ValueError("workflow_entry_point is required when workflow_content is a zip")

        logger.info(f"Entry point requested: '{entry_point}'")

        # Check if entry point exists in virtual_fs
        if entry_point in virtual_fs:
            logger.info(f"Entry point found directly: {entry_point}")
        else:
            logger.warning(f"Entry point NOT found directly. Available: {list(virtual_fs.keys())[:10]}")

        # Resolve all $refs
        resolver = WorkflowResolver(virtual_fs)
        try:
            resolved_workflow = resolver.resolve(entry_point)
        except FileNotFoundError as e:
            logger.error(f"FileNotFoundError resolving entry point: {e}")
            raise ValueError(f"Entry point not found: {e}")
        except Exception as e:
            raise ValueError(f"Failed to resolve workflow: {e}")

        return resolved_workflow, content_hash, "zip"

    else:
        raise ValueError(f"workflow_content must be string (base64 zip) or dict, got {type(workflow_content).__name__}")


def summarize_response(response) -> str:
    """Create a brief summary of an interaction response for logging"""
    if response is None:
        return "None"

    # Handle InteractionResponse object
    if hasattr(response, 'selected_values'):
        selected = response.selected_values
        if selected:
            if len(selected) == 1:
                val = selected[0]
                if len(str(val)) > 50:
                    return f"selected: {str(val)[:50]}..."
                return f"selected: {val}"
            return f"selected: [{len(selected)} items]"

    if hasattr(response, 'text_value') and response.text_value:
        text = response.text_value
        if len(text) > 50:
            return f"text: {text[:50]}..."
        return f"text: {text}"

    if hasattr(response, 'custom_value') and response.custom_value:
        return f"custom: {response.custom_value[:50]}..."

    # Fallback
    return str(response)[:100]


def load_ai_config(config_path: str) -> dict:
    """Load AI configuration from JSON file"""
    if not os.path.exists(config_path):
        return {}

    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # Read API key from file if specified
    if 'api_key_file' in config:
        api_key_file = config['api_key_file']
        if os.path.exists(api_key_file):
            with open(api_key_file, 'r', encoding='utf-8') as f:
                api_key = f.read().strip()

            provider = config.get('provider', 'openai')
            if provider == 'openai':
                config['openai_api_key'] = api_key
                os.environ['OPENAI_API_KEY'] = api_key
            elif provider == 'anthropic':
                config['anthropic_api_key'] = api_key
                os.environ['ANTHROPIC_API_KEY'] = api_key

    return config


def set_api_keys_from_config(ai_config: dict) -> None:
    """Set API keys in environment from ai_config dict."""
    if not ai_config:
        return

    if 'api_key' in ai_config:
        provider = ai_config.get('provider', 'openai')
        if provider == 'openai':
            ai_config['openai_api_key'] = ai_config['api_key']
            os.environ['OPENAI_API_KEY'] = ai_config['api_key']
        elif provider == 'anthropic':
            ai_config['anthropic_api_key'] = ai_config['api_key']
            os.environ['ANTHROPIC_API_KEY'] = ai_config['api_key']

    if 'openai_api_key' in ai_config:
        os.environ['OPENAI_API_KEY'] = ai_config['openai_api_key']
    if 'anthropic_api_key' in ai_config:
        os.environ['ANTHROPIC_API_KEY'] = ai_config['anthropic_api_key']
