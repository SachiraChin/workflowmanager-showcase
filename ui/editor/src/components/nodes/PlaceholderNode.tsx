/**
 * Placeholder node for module types that don't have dedicated editors yet.
 *
 * Displays the module's basic info (module_id, name) in a grayed-out style
 * to indicate it's not editable in the current version of the editor.
 */

import { memo, useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ModuleConfig } from "@wfm/shared";
import { Button } from "@wfm/shared";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";

// =============================================================================
// Types
// =============================================================================

export type PlaceholderNodeData = {
  module: ModuleConfig;
  /** Callback to view state up to this module (runs module, opens state panel) */
  onViewState?: () => void;
};

// =============================================================================
// Constants
// =============================================================================

/** Height of placeholder node */
export const PLACEHOLDER_HEIGHT = 80;
/** Width of placeholder node (matches other module nodes) */
export const PLACEHOLDER_WIDTH = 340;

// =============================================================================
// Component
// =============================================================================

function PlaceholderNodeComponent({ id, data }: NodeProps) {
  const { module, onViewState } = data as unknown as PlaceholderNodeData;
  const containerRef = useRef<HTMLDivElement>(null);

  // Report height changes to parent for layout calculations
  useReportNodeHeight(id, containerRef);

  return (
    <div ref={containerRef} className="relative">
      <Handle type="target" position={Position.Top} id="in" className="!bg-muted-foreground" />

      <div className="w-[340px] rounded-lg border border-dashed border-muted-foreground/50 bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {module.module_id}
            </p>
            <h3 className="text-sm font-medium text-muted-foreground truncate">
              {module.name || "Unnamed Module"}
            </h3>
          </div>
          {onViewState && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onViewState();
              }}
            >
              State
            </Button>
          )}
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
