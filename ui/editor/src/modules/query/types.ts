/**
 * Type definitions for transform.query module.
 *
 * This module executes MongoDB aggregation pipelines on in-memory arrays
 * using mongomock. Useful for filtering, projecting, grouping, and
 * aggregating data without requiring a database connection.
 */

// =============================================================================
// Pipeline Types
// =============================================================================

/**
 * MongoDB aggregation pipeline stage.
 * Common stages: $match, $project, $unwind, $replaceRoot, $addFields,
 *                $facet, $sort, $limit, $skip, $group, $count
 */
export type PipelineStage = Record<string, unknown>;

// =============================================================================
// Module Types
// =============================================================================

/**
 * Inputs for transform.query module.
 */
export type QueryInputs = {
  /**
   * Array of objects to query. Can be:
   * - Jinja2 expression referencing state: "{{ state.xxx }}"
   * - Direct array (less common in practice)
   * - Array with embedded Jinja2: [{"root": "{{ state.xxx }}"}]
   */
  data: string | unknown[];
  /**
   * MongoDB aggregation pipeline stages.
   */
  pipeline: PipelineStage[];
  /**
   * Resolver schema for server-side resolution.
   */
  resolver_schema?: {
    type: string;
    properties?: Record<string, { resolver: string }>;
  };
};

/**
 * Outputs for transform.query module.
 */
export type QueryOutputs = {
  /** State key for the query result array */
  result: string;
};

/**
 * Complete module structure for transform.query.
 */
export type QueryModule = {
  module_id: "transform.query";
  name: string;
  inputs: QueryInputs;
  outputs_to_state: QueryOutputs;
};

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a value is a Jinja2 state reference.
 */
export function isJinja2Reference(value: unknown): value is string {
  return typeof value === "string" && value.includes("{{");
}

/**
 * Check if a module is a transform.query module.
 */
export function isQueryModule(module: unknown): module is QueryModule {
  return (
    typeof module === "object" &&
    module !== null &&
    "module_id" in module &&
    (module as { module_id: string }).module_id === "transform.query"
  );
}


