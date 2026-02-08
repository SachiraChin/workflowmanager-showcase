import { useEffect, useMemo, useRef, useState } from "react";
import * as go from "gojs";

type StressSummary = {
  totalNodes: number;
  totalEdges: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type GoNode = {
  key: string;
  text: string;
  loc: string;
  isGroup?: boolean;
  group?: string;
  fill?: string;
};

type GoLink = {
  from: string;
  to: string;
};

function buildStressModel(levels: number, nodesPerLevel: number): {
  nodes: GoNode[];
  links: GoLink[];
} {
  const nodes: GoNode[] = [];
  const links: GoLink[] = [];

  let previousGroupKey: string | undefined;

  for (let level = 0; level < levels; level += 1) {
    const groupKey = `g-${level + 1}`;
    nodes.push({
      key: groupKey,
      text: `Group ${level + 1}`,
      loc: `${40 + level * 38} ${40 + level * 38}`,
      isGroup: true,
      group: previousGroupKey,
      fill: level % 2 === 0 ? "#eef2f7" : "#e2e8f0",
    });

    for (let i = 0; i < nodesPerLevel; i += 1) {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const key = `n-${level + 1}-${i + 1}`;

      nodes.push({
        key,
        text: `L${level + 1}-${i + 1}`,
        loc: `${70 + col * 180} ${90 + row * 92}`,
        group: groupKey,
      });

      if (i > 0) {
        links.push({
          from: `n-${level + 1}-${i}`,
          to: key,
        });
      }
    }

    if (level > 0) {
      links.push({
        from: `n-${level}-${nodesPerLevel}`,
        to: `n-${level + 1}-1`,
      });
    }

    previousGroupKey = groupKey;
  }

  return { nodes, links };
}

export function GoJsStressPocPage() {
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

    const $ = go.GraphObject.make;

    const diagram = $(go.Diagram, containerRef.current, {
      "undoManager.isEnabled": true,
      "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
      initialContentAlignment: go.Spot.TopLeft,
      allowMove: true,
      allowCopy: false,
      allowDelete: false,
      model: $(go.GraphLinksModel),
    });

    diagram.groupTemplate = $(
      go.Group,
      "Auto",
      {
        computesBoundsAfterDrag: true,
        handlesDragDropForMembers: true,
        background: "transparent",
      },
      new go.Binding("group", "group"),
      $(
        go.Shape,
        "RoundedRectangle",
        {
          stroke: "#94a3b8",
          strokeWidth: 1,
          fill: "#e2e8f0",
        },
        new go.Binding("fill", "fill")
      ),
      $(
        go.Panel,
        "Vertical",
        { margin: 8, alignment: go.Spot.TopLeft },
        $(
          go.TextBlock,
          {
            font: "600 12px ui-sans-serif, system-ui, -apple-system",
            stroke: "#0f172a",
            margin: new go.Margin(0, 0, 6, 2),
          },
          new go.Binding("text", "text")
        ),
        $(go.Placeholder, { padding: 16 })
      )
    );

    diagram.nodeTemplate = $(
      go.Node,
      "Auto",
      {
        locationSpot: go.Spot.TopLeft,
      },
      new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
      $(go.Shape, "RoundedRectangle", {
        fill: "#ffffff",
        stroke: "#cbd5e1",
        strokeWidth: 1,
      }),
      $(
        go.TextBlock,
        {
          margin: 8,
          font: "12px ui-sans-serif, system-ui, -apple-system",
          stroke: "#0f172a",
        },
        new go.Binding("text", "text")
      )
    );

    diagram.linkTemplate = $(
      go.Link,
      { routing: go.Routing.AvoidsNodes, corner: 4 },
      $(go.Shape, { stroke: "#334155", strokeWidth: 1 }),
      $(go.Shape, { toArrow: "Standard", stroke: null, fill: "#334155" })
    );

    const model = buildStressModel(levels, nodesPerLevel);
    diagram.model = new go.GraphLinksModel(model.nodes, model.links);

    diagram.commandHandler.zoomToFit();

    return () => {
      diagram.div = null;
    };
  }, [levels, nodesPerLevel]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">GoJS Stress PoC</h1>
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
            onChange={(e) => setNodesPerLevel(clamp(Number(e.target.value), 10, 60))}
          />
        </label>
        <span className="text-muted-foreground">
          Total nodes: {summary.totalNodes} | Total edges: {summary.totalEdges}
        </span>
      </section>
      <div className="flex-1 min-h-0 p-2">
        <div className="gojs-canvas h-full w-full rounded-md border" ref={containerRef} />
      </div>
    </div>
  );
}
