/**
 * API client for virtual workflow execution.
 *
 * Communicates with the /workflow/virtual/* endpoints on the server.
 */

import { api } from "@wfm/shared";
import type {
  VirtualStartRequest,
  VirtualRespondRequest,
  VirtualWorkflowResponse,
} from "./types";

/**
 * POST JSON to an endpoint and return typed response.
 */
async function postJson<T>(
  endpoint: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await api.fetchResponse(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
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
    "/workflow/virtual/start",
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
    "/workflow/virtual/respond",
    request as unknown as Record<string, unknown>
  );
}
