/**
 * Placeholder node for module types that don't have dedicated editors yet.
 *
 * Displays the module's basic info (module_id, name) in a grayed-out style
 * to indicate it's not editable in the current version of the editor.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ModuleConfig } from "@wfm/shared";

// =============================================================================
// Types
// =============================================================================

export type PlaceholderNodeData = {
  module: ModuleConfig;
};

// =============================================================================
// Constants
// =============================================================================

/** Height of placeholder node */
export const PLACEHOLDER_HEIGHT = 80;
/** Width of placeholder node */
export const PLACEHOLDER_WIDTH = 280;

// =============================================================================
// Component
// =============================================================================

function PlaceholderNodeComponent({ data }: NodeProps) {
  const { module } = data as unknown as PlaceholderNodeData;

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} id="in" className="!bg-muted-foreground" />

      <div className="w-[280px] rounded-lg border border-dashed border-muted-foreground/50 bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {module.module_id}
            </p>
            <h3 className="text-sm font-medium text-muted-foreground truncate">
              {module.name || "Unnamed Module"}
            </h3>
          </div>
        </div>

        <p className="mt-2 text-xs text-muted-foreground/60 italic">
          Editor not available for this module type
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} id="out" className="!bg-muted-foreground" />
    </div>
  );
}

export const PlaceholderNode = memo(PlaceholderNodeComponent);
