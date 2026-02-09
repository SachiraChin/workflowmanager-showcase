/**
 * Hook for tracking measured heights of ReactFlow nodes.
 *
 * This enables dynamic layout calculation based on actual rendered heights
 * instead of hardcoded constants. Each node reports its height via a callback,
 * and the parent component can use these heights for positioning.
 *
 * IMPORTANT: Height updates are batched to avoid flicker. When a module
 * expands/collapses, multiple height updates can fire in quick succession
 * (estimated height, then measured height from ResizeObserver). We batch
 * these updates and only trigger a single re-render after they stabilize.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// =============================================================================
// Types
// =============================================================================

export type NodeHeightsContextValue = {
  /** Get the measured height of a node, or undefined if not yet measured */
  getHeight: (nodeId: string) => number | undefined;
  /** Report a node's measured height */
  reportHeight: (nodeId: string, height: number) => void;
  /** 
   * Set an estimated height immediately (before render/measurement).
   * Use this when expand state changes to pre-size the container.
   */
  setEstimatedHeight: (nodeId: string, height: number) => void;
  /** Get all measured heights (for dependency tracking in useMemo) */
  heights: Record<string, number>;
};

// =============================================================================
// Context
// =============================================================================

const NodeHeightsContext = createContext<NodeHeightsContextValue | null>(null);

export const NodeHeightsProvider = NodeHeightsContext.Provider;

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook to access the node heights context.
 * Must be used within a NodeHeightsProvider.
 */
export function useNodeHeightsContext(): NodeHeightsContextValue {
  const context = useContext(NodeHeightsContext);
  if (!context) {
    throw new Error(
      "useNodeHeightsContext must be used within a NodeHeightsProvider"
    );
  }
  return context;
}

/** Batch delay in ms - wait for height updates to stabilize before re-render */
const HEIGHT_BATCH_DELAY = 50;

/**
 * Hook to create and manage node heights state.
 * Use this in the parent component that needs to track heights.
 *
 * Height updates are batched: when multiple updates occur in quick succession
 * (e.g., estimated height followed by measured height), we wait for them to
 * stabilize before triggering a re-render. This prevents flicker.
 */
export function useNodeHeights(): NodeHeightsContextValue {
  const [heights, setHeights] = useState<Record<string, number>>({});
  
  // Use ref to track pending updates without triggering re-renders
  const heightsRef = useRef(heights);
  const pendingUpdatesRef = useRef<Record<string, number>>({});
  const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref in sync with state
  heightsRef.current = heights;

  // Flush pending updates to state (triggers re-render)
  const flushUpdates = useCallback(() => {
    const pending = pendingUpdatesRef.current;
    if (Object.keys(pending).length === 0) return;

    setHeights((prev) => {
      // Check if any values actually changed
      let hasChanges = false;
      for (const [nodeId, height] of Object.entries(pending)) {
        if (prev[nodeId] !== height) {
          hasChanges = true;
          break;
        }
      }
      if (!hasChanges) return prev;

      return { ...prev, ...pending };
    });

    pendingUpdatesRef.current = {};
  }, []);

  // Schedule a batched update
  const scheduleUpdate = useCallback(
    (nodeId: string, height: number) => {
      // Skip if height hasn't changed from current state
      if (heightsRef.current[nodeId] === height) return;

      // Add to pending updates
      pendingUpdatesRef.current[nodeId] = height;

      // Clear existing timeout and schedule new one
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
      batchTimeoutRef.current = setTimeout(flushUpdates, HEIGHT_BATCH_DELAY);
    },
    [flushUpdates]
  );

  const getHeight = useCallback((nodeId: string): number | undefined => {
    // Check pending updates first, then current state
    return pendingUpdatesRef.current[nodeId] ?? heightsRef.current[nodeId];
  }, []);

  const reportHeight = useCallback(
    (nodeId: string, height: number) => {
      scheduleUpdate(nodeId, height);
    },
    [scheduleUpdate]
  );

  // Set estimated height SYNCHRONOUSLY - this is critical for preventing jump
  // When expand/collapse happens, we need the step container to resize
  // in the same render cycle, before the module content changes
  const setEstimatedHeight = useCallback(
    (nodeId: string, height: number) => {
      // Clear any pending batched update for this node
      delete pendingUpdatesRef.current[nodeId];
      
      // Update state synchronously
      setHeights((prev) => {
        if (prev[nodeId] === height) return prev;
        return { ...prev, [nodeId]: height };
      });
    },
    []
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, []);

  return useMemo(
    () => ({ getHeight, reportHeight, setEstimatedHeight, heights }),
    [getHeight, reportHeight, setEstimatedHeight, heights]
  );
}

/**
 * Hook for a node to report its own height.
 * Uses ResizeObserver to track height changes.
 *
 * @param nodeId - The ReactFlow node ID
 * @param ref - Ref to the DOM element to measure
 */
export function useReportNodeHeight(
  nodeId: string,
  ref: React.RefObject<HTMLElement | null>
): void {
  const { reportHeight } = useNodeHeightsContext();

  // Set up observer on mount, clean up on unmount
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0) {
          reportHeight(nodeId, height);
        }
      }
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [nodeId, ref, reportHeight]);
}
