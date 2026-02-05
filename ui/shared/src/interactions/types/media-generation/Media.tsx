/**
 * Media - Card chrome wrapper for media generation.
 *
 * Renders card chrome (border, optional header, padding) and children.
 * Used as render_as="media" in compound expressions like "tab.media[...]".
 *
 * Consistent with TabLayout pattern - accepts children from bracket syntax.
 */

import type { ReactNode } from "react";
import type { SchemaProperty, UxConfig } from "../../../types/schema";

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

export function Media({ path: _path, ux: _ux, children, disabled: _disabled, readonly: _readonly }: MediaProps) {
  void _path; // Props accepted for API consistency
  void _ux;
  void _disabled;
  void _readonly; // Children handle their own disabled/readonly state

  return (
    <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
      {/* Body - no header since tabs already show the context */}
      <div className="p-4 space-y-4">{children}</div>
    </div>
  );
}
