/**
 * MediaGenerationContext - State management for media generation interaction.
 *
 * Provides generation-specific state to descendant components:
 * - Generations by prompt path
 * - Loading/progress state
 * - Selected content
 * - Sub-action execution
 *
 * Used by ContentPanelSchemaRenderer to detect when it should render
 * with media generation capabilities.
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type {
  SubActionConfig,
  GenerationResult,
  ProgressState,
  PreviewInfo,
  CropState,
} from "./types";

// =============================================================================
// Types
// =============================================================================

export interface MediaGenerationContextValue {
  /** Available sub-actions (from workflow config) */
  subActions: SubActionConfig[];

  /** Get generations for a given path */
  getGenerations: (path: string[]) => GenerationResult[];

  /** Check if a prompt is currently loading */
  isLoading: (path: string[]) => boolean;

  /** Get progress for a loading prompt */
  getProgress: (path: string[]) => ProgressState | undefined;

  /** Get error for a prompt */
  getError: (path: string[]) => string | undefined;

  /** Currently selected content ID (global) */
  selectedContentId: string | null;

  /** Select content */
  onSelectContent: (contentId: string) => void;

  /** Execute sub-action for a prompt */
  executeSubAction: (
    path: string[],
    action: SubActionConfig,
    params: Record<string, unknown>,
    metadata: { provider: string; promptId: string }
  ) => void;

  /** Readonly mode */
  readonly: boolean;

  /** Disabled mode */
  disabled: boolean;

  /** Get preview info for a prompt */
  getPreview: (path: string[]) => PreviewInfo | undefined;

  /** Check if preview is loading for a prompt */
  isPreviewLoading: (path: string[]) => boolean;

  /** Fetch preview for a prompt with given params */
  fetchPreview: (
    path: string[],
    provider: string,
    actionType: string,
    params: Record<string, unknown>
  ) => void;

  /** Get data at a given path (for accessing sibling fields) */
  getDataAtPath: (path: string[]) => unknown;

  // =============================================================================
  // Crop Selection State (for img2vid)
  // =============================================================================

  /** Saved crop selection (global, applies to all providers) */
  savedCrop: CropState | null;

  /** Set saved crop selection */
  setSavedCrop: (crop: CropState | null) => void;

  /** Clear saved crop selection */
  clearSavedCrop: () => void;
}

export interface MediaGenerationProviderProps {
  children: ReactNode;
  value: MediaGenerationContextValue;
}

// =============================================================================
// Context
// =============================================================================

const MediaGenerationContext = createContext<MediaGenerationContextValue | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access MediaGeneration context.
 * Returns null if not within a MediaGeneration interaction.
 */
export function useMediaGeneration(): MediaGenerationContextValue | null {
  return useContext(MediaGenerationContext);
}

/**
 * Check if we're inside a MediaGeneration context.
 */
export function useIsMediaGeneration(): boolean {
  return useContext(MediaGenerationContext) !== null;
}

// =============================================================================
// Provider
// =============================================================================

export function MediaGenerationProvider({
  children,
  value,
}: MediaGenerationProviderProps) {
  return (
    <MediaGenerationContext.Provider value={value}>
      {children}
    </MediaGenerationContext.Provider>
  );
}
