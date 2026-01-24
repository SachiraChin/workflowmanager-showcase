/**
 * Layout registry for schema-based rendering.
 *
 * Separated from index.ts to avoid circular dependencies.
 * Layouts import registerLayout from here, index.ts re-exports.
 */

import type { LayoutComponent } from "./types";

// =============================================================================
// Registry
// =============================================================================

const layoutRegistry: Record<string, LayoutComponent> = {};

/**
 * Register a layout component for a render_as value.
 *
 * @example
 * registerLayout("card", CardLayout);
 * registerLayout("card-stack", CardStackLayout);
 */
export function registerLayout(key: string, component: LayoutComponent): void {
  layoutRegistry[key] = component;
}

/**
 * Get a layout component for a render_as value.
 * Returns DefaultLayout if not found.
 *
 * @example
 * const Layout = getLayout(schema.render_as);
 * return <Layout schema={schema} path={path} data={data}>{children}</Layout>;
 */
export function getLayout(renderAs: string | undefined): LayoutComponent {
  if (renderAs && layoutRegistry[renderAs]) {
    return layoutRegistry[renderAs];
  }
  return layoutRegistry["default"] ?? DefaultLayoutFallback;
}

/**
 * Fallback layout if "default" is not registered.
 * Simple wrapper that renders children.
 */
const DefaultLayoutFallback: LayoutComponent = ({ children }) => {
  return <div className="space-y-2">{children}</div>;
};
