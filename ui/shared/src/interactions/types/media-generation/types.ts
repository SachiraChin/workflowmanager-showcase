/**
 * Types for MediaGeneration interaction component.
 *
 * These types match the server-side models in:
 * - server/models/requests.py (SubActionRequest)
 * - server/models/sub_action.py (SSE events)
 */

// =============================================================================
// Sub-Action Configuration
// =============================================================================

/**
 * Sub-action configuration from workflow module config.
 * Passed through display_data.sub_actions.
 */
export interface SubActionConfig {
  /** Unique identifier for the action */
  id: string;
  /** Button label */
  label: string;
  /** Operation type: "txt2img", "img2img", "img2vid" */
  action_type: string;
  /** Label shown while loading */
  loading_label?: string;
  /** Where results accumulate in display_data */
  result_key: string;
}

// =============================================================================
// Generation Results
// =============================================================================

/**
 * Result from a successful generation sub-action.
 * Returned in SSE complete event.
 */
export interface GenerationResult {
  /** URLs of generated content */
  urls: string[];
  /** Database ID for generation metadata (optional for adapter flexibility) */
  metadata_id?: string;
  /** Database IDs for individual content items (optional for adapter flexibility) */
  content_ids?: string[];
}

// =============================================================================
// Prompt Data Structures
// =============================================================================

/**
 * Individual prompt data (structured fields or string).
 */
export type PromptData = Record<string, unknown> | string;

/**
 * Prompts grouped by provider and prompt ID.
 * Structure: prompts[provider][prompt_id] = prompt_data
 */
export interface PromptsData {
  prompts: Record<string, Record<string, PromptData>>;
}

// =============================================================================
// SSE Event Types
// =============================================================================

/**
 * SSE event: Sub-action started.
 */
export interface SSEStartedEvent {
  /** Unique ID for this execution run */
  execution_id: string;
  /** ID of the sub-action definition (e.g., "image_generation") */
  sub_action_id: string;
}

/**
 * SSE event: Progress update during generation.
 */
export interface SSEProgressEvent {
  elapsed_ms: number;
  message: string;
}

/**
 * SSE event: Generation completed successfully.
 */
export interface SSECompleteEvent {
  urls: string[];
  metadata_id: string;
  content_ids: string[];
}

/**
 * SSE event: Error occurred.
 */
export interface SSEErrorEvent {
  message: string;
  retry_after?: number;
}

/**
 * Union of all SSE event data types.
 */
export type SSEEventData =
  | SSEStartedEvent
  | SSEProgressEvent
  | SSECompleteEvent
  | SSEErrorEvent;

// =============================================================================
// Sub-Action Request
// =============================================================================

/**
 * Request body for sub-action API call.
 * Matches server SubActionRequest model.
 */
export interface SubActionRequest {
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
// Component State
// =============================================================================

/**
 * Progress state during generation.
 */
export interface ProgressState {
  elapsed_ms: number;
  message: string;
}

/**
 * Loading state for a prompt.
 */
export interface PromptLoadingState {
  isLoading: boolean;
  progress?: ProgressState;
  error?: string;
}

// =============================================================================
// Preview Types
// =============================================================================

/**
 * Resolution information for preview.
 */
export interface ResolutionInfo {
  width: number;
  height: number;
  megapixels: number;
}

/**
 * Credit/cost information for preview.
 */
export interface CreditInfo {
  credits: number;
  cost_per_credit: number;
  total_cost_usd: number;
  num_images: number;
  credits_per_image: number;
  cost_per_image_usd: number;
}

/**
 * Combined preview information for a generation configuration.
 */
export interface PreviewInfo {
  resolution: ResolutionInfo;
  credits: CreditInfo;
}

// =============================================================================
// Crop Selection Types
// =============================================================================

/**
 * Crop region coordinates in pixels.
 * Coordinates are relative to the original image dimensions.
 */
export interface CropRegion {
  /** X offset from left edge in pixels */
  x: number;
  /** Y offset from top edge in pixels */
  y: number;
  /** Width of crop region in pixels */
  width: number;
  /** Height of crop region in pixels */
  height: number;
}

/**
 * Saved crop state including region and aspect ratio.
 */
export interface CropState {
  /** The crop region coordinates */
  region: CropRegion;
  /** The aspect ratio used for this crop (e.g., "9:16", "16:9", "free") */
  aspectRatio: string;
}

/**
 * Available aspect ratio options for crop selection.
 */
export const CROP_ASPECT_RATIOS = [
  { key: "9:16", label: "9:16 (Portrait)", value: 9 / 16 },
  { key: "16:9", label: "16:9 (Landscape)", value: 16 / 9 },
  { key: "2:3", label: "2:3 (Portrait)", value: 2 / 3 },
  { key: "3:2", label: "3:2 (Landscape)", value: 3 / 2 },
  { key: "3:4", label: "3:4 (Portrait)", value: 3 / 4 },
  { key: "4:3", label: "4:3 (Landscape)", value: 4 / 3 },
  { key: "1:1", label: "1:1 (Square)", value: 1 },
  { key: "free", label: "Free Selection", value: undefined },
] as const;
