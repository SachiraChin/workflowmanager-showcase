import { useEffect, useMemo, useRef, useState } from "react";
import { Graph, type Node } from "@antv/x6";

type StressSummary = {
  totalNodes: number;
  totalEdges: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function X6StressPocPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [levels, setLevels] = useState(6);
  const [nodesPerLevel, setNodesPerLevel] = useState(30);

  const summary = useMemo<StressSummary>(
    () => ({
      totalNodes: levels + levels * nodesPerLevel,
      totalEdges: levels * Math.max(0, nodesPerLevel - 1) + Math.max(0, levels - 1),
    }),
    [levels, nodesPerLevel]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const graph = new Graph({
      container: containerRef.current,
      background: { color: "transparent" },
      grid: { visible: true, size: 24 },
      panning: true,
      mousewheel: { enabled: true, modifiers: ["ctrl", "meta"] },
    });

    let previousGroup: Node | null = null;

    for (let level = 0; level < levels; level += 1) {
      const group: Node = graph.addNode({
        shape: "rect",
        x: previousGroup ? 52 : 40,
        y: previousGroup ? 52 : 40,
        width: Math.max(720, 2100 - level * 220),
        height: Math.max(560, 1320 - level * 130),
        label: `Group ${level + 1}`,
        attrs: {
          body: {
            stroke: "var(--border)",
            fill: level % 2 === 0 ? "var(--card)" : "var(--muted)",
            rx: 10,
            ry: 10,
          },
          label: {
            fill: "var(--foreground)",
            fontSize: 13,
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 12,
            refY: 10,
          },
        },
      });

      if (previousGroup) {
        previousGroup.addChild(group);
      }

      const columns = 6;
      const spacingX = 250;
      const spacingY = 124;

      const nodeIds: string[] = [];

      for (let i = 0; i < nodesPerLevel; i += 1) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const nodeId = `x6-l${level + 1}-n${i + 1}`;
        const node = graph.addNode({
          id: nodeId,
          shape: "rect",
          x: 32 + col * spacingX,
          y: 54 + row * spacingY,
          width: 140,
          height: 42,
          label: `L${level + 1}-${i + 1}`,
          attrs: {
            body: {
              stroke: "var(--border)",
              fill: "var(--background)",
              rx: 8,
              ry: 8,
            },
            label: {
              fill: "var(--foreground)",
              fontSize: 12,
            },
          },
        });

        group.addChild(node);
        nodeIds.push(nodeId);

        if (i > 0) {
          graph.addEdge({
            source: { cell: nodeIds[i - 1] },
            target: { cell: nodeId },
            attrs: {
              line: {
                stroke: "var(--foreground)",
                strokeWidth: 1,
                targetMarker: { name: "classic", size: 6 },
              },
            },
          });
        }
      }

      if (level > 0) {
        graph.addEdge({
          source: { cell: `x6-l${level}-n${nodesPerLevel}` },
          target: { cell: `x6-l${level + 1}-n1` },
          attrs: {
            line: {
              stroke: "var(--foreground)",
              strokeWidth: 1.2,
              strokeDasharray: "4 2",
              targetMarker: { name: "classic", size: 7 },
            },
          },
        });
      }

      previousGroup = group;
    }

    graph.centerContent();

    return () => graph.dispose();
  }, [levels, nodesPerLevel]);

  return (
    <div className="h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">X6 Stress PoC</h1>
          <p className="text-xs text-muted-foreground">
            Deep nested groups with synthetic scale load.
          </p>
        </div>
      </header>
      <section className="flex items-center gap-4 border-b p-3 text-sm">
        <label className="flex items-center gap-2">
          Levels
          <input
            className="w-20 rounded border bg-background px-2 py-1"
            min={2}
            max={8}
            type="number"
            value={levels}
            onChange={(e) => setLevels(clamp(Number(e.target.value), 2, 8))}
          />
        </label>
        <label className="flex items-center gap-2">
          Nodes/Level
          <input
            className="w-24 rounded border bg-background px-2 py-1"
            min={10}
            max={60}
            type="number"
            value={nodesPerLevel}
            onChange={(e) =>
              setNodesPerLevel(clamp(Number(e.target.value), 10, 60))
            }
          />
        </label>
        <span className="text-muted-foreground">
          Total nodes: {summary.totalNodes} | Total edges: {summary.totalEdges}
        </span>
      </section>
      <div className="h-[calc(100vh-106px)] p-2">
        <div className="x6-canvas h-full w-full rounded-md border" ref={containerRef} />
      </div>
    </div>
  );
}
