/**
 * React hook for VirtualRuntime integration.
 *
 * Provides a React-friendly interface to the VirtualRuntime class,
 * managing state updates and providing reactive values.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import type { WorkflowDefinition, InteractionResponseData } from "@wfm/shared";
import { VirtualRuntime } from "./VirtualRuntime";
import type {
  ModuleLocation,
  ModuleSelection,
  VirtualWorkflowResponse,
  RuntimeStatus,
  ModuleCheckpoint,
} from "./types";

// =============================================================================
// Hook State Types
// =============================================================================

export interface VirtualRuntimeState {
  /** Current runtime status */
  status: RuntimeStatus;
  /** Whether an operation is in progress */
  busy: boolean;
  /** Last response from server */
  lastResponse: VirtualWorkflowResponse | null;
  /** Last error message */
  error: string | null;
  /** Current state (module outputs) */
  state: Record<string, unknown> | null;
}

export interface VirtualRuntimeActions {
  /**
   * Run workflow to a target module.
   * @param workflow - The full workflow definition
   * @param target - The module to run to
   * @param selections - Pre-defined selections for prerequisite interactive modules
   */
  runToModule: (
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections?: ModuleSelection[]
  ) => Promise<void>;

  /**
   * Submit a response to the current interaction.
   * @param workflow - The full workflow definition
   * @param target - The target module
   * @param response - User's response to the interaction
   */
  submitResponse: (
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    response: InteractionResponseData
  ) => Promise<void>;

  /**
   * Get checkpoint for a module if it exists.
   */
  getCheckpoint: (location: ModuleLocation) => ModuleCheckpoint | null;

  /**
   * Reset the runtime, clearing all checkpoints and state.
   */
  reset: () => void;
}

export interface UseVirtualRuntimeReturn extends VirtualRuntimeState {
  actions: VirtualRuntimeActions;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook to use VirtualRuntime in React components.
 *
 * Creates and manages a VirtualRuntime instance, providing reactive
 * state updates when runtime status changes.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { status, busy, lastResponse, error, state, actions } = useVirtualRuntime();
 *
 *   const handleRun = async () => {
 *     await actions.runToModule(workflow, { step_id: "step1", module_name: "select" });
 *   };
 *
 *   if (status === "awaiting_input" && lastResponse?.interaction_request) {
 *     return <InteractionHost request={lastResponse.interaction_request} ... />;
 *   }
 *
 *   return <button onClick={handleRun}>Run</button>;
 * }
 * ```
 */
export function useVirtualRuntime(): UseVirtualRuntimeReturn {
  // Create runtime instance (stable across renders)
  const runtimeRef = useRef<VirtualRuntime | null>(null);
  if (!runtimeRef.current) {
    runtimeRef.current = new VirtualRuntime();
  }
  const runtime = runtimeRef.current;

  // Reactive state
  const [status, setStatus] = useState<RuntimeStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [lastResponse, setLastResponse] =
    useState<VirtualWorkflowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<Record<string, unknown> | null>(null);

  // Sync state from runtime
  const syncState = useCallback(() => {
    setStatus(runtime.getStatus());
    setLastResponse(runtime.getLastResponse());
    setError(runtime.getLastError());
    setState(runtime.getLastResponse()?.state ?? null);
  }, [runtime]);

  // Actions
  const runToModule = useCallback(
    async (
      workflow: WorkflowDefinition,
      target: ModuleLocation,
      selections: ModuleSelection[] = []
    ) => {
      setBusy(true);
      setError(null);

      try {
        await runtime.runToModule(workflow, target, selections);
      } finally {
        syncState();
        setBusy(false);
      }
    },
    [runtime, syncState]
  );

  const submitResponse = useCallback(
    async (
      workflow: WorkflowDefinition,
      target: ModuleLocation,
      response: InteractionResponseData
    ) => {
      setBusy(true);
      setError(null);

      try {
        await runtime.submitResponse(workflow, target, response);
      } finally {
        syncState();
        setBusy(false);
      }
    },
    [runtime, syncState]
  );

  const getCheckpoint = useCallback(
    (location: ModuleLocation) => {
      return runtime.getCheckpoint(location);
    },
    [runtime]
  );

  const reset = useCallback(() => {
    runtime.reset();
    syncState();
  }, [runtime, syncState]);

  // Memoize actions object
  const actions = useMemo<VirtualRuntimeActions>(
    () => ({
      runToModule,
      submitResponse,
      getCheckpoint,
      reset,
    }),
    [runToModule, submitResponse, getCheckpoint, reset]
  );

  return {
    status,
    busy,
    lastResponse,
    error,
    state,
    actions,
  };
}
