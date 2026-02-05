/**
 * SubActionContext - Manages sub-action execution and state.
 *
 * Provides:
 * - triggerSubAction(actionId, params) - execute a sub-action
 * - subActionState - current execution state (running, progress, error)
 * - Sub-action definitions from display_data
 *
 * Architecture:
 * - Uses injectable SubActionExecutor to decouple from webui's API/store
 * - webui provides real executor that calls API
 * - editor can provide mock executor for previews
 *
 * Used by:
 * - InteractionFooterInner - renders sub-action buttons in footer
 * - Child components (e.g., ImageGeneration) - trigger sub-actions programmatically
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { SubActionDef } from "../types/index";

// =============================================================================
// Types
// =============================================================================

/** Current state of sub-action execution */
export interface SubActionState {
  /** ID of the currently running sub-action, or null */
  runningId: string | null;
  /** Progress message for the running sub-action */
  progress: string | null;
  /** Error message from the last sub-action, if any */
  error: string | null;
}

/**
 * Injectable executor for sub-actions.
 * webui provides real implementation, editor can provide mock.
 */
export interface SubActionExecutor {
  /**
   * Execute a sub-action.
   * @param subActionId - The sub-action ID to execute
   * @param params - Parameters for the sub-action
   * @param callbacks - Progress/completion/error callbacks
   */
  execute: (
    subActionId: string,
    params: Record<string, unknown>,
    callbacks: {
      onProgress?: (message: string) => void;
      onComplete?: (result?: unknown) => void;
      onError?: (error: string) => void;
    }
  ) => void;
}

/** What components see via useSubAction() */
export interface SubActionContextValue {
  /** All sub-action definitions from display_data */
  subActions: SubActionDef[];
  /** Sub-actions visible in footer (excludes hidden) */
  visibleSubActions: SubActionDef[];
  /** Current execution state */
  state: SubActionState;
  /**
   * Trigger a sub-action by ID.
   * @param subActionId - The sub-action ID to trigger (e.g., "image_generation")
   * @param params - Parameters to pass to the sub-action (includes all data needed)
   */
  trigger: (subActionId: string, params?: Record<string, unknown>) => void;
  /** Clear error state */
  clearError: () => void;
}

// =============================================================================
// Context
// =============================================================================

const SubActionContext = createContext<SubActionContextValue | null>(null);

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for components to access sub-action functionality.
 * Use this to trigger sub-actions or observe execution state.
 */
export function useSubAction(): SubActionContextValue {
  const ctx = useContext(SubActionContext);
  if (!ctx) {
    throw new Error("useSubAction must be used within SubActionProvider");
  }
  return ctx;
}

/**
 * Optional hook that returns null if not within provider.
 * Useful for components that may or may not be in sub-action context.
 */
export function useSubActionOptional(): SubActionContextValue | null {
  return useContext(SubActionContext);
}

// =============================================================================
// Provider
// =============================================================================

interface SubActionProviderProps {
  /** Sub-action definitions from display_data */
  subActions: SubActionDef[];
  /** Injectable executor (webui provides real, editor provides mock) */
  executor?: SubActionExecutor;
  /** Called when a sub-action completes successfully */
  onComplete?: () => void;
  children: ReactNode;
}

export function SubActionProvider({
  subActions,
  executor,
  onComplete,
  children,
}: SubActionProviderProps) {
  // Execution state
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filter visible sub-actions (exclude hidden)
  const visibleSubActions = useMemo(
    () => subActions.filter((sa) => !sa.hidden),
    [subActions]
  );

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Trigger sub-action execution
  const trigger = useCallback(
    (subActionId: string, params: Record<string, unknown> = {}) => {
      if (!executor) {
        console.error("[SubActionProvider] No executor configured");
        setError("No sub-action executor configured");
        return;
      }

      // Find sub-action definition
      const subAction = subActions.find((sa) => sa.id === subActionId);
      if (!subAction) {
        console.error("[SubActionProvider] Sub-action not found", { subActionId, available: subActions.map(s => s.id) });
        setError(`Sub-action '${subActionId}' not found`);
        return;
      }

      // Set loading state
      setRunningId(subActionId);
      setProgress(subAction.loading_label || "Processing...");
      setError(null);

      // Execute via injected executor
      executor.execute(subActionId, params, {
        onProgress: (message) => {
          setProgress(message || "Processing...");
        },
        onComplete: () => {
          setRunningId(null);
          setProgress(null);
          onComplete?.();
        },
        onError: (err) => {
          setRunningId(null);
          setProgress(null);
          setError(err || "Sub-action failed");
        },
      });
    },
    [executor, subActions, onComplete]
  );

  // Build context value
  const state = useMemo<SubActionState>(
    () => ({ runningId, progress, error }),
    [runningId, progress, error]
  );

  const contextValue = useMemo<SubActionContextValue>(
    () => ({
      subActions,
      visibleSubActions,
      state,
      trigger,
      clearError,
    }),
    [subActions, visibleSubActions, state, trigger, clearError]
  );

  return (
    <SubActionContext.Provider value={contextValue}>
      {children}
    </SubActionContext.Provider>
  );
}
