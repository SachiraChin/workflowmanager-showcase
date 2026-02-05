/**
 * UX namespace utilities for schema-driven rendering.
 *
 * Supports two formats (checked in priority order):
 * 1. _ux object: { "_ux": { "display": "visible", "render_as": "card" } }
 * 2. _ux.* flat: { "_ux.display": "visible", "_ux.card.title": "Hello" }
 *
 * Flat notation supports nested paths:
 * - "_ux.display" -> { display: value }
 * - "_ux.card.title" -> { card: { title: value } }
 *
 * This enables clean separation of JSON Schema validation from UI rendering.
 */

import type { UxConfig } from "../types/schema";

// =============================================================================
// getUx() - Main Extraction Function
// =============================================================================

/**
 * Set a nested value in an object using a dot-separated path.
 * Creates intermediate objects as needed.
 *
 * @example
 * setNestedValue({}, ["card", "title"], "Hello")
 * // => { card: { title: "Hello" } }
 */
function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current) || typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

/**
 * Extract UX configuration from a schema node.
 *
 * Checks for UX properties in priority order:
 * 1. _ux object namespace: schema._ux.property
 * 2. _ux.* flat notation: schema["_ux.property"] or schema["_ux.nested.property"]
 *
 * Flat notation values override _ux object values (allows selective overrides).
 *
 * @param schema - The schema node to extract UX from
 * @returns UxConfig with all found UX properties
 *
 * @example
 * // Object notation:
 * getUx({ _ux: { display: "visible" } })
 * // => { display: "visible" }
 *
 * // Flat notation with nesting:
 * getUx({ "_ux.display": "visible", "_ux.card.title": "Hello" })
 * // => { display: "visible", card: { title: "Hello" } }
 *
 * // Mixed (flat overrides object):
 * getUx({ _ux: { display: "hidden" }, "_ux.display": "visible" })
 * // => { display: "visible" }
 */
export function getUx(schema: Record<string, unknown> | undefined | null): UxConfig {
  if (!schema) return {};

  // Start with _ux object namespace (shallow copy)
  const uxObject = schema._ux;
  const result: Record<string, unknown> = uxObject && typeof uxObject === "object" && !Array.isArray(uxObject)
    ? { ...uxObject as Record<string, unknown> }
    : {};

  // Apply _ux.* flat notation directly to result (overrides object values)
  for (const key of Object.keys(schema)) {
    if (key.startsWith("_ux.")) {
      const path = key.slice(4).split("."); // Remove "_ux." prefix and split by "."
      setNestedValue(result, path, schema[key]);
    }
  }

  return result as UxConfig;
}

/**
 * Check if a schema has any UX configuration.
 *
 * @param schema - The schema node to check
 * @returns true if schema has _ux object or _ux.* keys
 */
export function hasUx(schema: Record<string, unknown> | undefined | null): boolean {
  if (!schema) return false;

  // Check for _ux object
  if (schema._ux) return true;

  // Check for _ux.* flat keys
  for (const key of Object.keys(schema)) {
    if (key.startsWith("_ux.")) return true;
  }

  return false;
}
