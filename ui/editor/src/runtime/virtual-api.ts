import { api } from "@wfm/shared";
import type {
  InteractionResponseData,
  WorkflowResponse,
} from "@wfm/shared";

export type VirtualStartRequest = {
  workflow: Record<string, unknown>;
  virtual_db: string | null;
  target_step_id: string;
  target_module_name: string;
};

export type VirtualRespondRequest = {
  workflow: Record<string, unknown>;
  virtual_db: string;
  target_step_id: string;
  target_module_name: string;
  interaction_id: string;
  response: InteractionResponseData;
};

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

export async function virtualStart(
  request: VirtualStartRequest
): Promise<WorkflowResponse> {
  return postJson<WorkflowResponse>("/workflow/virtual/start", request);
}

export async function virtualRespond(
  request: VirtualRespondRequest
): Promise<WorkflowResponse> {
  return postJson<WorkflowResponse>("/workflow/virtual/respond", request);
}
