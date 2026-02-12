/**
 * API Client Interface Types
 *
 * Defines the interface for the API client that can be implemented
 * by both the production client (calls real endpoints) and virtual
 * client (calls virtual endpoints with virtualDb for editor preview).
 */

import type {
  StartWorkflowRequest,
  StartWorkflowByVersionRequest,
  WorkflowResponse,
  RespondRequest,
  WorkflowStatusResponse,
  SSEEventType,
  WorkflowDefinition,
  InteractionHistoryResponse,
  WorkflowTemplatesResponse,
  SubActionRequest,
  WorkflowFileContent,
  ModelsResponse,
  CloneVersionResponse,
} from "../types/index";

// =============================================================================
// Response Types
// =============================================================================

export interface GenerationsResponse {
  generations: Array<{
    urls: string[];
    metadata_id: string;
    content_ids: string[];
    prompt_id: string;
    provider: string;
    request_params?: Record<string, unknown>;
  }>;
}

export interface MediaPreviewRequest {
  provider: string;
  action_type: string;
  params: Record<string, unknown>;
}

export interface MediaPreviewResponse {
  resolution: {
    width: number;
    height: number;
    megapixels: number;
  };
  credits: {
    credits: number;
    cost_per_credit: number;
    total_cost_usd: number;
    num_images: number;
    credits_per_image: number;
    cost_per_image_usd: number;
  };
}

export interface WorkflowRunItem {
  workflow_run_id: string;
  project_name: string;
  workflow_template_name: string;
  status: string;
  current_step: string | null;
  current_step_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface WorkflowRunsResponse {
  workflows: WorkflowRunItem[];
  count: number;
  total: number;
}

export interface StatusDisplayResponse {
  display_fields: Array<{ id: string; label: string; value: string }>;
  layout?: string[][];
}

export interface WorkflowDefinitionResponse {
  workflow_run_id: string;
  version_id: string;
  definition: WorkflowDefinition;
  raw_definition?: WorkflowDefinition;
}

export interface InteractionDataResponse {
  display_data: Record<string, unknown>;
}

export interface LoginResponse {
  user_id: string;
  email?: string | null;
  username: string;
  role?: string | null;
  message: string;
}

export interface InvitationStatusResponse {
  invitation_code: string;
  remaining_uses: number;
  expires_at?: string | null;
}

export interface RegisterRequest {
  invitation_code: string;
  username: string;
  password: string;
  email?: string;
}

export interface CurrentUserResponse {
  user_id: string;
  email?: string | null;
  username: string;
  role?: string | null;
}

export interface PublishGlobalResponse {
  global_template_id: string;
  inserted: number;
  existing: number;
}

// =============================================================================
// API Client Interface
// =============================================================================

/**
 * Full API client interface.
 *
 * This interface defines all methods available on the API client.
 * Both production and virtual implementations must implement this.
 */
export interface ApiClientInterface {
  // Configuration
  setAccessKey(key: string): void;

  // ============================================================
  // Workflow Endpoints
  // ============================================================

  startWorkflow(request: StartWorkflowRequest): Promise<WorkflowResponse>;

  confirmWorkflowStart(request: StartWorkflowRequest): Promise<WorkflowResponse>;

  startWorkflowByVersion(
    versionId: string,
    request: StartWorkflowByVersionRequest
  ): Promise<WorkflowResponse>;

  getStatus(workflowRunId: string): Promise<WorkflowStatusResponse>;

  respond(request: RespondRequest): Promise<WorkflowResponse>;

  cancel(workflowRunId: string): Promise<void>;

  resume(workflowRunId: string): Promise<WorkflowResponse>;

  resumeWithContent(
    workflowRunId: string,
    workflowContent: string | Record<string, unknown>,
    entryPoint?: string,
    capabilities?: string[]
  ): Promise<WorkflowResponse>;

  confirmResume(
    workflowRunId: string,
    workflowContent: string | Record<string, unknown>,
    entryPoint?: string,
    capabilities?: string[]
  ): Promise<WorkflowResponse>;

  getState(workflowRunId: string): Promise<Record<string, unknown>>;

  getStateV2(workflowRunId: string): Promise<{ state: Record<string, unknown> }>;

  getStatusDisplay(workflowRunId: string): Promise<StatusDisplayResponse>;

  getWorkflowDefinition(workflowRunId: string): Promise<WorkflowDefinitionResponse>;

  getWorkflowFile(workflowRunId: string, fileId: string): Promise<WorkflowFileContent>;

  listWorkflowTemplates(): Promise<WorkflowTemplatesResponse>;

  cloneGlobalVersionToUser(
    templateId: string,
    versionId: string
  ): Promise<CloneVersionResponse>;

  publishGlobalTemplate(sourceVersionId: string): Promise<PublishGlobalResponse>;

  listWorkflowRuns(limit?: number, offset?: number): Promise<WorkflowRunsResponse>;

  // ============================================================
  // Interaction Endpoints
  // ============================================================

  getInteractionHistory(workflowRunId: string): Promise<InteractionHistoryResponse>;

  getInteractionData(
    workflowRunId: string,
    interactionId: string
  ): Promise<InteractionDataResponse>;

  getInteractionGenerations(
    workflowRunId: string,
    interactionId: string,
    contentType: string
  ): Promise<GenerationsResponse>;

  // ============================================================
  // Media Endpoints
  // ============================================================

  getMediaPreview(
    workflowRunId: string,
    request: MediaPreviewRequest
  ): Promise<MediaPreviewResponse>;

  // ============================================================
  // Models Configuration
  // ============================================================

  getModels(): Promise<ModelsResponse>;

  // ============================================================
  // Authentication Endpoints
  // ============================================================

  login(identifier: string, password: string): Promise<LoginResponse>;

  getInvitationStatus(invitationCode: string): Promise<InvitationStatusResponse>;

  registerWithInvitation(request: RegisterRequest): Promise<LoginResponse>;

  guestAccess(invitationCode: string): Promise<LoginResponse>;

  logout(): Promise<{ message: string }>;

  refreshToken(): Promise<{ message: string }>;

  getCurrentUser(): Promise<CurrentUserResponse>;

  // ============================================================
  // SSE Streaming
  // ============================================================

  streamWorkflow(
    workflowRunId: string,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void;

  streamState(
    workflowRunId: string,
    onSnapshot: (state: Record<string, unknown>) => void,
    onUpdate: (changedKeys: string[], updates: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void;

  streamRespond(
    request: RespondRequest,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError?: (error: Error) => void,
    onStart?: () => void
  ): () => void;

  streamSubAction(
    workflowRunId: string,
    request: SubActionRequest,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError?: (error: Error) => void
  ): () => void;
}
