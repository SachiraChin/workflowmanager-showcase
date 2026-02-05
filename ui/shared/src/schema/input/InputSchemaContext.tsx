/**
 * InputSchemaContext - Shared context for input schema rendering.
 *
 * Split into two contexts for performance:
 * - InputSchemaActionsContext: Stable functions that don't change between renders
 * - InputSchemaStateContext: Reactive state that changes when values/errors change
 *
 * This split prevents components that only need to call functions (like setValue)
 * from re-rendering when values change. Components can choose which context
 * they need:
 * - useInputSchemaActions() - for calling functions only (stable, no re-renders)
 * - useInputSchemaState() - for reactive values (re-renders on state change)
 * - useInputSchema() - for both (convenience, re-renders on state change)
 *
 * Used by:
 * - InputSchemaComposer (provides both contexts)
 * - Input renderers (need both: display values + update on change)
 * - Generation components (need actions only for setValue/getMappedValues)
 */

import { createContext, useContext } from "react";
import type { SchemaProperty } from "../../types/schema";

// =============================================================================
// Dynamic Options Types
// =============================================================================

/**
 * Option for dynamic dropdowns populated by controls.
 */
export interface DynamicOption {
  value: unknown;
  label: string;
  /** Full source item for nested controls (when controlled field also controls others) */
  sourceItem?: unknown;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Convert path array to dot-separated key string.
 */
export function pathToKey(path: string[]): string {
  return path.join(".");
}

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
 * Stable actions context - functions that don't change between renders.
 * Components using only these won't re-render when values change.
 */
export interface InputSchemaActions {
  // Source data (stable reference)
  sourceData: Record<string, unknown>;

  // Values management (functions are stable)
  getValue: (key: string) => unknown;
  setValue: (key: string, value: unknown) => void;
  getMappedValues: () => Record<string, unknown>;

  // Error management
  setError: (key: string, error: string) => void;
  clearError: (key: string) => void;
  clearAllErrors: () => void;

  // Dynamic options for controlled select fields
  getDynamicOptions: (key: string) => DynamicOption[] | undefined;
  setDynamicOptions: (key: string, options: DynamicOption[]) => void;

  // Alternative input mode tracking
  isAlternativeMode: (key: string) => boolean;
  setAlternativeMode: (key: string, active: boolean) => void;

  // Visibility control for conditional field display
  isVisible: (key: string) => boolean;
  setVisibility: (key: string, visible: boolean) => void;

  // Schema reference (stable)
  inputSchema: InputSchema;

  // Props (stable per render)
  disabled: boolean;
  readonly: boolean;
}

/**
 * Reactive state context - values that change and trigger re-renders.
 */
export interface InputSchemaState {
  // Current values (reactive - changes trigger re-render)
  values: Record<string, unknown>;

  // Validation errors (reactive)
  errors: Record<string, string>;

  // Alternative mode state (reactive)
  alternativeMode: Record<string, boolean>;

  // Visibility state (reactive)
  visibility: Record<string, boolean>;

  // Computed state
  isValid: boolean;
}

/**
 * Combined context value for backward compatibility.
 * Components that need both actions and state can use this.
 */
export interface InputSchemaContextValue extends InputSchemaActions, InputSchemaState {}

// =============================================================================
// Contexts
// =============================================================================

/**
 * Context for stable actions (functions that don't change).
 * Components using only this won't re-render when values change.
 */
export const InputSchemaActionsContext = createContext<InputSchemaActions | null>(null);

/**
 * Context for reactive state (values that change).
 * Components using this will re-render when values/errors change.
 */
export const InputSchemaStateContext = createContext<InputSchemaState | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access stable actions only.
 * Components using this WON'T re-render when values change.
 * Use this for components that only need to call functions like setValue.
 *
 * @throws Error if used outside of InputSchemaComposer
 */
export function useInputSchemaActions(): InputSchemaActions {
  const ctx = useContext(InputSchemaActionsContext);
  if (!ctx) {
    throw new Error("useInputSchemaActions must be used within InputSchemaComposer");
  }
  return ctx;
}

/**
 * Hook to optionally access stable actions.
 * Returns null if not within InputSchemaComposer.
 * Components using this WON'T re-render when values change.
 */
export function useInputSchemaActionsOptional(): InputSchemaActions | null {
  return useContext(InputSchemaActionsContext);
}

/**
 * Hook to access reactive state only.
 * Components using this WILL re-render when values/errors change.
 * Use this for components that need to display current values.
 *
 * @throws Error if used outside of InputSchemaComposer
 */
export function useInputSchemaState(): InputSchemaState {
  const ctx = useContext(InputSchemaStateContext);
  if (!ctx) {
    throw new Error("useInputSchemaState must be used within InputSchemaComposer");
  }
  return ctx;
}

/**
 * Hook to optionally access reactive state.
 * Returns null if not within InputSchemaComposer.
 */
export function useInputSchemaStateOptional(): InputSchemaState | null {
  return useContext(InputSchemaStateContext);
}

/**
 * Hook to access both actions and state (combined).
 * This is a convenience hook for components that need both.
 * Components using this WILL re-render when values change.
 *
 * @throws Error if used outside of InputSchemaComposer
 */
export function useInputSchema(): InputSchemaContextValue {
  const actions = useContext(InputSchemaActionsContext);
  const state = useContext(InputSchemaStateContext);
  if (!actions || !state) {
    throw new Error("useInputSchema must be used within InputSchemaComposer");
  }
  return { ...actions, ...state };
}

/**
 * Hook to optionally access both actions and state.
 * Returns null if not within InputSchemaComposer.
 * Components using this WILL re-render when values change.
 */
export function useInputSchemaOptional(): InputSchemaContextValue | null {
  const actions = useContext(InputSchemaActionsContext);
  const state = useContext(InputSchemaStateContext);
  if (!actions || !state) {
    return null;
  }
  return { ...actions, ...state };
}
