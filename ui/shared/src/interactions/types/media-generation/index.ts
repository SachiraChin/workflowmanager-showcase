/**
 * MediaGeneration interaction component.
 *
 * Handles media_generation interaction type for image/video generation workflows.
 */

export { MediaGenerationHost } from "./MediaGenerationHost";
export { Media } from "./Media";
export { ImageGeneration } from "./ImageGeneration";
export { VideoGeneration } from "./VideoGeneration";
export { AudioGeneration } from "./AudioGeneration";

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
