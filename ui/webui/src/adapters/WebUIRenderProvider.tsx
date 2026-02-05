/**
 * WebUIRenderProvider - Bridges @wfm/shared RenderContext to webui state.
 *
 * Provides:
 * - templateState from WorkflowStateContext (SSE-synced workflow state)
 * - debugMode from localStorage
 * - readonly flag based on viewMode
 * - onUpdateDisplayData callback to update display data in store
 */

import { type ReactNode, useMemo, useCallback } from "react";
import { RenderProvider } from "@wfm/shared";
import { useWorkflowStateContext } from "@/state/WorkflowStateContext";
import { useWorkflowStore } from "@/state/workflow-store";
import { getDebugMode } from "@/state/hooks/useDebugMode";

interface WebUIRenderProviderProps {
  children: ReactNode;
}

/**
 * Provider that connects @wfm/shared RenderContext to webui state sources.
 */
export function WebUIRenderProvider({ children }: WebUIRenderProviderProps) {
  // Get template state from SSE-synced workflow state
  const { state: templateState } = useWorkflowStateContext();

  // Get update function from store
  const updateCurrentInteractionDisplayData = useWorkflowStore(
    (s) => s.updateCurrentInteractionDisplayData
  );

  // Debug mode from localStorage
  const debugMode = getDebugMode();

  // Readonly when viewing history in single mode
  // (TODO: This may need refinement based on actual readonly requirements)
  const readonly = false; // Current implementation doesn't have readonly mode

  // Handler for updating display data (debug mode) - memoized to prevent re-renders
  const handleUpdateDisplayData = useCallback(
    (path: string[], data: unknown, _schema: unknown) => {
      const interaction = useWorkflowStore.getState().currentInteraction;
      if (!interaction) return;

      // Merge the update at the given path
      const newDisplayData = { ...interaction.display_data };

      // Navigate to the parent and set the value
      let current: Record<string, unknown> = newDisplayData;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (typeof current[key] !== "object" || current[key] === null) {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }

      if (path.length > 0) {
        current[path[path.length - 1]] = data;
      }

      updateCurrentInteractionDisplayData(newDisplayData);
    },
    [updateCurrentInteractionDisplayData]
  );

  // Memoize the context value to prevent unnecessary re-renders
  const contextValue = useMemo(
    () => ({
      templateState: templateState as Record<string, unknown>,
      debugMode,
      readonly,
      onUpdateDisplayData: handleUpdateDisplayData,
    }),
    [templateState, debugMode, readonly, handleUpdateDisplayData]
  );

  return (
    <RenderProvider value={contextValue}>
      {children}
    </RenderProvider>
  );
}
