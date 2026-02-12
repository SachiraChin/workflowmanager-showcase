/**
 * Virtual API Client for Editor Preview Mode
 *
 * Implements ApiClientInterface but calls the virtual-server which runs
 * separately from the main server for resource isolation.
 *
 * Uses VIRTUAL_API_URL (e.g., http://localhost:9001 in dev,
 * virtual.{domain} in production) and calls /workflow/* endpoints.
 *
 * This client is injected via ApiClientProvider when rendering interactions
 * in the editor preview panel.
 */

import type {
  ApiClientInterface,
  GenerationsResponse,
  MediaPreviewRequest,
  MediaPreviewResponse,
} from "@wfm/shared";
import type { SubActionRequest, SSEEventType, WorkflowDefinition } from "@wfm/shared";
import { VIRTUAL_API_URL } from "@wfm/shared";

// =============================================================================
// Types
// =============================================================================

export interface VirtualApiClientConfig {
  /** Get current virtualDb state */
  getVirtualDb: () => string | null;
  /** Get current virtual run ID */
  getVirtualRunId: () => string | null;
  /** Get current workflow definition */
  getWorkflow: () => WorkflowDefinition | null;
  /** Called when virtualDb is updated by an operation */
  onVirtualDbUpdate?: (newVirtualDb: string) => void;
  /** Whether mock mode is enabled */
  getMockMode?: () => boolean;
}

// =============================================================================
// Virtual API Client
// =============================================================================

/**
 * Creates a virtual API client that calls the virtual-server.
 *
 * For methods that need virtualDb (generations, sub-actions), it calls
 * the /workflow/* endpoints with the virtualDb in the request body.
 *
 * For methods that don't need virtualDb (media preview), it calls the
 * endpoint directly.
 *
 * Methods not supported in virtual mode throw errors.
 */
export function createVirtualApiClient(
  config: VirtualApiClientConfig
): ApiClientInterface {
  const {
    getVirtualDb,
    getVirtualRunId,
    getWorkflow,
    onVirtualDbUpdate,
    getMockMode = () => true,
  } = config;

  const baseUrl = VIRTUAL_API_URL;

  // Helper to make authenticated requests
  async function request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  // Helper to throw "not supported" errors for methods that don't make sense in virtual mode
  function notSupported(methodName: string): never {
    throw new Error(
      `${methodName} is not supported in virtual/preview mode`
    );
  }

  return {
    // Configuration - no-op in virtual mode
    setAccessKey: () => {},

    // ============================================================
    // Methods that work with virtual endpoints
    // ============================================================

    async getInteractionGenerations(
      _workflowRunId: string,
      interactionId: string,
      contentType: string
    ): Promise<GenerationsResponse> {
      const virtualDb = getVirtualDb();
      const virtualRunId = getVirtualRunId();

      if (!virtualDb || !virtualRunId) {
        // No virtual state yet - return empty generations
        return { generations: [] };
      }

      return request<GenerationsResponse>("/workflow/generations", {
        method: "POST",
        body: JSON.stringify({
          virtual_db: virtualDb,
          virtual_run_id: virtualRunId,
          interaction_id: interactionId,
          content_type: contentType,
        }),
      });
    },

    async getMediaPreview(
      _workflowRunId: string,
      previewRequest: MediaPreviewRequest
    ): Promise<MediaPreviewResponse> {
      // Media preview doesn't need virtualDb - just calls the virtual endpoint
      // which bypasses workflow verification
      return request<MediaPreviewResponse>("/workflow/media/preview", {
        method: "POST",
        body: JSON.stringify(previewRequest),
      });
    },

    streamSubAction(
      _workflowRunId: string,
      subActionRequest: SubActionRequest,
      onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
      onError?: (error: Error) => void
    ): () => void {
      const controller = new AbortController();

      const virtualDb = getVirtualDb();
      const virtualRunId = getVirtualRunId();
      const workflow = getWorkflow();

      if (!virtualDb || !virtualRunId || !workflow) {
        onError?.(new Error("Virtual state not available"));
        return () => {};
      }

      (async () => {
        try {
          const response = await fetch(
            `${baseUrl}/workflow/sub-action`,
            {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workflow,
                virtual_db: virtualDb,
                virtual_run_id: virtualRunId,
                interaction_id: subActionRequest.interaction_id,
                sub_action_id: subActionRequest.sub_action_id,
                params: subActionRequest.params || {},
                ai_config: subActionRequest.ai_config,
                mock: getMockMode(),
              }),
              signal: controller.signal,
            }
          );

          if (!response.ok) {
            throw new Error(`Sub-action failed: ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No response body");
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let currentEventType: SSEEventType | null = null;

          while (true) {
            const { done, value } = await reader.read();

            if (value) {
              buffer += decoder.decode(value, { stream: true });
            }

            const lines = buffer.split("\n");
            buffer = done ? "" : lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEventType = line.slice(7).trim() as SSEEventType;
              } else if (line.startsWith("data: ") && currentEventType) {
                try {
                  const data = JSON.parse(line.slice(6));

                  // Update virtualDb if present in completion event
                  if (
                    currentEventType === "complete" &&
                    data.virtual_db &&
                    onVirtualDbUpdate
                  ) {
                    onVirtualDbUpdate(data.virtual_db);
                  }

                  onEvent(currentEventType, data);
                } catch (e) {
                  console.error("[VirtualApiClient] Failed to parse SSE data", e);
                }
                currentEventType = null;
              }
            }

            if (done) break;
          }
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            onError?.(error as Error);
          }
        }
      })();

      return () => {
        controller.abort();
      };
    },

    // ============================================================
    // Methods not supported in virtual mode
    // ============================================================

    startWorkflow: () => notSupported("startWorkflow"),
    confirmWorkflowStart: () => notSupported("confirmWorkflowStart"),
    startWorkflowByVersion: () => notSupported("startWorkflowByVersion"),
    getStatus: () => notSupported("getStatus"),
    respond: () => notSupported("respond"),
    cancel: () => notSupported("cancel"),
    resume: () => notSupported("resume"),
    resumeWithContent: () => notSupported("resumeWithContent"),
    confirmResume: () => notSupported("confirmResume"),
    getState: () => notSupported("getState"),
    getStateV2: () => notSupported("getStateV2"),
    getStatusDisplay: () => notSupported("getStatusDisplay"),
    getWorkflowDefinition: () => notSupported("getWorkflowDefinition"),
    getWorkflowFile: () => notSupported("getWorkflowFile"),
    listWorkflowTemplates: () => notSupported("listWorkflowTemplates"),
    cloneGlobalVersionToUser: () => notSupported("cloneGlobalVersionToUser"),
    publishGlobalTemplate: () => notSupported("publishGlobalTemplate"),
    listWorkflowRuns: () => notSupported("listWorkflowRuns"),
    getInteractionHistory: () => notSupported("getInteractionHistory"),
    getInteractionData: () => notSupported("getInteractionData"),
    getModels: () => notSupported("getModels"),
    login: () => notSupported("login"),
    getInvitationStatus: () => notSupported("getInvitationStatus"),
    registerWithInvitation: () => notSupported("registerWithInvitation"),
    guestAccess: () => notSupported("guestAccess"),
    logout: () => notSupported("logout"),
    refreshToken: () => notSupported("refreshToken"),
    getCurrentUser: () => notSupported("getCurrentUser"),
    streamWorkflow: () => notSupported("streamWorkflow"),
    streamState: () => notSupported("streamState"),
    streamRespond: () => notSupported("streamRespond"),
  };
}
