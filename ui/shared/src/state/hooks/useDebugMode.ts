/**
 * useDebugMode - Hook for managing debug mode state.
 *
 * Debug mode enables:
 * - Editing display_data from the state tree view
 * - Syncing external value changes to input components
 *
 * State is persisted in localStorage (non-expiring).
 */

import { useState, useCallback } from "react";

const DEBUG_MODE_KEY = "workflow-debug-mode";

/**
 * Get initial debug mode from localStorage.
 */
function getStoredDebugMode(): boolean {
  try {
    const stored = localStorage.getItem(DEBUG_MODE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

/**
 * Save debug mode to localStorage.
 */
function saveDebugMode(enabled: boolean): void {
  try {
    localStorage.setItem(DEBUG_MODE_KEY, String(enabled));
  } catch {
    // localStorage not available
  }
}

/**
 * Hook for managing debug mode.
 * Returns current state and toggle function.
 */
export function useDebugMode() {
  const [isDebugMode, setIsDebugMode] = useState(getStoredDebugMode);

  // Toggle and save synchronously (important for view refresh timing)
  const toggleDebugMode = useCallback(() => {
    setIsDebugMode((prev) => {
      const newValue = !prev;
      saveDebugMode(newValue); // Save synchronously before view refresh
      return newValue;
    });
  }, []);

  const setDebugMode = useCallback((enabled: boolean) => {
    saveDebugMode(enabled); // Save synchronously
    setIsDebugMode(enabled);
  }, []);

  return {
    isDebugMode,
    toggleDebugMode,
    setDebugMode,
  };
}

/**
 * Get debug mode directly from localStorage (for non-hook contexts).
 */
export function getDebugMode(): boolean {
  return getStoredDebugMode();
}
