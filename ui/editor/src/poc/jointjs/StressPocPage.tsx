import { useEffect, useMemo, useRef, useState } from "react";
import { dia, shapes } from "@joint/core";

type StressSummary = {
  totalNodes: number;
  totalEdges: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function JointJsStressPocPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const debugRef = useRef<HTMLSpanElement>(null);
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
    const container = containerRef.current;

    const graph = new dia.Graph({}, { cellNamespace: shapes });
    const paper = new dia.Paper({
      model: graph,
      cellViewNamespace: shapes,
      el: container,
      width: container.clientWidth || 1200,
      height: container.clientHeight || 700,
      gridSize: 20,
      drawGrid: { name: "mesh", args: { color: "#d4d4d8", thickness: 1 } },
      background: { color: "transparent" },
      interactive: true,
      defaultConnectionPoint: { name: "boundary" },
    });

    if (debugRef.current) {
      debugRef.current.textContent =
        `paper ${container.clientWidth}x${container.clientHeight} | cells 0`;
    }

    let previousGroup: shapes.standard.Rectangle | null = null;

    for (let level = 0; level < levels; level += 1) {
      const group: shapes.standard.Rectangle = new shapes.standard.Rectangle({
        position: previousGroup ? { x: 52, y: 52 } : { x: 40, y: 40 },
        size: {
          width: Math.max(780, 2100 - level * 220),
          height: Math.max(620, 1320 - level * 130),
        },
        attrs: {
          body: {
            fill: level % 2 === 0 ? "#f8fafc" : "#eef2f7",
            stroke: "#cbd5e1",
            strokeWidth: 1,
            rx: 10,
            ry: 10,
          },
          label: {
            text: `Group ${level + 1}`,
            fill: "#0f172a",
            fontSize: 13,
            textAnchor: "start",
            textVerticalAnchor: "top",
            refX: 12,
            refY: 10,
          },
        },
      });
      group.addTo(graph);
      if (previousGroup) {
        previousGroup.embed(group);
      }
      group.toBack();

      const nodeIds: string[] = [];
      const columns = 6;
      const spacingX = 250;
      const spacingY = 124;

      for (let i = 0; i < nodesPerLevel; i += 1) {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const node = new shapes.standard.Rectangle({
          id: `joint-l${level + 1}-n${i + 1}`,
          position: { x: 32 + col * spacingX, y: 54 + row * spacingY },
          size: { width: 146, height: 42 },
          attrs: {
            body: {
              fill: "#ffffff",
              stroke: "#cbd5e1",
              strokeWidth: 1,
              rx: 8,
              ry: 8,
            },
            label: {
              text: `L${level + 1}-${i + 1}`,
              fill: "#0f172a",
              fontSize: 12,
            },
          },
        });

        node.addTo(graph);
        group.embed(node);
        nodeIds.push(node.id.toString());

        if (i > 0) {
          new shapes.standard.Link({
            source: { id: nodeIds[i - 1] },
            target: { id: nodeIds[i] },
            attrs: {
              line: {
                stroke: "#334155",
                strokeWidth: 1,
                targetMarker: {
                  type: "path",
                  d: "M 8 -4 0 0 8 4 Z",
                },
              },
            },
          }).addTo(graph);
        }
      }

      if (level > 0) {
        new shapes.standard.Link({
          source: { id: `joint-l${level}-n${nodesPerLevel}` },
          target: { id: `joint-l${level + 1}-n1` },
          attrs: {
            line: {
              stroke: "#0f172a",
              strokeDasharray: "4 2",
              strokeWidth: 1.2,
              targetMarker: {
                type: "path",
                d: "M 8 -4 0 0 8 4 Z",
              },
            },
          },
        }).addTo(graph);
      }

      previousGroup = group;
    }

    paper.scaleContentToFit({
      padding: 36,
      preserveAspectRatio: true,
      minScaleX: 0.3,
      minScaleY: 0.3,
      maxScaleX: 1,
      maxScaleY: 1,
    });

    const handleResize = () => {
      paper.setDimensions(container.clientWidth || 1200, container.clientHeight || 700);
      paper.scaleContentToFit({
        padding: 36,
        preserveAspectRatio: true,
        minScaleX: 0.3,
        minScaleY: 0.3,
        maxScaleX: 1,
        maxScaleY: 1,
      });
      if (debugRef.current) {
        debugRef.current.textContent =
          `paper ${container.clientWidth}x${container.clientHeight} | cells ${graph.getCells().length}`;
      }
    };

    if (debugRef.current) {
      debugRef.current.textContent =
        `paper ${container.clientWidth}x${container.clientHeight} | cells ${graph.getCells().length}`;
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      paper.remove();
      graph.clear();
    };
  }, [levels, nodesPerLevel]);

  return (
    <div className="h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">JointJS Stress PoC</h1>
          <p className="text-xs text-muted-foreground">
            Deep nested groups with synthetic scale load.
          </p>
        </div>
      </header>
      <section className="border-b px-3 py-1 text-xs text-muted-foreground">
        debug: <span ref={debugRef}>init</span>
      </section>
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
        <div className="joint-canvas h-full w-full rounded-md border" ref={containerRef} />
      </div>
    </div>
  );
}
