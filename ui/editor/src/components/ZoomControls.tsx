/**
 * Zoom Controls Component for ReactFlow.
 *
 * Provides zoom in/out buttons, percentage display, and fit-to-view functionality.
 */

import { useEffect, useState } from "react";
import { Panel, useReactFlow } from "@xyflow/react";

export function ZoomControls() {
  const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
  const [zoom, setZoom] = useState(1);

  // Update zoom display when zoom changes
  useEffect(() => {
    const updateZoom = () => setZoom(getZoom());
    updateZoom();
    // Poll for zoom changes (ReactFlow doesn't have a zoom change event)
    const interval = setInterval(updateZoom, 100);
    return () => clearInterval(interval);
  }, [getZoom]);

  const zoomPercentage = Math.round(zoom * 100);

  return (
    <Panel position="bottom-right">
      <div className="flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={() => zoomOut()}
          title="Zoom out"
        >
          <span className="text-lg font-medium">−</span>
        </button>
        <span className="min-w-[4rem] text-center text-xs font-medium tabular-nums">
          {zoomPercentage}%
        </span>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={() => zoomIn()}
          title="Zoom in"
        >
          <span className="text-lg font-medium">+</span>
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          className="flex h-8 items-center justify-center rounded-md px-2 text-xs hover:bg-muted transition-colors"
          onClick={() => fitView({ padding: 0.3 })}
          title="Fit to view"
        >
          Fit
        </button>
      </div>
    </Panel>
  );
}
