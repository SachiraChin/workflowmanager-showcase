/**
 * Type definitions for transform.extract module.
 *
 * This module is a passthrough that takes arbitrary named inputs (typically
 * Jinja2 expressions) and outputs them unchanged. Used with outputs_to_state
 * to store computed values to workflow state.
 */

// =============================================================================
// Module Types
// =============================================================================

/**
 * A single extraction entry - maps an input key to a Jinja2 expression
 * and an output state key.
 */
export type ExtractionEntry = {
  /** Unique identifier for this entry (for React keys) */
  id: string;
  /** The input key name */
  key: string;
  /** The Jinja2 expression to evaluate */
  value: string;
  /** The state key to store the result */
  stateKey: string;
};

/**
 * Inputs for transform.extract module.
 * Dynamic key-value pairs where values are typically Jinja2 expressions.
 */
export type ExtractInputs = Record<string, unknown>;

/**
 * Outputs for transform.extract module.
 * Maps input keys to state keys for storage.
 */
export type ExtractOutputs = Record<string, string>;

/**
 * Complete module structure for transform.extract.
 */
export type ExtractModule = {
  module_id: "transform.extract";
  name: string;
  inputs: ExtractInputs;
  outputs_to_state: ExtractOutputs;
};

// =============================================================================
// Utilities
// =============================================================================

/** Simple unique ID generator for React keys */
function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

// =============================================================================
// Conversion Utilities
// =============================================================================

/**
 * Convert module inputs/outputs to extraction entries for the UI.
 */
export function moduleToEntries(module: ExtractModule): ExtractionEntry[] {
  const entries: ExtractionEntry[] = [];
  const inputs = module.inputs || {};
  const outputs = module.outputs_to_state || {};

  // Skip resolver_schema - it's internal
  for (const key of Object.keys(inputs)) {
    if (key === "resolver_schema") continue;

    entries.push({
      id: generateId(),
      key,
      value: typeof inputs[key] === "string" ? inputs[key] : JSON.stringify(inputs[key]),
      stateKey: outputs[key] || key,
    });
  }

  return entries;
}

/**
 * Convert extraction entries back to module inputs/outputs.
 */
export function entriesToModule(
  entries: ExtractionEntry[],
  originalModule: ExtractModule
): ExtractModule {
  const inputs: ExtractInputs = {};
  const outputs: ExtractOutputs = {};

  // Preserve resolver_schema if it exists
  if (originalModule.inputs?.resolver_schema) {
    inputs.resolver_schema = originalModule.inputs.resolver_schema;
  }

  for (const entry of entries) {
    if (!entry.key.trim()) continue; // Skip empty keys
    inputs[entry.key] = entry.value;
    outputs[entry.key] = entry.stateKey || entry.key;
  }

  return {
    ...originalModule,
    inputs,
    outputs_to_state: outputs,
  };
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a module is a transform.extract module.
 */
export function isExtractModule(module: unknown): module is ExtractModule {
  return (
    typeof module === "object" &&
    module !== null &&
    "module_id" in module &&
    (module as { module_id: string }).module_id === "transform.extract"
  );
}
