/**
 * Zustand store for workflow execution state.
 * Centralized state management for the entire workflow lifecycle.
 */

import { create } from "zustand";
import type {
  WorkflowStatus,
  InteractionRequest,
  WorkflowProgress,
  CompletedInteraction,
  ModelsResponse,
} from "../types/index";

// =============================================================================
// Types
// =============================================================================

/** View mode for workflow steps */
export type ViewMode = "scroll" | "single";

export interface WorkflowExecutionState {
  // Workflow identity
  workflowRunId: string | null;
  projectName: string | null;
  workflowName: string | null;

  // Execution status
  status: WorkflowStatus | null;
  progress: WorkflowProgress | null;
  error: string | null;

  // Current interaction
  currentInteraction: InteractionRequest | null;
  interactionHistory: InteractionRequest[];

  // Completed interactions (request + response pairs for history display)
  completedInteractions: CompletedInteraction[];

  // Streaming state
  isConnected: boolean;
  isProcessing: boolean;
  elapsedMs: number;
  lastMessage: string | null;

  // Module outputs (workflow state)
  moduleOutputs: Record<string, unknown>;

  // Event log
  events: WorkflowEvent[];

  // View mode (scroll = all cards visible, single = one card at a time)
  viewMode: ViewMode;
  currentViewIndex: number;

  // Model selection (runtime override)
  modelsConfig: ModelsResponse | null;
  selectedProvider: string | null;
  selectedModel: string | null;

  // Access denied state (403 errors)
  accessDenied: boolean;
}

export interface WorkflowEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface WorkflowActions {
  // Workflow lifecycle
  startWorkflow: (workflowRunId: string, projectName: string, workflowName?: string) => void;
  setStatus: (status: WorkflowStatus) => void;
  setProgress: (progress: WorkflowProgress) => void;
  setError: (error: string | null) => void;
  reset: () => void;

  // Interaction handling
  setCurrentInteraction: (interaction: InteractionRequest | null) => void;
  updateCurrentInteractionDisplayData: (displayData: Record<string, unknown>) => void;
  addToInteractionHistory: (interaction: InteractionRequest) => void;

  // Completed interactions (history)
  setCompletedInteractions: (interactions: CompletedInteraction[]) => void;
  addCompletedInteraction: (interaction: CompletedInteraction) => void;

  // Streaming state
  setConnected: (connected: boolean) => void;
  setProcessing: (processing: boolean) => void;
  updateProgress: (elapsedMs: number, message?: string) => void;

  // State management
  setModuleOutputs: (outputs: Record<string, unknown>) => void;
  updateModuleOutput: (key: string, value: unknown) => void;

  // Event logging
  addEvent: (type: string, data: Record<string, unknown>) => void;
  clearEvents: () => void;

  // View mode
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
  setCurrentViewIndex: (index: number) => void;
  navigateView: (direction: "prev" | "next", maxIndex: number) => void;

  // Model selection
  setModelsConfig: (config: ModelsResponse) => void;
  setSelectedModel: (provider: string | null, model: string | null) => void;

  // Access denied
  setAccessDenied: (denied: boolean) => void;
}

// =============================================================================
// LocalStorage helpers
// =============================================================================

const VIEW_MODE_STORAGE_KEY = "workflow-view-mode";

function getStoredViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "scroll" || stored === "single") {
      return stored;
    }
  } catch {
    // localStorage not available
  }
  return "single"; // default
}

function saveViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // localStorage not available
  }
}

// =============================================================================
// Initial State
// =============================================================================

const initialState: WorkflowExecutionState = {
  workflowRunId: null,
  projectName: null,
  workflowName: null,
  status: null,
  progress: null,
  error: null,
  currentInteraction: null,
  interactionHistory: [],
  completedInteractions: [],
  isConnected: false,
  isProcessing: false,
  elapsedMs: 0,
  lastMessage: null,
  moduleOutputs: {},
  events: [],
  viewMode: getStoredViewMode(),
  currentViewIndex: 0,
  modelsConfig: null,
  selectedProvider: null,
  selectedModel: null,
  accessDenied: false,
};

// =============================================================================
// Store
// =============================================================================

