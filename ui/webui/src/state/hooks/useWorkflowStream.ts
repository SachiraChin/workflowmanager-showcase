/**
 * Hook for managing SSE streaming connection to workflow execution.
 * Handles connection lifecycle, event parsing, and reconnection.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SSEEventType, InteractionRequest } from "@/core/types";
import { API_URL } from "@/core/config";

export interface StreamEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface WorkflowStreamState {
  isConnected: boolean;
  isProcessing: boolean;
  error: string | null;
  events: StreamEvent[];
  currentInteraction: InteractionRequest | null;
  elapsedMs: number;
  lastMessage: string | null;
}

interface UseWorkflowStreamOptions {
  baseUrl?: string;
  onEvent?: (event: StreamEvent) => void;
  onInteraction?: (interaction: InteractionRequest) => void;
  onComplete?: (data: Record<string, unknown>) => void;
  onError?: (error: string) => void;
}

export function useWorkflowStream(options: UseWorkflowStreamOptions = {}) {
  const {
    baseUrl = API_URL,
    onEvent,
    onInteraction,
    onComplete,
    onError,
  } = options;

  const [state, setState] = useState<WorkflowStreamState>({
    isConnected: false,
    isProcessing: false,
    error: null,
    events: [],
    currentInteraction: null,
    elapsedMs: 0,
    lastMessage: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isConnected: false,
      isProcessing: false,
    }));
  }, []);

  const addEvent = useCallback((type: SSEEventType, data: Record<string, unknown>) => {
    const event: StreamEvent = { type, data, timestamp: new Date() };
    setState((prev) => ({
      ...prev,
      events: [...prev.events, event],
    }));
    onEvent?.(event);
    return event;
  }, [onEvent]);

  const handleSSEEvent = useCallback(
    (eventType: SSEEventType, data: Record<string, unknown>) => {
      addEvent(eventType, data);

      switch (eventType) {
        case "started":
          setState((prev) => ({
            ...prev,
            isProcessing: true,
            error: null,
            currentInteraction: null,
          }));
          break;

        case "progress":
          setState((prev) => ({
            ...prev,
            elapsedMs: (data.elapsed_ms as number) || prev.elapsedMs,
            lastMessage: (data.message as string) || prev.lastMessage,
          }));
          break;

        case "interaction":
          const interaction = data as unknown as InteractionRequest;
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            currentInteraction: interaction,
          }));
          onInteraction?.(interaction);
          break;

        case "complete":
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            currentInteraction: null,
          }));
          onComplete?.(data);
          disconnect();
          break;

        case "error":
          const errorMsg = (data.message as string) || "Unknown error";
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            error: errorMsg,
          }));
          onError?.(errorMsg);
          disconnect();
          break;

        case "cancelled":
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            error: "Workflow cancelled",
          }));
          disconnect();
          break;
      }
    },
    [addEvent, disconnect, onInteraction, onComplete, onError]
  );

  /**
   * Connect to workflow stream using EventSource (GET endpoint)
   */
  const connect = useCallback(
    (workflowRunId: string) => {
      disconnect();

      const url = `${baseUrl}/workflow/${workflowRunId}/stream`;
      const eventSource = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        setState((prev) => ({
          ...prev,
          isConnected: true,
          error: null,
        }));
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
        setState((prev) => ({
          ...prev,
          isConnected: false,
          error: "SSE connection lost. Please try again.",
        }));
        disconnect();
      };
    },
    [baseUrl, disconnect, handleSSEEvent]
  );

  /**
   * Send a response and stream the continuation (POST endpoint with SSE response)
   */
  const respondAndStream = useCallback(
    async (
      workflowRunId: string,
      interactionId: string,
      response: Record<string, unknown>
    ) => {
      disconnect();

      const url = `${baseUrl}/workflow/${workflowRunId}/stream/respond`;
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setState((prev) => ({
        ...prev,
        isConnected: true,
        isProcessing: true,
        currentInteraction: null,
        error: null,
      }));

      try {
        const fetchResponse = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            workflow_run_id: workflowRunId,
            interaction_id: interactionId,
            response,
          }),
          signal: controller.signal,
        });

        if (!fetchResponse.ok) {
          throw new Error(`HTTP ${fetchResponse.status}: ${fetchResponse.statusText}`);
        }

        const reader = fetchResponse.body?.getReader();
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
          const errorMsg = (error as Error).message;
          setState((prev) => ({
            ...prev,
            isProcessing: false,
            error: errorMsg,
          }));
          onError?.(errorMsg);
        }
      } finally {
        setState((prev) => ({
          ...prev,
          isConnected: false,
        }));
      }
    },
    [baseUrl, disconnect, handleSSEEvent, onError]
  );

  const clearEvents = useCallback(() => {
    setState((prev) => ({
      ...prev,
      events: [],
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      error: null,
    }));
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    respondAndStream,
    clearEvents,
    clearError,
  };
}
