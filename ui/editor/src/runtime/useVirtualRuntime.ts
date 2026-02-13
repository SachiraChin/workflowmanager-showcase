/**
 * React hook for VirtualRuntime integration.
 *
 * Provides a React-friendly interface to the VirtualRuntime class,
 * managing state updates and providing reactive values.
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { WorkflowDefinition, InteractionResponseData } from "@wfm/shared";
import { useWorkflowStore } from "@wfm/shared";
import { VirtualRuntime } from "./VirtualRuntime";
import type {
  ModuleLocation,
  ModuleSelection,
  VirtualWorkflowResponse,
  VirtualStateResponse,
  CompletedInteraction,
  RuntimeStatus,
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
  /** Current state from /virtual/state endpoint */
  state: VirtualStateResponse | null;
  /** Whether the runtime panel is open */
  panelOpen: boolean;
  /** Whether the state panel is open */
  statePanelOpen: boolean;
  /** Current target module (the module we're trying to reach) */
  currentTarget: ModuleLocation | null;
  /** Module to filter state display to (null for full state) */
  stateUpToModule: ModuleLocation | null;
  /** Whether mock mode is enabled (default: true) */
  mockMode: boolean;
  /** Get current virtualDb state (for virtual API client) */
  getVirtualDb: () => string | null;
  /** Get current virtual run ID (for virtual API client) */
  getVirtualRunId: () => string | null;
  /** Set virtualDb state (called when sub-action updates state) */
  setVirtualDb: (db: string) => void;
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
    selections?: ModuleSelection[],
    options?: { mockModeOverride?: boolean }
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
   * Run workflow to a target module silently (no panel opens).
   * Used for loading data in the background.
   * Returns the state after execution.
   * @param workflow - The full workflow definition
   * @param target - The module to run to
   * @param selections - Pre-defined selections for prerequisite interactive modules
   */
  runToModuleSilent: (
    workflow: WorkflowDefinition,
    target: ModuleLocation,
    selections?: ModuleSelection[],
    options?: { mockModeOverride?: boolean }
  ) => Promise<VirtualStateResponse | null>;

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
   * Get interaction data for a specific module (for rendering preview).
   */
  getInteractionForModule: (location: ModuleLocation) => CompletedInteraction | null;

  /**
   * Check if we have state covering a given module.
   */
  hasStateFor: (workflow: WorkflowDefinition, target: ModuleLocation) => boolean;

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

  /**
   * Set mock mode.
   * @param mockMode - Whether to use mock data (true) or real API calls (false)
   */
  setMockMode: (mockMode: boolean) => void;

  /**
   * Reload the current target with a different mock mode.
   * Resets state and re-runs to the current target.
   * @param workflow - The full workflow definition
   * @param mockMode - Whether to use mock data (true) or real API calls (false)
   * @param selections - Pre-defined selections for prerequisite interactive modules
   */
  reloadWithMockMode: (
    workflow: WorkflowDefinition,
    mockMode: boolean,
    selections?: ModuleSelection[]
  ) => Promise<void>;
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
  const [state, setState] = useState<VirtualStateResponse | null>(null);
  const [panelOpen, setPanelOpenState] = useState(false);
  const [statePanelOpen, setStatePanelOpenState] = useState(false);
  const [currentTarget, setCurrentTarget] = useState<ModuleLocation | null>(null);
  const [stateUpToModule, setStateUpToModule] = useState<ModuleLocation | null>(null);
  const [mockMode, setMockModeState] = useState<boolean>(true);

  // Register panel change callbacks on mount
  useEffect(() => {
    runtime.setOnPanelChange((open) => {
      setPanelOpenState(open);
    });
    runtime.setOnStatePanelChange((open) => {
      setStatePanelOpenState(open);
    });
    runtime.setOnMockModeChange((mode) => {
      setMockModeState(mode);
    });
    // Sync initial state
    setPanelOpenState(runtime.isPanelOpen());
    setStatePanelOpenState(runtime.isStatePanelOpen());
    setMockModeState(runtime.getMockMode());

    return () => {
      runtime.setOnPanelChange(null);
      runtime.setOnStatePanelChange(null);
      runtime.setOnMockModeChange(null);
    };
  }, [runtime]);

  // Get workflow store actions
  const startWorkflow = useWorkflowStore((s) => s.startWorkflow);
  const resetWorkflowStore = useWorkflowStore((s) => s.reset);

  // Sync state from runtime
  const syncState = useCallback(() => {
    setStatus(runtime.getStatus());
    setLastResponse(runtime.getLastResponse());
    setError(runtime.getLastError());
    setState(runtime.getState());
    setPanelOpenState(runtime.isPanelOpen());
    setStatePanelOpenState(runtime.isStatePanelOpen());
    setCurrentTarget(runtime.getCurrentTarget());
    setStateUpToModule(runtime.getStateUpToModule());
    setMockModeState(runtime.getMockMode());

    // Sync virtualRunId to workflow store so sub-actions can use it
    const virtualRunId = runtime.getVirtualRunId();
    if (virtualRunId) {
      startWorkflow(virtualRunId, "preview", "Preview");
    }
  }, [runtime, startWorkflow]);

  // Actions
  const runToModule = useCallback(
    async (
      workflow: WorkflowDefinition,
      target: ModuleLocation,
      selections: ModuleSelection[] = [],
      options?: { mockModeOverride?: boolean }
    ) => {
      setBusy(true);
      setError(null);
      // Clear previous response immediately so panel shows loading state
      setLastResponse(null);
      setState(null);

      try {
        await runtime.runToModule(workflow, target, selections, {
          mockModeOverride: options?.mockModeOverride,
        });
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

  const runToModuleSilent = useCallback(
    async (
      workflow: WorkflowDefinition,
      target: ModuleLocation,
      selections: ModuleSelection[] = [],
      options?: { mockModeOverride?: boolean }
    ): Promise<VirtualStateResponse | null> => {
      setBusy(true);
      setError(null);

      try {
        // Run with openPanel: "none" to avoid opening any panels
        await runtime.runToModule(workflow, target, selections, {
          openPanel: "none",
          mockModeOverride: options?.mockModeOverride,
        });
        // Return state directly from runtime (not React state which is async)
        return runtime.getState();
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

  const getInteractionForModule = useCallback(
    (location: ModuleLocation) => {
      return runtime.getInteractionForModule(location);
    },
    [runtime]
  );

  const hasStateFor = useCallback(
    (workflow: WorkflowDefinition, target: ModuleLocation) => {
      return runtime.hasStateFor(workflow, target);
    },
    [runtime]
  );

  const reset = useCallback(
    (closePanel?: boolean) => {
      runtime.reset(closePanel);
      resetWorkflowStore();
      syncState();
    },
    [runtime, resetWorkflowStore, syncState]
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

  const setMockMode = useCallback(
    (mode: boolean) => {
      runtime.setMockMode(mode);
      setMockModeState(mode);
    },
    [runtime]
  );

  const reloadWithMockMode = useCallback(
    async (
      workflow: WorkflowDefinition,
      mode: boolean,
      selections: ModuleSelection[] = []
    ) => {
      setBusy(true);
      setError(null);
      setLastResponse(null);
      setState(null);

      try {
        await runtime.reloadWithMockMode(workflow, mode, selections);
      } finally {
        syncState();
        setBusy(false);
      }
    },
    [runtime, syncState]
  );

  // Memoize actions object
  const actions = useMemo<VirtualRuntimeActions>(
    () => ({
      runToModule,
      runToModuleForState,
      runToModuleSilent,
      submitResponse,
      getInteractionForModule,
      hasStateFor,
      reset,
      openPanel,
      closePanel,
      setPanelOpen,
      openStatePanel,
      openFullStatePanel,
      closeStatePanel,
      setStatePanelOpen,
      setMockMode,
      reloadWithMockMode,
    }),
    [
      runToModule,
      runToModuleForState,
      runToModuleSilent,
      submitResponse,
      getInteractionForModule,
      hasStateFor,
      reset,
      openPanel,
      closePanel,
      setPanelOpen,
      openStatePanel,
      openFullStatePanel,
      closeStatePanel,
      setStatePanelOpen,
      setMockMode,
      reloadWithMockMode,
    ]
  );

  // Getter functions that delegate to runtime
  // These are stable references that always return current values
  const getVirtualDb = useCallback(() => runtime.getVirtualDb(), [runtime]);
  const getVirtualRunId = useCallback(() => runtime.getVirtualRunId(), [runtime]);
  const setVirtualDb = useCallback((db: string) => runtime.setVirtualDb(db), [runtime]);

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
    mockMode,
    actions,
    // Getter/setter functions for virtual API client
    getVirtualDb,
    getVirtualRunId,
    setVirtualDb,
  };
}
