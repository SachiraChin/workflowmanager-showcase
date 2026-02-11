/**
 * Presentation helpers for transform.query module.
 *
 * Provides functions for displaying module information in the UI.
 */

import { type QueryModule, type PipelineStage, isJinja2Reference } from "./types";

/**
 * Get a short summary of the pipeline configuration.
 * Shows stage names if short enough, otherwise shows count.
 */
export function getPipelineSummary(pipeline: PipelineStage[]): string {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return "no stages";
  }

  // Extract stage names (e.g., "$match", "$project")
  const stageNames = pipeline
    .map((stage) => {
      if (typeof stage === "object" && stage !== null) {
        const keys = Object.keys(stage);
        return keys.length > 0 ? keys[0] : "?";
      }
      return "?";
    })
    .join(" → ");

  // If too long, just show count
  if (stageNames.length > 35) {
    return `${pipeline.length} stage${pipeline.length === 1 ? "" : "s"}`;
  }

  return stageNames;
}

/**
 * Get a short summary of the data source.
 * Extracts state key from Jinja2 expressions.
 */
export function getDataSourceSummary(data: unknown): string {
  if (isJinja2Reference(data)) {
    // Extract the state key from "{{ state.xxx }}" or "{{ state.xxx.yyy }}"
    const match = data.match(/\{\{\s*state\.([^\s}]+)\s*\}\}/);
    if (match) {
      const path = match[1];
      // Truncate long paths
      if (path.length > 25) {
        return `state.${path.slice(0, 22)}...`;
      }
      return `state.${path}`;
    }
    // If it's a more complex expression, truncate
    if (data.length > 30) {
      return `${data.slice(0, 27)}...`;
    }
    return data;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return "empty array";
    }
    // Check if it's a wrapped object with Jinja2 inside
    const firstItem = data[0];
    if (typeof firstItem === "object" && firstItem !== null) {
      const values = Object.values(firstItem);
      for (const val of values) {
        if (isJinja2Reference(val)) {
          return `[wrapped] ${getDataSourceSummary(val)}`;
        }
      }
    }
    return `${data.length} item${data.length === 1 ? "" : "s"}`;
  }

  return "unknown";
}

/**
 * Get a short description of what the module does.
 */
export function getModuleDescription(module: QueryModule): string {
  const pipelineSummary = getPipelineSummary(module.inputs.pipeline);
  const dataSummary = getDataSourceSummary(module.inputs.data);
  return `Query ${dataSummary} (${pipelineSummary})`;
}

/**
 * Format pipeline as a readable JSON string for display/editing.
 */
export function formatPipelineForDisplay(pipeline: PipelineStage[]): string {
  try {
    return JSON.stringify(pipeline, null, 2);
  } catch {
    return "[]";
  }
}

/**
 * Parse a pipeline string back to an array.
 * Returns null if parsing fails.
 */
export function parsePipelineString(str: string): PipelineStage[] | null {
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed as PipelineStage[];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Format data source for display in the editor.
 * Handles both string (Jinja2) and array formats.
 */
export function formatDataForDisplay(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return "";
  }
}

/**
 * Parse data source string back to its original format.
 * If it's valid JSON array, parse it. Otherwise treat as Jinja2 string.
 */
export function parseDataString(str: string): string | unknown[] {
  const trimmed = str.trim();
  // If it starts with [, try to parse as JSON array
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall through to return as string
    }
  }
  // Return as string (Jinja2 expression)
  return str;
}
