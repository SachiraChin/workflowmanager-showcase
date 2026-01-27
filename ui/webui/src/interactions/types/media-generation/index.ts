/**
 * MediaGeneration interaction component.
 *
 * Handles media_generation interaction type for image/video generation workflows.
 */

export { MediaGeneration } from "./MediaGeneration";

// Context exports
export {
  MediaGenerationProvider,
  useMediaGeneration,
  useIsMediaGeneration,
  type MediaGenerationContextValue,
} from "./MediaGenerationContext";

// Re-export types for external use
export type {
  SubActionConfig,
  GenerationResult,
  PromptData,
  PromptsData,
  ProgressState,
  PreviewInfo,
  ResolutionInfo,
  CreditInfo,
  CropRegion,
  CropState,
} from "./types";

export { CROP_ASPECT_RATIOS } from "./types";
