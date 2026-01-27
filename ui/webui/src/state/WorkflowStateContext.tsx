/**
 * Context for workflow state - keeps state synced from server via SSE.
 * Used for template rendering and future left-side display panel.
 */

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { useWorkflowState } from "@/hooks/useWorkflowState";
import { api } from "@/lib/api";
import type { WorkflowDefinition, ModuleConfig, FileTree, WorkflowFileContent } from "@/lib/types";

interface WorkflowStateContextValue {
  /** Current workflow state */
  state: Record<string, unknown>;
  /** Whether SSE connection is active */
  isConnected: boolean;
  /** Any connection error */
  error: string | null;
  /** Get a nested value from state */
  getValue: <T>(key: string, defaultValue?: T) => T | undefined;
  /** Workflow definition - flattened (has expanded modules with _metadata.expanded_from) */
  workflowDefinition: WorkflowDefinition | null;
  /** Raw workflow definition - original (has execution_groups modules) */
  rawWorkflowDefinition: WorkflowDefinition | null;
  /** Get module config from flattened definition (for expanded modules) */
  getModuleConfig: (stepId: string, moduleName: string) => ModuleConfig | null;
  /** Get module config from raw definition (for groups and regular modules) */
  getRawModuleConfig: (stepId: string, moduleName: string) => ModuleConfig | null;
  /** File tree from workflow state (streamed via SSE) */
  files: FileTree | null;
  /** Fetch content of a specific file */
  fetchFileContent: (fileId: string) => Promise<WorkflowFileContent | null>;
}

const WorkflowStateContext = createContext<WorkflowStateContextValue | null>(null);

interface WorkflowStateProviderProps {
  workflowRunId: string | null;
  children: ReactNode;
}

export function WorkflowStateProvider({
  workflowRunId,
  children,
}: WorkflowStateProviderProps) {
  const { state, isConnected, error, getValue, fetchState } = useWorkflowState(workflowRunId, {
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
      api.getWorkflowDefinition(workflowRunId)
        .then((response) => {
          setWorkflowDefinition(response.definition);
          // raw_definition is present when current version is "resolved" (from execution_groups)
          // If not present, raw and flattened are the same
          setRawWorkflowDefinition(response.raw_definition || response.definition);
        })
        .catch((err) => {
          console.error("Failed to fetch workflow definition", err);
        });
    }
  }, [workflowRunId]);

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
      return await api.getWorkflowFile(workflowRunId, fileId);
    } catch (err) {
      console.error("Failed to fetch file content", err);
      return null;
    }
  }, [workflowRunId]);

  // Keep module-level state in sync for non-React access
  useEffect(() => {
    setCurrentWorkflowState(state);
  }, [state]);

  return (
    <WorkflowStateContext.Provider value={{
      state,
      isConnected,
      error,
      getValue,
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

/**
 * Hook to access workflow state.
 * Must be used within WorkflowStateProvider.
 */
export function useWorkflowStateContext(): WorkflowStateContextValue {
  const context = useContext(WorkflowStateContext);
  if (!context) {
    // Return empty state if not in provider (allows components to work standalone)
    return {
      state: {},
      isConnected: false,
      error: null,
      getValue: () => undefined,
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
