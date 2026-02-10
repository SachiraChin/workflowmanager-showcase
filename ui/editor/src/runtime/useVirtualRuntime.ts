/**
 * React hook for VirtualRuntime integration.
 *
 * Provides a React-friendly interface to the VirtualRuntime class,
 * managing state updates and providing reactive values.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
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
  /** Whether the runtime panel is open */
  panelOpen: boolean;
  /** Whether the state panel is open */
  statePanelOpen: boolean;
  /** Current target module (the module we're trying to reach) */
  currentTarget: ModuleLocation | null;
  /** Module to filter state display to (null for full state) */
  stateUpToModule: ModuleLocation | null;
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
   * Run workflow to a target module for state inspection only.
   * Opens state panel instead of preview panel.
   * @param workflow - The full workflow definition
   * @param target - The module to run to
   * @param selections - Pre-defined selections for prerequisite interactive modules
   */
  runToModuleForState: (
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
   * @param closePanel - Whether to close the panel (default: false)
   */
  reset: (closePanel?: boolean) => void;

  /**
   * Open the runtime panel.
   */
  openPanel: () => void;

  /**
   * Close the runtime panel.
   */
  closePanel: () => void;

  /**
   * Set the panel open state directly (for controlled usage).
   */
  setPanelOpen: (open: boolean) => void;

  /**
   * Open the state panel (preserves current stateUpToModule filter).
   */
  openStatePanel: () => void;

  /**
   * Open the state panel showing full state (clears filter).
   */
  openFullStatePanel: () => void;

  /**
   * Close the state panel.
   */
  closeStatePanel: () => void;

  /**
   * Set the state panel open state directly (for controlled usage).
   */
  setStatePanelOpen: (open: boolean) => void;
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
  const [panelOpen, setPanelOpenState] = useState(false);
  const [statePanelOpen, setStatePanelOpenState] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<ModuleLocation | null>(null);
  const [stateUpToModule, setStateUpToModule] = useState<ModuleLocation | null>(null);

  // Register panel change callbacks on mount
  useEffect(() => {
    runtime.setOnPanelChange((open) => {
      setPanelOpenState(open);
    });
    runtime.setOnStatePanelChange((open) => {
      setStatePanelOpenState(open);
    });
    // Sync initial state
    setPanelOpenState(runtime.isPanelOpen());
    setStatePanelOpenState(runtime.isStatePanelOpen());

    return () => {
      runtime.setOnPanelChange(null);
      runtime.setOnStatePanelChange(null);
    };
  }, [runtime]);

  // Sync state from runtime
  const syncState = useCallback(() => {
    setStatus(runtime.getStatus());
    setLastResponse(runtime.getLastResponse());
    setError(runtime.getLastError());
    setState(runtime.getLastResponse()?.state ?? null);
    setPanelOpenState(runtime.isPanelOpen());
    setStatePanelOpenState(runtime.isStatePanelOpen());
    setCurrentTarget(runtime.getCurrentTarget());
    setStateUpToModule(runtime.getStateUpToModule());
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
      // Clear previous response immediately so panel shows loading state
      setLastResponse(null);
      setState(null);

      try {
        await runtime.runToModule(workflow, target, selections);
      } finally {
        syncState();
        setBusy(false);
      }
    },
    [runtime, syncState]
  );

  const runToModuleForState = useCallback(
    async (
      workflow: WorkflowDefinition,
      target: ModuleLocation,
      selections: ModuleSelection[] = []
    ) => {
      setBusy(true);
      setError(null);
      // Clear previous response immediately so panel shows loading state
      setLastResponse(null);
      setState(null);

      try {
        await runtime.runToModuleForState(workflow, target, selections);
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

  const reset = useCallback(
    (closePanel?: boolean) => {
      runtime.reset(closePanel);
      syncState();
    },
    [runtime, syncState]
  );

  const openPanel = useCallback(() => {
    runtime.openPanel();
  }, [runtime]);

  const closePanel = useCallback(() => {
    runtime.closePanel();
  }, [runtime]);

  const setPanelOpen = useCallback(
    (open: boolean) => {
      runtime.setPanelOpen(open);
    },
    [runtime]
  );

  const openStatePanel = useCallback(() => {
    runtime.openStatePanel();
    syncState();  // Sync to get stateUpToModule
  }, [runtime, syncState]);

  const openFullStatePanel = useCallback(() => {
    runtime.openFullStatePanel();
    syncState();  // Sync to get stateUpToModule (null)
  }, [runtime, syncState]);

  const closeStatePanel = useCallback(() => {
    runtime.closeStatePanel();
  }, [runtime]);

  const setStatePanelOpen = useCallback(
    (open: boolean) => {
      runtime.setStatePanelOpen(open);
    },
    [runtime]
  );

  // Memoize actions object
  const actions = useMemo<VirtualRuntimeActions>(
    () => ({
      runToModule,
      runToModuleForState,
      submitResponse,
      getCheckpoint,
      reset,
      openPanel,
      closePanel,
      setPanelOpen,
      openStatePanel,
      openFullStatePanel,
      closeStatePanel,
      setStatePanelOpen,
    }),
    [
      runToModule,
      runToModuleForState,
      submitResponse,
      getCheckpoint,
      reset,
      openPanel,
      closePanel,
      setPanelOpen,
      openStatePanel,
      openFullStatePanel,
      closeStatePanel,
      setStatePanelOpen,
    ]
  );

  return {
    status,
    busy,
    lastResponse,
    error,
    state,
    panelOpen,
    statePanelOpen,
    currentTarget,
    stateUpToModule,
    actions,
  };
}
