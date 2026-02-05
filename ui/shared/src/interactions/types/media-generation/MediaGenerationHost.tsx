/**
 * MediaGenerationHost - Simplified coordinator for media generation.
 *
 * Only manages truly shared state:
 * - selectedContentId (global selection)
 * - registerGeneration (collect results from children)
 * - Provider for InteractionHost integration
 *
 * Individual state (generations, loading, progress, error, preview)
 * is managed locally by ImageGeneration and VideoGeneration components.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useInteraction } from "../../../contexts/interaction-context";
import { SchemaRenderer } from "../../../schema/SchemaRenderer";
import {
  MediaGenerationProvider,
  type MediaGenerationContextValue,
} from "./MediaGenerationContext";
import type { SubActionConfig, GenerationResult } from "./types";
import type { SchemaProperty } from "../../../types/schema";

// =============================================================================
// Component
// =============================================================================

export function MediaGenerationHost() {
  const { request, disabled, updateProvider, mode } = useInteraction();
  const isReadonly = mode.type === "readonly";

  // Extract from display_data
  const displayData = request.display_data || {};
  const data = displayData.data as Record<string, unknown>;
  const schema = displayData.schema as SchemaProperty | undefined;
  const subActions = (displayData.sub_actions || []) as SubActionConfig[];

  // ONLY shared state - selection across all tabs
  const [selectedContentId, setSelectedContentId] = useState<string | null>(
    null
  );

  // Track generations from children for response
  const generationsRef = useRef<Record<string, GenerationResult[]>>({});

  // Track generations count as state to trigger provider updates for validation
  const [generationsCount, setGenerationsCount] = useState(0);

  // Initialize from readonly response
  useEffect(() => {
    if (isReadonly && mode.response) {
      const response = mode.response as {
        selected_content_id?: string;
      };
      if (response.selected_content_id) {
        setSelectedContentId(response.selected_content_id);
      }
    }
  }, [isReadonly, mode]);

  // Register generation from child components
  const registerGeneration = useCallback(
    (path: string, result: GenerationResult) => {
      generationsRef.current[path] = [
        ...(generationsRef.current[path] || []),
        result,
      ];
      // Update count to trigger provider state update for validation
      setGenerationsCount((prev) => prev + 1);
    },
    []
  );

  // Refs for getResponse closure stability
  const selectedContentIdRef = useRef(selectedContentId);
  selectedContentIdRef.current = selectedContentId;
  const generationsCountRef = useRef(generationsCount);
  generationsCountRef.current = generationsCount;

  // Register provider with InteractionHost
  // Note: isValid is always true - selection is optional for media generation
  // workflows. The retryable config controls whether to require selection.
  useEffect(() => {
    updateProvider({
      getState: () => ({
        isValid: true,
        selectedCount: selectedContentIdRef.current ? 1 : 0,
        selectedGroupIds: [],
        generationsCount: generationsCountRef.current,
      }),
      getResponse: () => ({
        selected_content_id: selectedContentIdRef.current ?? undefined,
        generations: generationsRef.current,
      }),
    });
  }, [updateProvider]);

  // Update provider when selection or generations count changes
  useEffect(() => {
    updateProvider({
      getState: () => ({
        isValid: true,
        selectedCount: selectedContentId ? 1 : 0,
        selectedGroupIds: [],
        generationsCount: generationsCountRef.current,
      }),
      getResponse: () => ({
        selected_content_id: selectedContentIdRef.current ?? undefined,
        generations: generationsRef.current,
      }),
    });
  }, [selectedContentId, generationsCount, updateProvider]);

  // Build context value
  const contextValue = useMemo<MediaGenerationContextValue>(
    () => ({
      subActions,
      selectedContentId,
      onSelectContent: setSelectedContentId,
      registerGeneration,
      rootData: data,
      readonly: isReadonly,
      disabled: disabled || isReadonly,
    }),
    [subActions, selectedContentId, registerGeneration, data, isReadonly, disabled]
  );

  // If no data or schema, show placeholder
  if (!data || !schema) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <MediaGenerationProvider value={contextValue}>
      <div className="h-full overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-black/20 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent dark:[&::-webkit-scrollbar-thumb]:bg-white/30">
        <SchemaRenderer
          data={data}
          schema={schema}
          path={[]}
          disabled={disabled || isReadonly}
          readonly={isReadonly}
        />
      </div>
    </MediaGenerationProvider>
  );
}
