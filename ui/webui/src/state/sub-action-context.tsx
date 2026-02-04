/**
 * SubActionContext - Manages sub-action execution and state.
 *
 * Provides:
 * - triggerSubAction(actionId, params) - execute a sub-action
 * - subActionState - current execution state (running, progress, error)
 * - Sub-action definitions from display_data
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
import { api } from "@/core/api";
import { useWorkflowStore } from "@/state/workflow-store";
import type { SubActionDef, SSEEventType } from "@/core/types";

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
  /** Interaction ID for API calls */
  interactionId: string;
  /** Sub-action definitions from display_data */
  subActions: SubActionDef[];
  /** Called when a sub-action completes successfully */
  onComplete?: () => void;
  children: ReactNode;
}

export function SubActionProvider({
  interactionId,
  subActions,
  onComplete,
  children,
}: SubActionProviderProps) {
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
      if (!workflowRunId) {
        setError("No workflow run ID");
        return;
      }

      // Find sub-action definition
      const subAction = subActions.find((sa) => sa.id === subActionId);
      if (!subAction) {
        setError(`Sub-action '${subActionId}' not found`);
        return;
      }

      // Set loading state
      setRunningId(subActionId);
      setProgress(subAction.loading_label || "Processing...");
      setError(null);

      // Build request with optional ai_config override
      const request: {
        interaction_id: string;
        sub_action_id: string;
        params: Record<string, unknown>;
        ai_config?: { provider?: string; model?: string };
      } = {
        interaction_id: interactionId,
        sub_action_id: subActionId,
        params,
      };

      // Include ai_config if model is selected
      if (selectedModel) {
        request.ai_config = {
          provider: selectedProvider || undefined,
          model: selectedModel,
        };
      }

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

      // Handle connection errors
      const handleError = (err: Error) => {
        setRunningId(null);
        setProgress(null);
        setError(err.message);
      };

      // Execute via SSE
      api.streamSubAction(workflowRunId, request, handleEvent, handleError);
    },
    [workflowRunId, interactionId, subActions, onComplete, selectedProvider, selectedModel]
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