export const useWorkflowStore = create<WorkflowExecutionState & WorkflowActions>(
  (set) => ({
    ...initialState,

    // Workflow lifecycle
    startWorkflow: (workflowRunId, projectName, workflowName) => {
      set({
        ...initialState,
        workflowRunId,
        projectName,
        workflowName: workflowName || null,
        status: "created",
      });
    },

    setStatus: (status) => set({ status }),

    setProgress: (progress) => set({ progress }),

    setError: (error) => set({ error, isProcessing: false }),

    reset: () => set(initialState),

    // Interaction handling
    setCurrentInteraction: (interaction) => {
      set({ currentInteraction: interaction, isProcessing: false });
    },

    updateCurrentInteractionDisplayData: (displayData) => {
      set((state) => {
        if (!state.currentInteraction) return state;
        return {
          currentInteraction: {
            ...state.currentInteraction,
            display_data: displayData,
          },
        };
      });
    },

    addToInteractionHistory: (interaction) => {
      set((state) => ({
        interactionHistory: [...state.interactionHistory, interaction],
      }));
    },

    // Completed interactions (history)
    setCompletedInteractions: (interactions) => set({ completedInteractions: interactions }),

    addCompletedInteraction: (interaction) => {
      set((state) => ({
        completedInteractions: [...state.completedInteractions, interaction],
      }));
    },

    // Streaming state
    setConnected: (connected) => set({ isConnected: connected }),

    setProcessing: (processing) => set({ isProcessing: processing }),

    updateProgress: (elapsedMs, message) => {
      set((state) => ({
        elapsedMs,
        lastMessage: message ?? state.lastMessage,
      }));
    },

    // State management
    setModuleOutputs: (outputs) => set({ moduleOutputs: outputs }),

    updateModuleOutput: (key, value) => {
      set((state) => ({
        moduleOutputs: { ...state.moduleOutputs, [key]: value },
      }));
    },

    // Event logging
    addEvent: (type, data) => {
      const event: WorkflowEvent = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type,
        data,
        timestamp: new Date(),
      };
      set((state) => ({
        events: [...state.events, event],
      }));
    },

    clearEvents: () => set({ events: [] }),

    // View mode
    setViewMode: (mode) => {
      saveViewMode(mode);
      set({ viewMode: mode });
    },

    toggleViewMode: () => set((state) => {
      const newMode = state.viewMode === "scroll" ? "single" : "scroll";
      saveViewMode(newMode);
      return { viewMode: newMode };
    }),

    setCurrentViewIndex: (index) => set({ currentViewIndex: index }),

    navigateView: (direction, maxIndex) => set((state) => {
      const newIndex = direction === "prev"
        ? Math.max(0, state.currentViewIndex - 1)
        : Math.min(maxIndex, state.currentViewIndex + 1);
      return { currentViewIndex: newIndex };
    }),

    // Model selection
    setModelsConfig: (config) => set({ modelsConfig: config }),

    setSelectedModel: (provider, model) => set({
      selectedProvider: provider,
      selectedModel: model,
    }),

    // Access denied
    setAccessDenied: (denied) => set({ accessDenied: denied }),
  })
);

// =============================================================================
// Selectors (for optimized re-renders)
// =============================================================================

export const selectWorkflowRunId = (state: WorkflowExecutionState) => state.workflowRunId;
export const selectStatus = (state: WorkflowExecutionState) => state.status;
export const selectProgress = (state: WorkflowExecutionState) => state.progress;
export const selectCurrentInteraction = (state: WorkflowExecutionState) => state.currentInteraction;
export const selectCompletedInteractions = (state: WorkflowExecutionState) => state.completedInteractions;
export const selectIsProcessing = (state: WorkflowExecutionState) => state.isProcessing;
export const selectError = (state: WorkflowExecutionState) => state.error;
export const selectModuleOutputs = (state: WorkflowExecutionState) => state.moduleOutputs;
export const selectViewMode = (state: WorkflowExecutionState) => state.viewMode;
export const selectCurrentViewIndex = (state: WorkflowExecutionState) => state.currentViewIndex;
export const selectModelsConfig = (state: WorkflowExecutionState) => state.modelsConfig;
export const selectSelectedProvider = (state: WorkflowExecutionState) => state.selectedProvider;
export const selectSelectedModel = (state: WorkflowExecutionState) => state.selectedModel;
export const selectAccessDenied = (state: WorkflowExecutionState) => state.accessDenied;
