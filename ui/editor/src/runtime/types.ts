/**
 * Types for Virtual Runtime execution.
 *
 * These types are specific to the editor's virtual execution feature
 * and mirror the server's virtual endpoint models.
 */

import type {
  InteractionResponseData,
  WorkflowResponse,
  WorkflowDefinition,
} from "@wfm/shared";

// =============================================================================
// API Request Types
// =============================================================================

/**
 * Request to start virtual module execution.
 * Sent to POST /workflow/virtual/start
 */
export interface VirtualStartRequest {
  /** Full resolved workflow JSON */
  workflow: WorkflowDefinition;
  /** Base64-encoded gzip of virtual database JSON. If null, creates fresh state. */
  virtual_db: string | null;
  /** Step ID containing target module */
  target_step_id: string;
  /** Module name to execute */
  target_module_name: string;
}

/**
 * Request to respond to virtual interaction.
 * Sent to POST /workflow/virtual/respond
 */
export interface VirtualRespondRequest {
  /** Full resolved workflow JSON */
  workflow: WorkflowDefinition;
  /** Base64-encoded gzip of virtual database JSON from start response */
  virtual_db: string;
  /** Virtual run ID from start response */
  virtual_run_id: string;
  /** Step ID containing target module */
  target_step_id: string;
  /** Module name */
  target_module_name: string;
  /** Interaction ID from start response */
  interaction_id: string;
  /** User's response to the interaction */
  response: InteractionResponseData;
}

/**
 * Request to resume virtual workflow with updated workflow and execute to target.
 * Sent to POST /workflow/virtual/resume/confirm
 */
export interface VirtualResumeConfirmRequest {
  /** Full resolved workflow JSON (potentially updated) */
  workflow: WorkflowDefinition;
  /** Base64-encoded gzip of virtual database JSON from previous response */
  virtual_db: string;
  /** Step ID containing target module */
  target_step_id: string;
  /** Module name to execute up to */
  target_module_name: string;
}

/**
 * Request to get state from virtual database.
 * Sent to POST /workflow/virtual/state
 */
export interface VirtualStateRequest {
  /** Base64-encoded gzip of virtual database JSON */
  virtual_db: string;
  /** Virtual run ID */
  virtual_run_id: string;
}

/**
 * Response containing workflow state.
 * Returned from POST /workflow/virtual/state
 */
export interface VirtualStateResponse {
  /** Hierarchical module state by step/module */
  steps: Record<string, unknown>;
  /** State-mapped values (flat dict) */
  state_mapped: Record<string, unknown>;
  /** File tree structure */
  files: unknown[];
}

/**
 * Request to get interaction history from virtual database.
 * Sent to POST /workflow/virtual/interaction-history
 */
export interface VirtualInteractionHistoryRequest {
  /** Base64-encoded gzip of virtual database JSON */
  virtual_db: string;
  /** Virtual run ID */
  virtual_run_id: string;
}

/**
 * A completed interaction with request and response.
 */
export interface CompletedInteraction {
  interaction_id: string;
  /** Full InteractionRequest data for rendering */
  request: Record<string, unknown>;
  /** User's response data */
  response: Record<string, unknown>;
  step_id?: string;
  module_name?: string;
  timestamp?: string;
}

/**
 * Response containing interaction history.
 * Returned from POST /workflow/virtual/interaction-history
 */
export interface VirtualInteractionHistoryResponse {
  /** List of completed interactions */
  interactions: CompletedInteraction[];
  /** Current pending interaction if any */
  pending_interaction: Record<string, unknown> | null;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Response from virtual workflow endpoints (/workflow/virtual/*).
 * Extends WorkflowResponse with virtual-specific fields.
 */
export interface VirtualWorkflowResponse extends WorkflowResponse {
  /** Virtual run ID for subsequent requests */
  virtual_run_id: string;
  /** Compressed database state (base64-encoded gzip JSON) - opaque to client */
  virtual_db: string | null;
  /** Current module outputs as plain dict - readable by UI for state display */
  state: Record<string, unknown> | null;
}

// =============================================================================
// Runtime Types
// =============================================================================

/**
 * Identifies a module within a workflow.
 */
export interface ModuleLocation {
  step_id: string;
  module_name: string;
}

/**
 * Cached checkpoint for a module boundary.
 * Stores the virtual_db state after a module completes successfully.
 */
export interface ModuleCheckpoint {
  /** Location of the module this checkpoint is for */
  location: ModuleLocation;
  /** Hash of the workflow at time of checkpoint */
  workflow_hash: string;
  /** Hash of this specific module's config */
  module_hash: string;
  /** Compressed database state after module completed */
  virtual_db: string;
  /** Virtual run ID associated with this checkpoint */
  virtual_run_id: string;
  /** State (module outputs) at this checkpoint */
  state: Record<string, unknown>;
}

/**
 * Selection data for a module that requires user input.
 */
export interface ModuleSelection {
  step_id: string;
  module_name: string;
  response: InteractionResponseData;
}

/**
 * Current state of the virtual runtime.
 */
export type RuntimeStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "completed"
  | "error";

/**
 * Result of running to a target module.
 */
export interface RunResult {
  status: RuntimeStatus;
  /** Present when status is "awaiting_input" */
  response?: VirtualWorkflowResponse;
  /** Present when status is "error" */
  error?: string;
}
