/**
 * RenderContext - Provides debug mode and UI settings to rendering components.
 *
 * This context provides UI-related settings that are not workflow state:
 * - Debug mode for edit functionality
 * - Readonly mode for history viewing
 * - Display data update callback
 *
 * Note: Template state for Jinja2/Nunjucks rendering is provided by
 * WorkflowStateContext, not this context.
 */

import { createContext, useContext, type ReactNode } from "react";

// =============================================================================
// Types
// =============================================================================

export interface RenderContextValue {
  /** Whether debug mode is enabled */
  debugMode: boolean;

  /** Whether in readonly mode (viewing history) */
  readonly: boolean;

  /**
   * Callback to update display data (debug mode only).
   * @param path - Path to the data being updated
   * @param data - New data value
   * @param schema - Schema for the data
   */
  onUpdateDisplayData?: (
    path: string[],
    data: unknown,
    schema: unknown
  ) => void;
}

// =============================================================================
// Default Context
// =============================================================================

const defaultContext: RenderContextValue = {
  debugMode: false,
  readonly: false,
  onUpdateDisplayData: undefined,
};

// =============================================================================
// Context
// =============================================================================

const RenderContext = createContext<RenderContextValue>(defaultContext);

// =============================================================================
// Provider
// =============================================================================

interface RenderProviderProps {
  children: ReactNode;
  value: Partial<RenderContextValue>;
}

/**
 * Provider for render context.
 * Merges provided values with defaults.
 */
export function RenderProvider({ children, value }: RenderProviderProps) {
  const merged = { ...defaultContext, ...value };
  return (
    <RenderContext.Provider value={merged}>{children}</RenderContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access render context.
 * Always returns a valid context (with defaults if not in provider).
 */
export function useRenderContext(): RenderContextValue {
  return useContext(RenderContext);
}
