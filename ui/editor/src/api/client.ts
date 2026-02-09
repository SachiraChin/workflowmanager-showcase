/**
 * API client for the workflow editor.
 *
 * Uses the shared API client for authentication handling,
 * but adds editor-specific endpoints.
 */

import { api } from "@wfm/shared";
import type {
  WorkflowTemplateResponse,
  WorkflowVersionResponse,
} from "./types";

// =============================================================================
// Editor API Client
// =============================================================================

export const editorApi = {
  /**
   * Get a workflow template by ID.
   * Returns template metadata and list of versions.
   */
  async getWorkflowTemplate(templateId: string): Promise<WorkflowTemplateResponse> {
    // Use the shared api's fetchResponse for auth handling, then parse JSON
    const response = await api.fetchResponse(`/workflow-templates/${templateId}`);
    return response.json();
  },

  /**
   * Get the latest version's workflow definition for a template.
   */
  async getWorkflowTemplateVersionLatest(
    templateId: string
  ): Promise<WorkflowVersionResponse> {
    const response = await api.fetchResponse(
      `/workflow-templates/${templateId}/versions/latest`
    );
    return response.json();
  },

  /**
   * Get a specific version's workflow definition for a template.
   */
  async getWorkflowTemplateVersion(
    templateId: string,
    versionId: string
  ): Promise<WorkflowVersionResponse> {
    const response = await api.fetchResponse(
      `/workflow-templates/${templateId}/versions/${versionId}`
    );
    return response.json();
  },
};
