/**
 * Hook for streaming workflow state updates.
 * Maintains a local copy of workflow state synchronized from server.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/config";

interface UseWorkflowStateOptions {
  baseUrl?: string;
  autoConnect?: boolean;
  onStateChange?: (state: Record<string, unknown>) => void;
}

export function useWorkflowState(
  workflowRunId: string | null,
  options: UseWorkflowStateOptions = {}
) {
  const {
    baseUrl = API_URL,
    autoConnect = true,
    onStateChange,
  } = options;

  const [state, setState] = useState<Record<string, unknown>>({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!workflowRunId) return;

    disconnect();

    const url = `${baseUrl}/workflow/${workflowRunId}/state/v2/stream`;
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    eventSource.addEventListener("state_snapshot", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const newState = data.state || {};
        setState(newState);
        onStateChange?.(newState);
      } catch (e) {
        console.error("Failed to parse state_snapshot event", e);
      }
    });

    eventSource.addEventListener("state_update", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const updates = data.updates || {};
        setState((prev) => {
          const newState = { ...prev, ...updates };
          onStateChange?.(newState);
          return newState;
        });
      } catch (e) {
        console.error("Failed to parse state_update event", e);
      }
    });

    eventSource.onerror = () => {
      setIsConnected(false);
      setError("State stream connection lost");
      disconnect();
    };
  }, [baseUrl, workflowRunId, disconnect, onStateChange]);

  // Auto-connect when workflowRunId changes
  useEffect(() => {
    if (autoConnect && workflowRunId) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [workflowRunId, autoConnect, connect, disconnect]);

  /**
   * Get a specific value from state with optional default
   */
  const getValue = useCallback(
    <T>(key: string, defaultValue?: T): T | undefined => {
      const keys = key.split(".");
      let value: unknown = state;
      for (const k of keys) {
        if (value && typeof value === "object" && k in value) {
          value = (value as Record<string, unknown>)[k];
        } else {
          return defaultValue;
        }
      }
      return value as T;
    },
    [state]
  );

  /**
   * Fetch state once (non-streaming) using hierarchical v2 endpoint
   */
  const fetchState = useCallback(async () => {
    if (!workflowRunId) return;

    try {
      const response = await fetch(`${baseUrl}/workflow/${workflowRunId}/state/v2`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const newState = data.state || {};
      setState(newState);
      onStateChange?.(newState);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [baseUrl, workflowRunId, onStateChange]);

  return {
    state,
    isConnected,
    error,
    connect,
    disconnect,
    getValue,
    fetchState,
  };
}
