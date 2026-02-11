/**
 * Type definitions for api.llm module.
 *
 * This module provides a unified interface for calling LLM APIs.
 * The provider is selected at runtime based on the 'provider' input parameter.
 */

// =============================================================================
// Input Types
// =============================================================================

/**
 * Reference to external content (prompt file, schema file).
 */
export type ContentRef = {
  $ref: string;
  type: "text" | "json" | "jinja2";
  /** Cache TTL in seconds (for prompt caching) */
  cache_ttl?: number;
};

/**
 * System message item - can be string, ref, or content object.
 */
export type SystemMessageItem =
  | string
  | ContentRef
  | { content: string; role?: string };

/**
 * Input content - can be string, ref, Jinja2 expression, or array.
 */
export type InputContent =
  | string
  | ContentRef
  | SystemMessageItem[];

/**
 * Output schema - JSON schema for structured output.
 */
export type OutputSchema = ContentRef | Record<string, unknown>;

/**
 * AI configuration for model parameters.
 */
export type AIConfig = {
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  reasoning_effort?: "low" | "medium" | "high";
  api_key?: string;
  api_endpoint?: string;
};

/**
 * Resolver schema for server-side resolution.
 */
export type ResolverSchema = {
  type: string;
  properties?: Record<string, { resolver: string }>;
};

/**
 * Inputs for api.llm module.
 */
export type LLMInputs = {
  /** LLM provider ID (openai, anthropic, etc.) */
  provider?: string;
  /** Model identifier */
  model?: string;
  /** Input for the API - string, Jinja2 expression, or ref */
  input: InputContent;
  /** System message(s) - string, array of refs, or single ref */
  system?: string | SystemMessageItem[];
  /** AI configuration (temperature, max_tokens, etc.) */
  ai_config?: AIConfig;
  /** Temperature override */
  temperature?: number;
  /** Max tokens override */
  max_tokens?: number;
  /** JSON schema for structured output */
  output_schema?: OutputSchema;
  /** Reasoning effort for reasoning models */
  reasoning_effort?: "low" | "medium" | "high";
  /** Optional metadata (e.g., step_id for logging) */
  metadata?: Record<string, unknown>;
  /** Enable prompt caching for system message (OpenAI only) */
  cache_system_message?: boolean;
  /** Enable prompt caching for first user message (OpenAI only) */
  cache_user_prefix?: boolean;
  /** Resolver schema for server-side resolution */
  resolver_schema?: ResolverSchema;
};

// =============================================================================
// Output Types
// =============================================================================

/**
 * Outputs for api.llm module.
 */
export type LLMOutputs = {
  /** State key for the response (string or parsed JSON) */
  response: string;
  /** State key for raw text response (optional) */
  response_text?: string;
  /** State key for model used (optional) */
  model?: string;
  /** State key for token usage (optional) */
  usage?: string;
};

// =============================================================================
// Module Type
// =============================================================================

/**
 * Complete module structure for api.llm.
 */
export type LLMModule = {
  module_id: "api.llm";
  name: string;
  inputs: LLMInputs;
  outputs_to_state: LLMOutputs;
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a content reference.
 */
export function isContentRef(value: unknown): value is ContentRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof (value as ContentRef).$ref === "string"
  );
}

/**
 * Check if a value is a Jinja2 state reference.
 */
export function isJinja2Reference(value: unknown): value is string {
  return typeof value === "string" && value.includes("{{");
}

/**
 * Check if system input is an array of message items.
 */
export function isSystemArray(
  system: LLMInputs["system"]
): system is SystemMessageItem[] {
  return Array.isArray(system);
}

// =============================================================================
// Display Helpers
// =============================================================================

/**
 * Get a display summary of the input configuration.
 */
export function getInputSummary(input: InputContent): string {
  if (typeof input === "string") {
    if (input.includes("{{")) {
      // Jinja2 reference - extract state reference
      const match = input.match(/\{\{\s*state\.(\w+)/);
      return match ? `state.${match[1]}` : "Jinja2 template";
    }
    // Truncate long strings
    return input.length > 40 ? `${input.slice(0, 40)}...` : input;
  }
  if (Array.isArray(input)) {
    return `${input.length} message(s)`;
  }
  if (isContentRef(input)) {
    // Show just the filename from the path
    const parts = input.$ref.split("/");
    return parts[parts.length - 1];
  }
  return "unknown";
}

/**
 * Get a display summary of the system prompt configuration.
 */
export function getSystemSummary(system: LLMInputs["system"]): string {
  if (!system) return "none";
  if (typeof system === "string") {
    return system.length > 30 ? `${system.slice(0, 30)}...` : system;
  }
  if (Array.isArray(system)) {
    const refCount = system.filter(isContentRef).length;
    if (refCount === system.length) {
      return `${refCount} file(s)`;
    }
    return `${system.length} part(s)`;
  }
  return "unknown";
}

/**
 * Get a display summary of the output schema.
 */
export function getOutputSchemaSummary(schema: OutputSchema | undefined): string {
  if (!schema) return "none (raw text)";
  if (isContentRef(schema)) {
    const parts = schema.$ref.split("/");
    return parts[parts.length - 1];
  }
  // Inline schema - show type or title if available
  if (typeof schema === "object") {
    const s = schema as Record<string, unknown>;
    if (s.title) return String(s.title);
    if (s.type) return `${s.type} schema`;
  }
  return "inline schema";
}
