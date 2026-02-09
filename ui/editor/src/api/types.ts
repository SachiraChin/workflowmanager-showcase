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
}

/**
 * Response from GET /workflow-templates/{template_id}/versions/{version_id}
 * and GET /workflow-templates/{template_id}/versions/latest
 */
export interface WorkflowVersionResponse {
  template_id: string;
  template_name: string;
  workflow_version_id: string;
  created_at: string;
  definition: WorkflowDefinition;
}
