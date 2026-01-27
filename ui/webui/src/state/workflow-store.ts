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
} from "@/core/types";

// =============================================================================
// Types
// =============================================================================

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
