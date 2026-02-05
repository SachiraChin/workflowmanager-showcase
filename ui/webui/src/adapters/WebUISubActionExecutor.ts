/**
 * WebUISubActionExecutor - Real implementation of SubActionExecutor for webui.
 *
 * This creates a SubActionExecutor that uses webui's API and workflow store
 * to execute sub-actions. It's designed to be passed to the shared InteractionHost.
 */

import { api } from "@/core/api";
import { useWorkflowStore } from "@/state/workflow-store";
import type { SubActionExecutor } from "@wfm/shared";
import type { SSEEventType } from "@wfm/shared";

/**
 * Create a SubActionExecutor for a specific interaction.
 *
 * This factory function creates an executor bound to a specific interaction ID.
 * It reads workflow state from the store at execution time.
 *
 * @param interactionId - The interaction ID for API calls
 * @returns A SubActionExecutor that can be passed to shared InteractionHost
 */
export function createWebUISubActionExecutor(
  interactionId: string
): SubActionExecutor {
  return {
    execute: (subActionId, params, callbacks) => {
      // Read current state from store at execution time
      const state = useWorkflowStore.getState();
      const { workflowRunId, selectedProvider, selectedModel } = state;

      if (!workflowRunId) {
        console.error("[WebUISubActionExecutor] No workflow run ID");
        callbacks.onError?.("No workflow run ID");
        return;
      }

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

      // Handle SSE events - wrapped to maintain closure over callbacks
      const handleEvent = (
        eventType: SSEEventType,
        data: Record<string, unknown>
      ) => {
        switch (eventType) {
          case "progress":
            callbacks.onProgress?.((data.message as string) || "Processing...");
            break;
          case "complete":
            callbacks.onComplete?.(data);
            break;
          case "error":
            callbacks.onError?.((data.message as string) || "Sub-action failed");
            break;
        }
      };

      // Handle connection errors
      const handleError = (err: Error) => {
        console.error("[WebUISubActionExecutor] Connection error:", err);
        callbacks.onError?.(err.message);
      };

      // Execute via SSE
      api.streamSubAction(workflowRunId, request, handleEvent, handleError);
    },
  };
}

/**
 * React hook to create a SubActionExecutor for the current interaction.
 *
 * This is a convenience hook that creates an executor using React patterns.
 * Use this in components that need to pass an executor to shared InteractionHost.
 *
 * @param interactionId - The interaction ID for API calls
 * @returns A SubActionExecutor instance
 */
export function useSubActionExecutor(interactionId: string): SubActionExecutor {
  // The executor reads state at execution time, so we don't need to
  // recreate it when state changes. But we do need a new one if interactionId changes.
  return createWebUISubActionExecutor(interactionId);
}
