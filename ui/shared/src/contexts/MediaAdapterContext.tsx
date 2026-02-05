/**
 * MediaAdapterContext - Adapter for media generation API operations.
 *
 * This context abstracts away the API implementation, allowing:
 * - webui to provide real API calls
 * - editor to provide mock implementations for preview
 *
 * Used by: ImageGeneration, VideoGeneration, AudioGeneration components
 */

import { createContext, useContext, type ReactNode } from "react";
import type { SSEEventType } from "../types/index";

// =============================================================================
// Types
// =============================================================================

/** Generation data returned from API - flexible to match actual server response */
export interface GenerationData {
  id?: string;
  prompt_key?: string;
  prompt_id?: string;
  provider?: string;
  urls: string[];
  metadata?: Record<string, unknown>;
  metadata_id?: string;
  content_ids?: string[];
  request_params?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional fields
}

/** Response from getInteractionGenerations */
export interface GenerationsResponse {
  generations: GenerationData[];
}

/** Parameters for getMediaPreview - flexible to match actual usage */
export interface MediaPreviewParams {
  interaction_id?: string;
  prompt_key?: string;
  prompt?: string;
  provider?: string;
  action_type?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown; // Allow additional fields
}

/** Response from getMediaPreview - flexible to match actual response */
export interface MediaPreviewResponse {
  urls: string[];
  metadata?: Record<string, unknown>;
  resolution?: string;
  credits?: number;
  [key: string]: unknown; // Allow additional fields
}

/** Sub-action request for media generation */
export interface MediaSubActionRequest {
  interaction_id: string;
  sub_action_id: string;
  params?: Record<string, unknown>;
  ai_config?: {
    provider?: string;
    model?: string;
  };
}

/**
 * Injectable adapter for media API operations.
 * webui provides real implementation, editor can provide mock.
 */
export interface MediaAdapter {
  /**
   * Get the workflow run ID.
   * Returns null if not in an active workflow.
   */
  getWorkflowRunId: () => string | null;

  /**
   * Get the selected AI provider.
   * Returns null if no provider is selected.
   */
  getSelectedProvider: () => string | null;

  /**
   * Get the selected AI model.
   * Returns null if no model is selected.
   */
  getSelectedModel: () => string | null;

  /**
   * Convert a relative media URL to a full URL.
   * @param url - Relative URL from the server
   * @returns Full URL for media access
   */
  toMediaUrl: (url: string) => string;

  /**
   * Fetch existing generations for an interaction.
   * @param interactionId - The interaction ID
   * @param mediaType - Optional media type filter ("image", "video", "audio")
   * @returns Promise with generations data
   */
  getInteractionGenerations: (
    interactionId: string,
    mediaType?: string
  ) => Promise<GenerationsResponse>;

  /**
   * Get a preview of media before full generation.
   * @param params - Preview parameters
   * @returns Promise with preview URLs
   */
  getMediaPreview: (
    params: MediaPreviewParams
  ) => Promise<MediaPreviewResponse>;

  /**
   * Execute a sub-action with SSE streaming.
   * @param request - Sub-action request
   * @param onEvent - Event callback for SSE events
   * @param onError - Error callback
   */
  streamSubAction: (
    request: MediaSubActionRequest,
    onEvent: (eventType: SSEEventType, data: Record<string, unknown>) => void,
    onError: (error: Error) => void
  ) => void;
}

/** Context value including the adapter */
export interface MediaAdapterContextValue {
  adapter: MediaAdapter | null;
}

// =============================================================================
// Default Context
// =============================================================================

const defaultContext: MediaAdapterContextValue = {
  adapter: null,
};

// =============================================================================
// Context
// =============================================================================

const MediaAdapterContext = createContext<MediaAdapterContextValue>(defaultContext);

// =============================================================================
// Provider
// =============================================================================

interface MediaAdapterProviderProps {
  children: ReactNode;
  adapter: MediaAdapter;
}

/**
 * Provider for media adapter context.
 */
export function MediaAdapterProvider({ children, adapter }: MediaAdapterProviderProps) {
  return (
    <MediaAdapterContext.Provider value={{ adapter }}>
      {children}
    </MediaAdapterContext.Provider>
  );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access media adapter.
 * Throws if not in a MediaAdapterProvider.
 */
export function useMediaAdapter(): MediaAdapter {
  const { adapter } = useContext(MediaAdapterContext);
  if (!adapter) {
    throw new Error("useMediaAdapter must be used within MediaAdapterProvider");
  }
  return adapter;
}

/**
 * Optional hook that returns null if not in a MediaAdapterProvider.
 * Useful for components that may render outside of media context.
 */
export function useMediaAdapterOptional(): MediaAdapter | null {
  const { adapter } = useContext(MediaAdapterContext);
  return adapter;
}
