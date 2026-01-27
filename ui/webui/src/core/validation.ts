/**
 * Unified Validation - JSON Schema 2020-12 validation wrapper for WebUI.
 *
 * Provides consistent validation interface matching contracts/validation.py
 * to ensure identical validation behavior between client and server.
 *
 * Uses Ajv library with Draft 2020-12 support.
 *
 * See: issues/2026_01_08_unified_validation/r3.md for design details.
 */

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ErrorObject } from "ajv";

// Initialize Ajv with 2020-12 draft and all errors mode
const ajv = new Ajv2020({
  allErrors: true,      // Collect all errors, not just first
  verbose: true,        // Include schema and data in errors
  strict: false,        // Don't fail on unknown formats
});

// Add format validation (email, date, uri, uuid, etc.)
addFormats(ajv);

/**
 * Normalized validation error format.
 *
 * Matches the Python ValidationError dataclass in contracts/validation.py
 * to ensure consistent error handling across client and server.
 */
export interface ValidationError {
  path: string;         // JSON pointer to invalid field (e.g., "/items/0/count")
  message: string;      // Human-readable error message
  keyword: string;      // Schema keyword that failed (e.g., "minimum", "required")
  schemaPath?: string;  // Path in schema where error occurred
}

/**
 * Result of schema validation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate data against a JSON Schema 2020-12.
 *
 * @param data - The data to validate (can be any JSON-compatible type)
 * @param schema - JSON Schema 2020-12 compliant schema
 * @returns ValidationResult with valid=true/false and list of errors
 *
 * @example
 * const schema = {
 *   type: "object",
 *   properties: {
 *     count: { type: "integer", minimum: 0 }
 *   },
 *   required: ["count"]
 * };
 *
 * const result = validateAgainstSchema({ count: -1 }, schema);
 * // result.valid = false
 * // result.errors = [{ path: "/count", message: "must be >= 0", keyword: "minimum" }]
 */
export function validateAgainstSchema(
  data: unknown,
  schema: object
): ValidationResult {
  // Compile schema (Ajv caches compiled schemas automatically)
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  // Transform Ajv errors to our normalized format
  const errors: ValidationError[] = (validate.errors || []).map(
    (err: ErrorObject) => ({
      path: err.instancePath || "",
      message: err.message || "Validation error",
      keyword: err.keyword,
      schemaPath: err.schemaPath,
    })
  );

  return { valid: false, errors };
}

/**
 * Format validation errors as human-readable strings.
 *
 * @param errors - List of ValidationError objects
 * @returns List of formatted error strings like "path: message"
 */
export function formatErrorsForDisplay(errors: ValidationError[]): string[] {
  return errors.map((err) => {
    if (err.path) {
      return `${err.path}: ${err.message}`;
    }
    return err.message;
  });
}

/**
 * Validate a single form field value against a property schema.
 *
 * Useful for real-time validation as user types.
 *
 * @param value - The field value to validate
 * @param propertySchema - JSON Schema for this specific property
 * @returns ValidationResult
 */
export function validateField(
  value: unknown,
  propertySchema: object
): ValidationResult {
  return validateAgainstSchema(value, propertySchema);
}

/**
 * Check if a schema is valid JSON Schema 2020-12.
 *
 * @param schema - The schema to validate
 * @returns null if valid, error message string if invalid
 */
export function validateSchema(schema: object): string | null {
  try {
    ajv.compile(schema);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid schema";
  }
}
