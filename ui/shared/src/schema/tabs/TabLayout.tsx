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
import type { SchemaProperty, UxConfig } from "../../types/schema";

// Forward declaration to avoid circular import
import { SchemaRenderer } from "../SchemaRenderer";

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
  /** Children from compound parsing (e.g., tab.media[...] passes inner content as children) */
  children?: ReactNode;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Resolve tab label from ux config, context, and data.
 * Priority: tab_label > tab_label_field > tabKey (from context) > fallback
 */
function resolveTabLabel(
  ux: UxConfig,
  data: unknown,
  fallback: string,
  tabKey?: string
): string {
  // 1. Static tab_label
  if (ux.tab_label) {
    return ux.tab_label;
  }

  // 2. Dynamic tab_label_field (item-level config)
  if (ux.tab_label_field && typeof data === "object" && data !== null) {
    const dataObj = data as Record<string, unknown>;
    const fieldValue = dataObj[ux.tab_label_field];
    if (fieldValue !== undefined && fieldValue !== null) {
      return String(fieldValue);
    }
  }

  // 3. tab_key from parent TabsContext (array-level config)
  if (tabKey && typeof data === "object" && data !== null) {
    const dataObj = data as Record<string, unknown>;
    const fieldValue = dataObj[tabKey];
    if (fieldValue !== undefined && fieldValue !== null) {
      return String(fieldValue);
    }
  }

  // 4. Fallback to path-based label
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
  disabled = false,
  readonly = false,
}: TabLayoutProps) {
  const tabsContext = useTabsContext();
  const tabId = path.join(".");

  // Resolve label (tabKey from context provides array-level tab_key)
  const label = resolveTabLabel(ux, data, path[path.length - 1] || "Tab", tabsContext.tabKey);

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
      disabled={disabled}
      readonly={readonly}
    />
  );
}
