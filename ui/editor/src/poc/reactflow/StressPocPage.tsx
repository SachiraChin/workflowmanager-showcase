import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type StressGraph = {
  nodes: Node[];
  edges: Edge[];
};

function buildStressGraph(levels: number, nodesPerLevel: number): StressGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  let previousGroupId: string | undefined;

  for (let level = 0; level < levels; level += 1) {
    const groupId = `g-${level}`;
    const width = 2200 - level * 240;
    const height = 1400 - level * 140;

    nodes.push({
      id: groupId,
      type: "group",
      data: { label: `Group ${level + 1}` },
      position: previousGroupId ? { x: 40, y: 40 } : { x: 40, y: 40 },
      style: {
        width,
        height,
        border: "1px solid var(--border)",
        background: level % 2 === 0 ? "var(--card)" : "var(--muted)",
      },
      parentId: previousGroupId,
      draggable: false,
      selectable: false,
    });

    const columns = 6;
    const spacingX = 260;
    const spacingY = 140;

    for (let i = 0; i < nodesPerLevel; i += 1) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const id = `n-${level}-${i}`;

      nodes.push({
        id,
        data: { label: `L${level + 1}-${i + 1}` },
        position: { x: 30 + col * spacingX, y: 60 + row * spacingY },
        parentId: groupId,
        extent: "parent",
      });

      if (i > 0) {
        edges.push({
          id: `e-${level}-${i - 1}-${i}`,
          source: `n-${level}-${i - 1}`,
          target: id,
          animated: false,
        });
      }
    }

    if (level > 0) {
      edges.push({
        id: `e-cross-${level}`,
        source: `n-${level - 1}-${nodesPerLevel - 1}`,
        target: `n-${level}-0`,
        animated: true,
      });
    }

    previousGroupId = groupId;
  }

  return { nodes, edges };
}

export function ReactFlowStressPocPage() {
  const [levels, setLevels] = useState(6);
  const [nodesPerLevel, setNodesPerLevel] = useState(30);

  const graph = useMemo(
    () => buildStressGraph(levels, nodesPerLevel),
    [levels, nodesPerLevel]
  );

  return (
    <div className="h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">React Flow Stress PoC</h1>
          <p className="text-xs text-muted-foreground">
            Deep nested groups with synthetic scale load.
          </p>
        </div>
        <a className="text-sm underline" href="/">
          Back
        </a>
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
            onChange={(e) => setLevels(Number(e.target.value))}
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
            onChange={(e) => setNodesPerLevel(Number(e.target.value))}
          />
        </label>
        <span className="text-muted-foreground">
          Total nodes: {graph.nodes.length}
        </span>
      </section>
      <div className="h-[calc(100vh-106px)]">
        <ReactFlow fitView nodes={graph.nodes} edges={graph.edges}>
          <MiniMap />
          <Controls />
          <Background gap={24} />
        </ReactFlow>
      </div>
    </div>
  );
}
