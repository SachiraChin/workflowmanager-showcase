/**
 * Hook for tracking measured heights of ReactFlow nodes.
 *
 * This enables dynamic layout calculation based on actual rendered heights
 * instead of hardcoded constants. Each node reports its height via a callback,
 * and the parent component can use these heights for positioning.
 *
 * Heights are fully measurement-driven. Nodes report their real DOM height,
 * and parent step containers derive their size from those measurements.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
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

/**
 * Hook to create and manage node heights state.
 * Use this in the parent component that needs to track heights.
 */
export function useNodeHeights(): NodeHeightsContextValue {
  const [heights, setHeights] = useState<Record<string, number>>({});

  const reportHeight = useCallback((nodeId: string, height: number) => {
    if (!Number.isFinite(height) || height <= 0) return;
    setHeights((prev) => {
      if (prev[nodeId] === height) return prev;
      return { ...prev, [nodeId]: height };
    });
  }, []);

  const getHeight = useCallback((nodeId: string): number | undefined => {
    return heights[nodeId];
  }, [heights]);

  return useMemo(
    () => ({ getHeight, reportHeight, heights }),
    [getHeight, reportHeight, heights]
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
  ref: React.RefObject<HTMLElement | null>,
  measurementKey?: unknown
): void {
  const { reportHeight } = useNodeHeightsContext();

  // Measure in layout phase so parent sizing can update before paint.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const height = element.getBoundingClientRect().height;
    if (height > 0) {
      reportHeight(nodeId, height);
    }
  }, [nodeId, ref, reportHeight, measurementKey]);

  // Keep listening for runtime size changes after mount.
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
