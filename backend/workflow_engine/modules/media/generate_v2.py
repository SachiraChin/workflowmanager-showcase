"""
media.generateV2 module.

Combines prompt generation and media generation interaction in a single module.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional

from ...engine.module_interface import InteractionRequest, ModuleInput, ModuleOutput
from ..api.llm_call import LLMCallModule
from .generate import MediaGenerateModule
from backend.providers.media.registry import MediaProviderRegistry


SHARED_PROMPT_REF_TOKEN = "{{shared_prompt_ref}}"


class MediaGenerateV2Module(MediaGenerateModule):
    @property
    def module_id(self) -> str:
        return "media.generateV2"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput("action_type", "string", required=False, default="txt2img"),
            ModuleInput("providers", "array", required=True),
            ModuleInput("prompt_config", "object", required=True),
            ModuleInput("display_schema", "object", required=False, default=None),
            ModuleInput("title", "string", required=False, default="Generate Media"),
            ModuleInput("source_image", "string", required=False, default=None),
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput("selected_content_id", "string"),
            ModuleOutput("selected_content", "object"),
            ModuleOutput("generations", "object"),
            ModuleOutput("generated_prompts", "object"),
        ]

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context,
    ) -> Optional[InteractionRequest]:
        action_type = self.get_input_value(inputs, "action_type") or "txt2img"
        providers = self._normalize_providers(inputs.get("providers"))
        self._validate_provider_constraints(action_type, providers)

        generated_prompts = self._generate_prompts(
            inputs,
            providers,
            action_type,
            context,
        )
        display_schema = inputs.get("display_schema")
        if not isinstance(display_schema, dict):
            display_schema = self._build_default_display_schema(providers, action_type)

        proxy_inputs = {
            "prompts": generated_prompts,
            "schema": display_schema,
            "title": self.get_input_value(inputs, "title") or "Generate Media",
            "action_type": action_type,
        }
        if inputs.get("source_image"):
            proxy_inputs["source_image"] = inputs["source_image"]

        # IMPORTANT: resolved_inputs are persisted on INTERACTION_REQUESTED event
        # and later fed into execute_with_response; store generated prompts there.
        inputs["_generated_prompts"] = generated_prompts

        req = super().get_interaction_request(proxy_inputs, context)
        if req:
            display_data = deepcopy(req.display_data or {})
            data = display_data.get("data")
            if isinstance(data, dict):
                data["_generated_prompts"] = generated_prompts
                display_data["data"] = data
            req.display_data = display_data
        return req

    def execute_with_response(self, inputs: Dict[str, Any], context, response):
        outputs = super().execute_with_response(inputs, context, response)
        outputs["generated_prompts"] = inputs.get("_generated_prompts", {})
        return outputs

    def _generate_prompts(
        self,
        inputs: Dict[str, Any],
        providers: List[str],
        action_type: str,
        context,
    ) -> Dict[str, Any]:
        prompt_config = inputs.get("prompt_config")
        if not isinstance(prompt_config, dict):
            raise ValueError("prompt_config must be an object")

        user_prompt = prompt_config.get("user")
        if not isinstance(user_prompt, str) or not user_prompt.strip():
            raise ValueError("prompt_config.user must be a non-empty string")

        shared_prompt = prompt_config.get("shared_prompt") or ""
        provider_prompts = prompt_config.get("provider_prompts")
        if not isinstance(provider_prompts, dict):
            provider_prompts = {}

        provider_blocks: List[str] = []
        for provider in providers:
            body = provider_prompts.get(provider)
            if not isinstance(body, str) or not body.strip():
                body = f"Use {SHARED_PROMPT_REF_TOKEN}."

            provider_blocks.append(
                "\n".join(
                    [
                        f"## Provider: {provider}",
                        "Follow provider-specific output requirements.",
                        body,
                    ]
                )
            )

        stitched_prompt_instructions = "\n\n".join(
            [
                "## Shared Provider Instructions",
                str(shared_prompt),
                "Reference: {{shared_prompt_ref}} means 'shared instructions above'.",
                *provider_blocks,
            ]
        )

        system_input = prompt_config.get("system")
        if isinstance(system_input, list):
            llm_system: List[Any] = [*system_input]
        elif system_input is None:
            llm_system = []
        else:
            llm_system = [system_input]

        llm_system.append(
            {
                "type": "text",
                "content": stitched_prompt_instructions,
                "cache_ttl": 10800,
            }
        )

        llm_inputs: Dict[str, Any] = {
            "provider": prompt_config.get("provider") or "openai",
            "model": prompt_config.get("model"),
            "system": llm_system,
            "input": user_prompt,
            "ai_config": prompt_config.get("ai_config") or {},
            "output_schema": self._build_prompt_output_schema(providers, action_type),
            "metadata": prompt_config.get("metadata")
            or {"step_id": getattr(context, "step_id", None)},
        }

        llm_result = LLMCallModule().execute(llm_inputs, context)
        parsed = llm_result.get("response")
        if not isinstance(parsed, dict):
            raise ValueError("V2 LLM response must be an object")
        prompts = parsed.get("prompts")
        if not isinstance(prompts, dict):
            raise ValueError("V2 LLM response must include prompts object")
        return parsed

    def _build_prompt_output_schema(
        self,
        providers: List[str],
        action_type: str,
    ) -> Dict[str, Any]:
        prompt_props: Dict[str, Any] = {}
        for provider_name in providers:
            provider_class = MediaProviderRegistry.get_class(provider_name)
            provider_schema = provider_class.get_data_schema_for_action(action_type)
            if not isinstance(provider_schema, dict) or not provider_schema:
                raise ValueError(
                    f"Provider '{provider_name}' does not expose data schema for action_type '{action_type}'"
                )
            prompt_props[provider_name] = deepcopy(provider_schema)

        top_level_properties: Dict[str, Any] = {"prompts": {
            "type": "object",
            "properties": prompt_props,
            "required": providers,
            "additionalProperties": False,
        }}

        required_top: List[str] = ["prompts"]
        if action_type == "txt2img":
            top_level_properties["scene_title"] = {
                "type": "string",
                "description": "The title of the scene these prompts are for",
            }
            top_level_properties["key_moment"] = {
                "type": "string",
                "description": "Brief description of the key visual moment being captured",
            }
            required_top = ["scene_title", "key_moment", "prompts"]
        elif action_type == "img2vid":
            top_level_properties["scene_title"] = {
                "type": "string",
                "description": "The scene this video prompt is for",
            }
            top_level_properties["motion_summary"] = {
                "type": "string",
                "description": "Brief description of the primary motion/movement in this video",
            }
            required_top = ["scene_title", "motion_summary", "prompts"]

        return {
            "type": "object",
            "properties": top_level_properties,
            "required": required_top,
            "additionalProperties": False,
        }

    def _build_default_display_schema(
        self,
        providers: List[str],
        action_type: str,
    ) -> Dict[str, Any]:
        tab_render = {
            "txt2img": "tab.media[input_schema,image_generation]",
            "img2vid": "tab.media[input_schema,video_generation]",
            "txt2audio": "tab.media[input_schema,audio_generation]",
        }.get(action_type, "tab.media[input_schema,image_generation]")

        prompts_props: Dict[str, Any] = {}
        for provider in providers:
            prompts_props[provider] = {
                "type": "object",
                "_ux": {
                    "display": "visible",
                    "tab_label": provider.replace("_", " ").title(),
                    "render_as": tab_render,
                    "provider": provider,
                    "input_schema": {
                        "type": "object",
                        "_ux": {
                            "layout": "grid",
                            "layout_columns": 3,
                            "layout_columns_sm": 2,
                        },
                        "properties": {
                            "_text": {
                                "type": "string",
                                "title": "Prompt",
                                "destination_field": "prompt",
                                "_ux": {
                                    "input_type": "textarea",
                                    "col_span": "full",
                                    "rows": 4,
                                    "source_field": "prompt",
                                },
                            }
                        },
                    },
                },
                "properties": {
                    "prompt": {"type": "string", "_ux": {"display": False}}
                },
            }

        return {
            "type": "object",
            "_ux": {"display": "passthrough"},
            "properties": {
                "prompts": {
                    "type": "object",
                    "_ux": {"display": "visible", "render_as": "tabs"},
                    "properties": prompts_props,
                }
            },
        }

    def _normalize_providers(self, providers: Any) -> List[str]:
        if not isinstance(providers, list):
            raise ValueError("providers must be an array")
        out: List[str] = []
        for item in providers:
            if not isinstance(item, str) or not item:
                raise ValueError("provider ids must be non-empty strings")
            if item in out:
                raise ValueError(f"duplicate provider not allowed: {item}")
            out.append(item)
        if not out:
            raise ValueError("providers cannot be empty")
        return out

    def _validate_provider_constraints(self, action_type: str, providers: List[str]) -> None:
        allowed = {
            "txt2img": {"midjourney", "leonardo", "openai", "stable_diffusion"},
            "img2vid": {"openai", "leonardo"},
            "txt2audio": {"elevenlabs"},
        }
        valid = allowed.get(action_type)
        if not valid:
            raise ValueError(f"Unsupported action_type: {action_type}")
        invalid = [p for p in providers if p not in valid]
        if invalid:
            raise ValueError(
                f"Invalid providers for action_type '{action_type}': {', '.join(invalid)}"
            )
