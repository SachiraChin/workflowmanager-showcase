/**
 * InputSchemaContext - Shared context for input schema rendering.
 *
 * Provides:
 * - Values management (get/set input values)
 * - Error management (validation errors per field)
 * - Schema reference for validation rules
 *
 * Used by:
 * - InputSchemaComposer (provides the context)
 * - Input renderers (read/write values, display errors)
 * - MediaPanel (validate and submit values)
 */

import { createContext, useContext } from "react";
import type { SchemaProperty } from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Input schema type - object schema with properties for input fields.
 */
export interface InputSchema {
  type: "object";
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  _ux?: {
    layout?: "grid" | "flex" | "stack";
    layout_columns?: number;
    layout_columns_sm?: number;
    layout_gap?: number;
  };
}

/**
 * Context value for input schema management.
 */
export interface InputSchemaContextValue {
  // Values management
  values: Record<string, unknown>;
  getValue: (key: string) => unknown;
  setValue: (key: string, value: unknown) => void;

  // Get values with destination_field mapping applied (for submission)
  getMappedValues: () => Record<string, unknown>;

  // Validation errors
  errors: Record<string, string>;
  setError: (key: string, error: string) => void;
  clearError: (key: string) => void;
  clearAllErrors: () => void;

  // State
  isValid: boolean;

  // Schema reference (for validation rules)
  inputSchema: InputSchema;
}

// =============================================================================
// Context
// =============================================================================

/**
 * Context for input schema state management.
 * Null when not within an InputSchemaComposer.
 */
export const InputSchemaContext = createContext<InputSchemaContextValue | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access input schema context.
 * Throws if used outside of InputSchemaComposer.
 *
 * Use this when the component MUST be within an input schema context.
 */
export function useInputSchema(): InputSchemaContextValue {
  const ctx = useContext(InputSchemaContext);
  if (!ctx) {
    throw new Error("useInputSchema must be used within InputSchemaComposer");
  }
  return ctx;
}

/**
 * Hook to optionally access input schema context.
 * Returns null if not within InputSchemaComposer.
 *
 * Use this when the component can work with or without input schema context.
 */
export function useInputSchemaOptional(): InputSchemaContextValue | null {
  return useContext(InputSchemaContext);
}
