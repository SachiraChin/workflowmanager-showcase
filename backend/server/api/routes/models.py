"""
Models API Routes

Endpoints for retrieving available LLM models configuration.
"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter

from backend.workflow_engine.models.responses import ModelsResponse

logger = logging.getLogger('workflow.api.models')

router = APIRouter(tags=["models"])


def _load_models_config() -> dict:
    """
    Load models configuration from the central config file.
    
    Returns:
        Dict containing providers, models, and defaults
    """
    config_path = Path(__file__).parent.parent.parent / "modules" / "api" / "models_config.json"
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        logger.error(f"Models config not found at {config_path}")
        # Return minimal fallback
        return {
            "default_provider": "openai",
            "default_model": "gpt-5.2",
            "providers": {
                "openai": {
                    "name": "OpenAI",
                    "default": "gpt-5.2",
                    "models": [{"id": "gpt-5.2", "name": "GPT-5.2"}]
                }
            }
        }
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse models config: {e}")
        raise


@router.get("/models", response_model=ModelsResponse)
async def get_models():
    """
    Get available LLM models configuration.
    
    Returns list of providers with their available models, human-friendly names,
    and default selections. Used by UI to populate model selector dropdown.
    
    Returns:
        ModelsResponse with providers, models, and defaults
    """
    config = _load_models_config()
    return ModelsResponse(**config)
