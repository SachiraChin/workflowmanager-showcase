/**
 * Media - Card chrome wrapper for media generation.
 *
 * Renders card chrome (border, optional header, padding) and children.
 * Used as render_as="media" in compound expressions like "tab.media[...]".
 *
 * Consistent with TabLayout pattern - accepts children from bracket syntax.
 */

import type { ReactNode } from "react";
import type { SchemaProperty, UxConfig } from "../../schema/types";

// =============================================================================
// Types
// =============================================================================

interface MediaProps {
  /** Schema for this node */
  schema: SchemaProperty;
  /** Data for this node */
  data: unknown;
  /** Path to this data in the tree */
  path: string[];
  /** UX configuration */
  ux: UxConfig;
  /** Children from bracket syntax (e.g., InputSchemaComposer + ImageGeneration) */
  children?: ReactNode;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function Media({ path, ux, children, disabled: _disabled, readonly: _readonly }: MediaProps) {
  void _disabled; // Props accepted for API consistency
  void _readonly; // Children handle their own disabled/readonly state
  // Header from display_label or path
  const header = ux.display_label || path[path.length - 1];

  return (
    <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
      {/* Header */}
      {header && (
        <div className="px-4 py-2.5 bg-muted/50 border-b">
          <span className="font-medium text-sm text-foreground capitalize">
            {String(header).replace(/_/g, " ")}
          </span>
        </div>
      )}

      {/* Body */}
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}
