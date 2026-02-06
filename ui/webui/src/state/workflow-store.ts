/**
 * Re-export workflow store from shared package.
 * All state management is centralized in @wfm/shared.
 */

export {
  useWorkflowStore,
  type ViewMode,
  type WorkflowExecutionState,
  type WorkflowActions,
  type WorkflowEvent,
  selectWorkflowRunId,
  selectStatus,
  selectProgress,
  selectCurrentInteraction,
  selectCompletedInteractions,
  selectIsProcessing,
  selectError,
  selectModuleOutputs,
  selectViewMode,
  selectCurrentViewIndex,
  selectModelsConfig,
  selectSelectedProvider,
  selectSelectedModel,
  selectAccessDenied,
} from "@wfm/shared";
