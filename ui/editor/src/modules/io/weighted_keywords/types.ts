/**
 * Type definitions for io.weighted_keywords module.
 *
 * This module stores and retrieves weighted keywords for duplicate prevention.
 * Keywords are scoped by workflow_template_id.
 *
 * Modes:
 * - load: Retrieve keywords with optional MongoDB aggregation pipeline
 * - save: Store keywords with weight accumulation
 */

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * MongoDB aggregation pipeline stage.
 * Only safe stages are allowed (validated on backend).
 */
export type PipelineStage = Record<string, unknown>;

// =============================================================================
// Module Types
// =============================================================================

/**
 * Inputs specific to load mode.
 */
export type WeightedKeywordsLoadInputs = {
  mode: "load";
  /**
   * MongoDB aggregation pipeline stages.
   * Allowed: $match, $sort, $project, $limit, $skip, $group, $unwind,
   *          $addFields, $set, $count, $replaceRoot, $sample, $bucket,
   *          $bucketAuto, $sortByCount, $facet
   */
  pipeline: PipelineStage[];
  resolver_schema?: {
    type: string;
    properties?: Record<string, { resolver: string }>;
  };
};

/**
 * Inputs specific to save mode.
 */
export type WeightedKeywordsSaveInputs = {
  mode: "save";
  /**
   * Keywords to save. Can be:
   * - Jinja2 expression referencing state: "{{ state.xxx }}"
   * - Direct array (less common in practice)
   */
  weighted_keywords: string | Array<{ keyword: string; weight: number }>;
  /**
   * If true (default), weight adds to existing. If false, replaces.
   */
  accumulate_weight?: boolean;
  resolver_schema?: {
    type: string;
    properties?: Record<string, { resolver: string }>;
  };
};

/**
 * Union of load and save inputs.
 */
export type WeightedKeywordsInputs =
  | WeightedKeywordsLoadInputs
  | WeightedKeywordsSaveInputs;

/**
 * Outputs for load mode.
 */
export type WeightedKeywordsLoadOutputs = {
  /** State key for the retrieved keywords array */
  weighted_keywords: string;
  /** State key for the count of keywords */
  count: string;
};

/**
 * Outputs for save mode.
 */
export type WeightedKeywordsSaveOutputs = {
  /** State key for the number of keywords saved */
  saved_count: string;
};

/**
 * Complete module structure for io.weighted_keywords.
 */
export type WeightedKeywordsModule = {
  module_id: "io.weighted_keywords";
  name: string;
  inputs: WeightedKeywordsInputs;
  outputs_to_state: WeightedKeywordsLoadOutputs | WeightedKeywordsSaveOutputs;
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if inputs are for load mode.
 */
export function isLoadMode(
  inputs: WeightedKeywordsInputs
): inputs is WeightedKeywordsLoadInputs {
  return inputs.mode === "load";
}

/**
 * Check if inputs are for save mode.
 */
export function isSaveMode(
  inputs: WeightedKeywordsInputs
): inputs is WeightedKeywordsSaveInputs {
  return inputs.mode === "save";
}

/**
 * Check if outputs are for load mode.
 */
export function isLoadOutputs(
  outputs: WeightedKeywordsLoadOutputs | WeightedKeywordsSaveOutputs
): outputs is WeightedKeywordsLoadOutputs {
  return "weighted_keywords" in outputs && "count" in outputs;
}

/**
 * Check if outputs are for save mode.
 */
export function isSaveOutputs(
  outputs: WeightedKeywordsLoadOutputs | WeightedKeywordsSaveOutputs
): outputs is WeightedKeywordsSaveOutputs {
  return "saved_count" in outputs;
}

/**
 * Check if a value is a Jinja2 state reference.
 */
export function isJinja2Reference(value: unknown): value is string {
  return typeof value === "string" && value.includes("{{");
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a WeightedKeywordsModule configuration.
 * Returns an array of validation issue messages (empty if valid).
 */
export function validateWeightedKeywordsModule(
  module: WeightedKeywordsModule
): string[] {
  const issues: string[] = [];

  // Name is required
  if (!module.name?.trim()) {
    issues.push("Module name is required");
  }

  // Mode is required
  if (!module.inputs.mode) {
    issues.push("Mode is required (load or save)");
  } else if (module.inputs.mode !== "load" && module.inputs.mode !== "save") {
    issues.push("Mode must be 'load' or 'save'");
  }

  // Mode-specific validation
  if (isLoadMode(module.inputs)) {
    // Pipeline should be an array
    if (!Array.isArray(module.inputs.pipeline)) {
      issues.push("Pipeline must be an array");
    }

    // Load outputs validation
    if (isLoadOutputs(module.outputs_to_state)) {
      if (!module.outputs_to_state.weighted_keywords?.trim()) {
        issues.push("Output state key for weighted_keywords is required");
      }
      if (!module.outputs_to_state.count?.trim()) {
        issues.push("Output state key for count is required");
      }
    }
  } else if (isSaveMode(module.inputs)) {
    // weighted_keywords source is required
    if (!module.inputs.weighted_keywords) {
      issues.push("weighted_keywords source is required for save mode");
    }

    // Save outputs validation
    if (isSaveOutputs(module.outputs_to_state)) {
      if (!module.outputs_to_state.saved_count?.trim()) {
        issues.push("Output state key for saved_count is required");
      }
    }
  }

  return issues;
}
