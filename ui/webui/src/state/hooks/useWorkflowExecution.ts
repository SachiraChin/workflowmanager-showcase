/**
 * Re-export useWorkflowExecution hook from shared package.
 * All state management is centralized in @wfm/shared.
 */

export {
  useWorkflowExecution,
  setCapabilities,
  getCapabilities,
  type VersionConfirmationState,
} from "@wfm/shared";
