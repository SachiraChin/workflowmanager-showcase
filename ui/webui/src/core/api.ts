/**
 * API client for communicating with the workflow server.
 */

import type {
  StartWorkflowRequest,
  StartWorkflowByVersionRequest,
  WorkflowResponse,
  RespondRequest,
  WorkflowStatusResponse,
  SSEEventType,
  WorkflowDefinition,
  InteractionHistoryResponse,
  WorkflowTemplatesResponse,
  SubActionRequest,
  WorkflowFileContent,
} from "./types";
import { API_URL } from "./config";

interface ApiClientConfig {
  baseUrl?: string;
  accessKey?: string;
}

class ApiClient {
  private baseUrl: string;
  private accessKey: string | null = null;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl || API_URL;
    this.accessKey = config.accessKey || null;
  }

  setAccessKey(key: string) {
    this.accessKey = key;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (this.accessKey) {
      headers["X-Access-Key"] = this.accessKey;
    }
    return headers;
  }

  private isRefreshing = false;
  private refreshPromise: Promise<boolean> | null = null;

  /**
   * Wrap any async method with auth retry logic.
   * If the method throws a 401, refresh token and retry once.
   */
  private async withAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          return await fn();
        }
      }
      throw err;
    }
  }

  private async tryRefreshToken(): Promise<boolean> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: "POST",
          credentials: "include",
          headers: this.getHeaders(),
        });
        return response.ok;
      } catch {
        return false;
      }
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /** Raw request without auth retry - use for auth endpoints */
  async requestRaw<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      credentials: "include",
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new ApiError(
        response.status,
        errorData.detail || response.statusText
      );
    }

    return response.json();
  }

  /** Request with auth retry */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    return this.withAuth(() => this.requestRaw<T>(endpoint, options));
  }

  // ============================================================
  // Workflow Endpoints
  // ============================================================

  async startWorkflow(request: StartWorkflowRequest): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>("/workflow/start", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Confirm and start a workflow after version change was detected.
   * Called after startWorkflow returns requires_confirmation=true.
   */
  async confirmWorkflowStart(request: StartWorkflowRequest): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>("/workflow/start/confirm", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  /**
   * Start workflow with an existing version.
   * Used when selecting a version from workflow templates.
   */
  async startWorkflowByVersion(
    versionId: string,
    request: StartWorkflowByVersionRequest
  ): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(`/workflow/start/${versionId}`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async getStatus(workflowRunId: string): Promise<WorkflowStatusResponse> {
    return this.request<WorkflowStatusResponse>(
      `/workflow/${workflowRunId}/status`
    );
  }

  async respond(request: RespondRequest): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>("/workflow/respond", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  async cancel(workflowRunId: string): Promise<void> {
    await this.request<void>(`/workflow/${workflowRunId}/cancel`, {
      method: "POST",
    });
  }

  /**
   * Resume an existing workflow.
   * Returns current state and pending interaction if any.
   */
  async resume(workflowRunId: string): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(`/workflow/${workflowRunId}/resume`, {
      method: "POST",
    });
  }

  /**
   * Resume workflow with updated content.
   * May return requires_confirmation if version changed.
   */
  async resumeWithContent(
    workflowRunId: string,
    workflowContent: string | Record<string, unknown>,
    entryPoint?: string,
    capabilities?: string[]
  ): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(`/workflow/${workflowRunId}/resume`, {
      method: "POST",
      body: JSON.stringify({
        workflow_content: workflowContent,
        workflow_entry_point: entryPoint,
        capabilities,
      }),
    });
  }

  /**
   * Confirm version change and resume workflow.
   */
  async confirmResume(
    workflowRunId: string,
    workflowContent: string | Record<string, unknown>,
    entryPoint?: string,
    capabilities?: string[]
  ): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(`/workflow/${workflowRunId}/resume/confirm`, {
      method: "POST",
      body: JSON.stringify({
        workflow_content: workflowContent,
        workflow_entry_point: entryPoint,
        capabilities,
      }),
    });
  }

  async getState(workflowRunId: string): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(
      `/workflow/${workflowRunId}/state`
    );
  }

  /**
   * Get hierarchical workflow state (v2 endpoint).
   */
  async getStateV2(workflowRunId: string): Promise<{ state: Record<string, unknown> }> {
    return this.request<{ state: Record<string, unknown> }>(
      `/workflow/${workflowRunId}/state/v2`
    );
  }

  async getStatusDisplay(workflowRunId: string): Promise<{
    display_fields: Array<{ id: string; label: string; value: string }>;
    layout?: string[][];
  }> {
    return this.request<{
      display_fields: Array<{ id: string; label: string; value: string }>;
      layout?: string[][];
    }>(`/workflow/${workflowRunId}/status-display`);
  }

  async getWorkflowDefinition(workflowRunId: string): Promise<{
    workflow_run_id: string;
    version_id: string;
    definition: WorkflowDefinition;
    raw_definition?: WorkflowDefinition;  // Present for resolved versions (has execution_groups)
  }> {
    return this.request<{
      workflow_run_id: string;
      version_id: string;
      definition: WorkflowDefinition;
      raw_definition?: WorkflowDefinition;
    }>(`/workflow/${workflowRunId}/definition`);
  }

  async getWorkflowFile(workflowRunId: string, fileId: string): Promise<WorkflowFileContent> {
    return this.request<WorkflowFileContent>(`/workflow/${workflowRunId}/files/${fileId}`);
  }

  async listWorkflowTemplates(): Promise<WorkflowTemplatesResponse> {
    return this.request<WorkflowTemplatesResponse>("/workflow-templates");
  }

  async listWorkflowRuns(limit: number = 10, offset: number = 0): Promise<{
    workflows: Array<{
      workflow_run_id: string;
      project_name: string;
      workflow_template_name: string;
      status: string;
      current_step: string | null;
      current_step_name: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    }>;
    count: number;
    total: number;
  }> {
    return this.request<{
      workflows: Array<{
        workflow_run_id: string;
        project_name: string;
        workflow_template_name: string;
        status: string;
        current_step: string | null;
        current_step_name: string | null;
        created_at: string;
        updated_at: string;
        completed_at: string | null;
      }>;
      count: number;
      total: number;
    }>(`/workflows/all?limit=${limit}&offset=${offset}`);
  }

  /**
   * Get interaction history for a workflow.
   * Returns completed interactions (request + response pairs) and pending interaction if any.
   */
  async getInteractionHistory(workflowRunId: string): Promise<InteractionHistoryResponse> {
    return this.request<InteractionHistoryResponse>(
      `/workflow/${workflowRunId}/interaction-history`
    );
  }

  /**
   * Get resolved display_data for an interaction using current workflow state.
   *
   * Re-resolves module inputs against current state, ensuring display_data
   * includes any updates from sub-actions.
   *
   * Used:
   * - On page load after getting pending interaction
   * - After sub-action completes to refresh the view
   */
  async getInteractionData(
    workflowRunId: string,
    interactionId: string
  ): Promise<{ display_data: Record<string, unknown> }> {
    return this.request<{ display_data: Record<string, unknown> }>(
      `/workflow/${workflowRunId}/interaction/${interactionId}/data`
    );
  }

  /**
   * Get all generations for a media generation interaction.
   * Used to restore previously generated content on page refresh.
   *
   * @param contentType - Required filter for content type (e.g., "image", "video")
   */
  async getInteractionGenerations(
    workflowRunId: string,
    interactionId: string,
    contentType: string
  ): Promise<{
    generations: Array<{
      urls: string[];
      metadata_id: string;
      content_ids: string[];
      prompt_id: string;
      provider: string;
      request_params?: Record<string, unknown>;
    }>;
  }> {
    return this.request<{
      generations: Array<{
        urls: string[];
        metadata_id: string;
        content_ids: string[];
        prompt_id: string;
        provider: string;
        request_params?: Record<string, unknown>;
      }>;
    }>(`/workflow/${workflowRunId}/interaction/${interactionId}/generations?content_type=${encodeURIComponent(contentType)}`);
  }

  /**
   * Get preview info (resolution and credits) for a media generation configuration.
   * Used to show expected output dimensions and cost before generating.
   */
  async getMediaPreview(
    workflowRunId: string,
    request: {
      provider: string;
      action_type: string;
      params: Record<string, unknown>;
    }
  ): Promise<{
    resolution: {
      width: number;
      height: number;
      megapixels: number;
    };
    credits: {
      credits: number;
      cost_per_credit: number;
      total_cost_usd: number;
      num_images: number;
      credits_per_image: number;
      cost_per_image_usd: number;
    };
  }> {
    return this.request<{
      resolution: {
        width: number;
        height: number;
        megapixels: number;
      };
      credits: {
        credits: number;
        cost_per_credit: number;
        total_cost_usd: number;
        num_images: number;
        credits_per_image: number;
        cost_per_image_usd: number;
      };
    }>(`/workflow/${workflowRunId}/media/preview`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  // ============================================================
  // Authentication Endpoints
  // ============================================================

  async login(email: string, password: string): Promise<{
    user_id: string;
    email: string;
    username: string;
    message: string;
  }> {
    return this.requestRaw<{
      user_id: string;
      email: string;
      username: string;
      message: string;
    }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }

  async logout(): Promise<{ message: string }> {
    return this.requestRaw<{ message: string }>("/auth/logout", {
      method: "POST",
    });
  }

  async refreshToken(): Promise<{ message: string }> {
    return this.requestRaw<{ message: string }>("/auth/refresh", {
      method: "POST",
    });
  }

  async getCurrentUser(): Promise<{
    user_id: string;
    email: string;
    username: string;
  }> {
    // Use request (with auth retry) so expired access tokens trigger refresh
    return this.request<{
      user_id: string;
      email: string;
      username: string;
    }>("/auth/me");
  }

  // ============================================================
  // SSE Streaming
  // ============================================================

  streamWorkflow(
    workflowRunId: string,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void {
    const url = `${this.baseUrl}/workflow/${workflowRunId}/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });

    const eventTypes: SSEEventType[] = [
      "started",
      "progress",
      "interaction",
      "complete",
      "error",
      "cancelled",
    ];

    eventTypes.forEach((eventType) => {
      eventSource.addEventListener(eventType, (event) => {
        try {
          const data = JSON.parse((event as MessageEvent).data);
          onEvent(eventType, data);
        } catch (e) {
          console.error(`Failed to parse SSE event: ${eventType}`, e);
        }
      });
    });

    eventSource.onerror = (event) => {
      console.error("SSE connection error:", event);
      onError?.(new Error("SSE connection failed"));
      eventSource.close();
    };

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  }

  streamState(
    workflowRunId: string,
    onSnapshot: (state: Record<string, unknown>) => void,
    onUpdate: (changedKeys: string[], updates: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void {
    const url = `${this.baseUrl}/workflow/${workflowRunId}/state/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.addEventListener("state_snapshot", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        onSnapshot(data.state);
      } catch (e) {
        console.error("Failed to parse state_snapshot event", e);
      }
    });

    eventSource.addEventListener("state_update", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        onUpdate(data.changed_keys, data.updates);
      } catch (e) {
        console.error("Failed to parse state_update event", e);
      }
    });

    eventSource.onerror = (event) => {
      console.error("State SSE connection error:", event);
      onError?.(new Error("State SSE connection failed"));
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }

  /**
   * Respond to an interaction and stream the continuation.
   * Uses the /stream/respond endpoint that combines respond + stream.
   *
   * @param request - The respond request
   * @param onEvent - Called for each SSE event
   * @param onError - Called on error
   * @param onStart - Called after request succeeds but before streaming (for tracking completed interactions)
   */
  streamRespond(
    request: RespondRequest,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError?: (error: Error) => void,
    onStart?: () => void
  ): () => void {
    const url = `${this.baseUrl}/workflow/${request.workflow_run_id}/stream/respond`;

    // For POST requests with SSE, we need to use fetch + ReadableStream
    const controller = new AbortController();

    (async () => {
      try {
        const doFetch = async () => {
          const response = await fetch(url, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(request),
            signal: controller.signal,
            credentials: "include",
          });

          if (!response.ok) {
            throw new ApiError(response.status, response.statusText);
          }
          return response;
        };

        const response = await this.withAuth(doFetch);

        // Request succeeded - notify caller before streaming
        onStart?.();

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEventType: SSEEventType | null = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEventType = line.slice(7).trim() as SSEEventType;
            } else if (line.startsWith("data: ") && currentEventType) {
              try {
                const data = JSON.parse(line.slice(6));
                onEvent(currentEventType, data);
              } catch (e) {
                console.error("Failed to parse SSE data", e);
              }
              currentEventType = null;
            }
          }
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
  }

  // ============================================================
  // Sub-Action Streaming
  // ============================================================

  /**
   * Execute a sub-action and stream the results via SSE.
   *
   * Sub-actions allow triggering operations from within an interactive module
   * without completing the interaction. Results are mapped back to parent state.
   *
   * Events:
   * - progress: { workflow_run_id, sub_action_id, message }
   * - complete: { sub_action_id, updated_state }
   * - error: { message, sub_action_id? }
   *
   * @param workflowRunId - The workflow run ID
   * @param request - SubActionRequest with interaction_id, action_id, params
   * @param onEvent - Callback for SSE events
   * @param onError - Callback for connection errors
   * @returns Cleanup function to abort the stream
   */
  streamSubAction(
    workflowRunId: string,
    request: SubActionRequest,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void {
    const url = `${this.baseUrl}/workflow/${workflowRunId}/sub-action`;
    const controller = new AbortController();

    (async () => {
      try {
        const doFetch = async () => {
          const response = await fetch(url, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(request),
            signal: controller.signal,
            credentials: "include",
          });

          if (!response.ok) {
            throw new ApiError(response.status, response.statusText);
          }
          return response;
        };

        const response = await this.withAuth(doFetch);

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEventType: SSEEventType | null = null;
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEventType = line.slice(7).trim() as SSEEventType;
            } else if (line.startsWith("data: ") && currentEventType) {
              try {
                const data = JSON.parse(line.slice(6));
                onEvent(currentEventType, data);
              } catch (e) {
                console.error("[SubAction] Failed to parse SSE data", e);
              }
              currentEventType = null;
            }
          }
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
  }
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Export singleton instance
export const api = new ApiClient();

// Export class for custom instances
export { ApiClient };
