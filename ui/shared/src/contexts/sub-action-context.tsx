/**
 * SubActionContext - Manages sub-action execution and state.
 *
 * Provides:
 * - triggerSubAction(actionId, params) - execute a sub-action
 * - subActionState - current execution state (running, progress, error)
 * - Sub-action definitions from display_data
 *
 * Architecture:
 * - Uses the shared API directly for sub-action execution
 * - Falls back to injectable executor for editor/mock scenarios
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
import type { SubActionDef, SSEEventType } from "../types/index";
import { api } from "../core/api";
import { useWorkflowStore } from "../state/workflow-store";

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
  /** Interaction ID for API calls */
  interactionId: string;
  /** Injectable executor for mock scenarios (editor) - if not provided, uses real API */
  executor?: SubActionExecutor;
  /** Called when a sub-action completes successfully */
  onComplete?: () => void;
  children: ReactNode;
}

export function SubActionProvider({
  subActions,
  interactionId,
  executor,
  onComplete,
  children,
}: SubActionProviderProps) {
  // Get workflow state
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);
  const selectedProvider = useWorkflowStore((s) => s.selectedProvider);
  const selectedModel = useWorkflowStore((s) => s.selectedModel);

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

      // If executor is provided (editor/mock), use it
      if (executor) {
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
        return;
      }

      // Otherwise, use the shared API directly
      if (!workflowRunId) {
        console.error("[SubActionProvider] No workflow run ID");
        setError("No workflow run ID");
        setRunningId(null);
        return;
      }

      // Build request
      const request = {
        interaction_id: interactionId,
        sub_action_id: subActionId,
        params,
        ...(selectedModel && {
          ai_config: {
            provider: selectedProvider || undefined,
            model: selectedModel,
          },
        }),
      };

      // Handle SSE events
      const handleEvent = (eventType: SSEEventType, data: Record<string, unknown>) => {
        switch (eventType) {
          case "progress":
            setProgress((data.message as string) || "Processing...");
            break;
          case "complete":
            setRunningId(null);
            setProgress(null);
            onComplete?.();
            break;
          case "error":
            setRunningId(null);
            setProgress(null);
            setError((data.message as string) || "Sub-action failed");
            break;
        }
      };

      const handleError = (err: Error) => {
        console.error("[SubActionProvider] Connection error:", err);
        setRunningId(null);
        setProgress(null);
        setError(err.message);
      };

      // Start streaming - fire and forget, let it complete naturally
      api.streamSubAction(
        workflowRunId,
        request,
        handleEvent,
        handleError
      );
    },
    [executor, subActions, onComplete, workflowRunId, interactionId, selectedProvider, selectedModel]
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
