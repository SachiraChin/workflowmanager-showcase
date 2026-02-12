/**
 * Type definitions for media.generate module.
 *
 * This module handles interactive media generation with provider-specific
 * schemas for txt2img, img2vid, and txt2audio workflows.
 */

// =============================================================================
// Action Types and Provider Registry
// =============================================================================

/** Supported action types for media generation */
export type ActionType = "txt2img" | "img2vid" | "txt2audio";

/** Provider identifiers */
export type ProviderId =
  | "midjourney"
  | "leonardo"
  | "openai"
  | "stable_diffusion"
  | "sora"
  | "elevenlabs";

/** Providers available for each action type */
export const PROVIDERS_BY_ACTION: Record<ActionType, ProviderId[]> = {
  txt2img: ["midjourney", "leonardo", "openai", "stable_diffusion"],
  img2vid: ["sora", "leonardo"],
  txt2audio: ["elevenlabs"],
};

/** Display labels for providers */
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  midjourney: "Midjourney",
  leonardo: "Leonardo",
  openai: "OpenAI",
  stable_diffusion: "Stable Diffusion",
  sora: "Sora",
  elevenlabs: "ElevenLabs",
};

/** Display labels for action types */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  txt2img: "Text to Image",
  img2vid: "Image to Video",
  txt2audio: "Text to Audio",
};

// =============================================================================
// Provider Schema Types
// =============================================================================

/**
 * UX configuration for a provider tab.
 * This is the _ux object within a provider's schema node.
 */
export type ProviderUxConfig = {
  display?: "visible" | "hidden" | "passthrough";
  tab_label?: string;
  render_as?: string;
  provider?: string;
  /** Input schema defines the generation form fields */
  input_schema?: InputSchema;
};

/**
 * Input schema for provider generation form.
 * Defines fields like prompt, aspect_ratio, model, etc.
 */
export type InputSchema = {
  type: "object";
  _ux?: {
    layout?: "grid" | "stack";
    layout_columns?: number;
    layout_columns_sm?: number;
  };
  properties?: Record<string, InputSchemaField>;
};

/**
 * A field within the input schema.
 */
export type InputSchemaField = {
  type: string;
  title?: string;
  default?: unknown;
  enum?: unknown[];
  enum_labels?: Record<string, string>;
  minimum?: number;
  maximum?: number;
  step?: number;
  value_key?: string;
  label_key?: string;
  destination_field?: string;
  controls?: Record<string, ControlConfig>;
  alternative?: AlternativeConfig;
  _ux?: {
    input_type?: string;
    col_span?: string;
    rows?: number;
    source_field?: string;
    enum_source?: string;
  };
};

/** Control configuration for dependent fields */
export type ControlConfig = {
  type: "enum" | "visibility";
  enum_path?: string;
  value_key?: string;
  label_key?: string;
  label_format?: string;
  default_index?: number;
  reset?: boolean;
  visible_when?: string;
};

/** Alternative input configuration */
export type AlternativeConfig = {
  compose?: { text: string };
  layout?: string;
  fields?: Array<{
    key?: string;
    type?: string;
    title?: string;
    content?: string;
    minimum?: number;
    maximum?: number;
    step?: number;
    default?: unknown;
    _ux?: Record<string, unknown>;
  }>;
};

/**
 * Schema for a single provider within the display schema.
 */
export type ProviderSchema = {
  type: "object";
  _ux?: ProviderUxConfig;
  properties?: Record<string, unknown>;
};

/**
 * A configured provider instance in the module.
 * Users can have multiple instances of the same provider.
 */
export type ProviderInstance = {
  /** Unique ID for this instance (for React keys) */
  id: string;
  /** Provider identifier */
  provider: ProviderId;
  /** Custom tab label (defaults to provider name) */
  tabLabel: string;
  /** The provider's schema configuration */
  schema: ProviderSchema;
};

// =============================================================================
// Module Types
// =============================================================================

/**
 * Inputs for media.generate module.
 */
export type MediaGenerateInputs = {
  /** Prompts - either Jinja2 expression or inline data */
  prompts: string | Record<string, unknown>;
  /** Display schema with _ux hints */
  schema: { $ref: string; type: string } | Record<string, unknown>;
  /** Interaction title */
  title?: string;
  /** Action type for provider metadata */
  action_type?: ActionType;
  /** Source image for img2vid */
  source_image?: string;
  /** Resolver schema */
  resolver_schema?: Record<string, unknown>;
};

/**
 * Outputs for media.generate module.
 */
