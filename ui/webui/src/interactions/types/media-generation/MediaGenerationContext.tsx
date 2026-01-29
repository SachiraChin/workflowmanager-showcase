/**
 * MediaGenerationContext - Shared state for media generation interaction.
 *
 * Provides only truly shared state to descendant components:
 * - Selected content ID (global selection across all tabs)
 * - Sub-actions (from workflow config)
 * - Register generation callback (for collecting response)
 * - Readonly/disabled flags
 *
 * Individual state (generations, loading, progress, error, preview) is
 * managed locally by ImageGeneration and VideoGeneration components.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { SubActionConfig, GenerationResult } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface MediaGenerationContextValue {
  /** Available sub-actions (from workflow config) */
  subActions: SubActionConfig[];

  /** Currently selected content ID (global across all tabs) */
  selectedContentId: string | null;

  /** Select content */
  onSelectContent: (contentId: string) => void;

  /** Register a generation result (for response collection) */
  registerGeneration: (path: string, result: GenerationResult) => void;

  /** Root data from the interaction (for accessing parent-level values) */
  rootData: Record<string, unknown>;

  /** Readonly mode */
  readonly: boolean;

  /** Disabled mode */
  disabled: boolean;
}

export interface MediaGenerationProviderProps {
  children: ReactNode;
  value: MediaGenerationContextValue;
}

// =============================================================================
// Context
// =============================================================================

const MediaGenerationContext = createContext<MediaGenerationContextValue | null>(
  null
);

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
