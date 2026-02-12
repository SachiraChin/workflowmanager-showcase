/**
 * Presentation helpers for media.generate module.
 */

import {
  type MediaGenerateModule,
  type ProviderInstance,
  ACTION_TYPE_LABELS,
  PROVIDER_LABELS,
  isJsonRefObject,
  extractProvidersFromSchema,
} from "./types";

/**
 * Get a summary of the module for collapsed node display.
 */
export function getModuleSummary(module: MediaGenerateModule): string {
  const actionType = module.inputs.action_type || "txt2img";
  const actionLabel = ACTION_TYPE_LABELS[actionType];

  // Try to extract provider count from schema
  let providerCount = 0;
  if (!isJsonRefObject(module.inputs.schema)) {
    const providers = extractProvidersFromSchema(
      module.inputs.schema as Record<string, unknown>
    );
    providerCount = providers.length;
  }

  if (providerCount > 0) {
    return `${actionLabel} - ${providerCount} provider${providerCount > 1 ? "s" : ""}`;
  }

  return actionLabel;
}

/**
 * Get provider summary for display.
 */
export function getProviderSummary(providers: ProviderInstance[]): string {
  if (providers.length === 0) {
    return "No providers configured";
  }

  if (providers.length <= 3) {
    return providers.map((p) => PROVIDER_LABELS[p.provider]).join(", ");
  }

  const first = providers.slice(0, 2).map((p) => PROVIDER_LABELS[p.provider]);
  return `${first.join(", ")} +${providers.length - 2} more`;
}

/**
 * Get title display text.
 */
export function getTitleSummary(module: MediaGenerateModule): string {
  return module.inputs.title || "Generate Media";
}

/**
 * Get prompts source summary.
 */
export function getPromptsSummary(module: MediaGenerateModule): string {
  const prompts = module.inputs.prompts;

  if (typeof prompts === "string") {
    if (prompts.startsWith("{{")) {
      // Extract state reference
      const match = prompts.match(/\{\{\s*state\.(\w+)/);
      return match ? `state.${match[1]}` : "state reference";
    }
    return "string";
  }

  return "inline data";
}

/**
 * Get schema source summary.
 */
export function getSchemaSummary(module: MediaGenerateModule): string {
  if (isJsonRefObject(module.inputs.schema)) {
    return `$ref: ${module.inputs.schema.$ref}`;
  }
  return "inline schema";
}

/**
 * Validate a provider instance.
 */
export function validateProviderInstance(
  instance: ProviderInstance
): string[] {
  const errors: string[] = [];

  if (!instance.tabLabel.trim()) {
    errors.push("Tab label is required");
  }

  if (!instance.schema._ux?.input_schema) {
    errors.push("Input schema is required");
  }

  return errors;
}

/**
 * Check for duplicate tab labels.
 */
export function findDuplicateTabLabels(
  providers: ProviderInstance[]
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const provider of providers) {
    const label = provider.tabLabel.trim().toLowerCase();
    if (label && seen.has(label)) {
      duplicates.add(label);
    }
    seen.add(label);
  }

  return duplicates;
}
