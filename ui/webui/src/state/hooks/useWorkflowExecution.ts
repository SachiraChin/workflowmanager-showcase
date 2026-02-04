/**
 * High-level hook that integrates SSE streaming with the workflow store.
 * This is the main hook components should use for workflow execution.
 *
 * IMPORTANT: This hook carefully separates state values from action functions.
 * - State values: Change when store updates, cause re-renders
 * - Actions: STABLE references that never change (safe for useCallback deps)
 *
 * This separation prevents infinite loops when callbacks are used in useEffect
 * dependency arrays.
 */

import { useCallback, useRef, useState } from "react";
import { useWorkflowStore } from "@/state/workflow-store";
import { useShallow } from "zustand/react/shallow";
import { api, ApiError } from "@/core/api";
import { API_URL } from "@/core/config";
import type {
  CompletedInteraction,
  InteractionRequest,
  InteractionResponseData,
  SSEEventType,
  StartWorkflowRequest,
  StartWorkflowByVersionRequest,
  VersionConfirmationResult,
  VersionDiff,
} from "@/core/types";
import { WEBUI_CAPABILITIES } from "@/lib/capabilities";

export interface VersionConfirmationState {
  pending: boolean;
  diff?: VersionDiff;
  oldHash?: string;
  newHash?: string;
  // For /start flow
  request?: StartWorkflowRequest;
  // For /resume flow
  resumeWorkflowRunId?: string;
  resumeContent?: string | Record<string, unknown>;
  resumeEntryPoint?: string;
}

