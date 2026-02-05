/**
 * WebUIMediaAdapter - Real implementation of MediaAdapter for webui.
 *
 * Bridges @wfm/shared MediaAdapterContext to webui's API and state.
 * This provides the actual API calls for media generation components.
 */

import { type ReactNode, useMemo } from "react";
import {
  MediaAdapterProvider,
  type MediaAdapter,
  type GenerationsResponse,
  type MediaPreviewParams,
  type MediaPreviewResponse,
  type MediaSubActionRequest,
} from "@wfm/shared";
import type { SSEEventType } from "@wfm/shared";
import { api } from "@/core/api";
import { toMediaUrl } from "@/core/config";
import { useWorkflowStore } from "@/state/workflow-store";

interface WebUIMediaAdapterProviderProps {
  children: ReactNode;
}

/**
 * Provider that supplies a real MediaAdapter implementation for webui.
 */
export function WebUIMediaAdapterProvider({
  children,
}: WebUIMediaAdapterProviderProps) {
  // Get state from workflow store
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);
  const selectedProvider = useWorkflowStore((s) => s.selectedProvider);
  const selectedModel = useWorkflowStore((s) => s.selectedModel);

  // Memoize the adapter to prevent re-creating on every render
  const adapter: MediaAdapter = useMemo(
    () => ({
      getWorkflowRunId: () => workflowRunId,

      getSelectedProvider: () => selectedProvider,

      getSelectedModel: () => selectedModel,

      toMediaUrl: (url: string) => toMediaUrl(url),

      getInteractionGenerations: async (
        interactionId: string,
        mediaType?: string
      ): Promise<GenerationsResponse> => {
        if (!workflowRunId) {
          return { generations: [] };
        }
        // API requires content_type parameter
        const response = await api.getInteractionGenerations(
          workflowRunId,
          interactionId,
          mediaType || "image"
        );
        return response;
      },

      getMediaPreview: async (
        params: MediaPreviewParams
      ): Promise<MediaPreviewResponse> => {
        if (!workflowRunId) {
          throw new Error("No active workflow");
        }
        const response = await api.getMediaPreview(workflowRunId, {
          provider: params.provider || "",
          action_type: params.action_type || "",
          params: params.params || {},
        });
        // Pass through the API response directly - it matches PreviewInfo structure
        return response as unknown as MediaPreviewResponse;
      },

      streamSubAction: (
        request: MediaSubActionRequest,
        onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
        onError: (error: Error) => void
      ) => {
        if (!workflowRunId) {
          onError(new Error("No active workflow"));
          return;
        }

        // Map MediaSubActionRequest to API's SubActionRequest format
        const apiRequest = {
          interaction_id: request.interaction_id,
          sub_action_id: request.sub_action_id,
          params: request.params,
          ai_config: request.ai_config,
        };

        // Call the API's streamSubAction
        api.streamSubAction(workflowRunId, apiRequest, onEvent, onError);
      },
    }),
    [workflowRunId, selectedProvider, selectedModel]
  );

  return (
    <MediaAdapterProvider adapter={adapter}>{children}</MediaAdapterProvider>
  );
}
