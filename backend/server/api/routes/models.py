"""
Models API Routes

Endpoints for retrieving available LLM models configuration.
"""

import json
import logging
from importlib import resources

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
    try:
        config_text = resources.files("backend.workflow_engine.modules.api").joinpath(
            "models_config.json"
        ).read_text(encoding="utf-8")
        return json.loads(config_text)
    except (FileNotFoundError, ModuleNotFoundError):
        logger.error(
            "Models config not found in backend.workflow_engine.modules.api"
        )
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
