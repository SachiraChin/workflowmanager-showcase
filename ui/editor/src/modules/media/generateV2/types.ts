import type { AIConfig, InputContent, SystemMessageItem } from "@/modules/api/llm";

export type ActionType = "txt2img" | "img2vid" | "txt2audio";

export type ProviderId =
  | "midjourney"
  | "leonardo"
  | "openai"
  | "stable_diffusion"
  | "elevenlabs";

export const PROVIDERS_BY_ACTION: Record<ActionType, ProviderId[]> = {
  txt2img: ["midjourney", "leonardo", "openai", "stable_diffusion"],
  img2vid: ["openai", "leonardo"],
  txt2audio: ["elevenlabs"],
};

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  txt2img: "Text to Image",
  img2vid: "Image to Video",
  txt2audio: "Text to Audio",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  midjourney: "Midjourney",
  leonardo: "Leonardo",
  openai: "OpenAI",
  stable_diffusion: "Stable Diffusion",
  elevenlabs: "ElevenLabs",
};

export const SHARED_PROMPT_REF_TOKEN = "{{shared_prompt_ref}}";

export type PromptConfig = {
  provider?: string;
  model?: string;
  system?: string | SystemMessageItem[];
  user?: InputContent;
  shared_prompt?: SystemMessageItem;
  provider_prompts?: Partial<Record<ProviderId, SystemMessageItem>>;
  ai_config?: AIConfig;
  metadata?: Record<string, unknown>;
};

export type MediaGenerateV2Inputs = {
  action_type: ActionType;
  providers: ProviderId[];
  prompt_config: PromptConfig;
  display_schema?: Record<string, unknown>;
  title?: string;
  source_image?: string;
};

export type MediaGenerateV2Outputs = {
  selected_content_id: string;
  selected_content: string;
  generations: string;
  generated_prompts: string;
};

export type MediaGenerateV2Module = {
  module_id: "media.generateV2";
  name: string;
  inputs: MediaGenerateV2Inputs;
  outputs_to_state: MediaGenerateV2Outputs;
  sub_actions?: Record<string, unknown>[];
  retryable?: Record<string, unknown>;
};

export function isMediaGenerateV2Module(
  module: unknown
): module is MediaGenerateV2Module {
  return (
    typeof module === "object" &&
    module !== null &&
    "module_id" in module &&
    (module as { module_id: string }).module_id === "media.generateV2"
  );
}
