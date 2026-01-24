/**
 * Layout registry for schema-based rendering.
 *
 * Layouts are registered by their render_as value and retrieved via getLayout().
 * All layouts receive LayoutProps with children that have data-* attributes.
 */

// =============================================================================
// Re-exports from registry
// =============================================================================

export { registerLayout, getLayout } from "./registry";

// =============================================================================
// Re-exports from types
// =============================================================================

export type { LayoutProps, LayoutComponent } from "./types";

// =============================================================================
// Re-exports from utils
// =============================================================================

export {
  filterByAttr,
  filterByAttrExists,
  filterExcludingRenderAs,
  childrenToArray,
  getAttr,
  getIndexFromPath,
} from "./utils";

// =============================================================================
// Layout Imports (triggers registration)
// =============================================================================

// Import layouts to register them
// Order doesn't matter since there are no Field dependencies
import "./DefaultLayout";
import "./CardStackLayout";
import "./SectionListLayout";
import "./CardLayout";
import "./SectionLayout";
import "./TabsLayout";
