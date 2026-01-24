/**
 * ContentPanelSchemaRenderer - Special renderer for content-panel.
 *
 * This is a special case handled BEFORE type routing in SchemaRenderer.
 * It renders a panel with:
 * - Header: from ux.display_label
 * - Body: delegated to SchemaRenderer (with display_label stripped)
 *
 * Note: Media generation now uses render_as: "media" explicitly,
 * which routes to MediaPanel. This component no longer checks for
 * MediaGenerationContext.
 *
 * The -panel suffix convention indicates special SchemaRenderer-level handling.
 */

import type { SchemaProperty, UxConfig } from "./types";
import { cn } from "@/lib/utils";

// Import SchemaRenderer for body delegation
// This creates a controlled recursion - we strip render_as to prevent infinite loop
import { SchemaRenderer } from "./SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface ContentPanelSchemaRendererProps {
  /** The data to render */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
}

// =============================================================================
// Component
// =============================================================================

export function ContentPanelSchemaRenderer({
  data,
  schema,
  path,
  ux,
}: ContentPanelSchemaRendererProps) {
  // Standard content-panel rendering
  // Header from display_label
  const header = ux.display_label;

  // Create modified UX for body:
  // - Strip display_label (we rendered it as header)
  // - Strip render_as (prevent infinite loop, let type routing happen)
  const bodyUx: UxConfig = {
    ...ux,
    display_label: undefined,
    render_as: undefined,
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
      {/* Header */}
      {header && (
        <div className="px-4 py-2.5 bg-muted/50 border-b">
          <span className="font-medium text-sm text-foreground">{header}</span>
        </div>
      )}

      {/* Body - delegated to SchemaRenderer */}
      <div className={cn("p-4", !header && "pt-4")}>
        <SchemaRenderer data={data} schema={schema} path={path} ux={bodyUx} />
      </div>
    </div>
  );
}
