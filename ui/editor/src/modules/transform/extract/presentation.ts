/**
 * Presentation helpers for transform.extract module.
 */

import type { ExtractModule, ExtractionEntry } from "./types";

/**
 * Get a summary of the extraction entries for collapsed node display.
 */
export function getExtractSummary(module: ExtractModule): string {
  const inputs = module.inputs || {};
  const keys = Object.keys(inputs).filter((k) => k !== "resolver_schema");

  if (keys.length === 0) {
    return "No extractions configured";
  }

  if (keys.length === 1) {
    return `1 extraction: ${keys[0]}`;
  }

  if (keys.length <= 3) {
    return `${keys.length} extractions: ${keys.join(", ")}`;
  }

  return `${keys.length} extractions: ${keys.slice(0, 2).join(", ")}...`;
}

/**
 * Validate an extraction entry.
 */
export function validateEntry(entry: ExtractionEntry): string[] {
  const errors: string[] = [];

  if (!entry.key.trim()) {
    errors.push("Key is required");
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.key)) {
    errors.push("Key must be a valid identifier (letters, numbers, underscores)");
  }

  if (!entry.value.trim()) {
    errors.push("Value is required");
  }

  if (!entry.stateKey.trim()) {
    errors.push("State key is required");
  } else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(entry.stateKey)) {
    errors.push("State key must be a valid identifier");
  }

  return errors;
}

/**
 * Check if any entries have duplicate keys.
 */
export function findDuplicateKeys(entries: ExtractionEntry[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const entry of entries) {
    const key = entry.key.trim();
    if (key && seen.has(key)) {
      duplicates.add(key);
    }
    seen.add(key);
  }

  return duplicates;
}

/** Simple unique ID generator for React keys */
function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

/**
 * Create an empty extraction entry.
 */
export function createEmptyEntry(): ExtractionEntry {
  return {
    id: generateId(),
    key: "",
    value: "",
    stateKey: "",
  };
}
