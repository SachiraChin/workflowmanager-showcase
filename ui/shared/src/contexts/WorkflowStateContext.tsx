/**
 * WorkflowStateContext - Provides workflow state to shared components.
 *
 * This context provides:
 * - SSE streaming of workflow state from server
 * - Workflow definition fetching
 * - File tree and file content access
 *
 * Used by: InputSchemaComposer, SchemaRenderer, TableSchemaRenderer,
 * ObjectSchemaRenderer, StateTreeView, FilesTreeView
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { useWorkflowState as useWorkflowStateHook } from "../state/hooks/useWorkflowState";
import { useApiClient } from "../core/api-context";
import type {
  ModuleConfig,
  WorkflowDefinition,
  FileTree,
  WorkflowFileContent,
} from "../types/index";

// Re-export types for convenience
export type { ModuleConfig, WorkflowDefinition, FileTree, WorkflowFileContent };

/** Context value provided to components */
export interface WorkflowStateContextValue {
  /** Current workflow run ID */
  workflowRunId: string | null;
  /** Current workflow state (raw from server) */
  state: Record<string, unknown>;
  /** Whether SSE connection is active */
  isConnected: boolean;
  /** Any connection error */
  error: string | null;
  /** Get a nested value from state */
  getValue: <T>(key: string, defaultValue?: T) => T | undefined;
  /** Update state at a specific path (for debugging) */
  updateStateAtPath: (path: string, value: unknown) => void;
  /** Workflow definition - flattened (has expanded modules) */
  workflowDefinition: WorkflowDefinition | null;
  /** Raw workflow definition - original (has execution_groups) */
  rawWorkflowDefinition: WorkflowDefinition | null;
  /** Get module config from flattened definition */
  getModuleConfig: (stepId: string, moduleName: string) => ModuleConfig | null;
  /** Get module config from raw definition */
  getRawModuleConfig: (stepId: string, moduleName: string) => ModuleConfig | null;
  /** File tree from workflow state */
  files: FileTree | null;
  /** Fetch content of a specific file */
  fetchFileContent: (fileId: string) => Promise<WorkflowFileContent | null>;
}

// =============================================================================
// Context
// =============================================================================

const WorkflowStateContext = createContext<WorkflowStateContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface WorkflowStateProviderProps {
  children: ReactNode;
  workflowRunId: string | null;
}

/**
 * Provider for workflow state context.
 * Handles SSE streaming and workflow definition fetching.
 */
export function WorkflowStateProvider({
  children,
  workflowRunId,
}: WorkflowStateProviderProps) {
  // Get API client from context (supports virtual/preview mode)
  const apiClient = useApiClient();
  
  const { state, isConnected, error, getValue, fetchState, updateStateAtPath } = useWorkflowStateHook(workflowRunId, {
    autoConnect: true,
  });

  const [workflowDefinition, setWorkflowDefinition] = useState<WorkflowDefinition | null>(null);
  const [rawWorkflowDefinition, setRawWorkflowDefinition] = useState<WorkflowDefinition | null>(null);

  // Fetch initial state immediately (SSE may take time to connect)
  useEffect(() => {
    if (workflowRunId) {
      fetchState();
    }
  }, [workflowRunId, fetchState]);

  // Fetch workflow definition once
  useEffect(() => {
    if (workflowRunId) {
      apiClient.getWorkflowDefinition(workflowRunId)
        .then((response) => {
          setWorkflowDefinition(response.definition);
          // raw_definition is present when current version is "resolved" (from execution_groups)
          // If not present, raw and flattened are the same
          setRawWorkflowDefinition(response.raw_definition || response.definition);
        })
        .catch((err: unknown) => {
          console.error("Failed to fetch workflow definition", err);
        });
    }
  }, [apiClient, workflowRunId]);

  // Get module config from flattened definition (for expanded modules)
  const getModuleConfig = useCallback((stepId: string, moduleName: string): ModuleConfig | null => {
    if (!workflowDefinition) return null;
    const step = workflowDefinition.steps.find((s) => s.step_id === stepId);
    if (!step) return null;
    const module = step.modules.find((m) => m.name === moduleName);
    return module || null;
  }, [workflowDefinition]);

  // Get module config from raw definition (for groups and regular modules)
  const getRawModuleConfig = useCallback((stepId: string, moduleName: string): ModuleConfig | null => {
    if (!rawWorkflowDefinition) return null;
    const step = rawWorkflowDefinition.steps.find((s) => s.step_id === stepId);
    if (!step) return null;
    const module = step.modules.find((m) => m.name === moduleName);
    return module || null;
  }, [rawWorkflowDefinition]);

  // Extract files from state
  const files = (state.files as FileTree) || null;

  // Fetch file content
  const fetchFileContent = useCallback(async (fileId: string): Promise<WorkflowFileContent | null> => {
    if (!workflowRunId) return null;
    try {
      return await apiClient.getWorkflowFile(workflowRunId, fileId);
    } catch (err) {
      console.error("Failed to fetch file content", err);
      return null;
    }
  }, [apiClient, workflowRunId]);

  // Keep module-level state in sync for non-React access
  useEffect(() => {
    setCurrentWorkflowState(state);
  }, [state]);

  return (
    <WorkflowStateContext.Provider value={{
      workflowRunId,
      state,
      isConnected,
      error,
      getValue,
      updateStateAtPath,
      workflowDefinition,
      rawWorkflowDefinition,
      getModuleConfig,
      getRawModuleConfig,
      files,
      fetchFileContent,
    }}>
      {children}
    </WorkflowStateContext.Provider>
  );
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access workflow state.
 * Returns empty state if not within provider (allows components to work standalone).
 */
export function useWorkflowState(): WorkflowStateContextValue {
  const context = useContext(WorkflowStateContext);
  if (!context) {
    return {
      workflowRunId: null,
      state: {},
      isConnected: false,
      error: null,
      getValue: () => undefined,
      updateStateAtPath: () => {},
      workflowDefinition: null,
      rawWorkflowDefinition: null,
      getModuleConfig: () => null,
      getRawModuleConfig: () => null,
      files: null,
      fetchFileContent: async () => null,
    };
  }
  return context;
}

// =============================================================================
// Non-React access (for use outside components)
// =============================================================================

/**
 * Get current workflow state directly (for use outside React components).
 * Returns empty object if no provider.
 */
let currentState: Record<string, unknown> = {};

export function setCurrentWorkflowState(state: Record<string, unknown>) {
  currentState = state;
}

export function getCurrentWorkflowState(): Record<string, unknown> {
  return currentState;
}
