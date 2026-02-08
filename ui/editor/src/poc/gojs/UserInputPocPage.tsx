import { useEffect, useRef, useState } from "react";
import * as go from "gojs";
import { userSelectNodeLabel } from "@/modules/user-select/presentation";
import { UserSelectModuleEditor } from "@/modules/user-select/UserSelectModuleEditor";
import { validateUserSelectModule } from "@/modules/user-select/types";
import { UserSelectRuntimePanel } from "@/runtime/UserSelectRuntimePanel";
import { useVirtualUserSelectRuntime } from "@/runtime/useVirtualUserSelectRuntime";

type NodeModel = {
  key: string;
  text: string;
  loc: string;
  isGroup?: boolean;
  group?: string;
  moduleName?: string;
  selected?: boolean;
};

type LinkModel = {
  from: string;
  to: string;
  text?: string;
};

export function GoJsUserInputPocPage() {
  const runtime = useVirtualUserSelectRuntime();
  const modules = runtime.modules;
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedModuleName, setSelectedModuleName] = useState<string>(modules[0]?.name);
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedModule = modules.find((module) => module.name === selectedModuleName);
  const selectedIssues = selectedModule ? validateUserSelectModule(selectedModule) : [];

  useEffect(() => {
    if (!containerRef.current) return;

    const $ = go.GraphObject.make;

    const diagram = $(go.Diagram, containerRef.current, {
      "undoManager.isEnabled": true,
      "toolManager.mouseWheelBehavior": go.ToolManager.WheelZoom,
      initialContentAlignment: go.Spot.TopLeft,
      allowMove: false,
      allowCopy: false,
      allowDelete: false,
      model: $(go.GraphLinksModel),
    });

    diagram.groupTemplate = $(
      go.Group,
      "Auto",
      { background: "transparent" },
      $(go.Shape, "RoundedRectangle", {
        fill: "#eef2f7",
        stroke: "#cbd5e1",
        strokeWidth: 1,
      }),
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
        click: (_: go.InputEvent, obj: go.GraphObject) => {
          const moduleName = obj.part?.data?.moduleName as string | undefined;
          if (moduleName) setSelectedModuleName(moduleName);
        },
      },
      new go.Binding("location", "loc", go.Point.parse).makeTwoWay(go.Point.stringify),
      $(
        go.Shape,
        "RoundedRectangle",
        {
          fill: "#ffffff",
          stroke: "#cbd5e1",
          strokeWidth: 1,
        },
        new go.Binding("stroke", "selected", (selected: boolean) =>
          selected ? "#6366f1" : "#cbd5e1"
        ),
        new go.Binding("strokeWidth", "selected", (selected: boolean) =>
          selected ? 2 : 1
        )
      ),
      $(
        go.TextBlock,
        {
          margin: 10,
          width: 400,
          isMultiline: true,
          wrap: go.Wrap.Fit,
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
      $(go.Shape, { toArrow: "Standard", stroke: null, fill: "#334155" }),
      $(
        go.Panel,
        "Auto",
        $(go.Shape, "RoundedRectangle", { fill: "#ffffff", stroke: "#cbd5e1" }),
        $(
          go.TextBlock,
          { margin: 4, stroke: "#0f172a", font: "11px ui-sans-serif, system-ui" },
          new go.Binding("text", "text")
        )
      )
    );

    const nodes: NodeModel[] = [
      {
        key: "step",
        isGroup: true,
        text: "user_input | Step 1",
        loc: "28 28",
      },
      ...modules.map((module, index) => ({
        key: module.name,
        moduleName: module.name,
        group: "step",
        loc: `${58 + index * 460} 82`,
        text: `${userSelectNodeLabel(module)}\nstate: ${runtime.runStateByModule[module.name] || "idle"}`,
        selected: module.name === selectedModuleName,
      })),
    ];

    const links: LinkModel[] = [];
    for (let i = 1; i < modules.length; i += 1) {
      links.push({
        from: modules[i - 1].name,
        to: modules[i].name,
        text: "step flow",
      });
    }

    diagram.model = new go.GraphLinksModel(nodes, links);
    diagram.commandHandler.zoomToFit();

    return () => {
      diagram.div = null;
    };
  }, [modules, selectedModuleName, runtime.runStateByModule]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">GoJS User Input PoC</h1>
          <p className="text-xs text-muted-foreground">
            `user.select` nodes show module summaries and shared runtime panel.
          </p>
        </div>
        <button
          className="rounded border bg-card px-3 py-1.5 text-xs"
          onClick={() => setPreviewOpen(true)}
          type="button"
        >
          Open Runtime Preview
        </button>
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-[1fr_420px] grid-rows-[minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden border-r p-2">
          <div className="gojs-canvas h-full w-full rounded-md border" ref={containerRef} />
        </div>
        <aside className="min-h-0 overflow-auto p-3">
          {selectedModule ? (
            <>
              <h2 className="mb-3 text-sm font-semibold">Module Parameters</h2>
              <div className="rounded border bg-card p-3">
                <UserSelectModuleEditor
                  onChange={(nextModule) => {
                    runtime.updateModule(selectedModule.name, nextModule);
                    if (nextModule.name !== selectedModule.name) {
                      setSelectedModuleName(nextModule.name);
                    }
                  }}
                  value={selectedModule}
                />
                <section className="mt-3 rounded border bg-background p-2">
                  <h3 className="text-xs font-semibold">Validation</h3>
                  {selectedIssues.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-destructive">
                      {selectedIssues.map((issue) => (
                        <li key={issue}>- {issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-emerald-600">No validation issues.</p>
                  )}
                </section>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a module node to edit.</p>
          )}
        </aside>
      </div>

      {previewOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 p-6">
          <div className="mx-auto flex h-full max-w-4xl min-h-0 flex-col rounded-lg border bg-background">
            <div className="flex items-center justify-between border-b p-3">
              <h2 className="text-sm font-semibold">GoJS Runtime Preview</h2>
              <button
                className="rounded border bg-card px-2 py-1 text-xs"
                onClick={() => setPreviewOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <UserSelectRuntimePanel
                controller={runtime}
                modules={modules}
                selectedModuleName={selectedModuleName}
                onSelectModule={setSelectedModuleName}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
