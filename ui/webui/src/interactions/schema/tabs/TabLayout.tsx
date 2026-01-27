/**
 * TabLayout - Wrapper component for individual tabs.
 *
 * Registers itself with parent TabsContext and controls visibility.
 * Used as render_as="tab" or as outer wrapper in compound like "tab.media".
 *
 * If children are passed (from compound parsing), renders them.
 * Otherwise, renders content via SchemaRenderer with render_as stripped.
 */

import { useEffect, type ReactNode } from "react";
import { useTabsContext } from "./TabsContext";
import type { SchemaProperty, UxConfig } from "../types";

// Forward declaration to avoid circular import
import { SchemaRenderer } from "../../SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface TabLayoutProps {
  /** Schema for this tab's content */
  schema: SchemaProperty;
  /** Data for this tab's content */
  data: unknown;
  /** Path to this data in the tree */
  path: string[];
  /** UX configuration */
  ux: UxConfig;
  /** Children from compound parsing (e.g., tab.media passes MediaPanel as children) */
  children?: ReactNode;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve tab label from ux config and data.
 * Priority: tab_label > tab_label_field > fallback
 */
function resolveTabLabel(ux: UxConfig, data: unknown, fallback: string): string {
  // 1. Static tab_label
  if (ux.tab_label) {
    return ux.tab_label;
  }

  // 2. Dynamic tab_label_field
  if (ux.tab_label_field && typeof data === "object" && data !== null) {
    const dataObj = data as Record<string, unknown>;
    const fieldValue = dataObj[ux.tab_label_field];
    if (fieldValue !== undefined && fieldValue !== null) {
      return String(fieldValue);
    }
  }

  // 3. Fallback to path-based label
  return fallback;
}

// =============================================================================
// Component
// =============================================================================

export function TabLayout({
  schema,
  data,
  path,
  ux,
  children,
}: TabLayoutProps) {
  const tabsContext = useTabsContext();
  const tabId = path.join(".");

  // Resolve label
  const label = resolveTabLabel(ux, data, path[path.length - 1] || "Tab");

  // Extract stable functions to avoid dependency on whole context
  const { register, unregister } = tabsContext;

  // Register on mount, unregister on unmount
  useEffect(() => {
    register({ id: tabId, label });

    return () => {
      unregister(tabId);
    };
  }, [tabId, label, register, unregister]);

  // Only render if this is the active tab
  if (!tabsContext.isActive(tabId)) {
    return null;
  }

  // If children passed (from compound like tab.media), render them
  if (children) {
    return <>{children}</>;
  }

  // Otherwise, render content via SchemaRenderer with render_as stripped
  return (
    <SchemaRenderer
      schema={schema}
      data={data}
      path={path}
      ux={{ ...ux, render_as: undefined }}
    />
  );
}
