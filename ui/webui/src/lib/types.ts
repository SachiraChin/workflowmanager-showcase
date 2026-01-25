/**
 * TypeScript types mirroring the server API models.
 * These match the contracts in contracts/ and server/api/models.py
 */

// =============================================================================
// Enums
// =============================================================================

export type WorkflowStatus =
  | "created"
  | "processing"
  | "awaiting_input"
  | "completed"
  | "error";

export type InteractionType =
  | "text_input"
  | "select_from_structured"
  | "review_grouped"
  | "file_input"
  | "file_download"
  | "form_input"
  | "media_generation"
  // Workflow-level interactions (handled by workflow manager, not modules)
  | "resume_choice"
  | "retry_options";

export type MessageLevel =
  | "debug"
  | "info"
  | "success"
  | "warning"
  | "error"
  | "header"
  | "muted";

export type SSEEventType =
  | "started"
  | "progress"
  | "interaction"
  | "complete"
  | "error"
  | "cancelled"
  | "state_snapshot"
  | "state_update";

// =============================================================================
// Common Models
// =============================================================================

export interface SelectOption {
  id: string;
  label: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface InteractionRequest {
  interaction_id: string;
  interaction_type: InteractionType;
  title?: string;

  // For selections
  options?: SelectOption[];
  min_selections?: number;
  max_selections?: number;
  allow_custom?: boolean;
  default_selection?: number | number[];

  // For structured display
  groups?: Record<string, unknown>;
  display_data?: Record<string, unknown>;

  // For text input
  multiline?: boolean;
  placeholder?: string;
  default_value?: string;
  allow_empty?: boolean;

  // For confirm
  yes_label?: string;
  no_label?: string;
  default_confirm?: boolean;

  // Context
  context?: Record<string, unknown>;
  extra_options?: SelectOption[];

  // Schema for client-side resolution
  resolver_schema?: Record<string, unknown>;

  // For file_input
  accepted_types?: string[];
  multiple_files?: boolean;
  base_path?: string;

  // For file_download
  file_content?: string;
  file_name?: string;
  file_content_type?: string; // "text", "json", "binary"
  file_destination?: string; // "root" or "ws"

  // For form_input
  form_schema?: Record<string, unknown>;
  form_type?: string;
  form_defaults?: Record<string, unknown>[]; // Array of defaults, one per data item
}

export interface WorkflowProgress {
  current_step?: string;
  current_module?: string;
  completed_steps: string[];
  total_steps: number;
  step_index: number;
}

// =============================================================================
// Request Models
// =============================================================================

/**
 * Request to start workflow with uploaded content.
 * Used with POST /workflow/start endpoint.
 */
export interface StartWorkflowRequest {
  project_name: string;
  workflow_content: string | Record<string, unknown>; // Required: base64 zip or JSON
  workflow_entry_point?: string; // Required for zip files
  ai_config?: {
    api_key?: string;
    provider?: string;
    model?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
  };
  force_new?: boolean;
  capabilities?: string[];
}

/**
 * Request to start workflow with an existing version.
 * Used with POST /workflow/start/{version_id} endpoint.
 */
export interface StartWorkflowByVersionRequest {
  project_name: string;
  ai_config?: {
    api_key?: string;
    provider?: string;
    model?: string;
    openai_api_key?: string;
    anthropic_api_key?: string;
  };
  force_new?: boolean;
  capabilities?: string[];
}

// Workflow template and version types
export interface WorkflowVersion {
  workflow_version_id: string;
  created_at: string;
  content_hash: string;
  source_type: string;
}

export interface WorkflowTemplate {
  template_name: string;
  template_id: string;
  versions: WorkflowVersion[];
}

export interface WorkflowTemplatesResponse {
  templates: WorkflowTemplate[];
  count: number;
}

export interface InteractionResponseData {
  value?: unknown;
  selected_indices?: (number | string | unknown[])[];
  selected_options?: Record<string, unknown>[];
  custom_value?: string;
  cancelled?: boolean;
  retry_requested?: boolean;
  retry_groups?: string[];
  retry_feedback?: string;
  jump_back_requested?: boolean;
  jump_back_target?: string;
  // FILE_DOWNLOAD response fields
  file_written?: boolean;
  file_path?: string;
  file_error?: string;
  // FORM_INPUT response fields
  form_data?: Record<string, unknown>[]; // Array of form values, one per data item
  // MEDIA_GENERATION response fields
  selected_content_id?: string; // ID of selected generated content
  generations?: Record<string, unknown[]>; // All generations by prompt key
}

export interface RespondRequest {
  workflow_run_id: string;
  interaction_id: string;
  response: InteractionResponseData;
}

// =============================================================================
// Response Models
// =============================================================================

export interface WorkflowResponse {
  workflow_run_id: string;
  status: WorkflowStatus;
  message?: string;
  progress?: WorkflowProgress;
  interaction_request?: InteractionRequest;
  result?: Record<string, unknown>;
  error?: string;
}

export interface WorkflowStatusResponse {
  workflow_run_id: string;
  project_name: string;
  workflow_template_name: string;
  status: WorkflowStatus;
  progress: WorkflowProgress;
  interaction_request?: InteractionRequest;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Interaction History Models (for scrollable history feature)
// =============================================================================

/**
 * Selection item combining path and data.
 * Used to pass initial selections to SelectionProvider in readonly mode.
 */
export interface SelectionItem {
  path: string[];
  data: unknown;
}

/**
 * Discriminated union for interaction mode.
 * - 'active': User is making selections/input (normal interactive mode)
 * - 'readonly': Showing completed interaction with response data (history view)
 */
export type InteractionMode =
  | { type: "active" }
  | { type: "readonly"; response: InteractionResponseData };

/**
 * A completed interaction with request and response paired.
 * Returned by the interaction-history endpoint.
 */
export interface CompletedInteraction {
  interaction_id: string;
  request: InteractionRequest;
  response: InteractionResponseData;
  timestamp: string;
  step_id?: string;
  module_name?: string;
}

/**
 * Response from the interaction-history endpoint.
 */
export interface InteractionHistoryResponse {
  workflow_run_id: string;
  interactions: CompletedInteraction[];
  pending_interaction?: InteractionRequest;
}

// =============================================================================
// Version Diff Models
// =============================================================================

export interface VersionDiffChange {
  type: "changed" | "added" | "removed";
  path: string;
  old_value?: unknown;
  new_value?: unknown;
}

export interface VersionDiff {
  has_changes: boolean;
  summary: string;
  changes: VersionDiffChange[];
}

export interface VersionConfirmationResult {
  requires_confirmation: boolean;
  version_diff?: VersionDiff;
  old_hash?: string;
  new_hash?: string;
}

// =============================================================================
// SSE Event Models
// =============================================================================

export interface SSEEventData {
  type: SSEEventType;
  data: Record<string, unknown>;
}

export interface SSEStartedData {
  workflow_run_id: string;
  step_id?: string;
  module_index?: number;
}

export interface SSEProgressData {
  elapsed_ms: number;
  message?: string;
}

export interface SSEInteractionData extends InteractionRequest {}

export interface SSECompleteData {
  [key: string]: unknown;
}

export interface SSEErrorData {
  message: string;
}

export interface SSEStateSnapshotData {
  state: Record<string, unknown>;
}

export interface SSEStateUpdateData {
  changed_keys: string[];
  updates: Record<string, unknown>;
}

// =============================================================================
// Workflow Definition Models
// =============================================================================

/**
 * Detailed context for modules expanded from execution_groups.
 * Stored inside _metadata._group_origin.
 */
export interface GroupOrigin {
  group_name: string;
  path_name: string;
  requires?: Array<{ capability: string; priority: number }>;
  is_group_exit?: boolean;
  auto_generated?: boolean;
}

/**
 * Metadata for modules, including expansion info for meta-modules.
 */
export interface ModuleMetadata {
  /** Parent module name this was expanded from (generic for any meta-module) */
  expanded_from?: string;
  /** Order within expansion (-1 for auto-generated at end) */
  expanded_index?: number;
  /** Detailed context specific to execution_groups */
  _group_origin?: GroupOrigin;
  /** Allow other metadata fields */
  [key: string]: unknown;
}

export interface ModuleConfig {
  module_id: string;
  name?: string;
  inputs?: Record<string, unknown>;
  outputs_to_state?: Record<string, string>;
  retryable?: Record<string, unknown>;
  comment?: string;
  /** Module metadata including expansion info */
  _metadata?: ModuleMetadata;
}

export interface StepDefinition {
  step_id: string;
  name?: string;
  description?: string;
  modules: ModuleConfig[];
}

export interface WorkflowDefinition {
  workflow_id: string;
  name?: string;
  description?: string;
  steps: StepDefinition[];
  config?: Record<string, unknown>;
  status_display?: Record<string, unknown>;
}

// =============================================================================
// Sub-Action Types
// =============================================================================

/**
 * Request body for sub-action API call.
 * Matches server SubActionRequest model.
 */
export interface SubActionRequest {
  /** Workflow run ID */
  workflow_run_id: string;
  /** ID of the current interaction */
  interaction_id: string;
  /** Provider name: "midjourney", "leonardo" */
  provider: string;
  /** Operation type: "txt2img", "img2img", "img2vid" */
  action_type: string;
  /** Identifier for the prompt being processed */
  prompt_id: string;
  /** Generation parameters (includes 'prompt') */
  params: Record<string, unknown>;
  /** Original prompt data from workflow (for storage) */
  source_data?: unknown;
}

// =============================================================================
// Workflow Files Types
// =============================================================================

/**
 * A single file entry in the file tree.
 */
export interface WorkflowFile {
  file_id: string;
  filename: string;
  content_type: string;
}

/**
 * A group of files (e.g., an API call with request/response).
 */
export interface FileGroup {
  group_id: string;
  created_at: string | null;
  files: WorkflowFile[];
}

/**
 * File tree structure - entirely dynamic based on actual data.
 *
 * Structure depends on branches and grouping:
 * - Single branch: { [category]: StepGroups | WorkflowFile[] }
 * - Multiple branches: { [branch_id]: { [category]: ... } }
 *
 * Where StepGroups = { [step_id]: FileGroup[] }
 *
 * Files with group_id are organized as: category/step_id/groups/files
 * Files without group_id are flat arrays under category.
 */
export type FileTree = Record<string, unknown>;

/**
 * Content of a file fetched from the API.
 */
export interface WorkflowFileContent {
  file_id: string;
  workflow_run_id: string;
  category: string;
  group_id?: string;
  filename: string;
  content_type: string;
  content: unknown;
  metadata: Record<string, unknown>;
}