export type MediaGenerateOutputs = {
  selected_content_id: string;
  selected_content: string;
  generations: string;
};

/**
 * Sub-action configuration.
 */
export type SubActionConfig = {
  id: string;
  label: string;
  loading_label?: string;
  hidden?: boolean;
  actions: Array<{ type: string }>;
};

/**
 * Complete module structure for media.generate.
 */
export type MediaGenerateModule = {
  module_id: "media.generate";
  name: string;
  inputs: MediaGenerateInputs;
  outputs_to_state: MediaGenerateOutputs;
  sub_actions?: SubActionConfig[];
  retryable?: Record<string, unknown>;
};

// =============================================================================
// Utilities
// =============================================================================

/** Simple unique ID generator for React keys */
function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * Check if a value is a JSON $ref object.
 */
export function isJsonRefObject(
  value: unknown
): value is { $ref: string; type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof (value as { $ref: unknown }).$ref === "string"
  );
}

/**
 * Extract provider instances from a display schema.
 * This parses the schema and creates ProviderInstance objects.
 */
export function extractProvidersFromSchema(
  schema: Record<string, unknown> | undefined
): ProviderInstance[] {
  if (!schema) return [];

  const instances: ProviderInstance[] = [];

  // Navigate to prompts.properties where providers are defined
  const properties = schema.properties as Record<string, unknown> | undefined;
  if (!properties) return [];

  const prompts = properties.prompts as Record<string, unknown> | undefined;
  if (!prompts) return [];

  const promptProps = prompts.properties as
    | Record<string, unknown>
    | undefined;
  if (!promptProps) return [];

  for (const [key, value] of Object.entries(promptProps)) {
    if (typeof value !== "object" || value === null) continue;

    const providerSchema = value as ProviderSchema;
    const ux = providerSchema._ux;

    instances.push({
      id: generateId(),
      provider: (ux?.provider || key) as ProviderId,
      tabLabel: ux?.tab_label || PROVIDER_LABELS[key as ProviderId] || key,
      schema: providerSchema,
    });
  }

  return instances;
}

/**
 * Build a display schema from provider instances.
 */
export function buildSchemaFromProviders(
  providers: ProviderInstance[],
  baseSchema?: Record<string, unknown>
): Record<string, unknown> {
  const promptProperties: Record<string, ProviderSchema> = {};

  for (const instance of providers) {
    // Use provider ID as key, but allow duplicates by appending index
    let key = instance.provider;
    let counter = 1;
    while (promptProperties[key]) {
      key = `${instance.provider}_${counter++}` as ProviderId;
    }

    promptProperties[key] = {
      ...instance.schema,
      _ux: {
        ...instance.schema._ux,
        tab_label: instance.tabLabel,
        provider: instance.provider,
      },
    };
  }

  return {
    type: "object",
    _ux: { display: "passthrough" },
    properties: {
      ...((baseSchema?.properties as Record<string, unknown>) || {}),
      prompts: {
        type: "object",
        _ux: {
          display: "visible",
          render_as: "tabs",
        },
        properties: promptProperties,
      },
    },
  };
}

/**
 * Create a default provider instance with empty input schema.
 */
export function createDefaultProviderInstance(
  provider: ProviderId,
  actionType: ActionType
): ProviderInstance {
  const renderAs =
    actionType === "txt2img"
      ? "tab.media[input_schema,image_generation]"
      : actionType === "img2vid"
        ? "tab.media[input_schema,video_generation]"
        : "tab.media[input_schema,audio_generation]";

  return {
    id: generateId(),
    provider,
    tabLabel: PROVIDER_LABELS[provider],
    schema: {
      type: "object",
      _ux: {
        display: "visible",
        tab_label: PROVIDER_LABELS[provider],
        render_as: renderAs,
        provider: provider,
        input_schema: {
          type: "object",
          _ux: {
            layout: "grid",
            layout_columns: 3,
            layout_columns_sm: 2,
          },
          properties: {
            _text: {
              type: "string",
              title: "Prompt",
              destination_field: "prompt",
              _ux: {
                input_type: "textarea",
                col_span: "full",
                rows: 4,
                source_field: "prompt",
              },
            },
          },
        },
      },
      properties: {
        prompt: {
          type: "string",
          _ux: { display: false },
        },
      },
    },
  };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a module is a media.generate module.
 */
export function isMediaGenerateModule(
  module: unknown
): module is MediaGenerateModule {
  return (
    typeof module === "object" &&
    module !== null &&
    "module_id" in module &&
    (module as { module_id: string }).module_id === "media.generate"
  );
}
