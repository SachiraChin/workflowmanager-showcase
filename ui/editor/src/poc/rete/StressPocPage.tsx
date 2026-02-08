import { useEffect, useMemo, useRef, useState } from "react";
import {
  addFlowNode,
  connectNodes,
  createReteInstance,
  zoomToNodes,
} from "@/poc/rete/rete-helpers";

type StressSummary = {
  totalNodes: number;
  totalEdges: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ReteStressPocPage() {
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
    let active = true;

    const start = async () => {
      try {
        const rete = await createReteInstance(containerRef.current as HTMLElement);
        if (debugRef.current) {
          debugRef.current.textContent = "rete initialized";
        }
      let previousLevelLast: Awaited<ReturnType<typeof addFlowNode>> | null = null;

      for (let level = 0; level < levels && active; level += 1) {
        const groupNode = await addFlowNode(
          rete.editor,
          rete.area,
          `Group ${level + 1}`,
          60 + level * 160,
          40 + level * 40
        );

        let previousNode: Awaited<ReturnType<typeof addFlowNode>> | null = null;
        for (let i = 0; i < nodesPerLevel && active; i += 1) {
          const col = i % 6;
          const row = Math.floor(i / 6);
          const node = await addFlowNode(
            rete.editor,
            rete.area,
            `L${level + 1}-${i + 1}`,
            60 + level * 160 + col * 200,
            140 + level * 220 + row * 110
          );

          if (!previousNode) {
            await connectNodes(rete.editor, groupNode, node);
          }

          if (previousNode) {
            await connectNodes(rete.editor, previousNode, node);
          }
          previousNode = node;
        }

        if (previousLevelLast && previousNode) {
          await connectNodes(rete.editor, previousLevelLast, previousNode);
        }
        previousLevelLast = previousNode;
        if (debugRef.current) {
          debugRef.current.textContent = `level ${level + 1}/${levels} | nodes ${rete.editor.getNodes().length}`;
        }
      }

      if (active) {
        await zoomToNodes(rete.area, rete.editor);
        if (debugRef.current) {
          debugRef.current.textContent = `ready | nodes ${rete.editor.getNodes().length}`;
        }
      }

      return rete;
      } catch (error) {
        if (debugRef.current) {
          debugRef.current.textContent = `error: ${String(error)}`;
        }
        throw error;
      }
    };

    let instancePromise = start();

    return () => {
      active = false;
      instancePromise.then((instance) => instance.destroy());
    };
  }, [levels, nodesPerLevel]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">Rete Stress PoC</h1>
          <p className="text-xs text-muted-foreground">
            Deep nested-like hierarchy using community presets only.
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
      <section className="border-b px-3 py-1 text-xs text-muted-foreground">
        debug: <span ref={debugRef}>init</span>
      </section>
      <div className="flex-1 min-h-0 p-2">
        <div className="rete-canvas h-full w-full rounded-md border" ref={containerRef} />
      </div>
    </div>
  );
}
