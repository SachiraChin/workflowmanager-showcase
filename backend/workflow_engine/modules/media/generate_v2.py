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

        generated_prompts = self._generate_prompts(inputs, providers, context)
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
        context,
    ) -> Dict[str, Any]:
        prompt_config = inputs.get("prompt_config")
        if not isinstance(prompt_config, dict):
            raise ValueError("prompt_config must be an object")

        shared_user = prompt_config.get("shared_user") or ""
        provider_prompts = prompt_config.get("provider_prompts")
        if not isinstance(provider_prompts, dict):
            provider_prompts = {}

        provider_blocks: List[str] = []
        for provider in providers:
            body = provider_prompts.get(provider)
            if not isinstance(body, str) or not body.strip():
                body = f"Use {SHARED_PROMPT_REF_TOKEN}."

            body = body.replace(
                SHARED_PROMPT_REF_TOKEN,
                "refer to shared instructions above",
            )

            provider_blocks.append(
                "\n".join(
                    [
                        f"## Provider: {provider}",
                        "Follow provider-specific output requirements.",
                        body,
                    ]
                )
            )

        user_prompt = "\n\n".join(
            [
                "## Shared Instructions",
                str(shared_user),
                *provider_blocks,
                "Return valid JSON only.",
            ]
        )

        llm_inputs: Dict[str, Any] = {
            "provider": prompt_config.get("provider") or "openai",
            "model": prompt_config.get("model"),
            "system": prompt_config.get("system"),
            "input": user_prompt,
            "ai_config": prompt_config.get("ai_config") or {},
            "output_schema": self._build_prompt_output_schema(providers),
        }

        llm_result = LLMCallModule().execute(llm_inputs, context)
        parsed = llm_result.get("response")
        if not isinstance(parsed, dict):
            raise ValueError("V2 LLM response must be an object")
        prompts = parsed.get("prompts")
        if not isinstance(prompts, dict):
            raise ValueError("V2 LLM response must include prompts object")
        return parsed

    def _build_prompt_output_schema(self, providers: List[str]) -> Dict[str, Any]:
        provider_schema_map = {
            "midjourney": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "style_notes": {"type": "string"},
                },
                "required": ["prompt", "style_notes"],
                "additionalProperties": False,
            },
            "leonardo": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "style_notes": {"type": "string"},
                },
                "required": ["prompt", "style_notes"],
                "additionalProperties": False,
            },
            "openai": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "camera_notes": {"type": "string"},
                },
                "required": ["prompt", "camera_notes"],
                "additionalProperties": False,
            },
            "stable_diffusion": {
                "type": "object",
                "properties": {
                    "tag_prompt": {"type": "string"},
                    "natural_prompt": {"type": "string"},
                    "negative_prompt": {"type": "string"},
                    "style_notes": {"type": "string"},
                },
                "required": [
                    "tag_prompt",
                    "natural_prompt",
                    "negative_prompt",
                    "style_notes",
                ],
                "additionalProperties": False,
            },
            "sora": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "motion_notes": {"type": "string"},
                },
                "required": ["prompt", "motion_notes"],
                "additionalProperties": False,
            },
            "elevenlabs": {
                "type": "object",
                "properties": {
                    "script": {"type": "string"},
                    "style_notes": {"type": "string"},
                },
                "required": ["script", "style_notes"],
                "additionalProperties": False,
            },
        }

        prompt_props: Dict[str, Any] = {}
        for provider in providers:
            prompt_props[provider] = deepcopy(
                provider_schema_map.get(
                    provider,
                    {
                        "type": "object",
                        "properties": {"prompt": {"type": "string"}},
                        "required": ["prompt"],
                        "additionalProperties": False,
                    },
                )
            )

        return {
            "type": "object",
            "properties": {
                "prompts": {
                    "type": "object",
                    "properties": prompt_props,
                    "required": providers,
                    "additionalProperties": False,
                }
            },
            "required": ["prompts"],
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
            if item not in out:
                out.append(item)
        if not out:
            raise ValueError("providers cannot be empty")
        return out

    def _validate_provider_constraints(self, action_type: str, providers: List[str]) -> None:
        allowed = {
            "txt2img": {"midjourney", "leonardo", "openai", "stable_diffusion"},
            "img2vid": {"sora", "leonardo"},
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
