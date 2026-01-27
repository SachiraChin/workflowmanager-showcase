/**
 * TabsContext - React context for tab registration and state management.
 *
 * TabsLayout provides this context, TabLayout children register with it.
 * Manages active tab state and tab visibility.
 */

import { createContext, useContext } from "react";

// =============================================================================
// Types
// =============================================================================

export interface TabInfo {
  /** Unique identifier for this tab (typically path.join(".")) */
  id: string;
  /** Display label for tab header */
  label: string;
  /** Registration order (for consistent tab ordering) */
  order: number;
}

export interface TabsContextValue {
  /** Register a tab with the container */
  register: (tab: Omit<TabInfo, "order">) => void;
  /** Unregister a tab when unmounted */
  unregister: (id: string) => void;
  /** Check if a tab is the active tab */
  isActive: (id: string) => boolean;
  /** Set the active tab */
  setActive: (id: string) => void;
  /** All registered tabs (sorted by order) */
  tabs: TabInfo[];
  /** Currently active tab ID (null = first tab) */
  activeTabId: string | null;
}

// =============================================================================
// Context
// =============================================================================

export const TabsContext = createContext<TabsContextValue | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Get the TabsContext value.
 * Throws if used outside a TabsLayout.
 */
export function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("useTabsContext must be used within a TabsLayout");
  }
  return context;
}

/**
 * Get the TabsContext value, or null if not in a TabsLayout.
 * Use this when tab functionality is optional.
 */
export function useTabsContextOptional(): TabsContextValue | null {
  return useContext(TabsContext);
}
