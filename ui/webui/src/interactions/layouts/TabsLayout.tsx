/**
 * TabsLayout - Container that renders children as tabs.
 *
 * Provides TabsContext for child TabLayout components to register with.
 * Renders tab header bar and content area.
 *
 * Content is rendered via SchemaRenderer with display=passthrough and
 * render_as=undefined, allowing normal rendering to continue until
 * TabLayout components are encountered.
 */

import React, { useState, useCallback, useMemo, type ReactNode } from "react";
import { cn } from "@/core/utils";
import { registerLayout } from "./registry";
import type { LayoutProps } from "./types";
import { TabsContext, type TabInfo } from "../schema/tabs/TabsContext";
import { SchemaRenderer } from "../SchemaRenderer";

// =============================================================================
// Component
// =============================================================================

export const TabsLayout: React.FC<LayoutProps & { children?: ReactNode }> = ({
  schema,
  path,
  data,
  ux,
  children,
}) => {
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const orderCounter = React.useRef(0);

  // Register a new tab
  const register = useCallback((tab: Omit<TabInfo, "order">) => {
    setTabs((prev) => {
      // Don't add if already registered
      if (prev.some((t) => t.id === tab.id)) {
        return prev;
      }
      const newTab: TabInfo = {
        ...tab,
        order: orderCounter.current++,
      };
      return [...prev, newTab].sort((a, b) => a.order - b.order);
    });
  }, []);

  // Unregister a tab
  const unregister = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Check if a tab is active
  const isActive = useCallback(
    (id: string) => {
      // If no active tab set, first tab is active
      if (activeTabId === null) {
        return tabs.length > 0 && tabs[0].id === id;
      }
      return id === activeTabId;
    },
    [activeTabId, tabs]
  );

  // Context value
  const contextValue = useMemo(
    () => ({
      register,
      unregister,
      isActive,
      setActive: setActiveTabId,
      tabs,
      activeTabId,
    }),
    [register, unregister, isActive, tabs, activeTabId]
  );

  // Determine effective active tab for header styling
  const effectiveActiveId = activeTabId ?? tabs[0]?.id ?? null;

  return (
    <TabsContext.Provider value={contextValue}>
      <div className="w-full">
        {/* Tab Headers */}
        {tabs.length > 0 && (
          <div className="flex border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "px-4 py-2.5 text-sm font-medium transition-colors",
                  "border-b-2 -mb-px",
                  "hover:text-foreground hover:bg-muted/50",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  tab.id === effectiveActiveId
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {/* Tab Content */}
        <div className="pt-4">
          {/* If children passed directly, render them */}
          {children ? (
            children
          ) : (
            /* Otherwise, render via SchemaRenderer with passthrough */
            <SchemaRenderer
              schema={schema}
              data={data}
              path={path}
              ux={{ ...ux, display: "passthrough", render_as: undefined }}
            />
          )}
        </div>
      </div>
    </TabsContext.Provider>
  );
};

registerLayout("tabs", TabsLayout);
