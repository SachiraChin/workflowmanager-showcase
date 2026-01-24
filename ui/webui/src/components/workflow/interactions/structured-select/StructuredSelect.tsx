/**
 * StructuredSelect - Structured selection using InteractionContext.
 *
 * Uses SchemaInteractionHost for rendering and registers with
 * InteractionHost via updateProvider for response handling.
 */

import { useCallback, useEffect, useRef, useMemo } from "react";
import { useInteraction } from "@/lib/interaction-context";
import type { SelectionItem } from "@/lib/types";
import {
  SchemaInteractionHost,
  type SchemaInteractionState,
} from "../schema-interaction";

/**
 * Convert selection state to server response format
 *
 * Handles two path formats:
 * 1. Single-element paths (additionalProperties): ["sora"] -> "sora"
 * 2. Multi-element paths (nested items): ["items", "0"] -> ["items", 0]
 *
 * For multi-select with single-element paths: [["sora"], ["leonardo"]] -> ["sora", "leonardo"]
 * For single-select: [["items", "0"]] -> ["items", 0]
 */
function buildSelectResponse(
  selectedPaths: string[][],
  selectedData: unknown[],
  multiSelect: boolean
) {
  // Convert paths to indices format expected by server
  // Convert numeric strings to numbers, keep string keys as strings
  const convertedPaths = selectedPaths.map((path) =>
    path.map((p) => {
      const num = parseInt(p, 10);
      return isNaN(num) ? p : num;
    })
  );

  let resultIndices: (string | number | (string | number)[])[];

  if (multiSelect) {
    // For multi-select, flatten single-element paths to just the element
    // [["sora"], ["leonardo"]] -> ["sora", "leonardo"]
    // [["items", 0], ["items", 1]] -> [["items", 0], ["items", 1]] (keep nested)
    resultIndices = convertedPaths.map((path) =>
      path.length === 1 ? path[0] : path
    );
  } else {
    // For single select, unwrap the outer array: [['items', '0']] -> ['items', 0]
    if (convertedPaths.length === 1) {
      resultIndices = convertedPaths[0] as (string | number)[];
    } else {
      resultIndices = convertedPaths;
    }
  }

  return {
    selected_indices: resultIndices,
    selected_options: selectedData.map((data, i) => ({
      data,
      index: selectedPaths[i] || [],
    })),
  };
}

export function StructuredSelect() {
  const { request, disabled, updateProvider, mode } = useInteraction();

  const displayData = request.display_data || {};
  const multiSelect = displayData.multi_select === true;

  // Extract initial selection from readonly response
  const initialSelectedItems = useMemo<SelectionItem[] | undefined>(() => {
    if (mode.type !== "readonly") return undefined;

    const selectedOptions = mode.response.selected_options;
    if (!selectedOptions?.length) return undefined;

    // Convert response format to SelectionItem[]
    return selectedOptions.map((opt) => ({
      path: Array.isArray(opt.index) ? opt.index.map(String) : [],
      data: opt.data,
    }));
  }, [mode]);

  // Keep ref for getResponse closure (reads latest state at submit time)
  const stateRef = useRef<SchemaInteractionState | null>(null);
  const multiSelectRef = useRef(multiSelect);
  multiSelectRef.current = multiSelect;

  // Handle state changes from SchemaInteractionHost
  // Call updateProvider directly to notify parent immediately (not via useEffect with ref deps)
  const handleStateChange = useCallback(
    (state: SchemaInteractionState) => {
      stateRef.current = state;
      updateProvider({
        getResponse: () => {
          const currentState = stateRef.current;
          if (!currentState) {
            return { selected_indices: [], selected_options: [] };
          }
          return buildSelectResponse(
            currentState.selectedPaths,
            currentState.selectedData,
            multiSelectRef.current
          );
        },
        getState: () => ({
          isValid: state.isValid,
          selectedCount: state.selectedCount,
          selectedGroupIds: [],
        }),
      });
    },
    [updateProvider]
  );

  // Register provider on mount (for initial state before any selection)
  useEffect(() => {
    updateProvider({
      getResponse: () => {
        const state = stateRef.current;
        if (!state) {
          return { selected_indices: [], selected_options: [] };
        }
        return buildSelectResponse(
          state.selectedPaths,
          state.selectedData,
          multiSelectRef.current
        );
      },
      getState: () => {
        const state = stateRef.current;
        return {
          isValid: state?.isValid ?? false,
          selectedCount: state?.selectedCount ?? 0,
          selectedGroupIds: [],
        };
      },
    });
  }, [updateProvider]);

  return (
    <div className="h-full">
      <SchemaInteractionHost
        request={request}
        mode="select"
        variant="cards"
        disabled={disabled}
        onStateChange={handleStateChange}
        initialSelectedItems={initialSelectedItems}
      />
    </div>
  );
}
