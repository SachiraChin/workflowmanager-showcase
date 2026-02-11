/**
 * API types for the workflow editor.
 */

import type { StepDefinition } from "@wfm/shared";

// =============================================================================
// Workflow Definition (matches backend WorkflowDefinition)
// =============================================================================

export interface WorkflowDefinition {
  workflow_id: string;
  name?: string;
  description?: string;
  steps: StepDefinition[];
  config?: Record<string, unknown>;
  status_display?: Record<string, unknown>;
}

// =============================================================================
// Version Info
// =============================================================================

export interface WorkflowVersionInfo {
  workflow_version_id: string;
  created_at: string;
  content_hash: string;
  source_type: string;
}

// =============================================================================
// API Responses
// =============================================================================

/**
 * Response from GET /workflow-templates/{template_id}
 */
export interface WorkflowTemplateResponse {
  template_id: string;
  template_name: string;
  name?: string;
  scope: "global" | "user";
  visibility: "public" | "visible" | "hidden";
  derived_from?: string;
  download_url?: string;
  versions: WorkflowVersionInfo[];
  /** True if current user owns this template */
  is_owner: boolean;
  /** True if this is a global template */
  is_global: boolean;
  /** True if current user can edit (owner or admin for global) */
  can_edit: boolean;
}

/**
 * Response from GET /workflow-templates/{template_id}/versions/{version_id}
 * and GET /workflow-templates/{template_id}/versions/latest
 * 
 * Note: `definition` will be null for global templates that user can't edit.
 * User must clone first to get access to the content.
 */
export interface WorkflowVersionResponse {
  template_id: string;
  template_name: string;
  workflow_version_id: string;
  created_at: string;
  /** Null for global templates user can't edit */
  definition: WorkflowDefinition | null;
  /** True if current user owns this template */
  is_owner: boolean;
  /** True if this is a global template */
  is_global: boolean;
  /** True if current user can edit (owner or admin for global) */
  can_edit: boolean;
  /** If user has a cloned version, redirect to this */
  redirect_to: { template_id: string; version_id: string } | null;
}

/**
 * Response from POST /workflow-templates/{template_id}/versions/{version_id}/clone
 */
export interface CloneVersionResponse {
  template_id: string;
  version_id: string;
  template_name: string;
  is_new_template: boolean;
  is_new_version: boolean;
}
