/**
 * API client for virtual workflow execution.
 *
 * Communicates with the virtual-server which runs separately from the main
 * server for resource isolation. Endpoints are:
 * - POST /workflow/start
 * - POST /workflow/respond
 * - POST /workflow/resume/confirm
 * - POST /workflow/state
 * - POST /workflow/interaction-history
 */

import { VIRTUAL_API_URL } from "@wfm/shared";
import type {
  VirtualStartRequest,
  VirtualRespondRequest,
  VirtualWorkflowResponse,
  VirtualResumeConfirmRequest,
  VirtualStateRequest,
  VirtualStateResponse,
  VirtualInteractionHistoryRequest,
  VirtualInteractionHistoryResponse,
} from "./types";

/**
 * POST JSON to a virtual server endpoint and return typed response.
 */
async function postJson<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${VIRTUAL_API_URL}${endpoint}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Virtual API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Start virtual execution targeting a specific module.
 *
 * The server will execute all modules from the beginning (or from the
 * provided virtual_db checkpoint) up to and including the target module.
 * If the target module is interactive, returns AWAITING_INPUT with the
 * interaction request.
 */
export async function virtualStart(
  request: VirtualStartRequest
): Promise<VirtualWorkflowResponse> {
  return postJson<VirtualWorkflowResponse>(
    "/workflow/start",
    request as unknown as Record<string, unknown>
  );
}

/**
 * Submit a response to a virtual interaction.
 *
 * After the user provides input for an interactive module, call this
 * to continue execution. The server processes the response and continues
 * to the target module (which may be the same module for final confirmation,
 * or a subsequent module).
 */
export async function virtualRespond(
  request: VirtualRespondRequest
): Promise<VirtualWorkflowResponse> {
  return postJson<VirtualWorkflowResponse>(
    "/workflow/respond",
    request as unknown as Record<string, unknown>
  );
}

/**
 * Resume virtual workflow with updated workflow and execute to target.
 *
 * Use this when:
 * - User clicks on a module that hasn't been executed yet
 * - Workflow may have been edited since last execution
 *
 * The server will:
 * 1. Import the virtual_db state (preserving existing events)
 * 2. Store the (potentially updated) workflow as a new version
 * 3. Resume execution from current position to the target module
 */
export async function virtualResumeConfirm(
  request: VirtualResumeConfirmRequest
): Promise<VirtualWorkflowResponse> {
  return postJson<VirtualWorkflowResponse>(
    "/workflow/resume/confirm",
    request as unknown as Record<string, unknown>
  );
}

/**
 * Get workflow state from virtual database.
 *
 * Returns the full workflow state without executing anything.
 * Used to display state panel.
 */
export async function virtualGetState(
  request: VirtualStateRequest
): Promise<VirtualStateResponse> {
  return postJson<VirtualStateResponse>(
    "/workflow/state",
    request as unknown as Record<string, unknown>
  );
}

/**
 * Get interaction history from virtual database.
 *
 * Returns all completed interactions (request + response pairs) and
 * the current pending interaction if any.
 * Used to render preview of completed interactive modules.
 */
export async function virtualGetInteractionHistory(
  request: VirtualInteractionHistoryRequest
): Promise<VirtualInteractionHistoryResponse> {
  return postJson<VirtualInteractionHistoryResponse>(
    "/workflow/interaction-history",
    request as unknown as Record<string, unknown>
  );
}
