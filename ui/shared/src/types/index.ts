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
  | "error"
  | "validation_failed";

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
  | "validation_failed"
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
  name?: string;  // Human-readable name from workflow JSON
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
  // Validation fields
  action_id?: string; // Which action triggered this response (e.g., "continue")
  confirmed_warnings?: string[]; // Validation IDs user confirmed to proceed
}

export interface RespondRequest {
  workflow_run_id: string;
  interaction_id: string;
  response: InteractionResponseData;
  ai_config?: {
    provider?: string;
    model?: string;
  };
}

// =============================================================================
// Models Configuration
// =============================================================================

export interface ModelInfo {
  id: string;
  name: string;
}

export interface ProviderConfig {
  name: string;
  default: string;
  models: ModelInfo[];
}

export interface ModelsResponse {
  default_provider: string;
  default_model: string;
  providers: Record<string, ProviderConfig>;
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
 * Generic sub-action request.
 * Matches server SubActionRequest model.
 */
export interface SubActionRequest {
  /** ID of the current interaction */
  interaction_id: string;
  /** References sub_action.id in module schema (e.g., "image_generation") */
  sub_action_id: string;
  /** Action-specific params - includes all data needed for the operation */
  params?: Record<string, unknown>;
  /** Optional runtime override for AI configuration (provider, model) */
  ai_config?: {
    provider?: string;
    model?: string;
  };
}

/**
 * Sub-action definition from module config.
 * Defines a button that triggers an operation without completing the interaction.
 */
export interface SubActionDef {
  /** Unique identifier for this sub-action */
  id: string;
  /** Button label */
  label: string;
  /** Keyboard shortcut (e.g., "r") */
  shortcut?: string;
  /** Loading state label */
  loading_label?: string;
  /** Hide from footer but allow programmatic triggering */
  hidden?: boolean;
  /** Actions to execute (target_sub_action or self_sub_action) */
  actions: Array<{
    type: "target_sub_action" | "self_sub_action";
    ref?: { step_id: string; module_name: string };
    params?: Record<string, unknown>;
  }>;
  /** How to map results back to parent state */
  result_mapping?: Array<{
    source: string;
    target: string;
    mode: "replace" | "merge";
  }>;
  /** Feedback configuration */
  feedback?: {
    enabled?: boolean;
    prompt?: string;
    state_key?: string;
  };
}

// =============================================================================
// Workflow Files Types - Universal Tree Structure
// =============================================================================

/**
 * Icon types for tree nodes.
 * Maps to lucide-react icons in the frontend.
 */
export type TreeNodeIcon =
  | "folder"
  | "folder-open"
  | "image"
  | "video"
  | "audio"
  | "json"
  | "text";

/**
 * Metadata for a tree node - defines how the node should be displayed
 * and what actions are available.
 */
export interface TreeNodeMetadata {
  /** Display name shown in the tree */
  display_name: string;

  /** Icon to show (defaults to "folder" for containers, "text" for leaves) */
  icon?: TreeNodeIcon;

  /** True if this is a leaf node (no children, clickable for content) */
  leaf?: boolean;

  /** Whether folder should be open by default */
  default_open?: boolean;

  /** URL to download this node's contents (as ZIP for containers) */
  download_url?: string;

  /**
   * Content type for leaf nodes - determines how content is displayed.
   * "image", "video", "audio" = media preview dialog
   * "json", "text" = content popup with JSON tree or text
   */
  content_type?: string;

  /** URL to fetch/display content for leaf nodes */
  content_url?: string;
}

/**
 * Universal tree node structure.
 * Backend builds this, frontend renders it recursively.
 */
export interface FileTreeNode {
  /** Node metadata - display and behavior */
  _meta: TreeNodeMetadata;

  /** Child nodes (only for container nodes) */
  children?: FileTreeNode[];
}

/**
 * Root file tree - array of top-level nodes.
 */
export type FileTree = FileTreeNode[];

/**
 * Simplified file info for MediaPreviewDialog.
 * Used to pass file data to the preview component.
 */
export interface WorkflowFile {
  file_id: string;
  filename: string;
  content_type: string;
  url?: string;
  preview_url?: string;
}

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

// =============================================================================
// Validation Types
// =============================================================================

/**
 * Validation rule configuration from step.json.
 * Defined under retryable.options[].validations[]
 */
export interface ValidationConfig {
  /** Unique identifier for this validation */
  id: string;
  /** Rule name from registry (e.g., "response_field_required") */
  rule: string;
  /** Response field to validate (rule-dependent) */
  field: string;
  /** "error" blocks action, "warning" requires confirmation */
  severity: "error" | "warning";
  /** Human-readable error message */
  message: string;
  /** Which layers validate: ["webui", "server"] */
  validator?: string[];
  /** For response_field_equals rule */
  value?: unknown;
  /** For min_selections rule */
  min?: number;
}

/**
 * Validation error/warning message from server or client.
 */
export interface ValidationMessage {
  id: string;
  field: string;
  rule: string;
  message: string;
  severity: "error" | "warning";
}

/**
 * Result of validating a response.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}

/**
 * SSE event data for validation_failed event.
 */
export interface SSEValidationFailedData {
  workflow_run_id: string;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
}
