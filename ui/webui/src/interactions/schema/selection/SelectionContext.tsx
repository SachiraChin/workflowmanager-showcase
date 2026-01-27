/**
 * SelectionContext - React context for selection and feedback state.
 *
 * Provides unified state management for both select and review modes:
 * - Selection: path-based selection for selectable arrays
 * - Feedback: per-path and global feedback for review mode
 * - Variant: cards vs list styling
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { SelectionItem } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

export type InteractionMode = "select" | "review";
export type VariantStyle = "cards" | "list";

export interface SelectionContextValue {
  // Mode and styling
  mode: InteractionMode;
  variant: VariantStyle;

  // Selection state (for mode: "select")
  multiSelect: boolean;
  minSelections: number;
  maxSelections: number;
  selectedPaths: string[][];
  selectedData: unknown[];
  isSelected: (path: string[]) => boolean;
  toggleSelection: (path: string[], data: unknown) => void;
  canSelect: (path: string[]) => boolean;

  // Feedback state (for mode: "review")
  feedbackByPath: Record<string, string>;
  globalFeedback: string;
  setFeedback: (path: string[] | null, feedback: string) => void;

  // Validation
  isValid: boolean;
  isDirty: boolean;
}

interface SelectionProviderProps {
  children: ReactNode;
  mode: InteractionMode;
  variant: VariantStyle;
  multiSelect?: boolean;
  minSelections?: number;
  maxSelections?: number;
  /** Initial selection items (for readonly mode from history) */
  initialSelectedItems?: SelectionItem[];
}

// =============================================================================
// Context
// =============================================================================

const SelectionContext = createContext<SelectionContextValue | null>(null);

// =============================================================================
// Hook
// =============================================================================

export function useSelection(): SelectionContextValue {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error("useSelection must be used within a SelectionProvider");
  }
  return context;
}

/**
 * Optional hook that returns null if not in a selection context.
 * Useful for components that may render outside of SchemaInteractionHost.
 */
export function useSelectionOptional(): SelectionContextValue | null {
  return useContext(SelectionContext);
}

// =============================================================================
// Helper Functions
// =============================================================================

function pathToKey(path: string[]): string {
  return path.join(".");
}

function pathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// =============================================================================
// Provider
// =============================================================================

export function SelectionProvider({
  children,
  mode,
  variant,
  multiSelect = false,
  minSelections = 1,
  maxSelections = 1,
  initialSelectedItems = [],
}: SelectionProviderProps) {
  // Split combined items into internal parallel arrays
  const [selectedPaths, setSelectedPaths] = useState<string[][]>(
    () => initialSelectedItems.map(item => item.path)
  );
  const [selectedData, setSelectedData] = useState<unknown[]>(
    () => initialSelectedItems.map(item => item.data)
  );
  const [isDirty, setIsDirty] = useState(false);

  // Feedback state
  const [feedbackByPath, setFeedbackByPath] = useState<Record<string, string>>({});
  const [globalFeedback, setGlobalFeedback] = useState("");

  // Selection helpers
  const isSelected = useCallback(
    (path: string[]) => selectedPaths.some((p) => pathsEqual(p, path)),
    [selectedPaths]
  );

  const canSelect = useCallback(
    (path: string[]) => {
      if (isSelected(path)) return true; // Can always deselect
      if (!multiSelect) return true; // Single select always allows
      return selectedPaths.length < maxSelections;
    },
    [isSelected, multiSelect, maxSelections, selectedPaths.length]
  );

  const toggleSelection = useCallback(
    (path: string[], data: unknown) => {
      setIsDirty(true);

      if (isSelected(path)) {
        // Deselect
        const idx = selectedPaths.findIndex((p) => pathsEqual(p, path));
        setSelectedPaths((prev) => prev.filter((_, i) => i !== idx));
        setSelectedData((prev) => prev.filter((_, i) => i !== idx));
      } else if (!multiSelect) {
        // Single select - replace
        setSelectedPaths([path]);
        setSelectedData([data]);
      } else if (selectedPaths.length < maxSelections) {
        // Multi select - add
        setSelectedPaths((prev) => [...prev, path]);
        setSelectedData((prev) => [...prev, data]);
      }
    },
    [isSelected, multiSelect, maxSelections, selectedPaths]
  );

  // Feedback helper
  const setFeedback = useCallback((path: string[] | null, feedback: string) => {
    setIsDirty(true);
    if (path === null) {
      setGlobalFeedback(feedback);
    } else {
      const key = pathToKey(path);
      setFeedbackByPath((prev) => ({
        ...prev,
        [key]: feedback,
      }));
    }
  }, []);

  // Validation
  const isValid = useMemo(() => {
    if (mode === "select") {
      return selectedPaths.length >= minSelections && selectedPaths.length <= maxSelections;
    }
    // Review mode is always valid (feedback is optional)
    return true;
  }, [mode, selectedPaths.length, minSelections, maxSelections]);

  // Context value
  const value = useMemo<SelectionContextValue>(
    () => ({
      mode,
      variant,
      multiSelect,
      minSelections,
      maxSelections,
      selectedPaths,
      selectedData,
      isSelected,
      toggleSelection,
      canSelect,
      feedbackByPath,
      globalFeedback,
      setFeedback,
      isValid,
      isDirty,
    }),
    [
      mode,
      variant,
      multiSelect,
      minSelections,
      maxSelections,
      selectedPaths,
      selectedData,
      isSelected,
      toggleSelection,
      canSelect,
      feedbackByPath,
      globalFeedback,
      setFeedback,
      isValid,
      isDirty,
    ]
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}
