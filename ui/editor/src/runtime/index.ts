/**
 * Virtual Runtime exports.
 *
 * This module provides the virtual execution runtime for the workflow editor.
 */

// Types
export type {
  VirtualStartRequest,
  VirtualRespondRequest,
  VirtualResumeConfirmRequest,
  VirtualStateRequest,
  VirtualStateResponse,
  VirtualInteractionHistoryRequest,
  VirtualInteractionHistoryResponse,
  CompletedInteraction,
  VirtualWorkflowResponse,
  ModuleLocation,
  ModuleSelection,
  RuntimeStatus,
  RunResult,
} from "./types";

// API
export {
  virtualStart,
  virtualRespond,
  virtualResumeConfirm,
  virtualGetState,
  virtualGetInteractionHistory,
} from "./virtual-api";

// Runtime
export { VirtualRuntime } from "./VirtualRuntime";

// React hook
export { useVirtualRuntime } from "./useVirtualRuntime";
export type {
  VirtualRuntimeState,
  VirtualRuntimeActions,
  UseVirtualRuntimeReturn,
} from "./useVirtualRuntime";

// Components
export { VirtualPreview } from "./VirtualPreview";
export type { VirtualPreviewProps } from "./VirtualPreview";

export { VirtualRuntimePanel } from "./VirtualRuntimePanel";
export type { VirtualRuntimePanelProps } from "./VirtualRuntimePanel";

export { StatePanel } from "./StatePanel";
export type { StatePanelProps } from "./StatePanel";