export function useWorkflowExecution() {
  // ==========================================================================
  // Store State (reactive - changes trigger re-renders)
  // ==========================================================================
  const workflowRunId = useWorkflowStore((state) => state.workflowRunId);
  const projectName = useWorkflowStore((state) => state.projectName);
  const status = useWorkflowStore((state) => state.status);
  const progress = useWorkflowStore((state) => state.progress);
  const error = useWorkflowStore((state) => state.error);
  const currentInteraction = useWorkflowStore((state) => state.currentInteraction);
  const interactionHistory = useWorkflowStore((state) => state.interactionHistory);
  const completedInteractions = useWorkflowStore((state) => state.completedInteractions);
  const isConnected = useWorkflowStore((state) => state.isConnected);
  const isProcessing = useWorkflowStore((state) => state.isProcessing);
  const elapsedMs = useWorkflowStore((state) => state.elapsedMs);
  const lastMessage = useWorkflowStore((state) => state.lastMessage);
  const moduleOutputs = useWorkflowStore((state) => state.moduleOutputs);
  const events = useWorkflowStore((state) => state.events);
  const selectedProvider = useWorkflowStore((state) => state.selectedProvider);
  const selectedModel = useWorkflowStore((state) => state.selectedModel);

  // ==========================================================================
  // Store Actions (STABLE - never changes, safe for useCallback dependencies)
  // Using useShallow to prevent re-renders when the object reference changes
  // but the individual action functions remain the same (they are always stable)
  // ==========================================================================
  const actions = useWorkflowStore(
    useShallow((state) => ({
      startWorkflow: state.startWorkflow,
      setStatus: state.setStatus,
      setProgress: state.setProgress,
      setError: state.setError,
      reset: state.reset,
      setCurrentInteraction: state.setCurrentInteraction,
      updateCurrentInteractionDisplayData: state.updateCurrentInteractionDisplayData,
      addToInteractionHistory: state.addToInteractionHistory,
      setCompletedInteractions: state.setCompletedInteractions,
      addCompletedInteraction: state.addCompletedInteraction,
      setConnected: state.setConnected,
      setProcessing: state.setProcessing,
      updateProgress: state.updateProgress,
      setModuleOutputs: state.setModuleOutputs,
      addEvent: state.addEvent,
      clearEvents: state.clearEvents,
      setAccessDenied: state.setAccessDenied,
    }))
  );

  // ==========================================================================
  // Refs and Local State
  // ==========================================================================
  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // We need refs to access current state values in callbacks without adding
  // them as dependencies (which would make the callbacks unstable)
  const workflowRunIdRef = useRef(workflowRunId);
  const currentInteractionRef = useRef(currentInteraction);
  const selectedProviderRef = useRef(selectedProvider);
  const selectedModelRef = useRef(selectedModel);

  // Keep refs in sync with state
  workflowRunIdRef.current = workflowRunId;
  currentInteractionRef.current = currentInteraction;
  selectedProviderRef.current = selectedProvider;
  selectedModelRef.current = selectedModel;

  /**
   * Refresh current interaction's display_data from server.
   * Fetches resolved data using current workflow state (includes sub-action results).
   */
  const refreshInteractionDisplayData = useCallback(
    async (wfRunId: string, interactionId: string) => {
      try {
        const result = await api.getInteractionData(wfRunId, interactionId);
        actions.updateCurrentInteractionDisplayData(result.display_data);
      } catch (e) {
        console.error("[refreshInteractionDisplayData] Failed:", e);
      }
    },
    [actions]
  );

  // Version confirmation state
  const [versionConfirmation, setVersionConfirmation] = useState<VersionConfirmationState>({
    pending: false,
  });

  // ==========================================================================
  // Stable Callbacks (dependencies are only stable refs and actions)
  // ==========================================================================

  // Track if we're disconnected to prevent processing stale events
  const isDisconnectedRef = useRef(false);

  const disconnect = useCallback(() => {
    isDisconnectedRef.current = true;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    actions.setConnected(false);
  }, [actions]);

  const handleSSEEvent = useCallback(
    (eventType: SSEEventType, data: Record<string, unknown>) => {
      // Ignore events if we've disconnected (prevents stale events from old workflows)
      if (isDisconnectedRef.current) {
        console.log(`[SSE] Ignoring stale event after disconnect: ${eventType}`);
        return;
      }

      // Validate workflow_run_id matches current workflow (prevents cross-workflow contamination)
      const eventWorkflowId = data.workflow_run_id as string | undefined;
      const currentWorkflowId = workflowRunIdRef.current;
      if (eventWorkflowId && currentWorkflowId && eventWorkflowId !== currentWorkflowId) {
        console.warn(`[SSE] Ignoring event for wrong workflow: expected ${currentWorkflowId}, got ${eventWorkflowId}`);
        return;
      }

      // Skip logging progress events (too noisy)
      if (eventType !== "progress") {
        console.log(`[SSE] Received event: ${eventType}`, data);
      }
      actions.addEvent(eventType, data);

      switch (eventType) {
        case "started":
          actions.setStatus("processing");
          actions.setProcessing(true);
          actions.setCurrentInteraction(null);
          break;

        case "progress":
          actions.updateProgress(
            (data.elapsed_ms as number) || 0,
            data.message as string | undefined
          );
          break;

        case "interaction":
          console.log("[SSE] Setting new interaction:", data);
          actions.setStatus("awaiting_input");
          actions.setCurrentInteraction(data as unknown as InteractionRequest);
          actions.addToInteractionHistory(data as unknown as InteractionRequest);
          // Interaction is a terminal event (like complete/error/cancelled).
          // Server closes SSE connection when awaiting input, so disconnect
          // to prevent EventSource auto-reconnect from interfering with respond().
          disconnect();
          break;

        case "complete":
          actions.setStatus("completed");
          actions.setProcessing(false);
          actions.setCurrentInteraction(null);
          if (data && typeof data === "object") {
            actions.setModuleOutputs(data);
          }
          disconnect();
          break;

        case "error":
          actions.setStatus("error");
          actions.setError((data.message as string) || "Unknown error");
          disconnect();
          break;

        case "cancelled":
          actions.setError("Workflow cancelled");
          actions.setProcessing(false);
          disconnect();
          break;
      }
    },
    [actions, disconnect]
  );

  const connectToStream = useCallback(
    (streamWorkflowRunId: string) => {
      disconnect();
      isDisconnectedRef.current = false;  // Reset for new connection

      const url = `${API_URL}/workflow/${streamWorkflowRunId}/stream`;
      const eventSource = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        actions.setConnected(true);
      };

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
            handleSSEEvent(eventType, data);
          } catch (e) {
            console.error(`Failed to parse SSE event: ${eventType}`, e);
          }
        });
      });

      eventSource.onerror = (event) => {
        console.error("[SSE] Connection error:", event);
        actions.setConnected(false);
        actions.setError("SSE connection lost. Please try again.");
        disconnect();
      };
    },
    [actions, disconnect, handleSSEEvent]
  );

  /**
   * Start a new workflow
   */
  const startWorkflow = useCallback(
    async (request: StartWorkflowRequest) => {
      disconnect();
      actions.reset();
      setVersionConfirmation({ pending: false });

      // Add WebUI capabilities to request
      const requestWithCapabilities = {
        ...request,
        capabilities: WEBUI_CAPABILITIES,
      };

      try {
        const data = await api.startWorkflow(requestWithCapabilities);

        // Check if version confirmation is required
        if (data.result?.requires_confirmation) {
          const result = data.result as unknown as VersionConfirmationResult;
          setVersionConfirmation({
            pending: true,
            diff: result.version_diff,
            oldHash: result.old_hash,
            newHash: result.new_hash,
            request,
          });
          return data;
        }

        actions.startWorkflow(data.workflow_run_id, request.project_name);
        actions.setStatus(data.status);

        if (data.progress) {
          actions.setProgress(data.progress);
        }

        // If there's an immediate interaction, set it
        if (data.interaction_request) {
          actions.setCurrentInteraction(data.interaction_request);
          actions.addToInteractionHistory(data.interaction_request);
        } else if (data.status === "processing") {
          connectToStream(data.workflow_run_id);
        }

        return data;
      } catch (error) {
        actions.setError((error as Error).message);
        throw error;
      }
    },
    [actions, disconnect, connectToStream]
  );

  /**
   * Start a workflow using an existing version ID
   */
  const startWorkflowByVersion = useCallback(
    async (versionId: string, request: StartWorkflowByVersionRequest) => {
      disconnect();
      actions.reset();
      setVersionConfirmation({ pending: false });

      // Add WebUI capabilities to request
      const requestWithCapabilities = {
        ...request,
        capabilities: WEBUI_CAPABILITIES,
      };

      try {
        const data = await api.startWorkflowByVersion(versionId, requestWithCapabilities);

        actions.startWorkflow(data.workflow_run_id, request.project_name);
        actions.setStatus(data.status);

        if (data.progress) {
          actions.setProgress(data.progress);
        }

        // If there's an immediate interaction, set it
        if (data.interaction_request) {
          actions.setCurrentInteraction(data.interaction_request);
          actions.addToInteractionHistory(data.interaction_request);
        } else if (data.status === "processing") {
          connectToStream(data.workflow_run_id);
        }

        return data;
      } catch (error) {
        actions.setError((error as Error).message);
        throw error;
      }
    },
    [actions, disconnect, connectToStream]
  );

  /**
   * Confirm version change and start workflow
   */
  const confirmVersionAndStart = useCallback(async () => {
    if (!versionConfirmation.request) {
      throw new Error("No pending version confirmation");
    }

    const request = versionConfirmation.request;
    setVersionConfirmation({ pending: false });

    // Add WebUI capabilities to request
    const requestWithCapabilities = {
      ...request,
      capabilities: WEBUI_CAPABILITIES,
    };

    try {
      const data = await api.confirmWorkflowStart(requestWithCapabilities);

      actions.startWorkflow(data.workflow_run_id, request.project_name);
      actions.setStatus(data.status);

      if (data.progress) {
        actions.setProgress(data.progress);
      }

      if (data.interaction_request) {
        actions.setCurrentInteraction(data.interaction_request);
        actions.addToInteractionHistory(data.interaction_request);
      } else if (data.status === "processing") {
        connectToStream(data.workflow_run_id);
      }

      return data;
    } catch (error) {
      actions.setError((error as Error).message);
      throw error;
    }
  }, [versionConfirmation, actions, connectToStream]);

  /**
   * Cancel version confirmation
   */
  const cancelVersionConfirmation = useCallback(() => {
    setVersionConfirmation({ pending: false });
  }, []);

  /**
   * Respond to current interaction and continue execution
   */
  const respond = useCallback(
    async (response: InteractionResponseData) => {
      // Use refs to get current values without adding them as dependencies
      const currentWorkflowRunId = workflowRunIdRef.current;
      const interaction = currentInteractionRef.current;

      if (!currentWorkflowRunId || !interaction) {
        throw new Error("No active interaction to respond to");
      }

      // Keep the interaction until we confirm the request succeeded
      const previousInteraction = interaction;
      actions.setProcessing(true);
      isDisconnectedRef.current = false;  // Reset for new connection

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        actions.setConnected(true);

        // Build request with optional ai_config override
        const currentProvider = selectedProviderRef.current;
        const currentModel = selectedModelRef.current;
        const requestBody: {
          workflow_run_id: string;
          interaction_id: string;
          response: InteractionResponseData;
          ai_config?: { provider: string; model: string };
        } = {
          workflow_run_id: currentWorkflowRunId,
          interaction_id: interaction.interaction_id,
          response,
        };
        
        // Include ai_config only if user has selected a specific model
        if (currentProvider && currentModel) {
          requestBody.ai_config = {
            provider: currentProvider,
            model: currentModel,
          };
        }
        
        console.log("[respond] Sending request body:", requestBody);
        console.log("[respond] response.form_data:", response.form_data);

        // Use centralized fetchResponse - handles 401 retry and 403 globally
        const fetchResponse = await api.fetchResponse(
          `/workflow/${currentWorkflowRunId}/stream/respond`,
          {
            method: "POST",
            body: JSON.stringify(requestBody),
          },
          controller.signal
        );

        // Track this as a completed interaction
        const completedInteraction: CompletedInteraction = {
          interaction_id: previousInteraction.interaction_id,
          request: previousInteraction,
          response,
          timestamp: new Date().toISOString(),
        };
        actions.addCompletedInteraction(completedInteraction);

        // Process the streaming response
        const reader = fetchResponse.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let currentEventType: SSEEventType | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEventType = line.slice(7).trim() as SSEEventType;
            } else if (line.startsWith("data: ") && currentEventType) {
              try {
                const data = JSON.parse(line.slice(6));
                handleSSEEvent(currentEventType, data);
              } catch (e) {
                console.error("Failed to parse SSE data", e);
              }
              currentEventType = null;
            }
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          // 403 is handled globally by api.fetchResponse
          // For 403, the global handler already reset state and set accessDenied
          // Just silently return to avoid showing duplicate error
          if (error instanceof ApiError && error.status === 403) {
            return;
          }
          actions.setError((error as Error).message);
          // Restore the interaction so user can retry
          actions.setCurrentInteraction(previousInteraction);
          actions.setProcessing(false);
        }
      } finally {
        actions.setConnected(false);
      }
    },
    [actions, handleSSEEvent]
  );

  /**
   * Cancel current workflow execution
   */
  const cancel = useCallback(async () => {
    const currentWorkflowRunId = workflowRunIdRef.current;
    if (!currentWorkflowRunId) return;

    disconnect();

    try {
      await api.cancel(currentWorkflowRunId);
    } catch (e) {
      console.error("Failed to cancel workflow", e);
    }
  }, [disconnect]);

  /**
   * Resume an existing workflow by fetching its current state.
   *
   * Uses the /resume endpoint to get current state and pending interaction.
   * Only connects to SSE stream if workflow is actively processing.
   */
  const resumeWorkflow = useCallback(
    async (resumeWorkflowRunId: string, resumeProjectName: string) => {
      // Prevent duplicate resume calls for the same workflow
      // Update ref immediately to prevent race conditions (before any async operations)
      if (workflowRunIdRef.current === resumeWorkflowRunId) {
        return;
      }
      workflowRunIdRef.current = resumeWorkflowRunId;

      disconnect();
      // NOTE: Do NOT call actions.reset() here!
      // reset() sets workflowRunId to null, which triggers re-renders and can cause
      // infinite loops when resumeWorkflow is called from a useEffect that depends on workflowRunId.
      // startWorkflow() already spreads initialState internally, so it resets everything
      // while also setting the new workflowRunId atomically.
      actions.startWorkflow(resumeWorkflowRunId, resumeProjectName);
      actions.setStatus("processing");

      // Fetch interaction history in background (don't block resume)
      api.getInteractionHistory(resumeWorkflowRunId)
        .then((historyResponse) => {
          actions.setCompletedInteractions(historyResponse.interactions);
        })
        .catch((e) => {
          console.debug("Failed to fetch interaction history", e);
        });

      try {
        // Call /resume endpoint - returns same response as /start
        const data = await api.resume(resumeWorkflowRunId);

        actions.setStatus(data.status);

        if (data.progress) {
          actions.setProgress(data.progress);
        }

        // Handle response same as /start response
        if (data.status === "awaiting_input" && data.interaction_request) {
          // Pending interaction - display immediately, no SSE needed
          actions.setCurrentInteraction(data.interaction_request);
          actions.addToInteractionHistory(data.interaction_request);
          // Fetch latest display_data (includes sub-action results)
          refreshInteractionDisplayData(
            resumeWorkflowRunId,
            data.interaction_request.interaction_id
          );
        } else if (data.status === "processing") {
          // Only connect to SSE if actively processing
          connectToStream(resumeWorkflowRunId);
        } else if (data.status === "completed") {
          // Workflow already completed
          if (data.result) {
            actions.setModuleOutputs(data.result);
          }
        } else if (data.status === "error") {
          actions.setError(data.error || "Workflow failed");
        }
      } catch (error) {
        // 403 is handled globally by api.fetchResponse (called internally by api.resume)
        // Just silently return to avoid showing duplicate error
        if (error instanceof ApiError && error.status === 403) {
          return;
        }
        actions.setError((error as Error).message);
      }
    },
    [actions, disconnect, connectToStream, refreshInteractionDisplayData]
  );

  /**
   * Resume an existing workflow with updated workflow content.
   *
   * Calls /resume with workflow_content. If version changed, returns
   * requires_confirmation and the diff dialog should be shown.
   */
  const resumeWithUpdate = useCallback(
    async (
      resumeWorkflowRunId: string,
      workflowContent: string | Record<string, unknown>,
      entryPoint?: string
    ) => {
      disconnect();
      actions.reset();
      setVersionConfirmation({ pending: false });

      try {
        const data = await api.resumeWithContent(
          resumeWorkflowRunId,
          workflowContent,
          entryPoint,
          WEBUI_CAPABILITIES
        );

        // Check if version confirmation is required
        if (data.result?.requires_confirmation) {
          const result = data.result as unknown as VersionConfirmationResult;
          setVersionConfirmation({
            pending: true,
            diff: result.version_diff,
            oldHash: result.old_hash,
            newHash: result.new_hash,
            // Store resume-specific data for confirm
            resumeWorkflowRunId,
            resumeContent: workflowContent,
            resumeEntryPoint: entryPoint,
          });
          return data;
        }

        // No confirmation needed - workflow resumed
        // Note: project_name comes from result for resume operations
        const projectName = (data.result?.project_name as string) || "";
        actions.startWorkflow(data.workflow_run_id, projectName);
        actions.setStatus(data.status);

        if (data.progress) {
          actions.setProgress(data.progress);
        }

        if (data.interaction_request) {
          actions.setCurrentInteraction(data.interaction_request);
          actions.addToInteractionHistory(data.interaction_request);
        } else if (data.status === "processing") {
          connectToStream(data.workflow_run_id);
        }

        return data;
      } catch (error) {
        actions.setError((error as Error).message);
        throw error;
      }
    },
    [actions, disconnect, connectToStream]
  );

  /**
   * Confirm version change and proceed with resume.
   *
   * Works for both /start and /resume flows based on what's in versionConfirmation state.
   */
  const confirmVersionAndResume = useCallback(async () => {
    // Check if this is a resume flow
    if (versionConfirmation.resumeWorkflowRunId) {
      const { resumeWorkflowRunId, resumeContent, resumeEntryPoint } = versionConfirmation;
      setVersionConfirmation({ pending: false });

      try {
        const data = await api.confirmResume(
          resumeWorkflowRunId,
          resumeContent!,
          resumeEntryPoint,
          WEBUI_CAPABILITIES
        );

        // Note: project_name comes from result for confirm resume operations
        const confirmProjectName = (data.result?.project_name as string) || "";
        actions.startWorkflow(data.workflow_run_id, confirmProjectName);
        actions.setStatus(data.status);

        if (data.progress) {
          actions.setProgress(data.progress);
        }

        if (data.interaction_request) {
          actions.setCurrentInteraction(data.interaction_request);
          actions.addToInteractionHistory(data.interaction_request);
        } else if (data.status === "processing") {
          connectToStream(data.workflow_run_id);
        }

        return data;
      } catch (error) {
        actions.setError((error as Error).message);
        throw error;
      }
    }

    // Fall back to original start flow
    return confirmVersionAndStart();
  }, [versionConfirmation, actions, connectToStream, confirmVersionAndStart]);

  return {
    // State (from store - reactive)
    workflowRunId,
    projectName,
    status,
    progress,
    error,
    currentInteraction,
    interactionHistory,
    completedInteractions,
    isConnected,
    isProcessing,
    elapsedMs,
    lastMessage,
    moduleOutputs,
    events,

    // Version confirmation state
    versionConfirmation,

    // Actions (stable callbacks)
    startWorkflow,
    startWorkflowByVersion,
    resumeWorkflow,
    resumeWithUpdate,
    respond,
    cancel,
    disconnect,
    reset: actions.reset,
    clearEvents: actions.clearEvents,
    refreshInteractionDisplayData,

    // Version confirmation actions
    confirmVersionAndStart,
    confirmVersionAndResume,
    cancelVersionConfirmation,
  };
}
