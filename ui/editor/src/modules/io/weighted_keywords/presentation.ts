/**
 * Presentation helpers for io.weighted_keywords module.
 *
 * Provides functions for displaying module information in the UI.
 */

import {
  type WeightedKeywordsModule,
  isLoadMode,
  isSaveMode,
  isJinja2Reference,
} from "./types";

/**
 * Get a short summary of the pipeline configuration.
 */
export function getPipelineSummary(pipeline: unknown[]): string {
  if (!Array.isArray(pipeline) || pipeline.length === 0) {
    return "no stages";
  }

  // Extract stage names
  const stageNames = pipeline
    .map((stage) => {
      if (typeof stage === "object" && stage !== null) {
        const keys = Object.keys(stage);
        return keys.length > 0 ? keys[0] : "?";
      }
      return "?";
    })
    .join(" → ");

  if (stageNames.length > 30) {
    return `${pipeline.length} stage(s)`;
  }

  return stageNames;
}

/**
 * Get a short summary of the weighted_keywords source.
 */
export function getKeywordsSourceSummary(source: unknown): string {
  if (isJinja2Reference(source)) {
    // Extract the state key from "{{ state.xxx }}"
    const match = source.match(/\{\{\s*state\.(\w+)\s*\}\}/);
    if (match) {
      return `state.${match[1]}`;
    }
    return source;
  }

  if (Array.isArray(source)) {
    return `${source.length} keyword(s)`;
  }

  return "unknown";
}

/**
 * Get a display label for the module based on its mode.
 */
export function getModeModeLabel(mode: string): string {
  switch (mode) {
    case "load":
      return "Load";
    case "save":
      return "Save";
    default:
      return mode;
  }
}

/**
 * Get a short description of what the module does.
 */
export function getModuleDescription(module: WeightedKeywordsModule): string {
  if (isLoadMode(module.inputs)) {
    const pipelineSummary = getPipelineSummary(module.inputs.pipeline);
    return `Load keywords (${pipelineSummary})`;
  }

  if (isSaveMode(module.inputs)) {
    const sourceSummary = getKeywordsSourceSummary(
      module.inputs.weighted_keywords
    );
    const accumulate = module.inputs.accumulate_weight !== false;
    return `Save from ${sourceSummary}${accumulate ? " (accumulate)" : ""}`;
  }

  return "Unknown mode";
}

/**
 * Get a multi-line label for the collapsed node view.
 */
export function getNodeLabel(module: WeightedKeywordsModule): string {
  const lines: string[] = [];

  lines.push(`Name: ${module.name}`);
  lines.push(`Mode: ${module.inputs.mode}`);

  if (isLoadMode(module.inputs)) {
    lines.push(`Pipeline: ${getPipelineSummary(module.inputs.pipeline)}`);
  } else if (isSaveMode(module.inputs)) {
    lines.push(
      `Source: ${getKeywordsSourceSummary(module.inputs.weighted_keywords)}`
    );
    lines.push(
      `Accumulate: ${module.inputs.accumulate_weight !== false ? "yes" : "no"}`
    );
  }

  return lines.join("\n");
}

/**
 * Format pipeline as a readable JSON string for display.
 */
export function formatPipelineForDisplay(pipeline: unknown[]): string {
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
export function parsePipelineString(str: string): unknown[] | null {
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
