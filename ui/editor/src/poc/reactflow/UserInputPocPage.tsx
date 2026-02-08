import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  InteractionHost,
  RenderProvider,
  type InteractionResponseData,
} from "@wfm/shared";
import { UserSelectModuleCard } from "@/modules/user-select/UserSelectModuleCard";
import {
  type UserSelectModule,
  validateUserSelectModule,
} from "@/modules/user-select/types";
import { UserSelectModuleEditor } from "@/modules/user-select/UserSelectModuleEditor";
import { useVirtualUserSelectRuntime } from "@/runtime/useVirtualUserSelectRuntime";

type UserSelectNodeData = {
  module: UserSelectModule;
  active: boolean;
  status: string;
  previewOpen: boolean;
  onTogglePreview: () => void;
  previewRequest: any;
  busy: boolean;
  onSubmitPreview: (response: InteractionResponseData) => void;
};

type UserSelectNode = Node<UserSelectNodeData, "userSelect">;

function UserSelectNodeView({ data }: NodeProps<UserSelectNode>) {
  return (
    <div className="space-y-1">
      <Handle id="in" position={Position.Left} type="target" />
      <UserSelectModuleCard
        active={data.active}
        module={data.module}
        onTogglePreview={data.onTogglePreview}
        previewContent={
          data.previewRequest ? (
            <RenderProvider value={{ debugMode: false, readonly: false }}>
              <InteractionHost
                disabled={data.busy}
                onSubmit={data.onSubmitPreview}
                request={data.previewRequest}
              />
            </RenderProvider>
          ) : (
            <p className="text-xs text-muted-foreground">
              Click Preview to load real server interaction.
            </p>
          )
        }
        previewOpen={data.previewOpen}
      />
      <Handle id="out" position={Position.Right} type="source" />
      <p className="text-center text-[11px] text-muted-foreground">state: {data.status}</p>
    </div>
  );
}

const nodeTypes = {
  userSelect: UserSelectNodeView,
};

export function ReactFlowUserInputPocPage() {
  const runtime = useVirtualUserSelectRuntime();
  const modules = runtime.modules;
  const [selectedModuleName, setSelectedModuleName] = useState<string>(
    modules[0]?.name ?? ""
  );
  const [previewModuleName, setPreviewModuleName] = useState<string | null>(null);

  const selectedModule = modules.find((module) => module.name === selectedModuleName);
  const selectedIssues = selectedModule ? validateUserSelectModule(selectedModule) : [];

  const edges = useMemo<Edge[]>(() => {
    const result: Edge[] = [];
    for (let i = 1; i < modules.length; i += 1) {
      result.push({
        id: `module-sequence-${i}`,
        source: modules[i - 1].name,
        target: modules[i].name,
        label: "step flow",
      });
    }
    return result;
  }, [modules]);

  const nodes = useMemo<UserSelectNode[]>(() => {
    return modules.map((module, index) => ({
      id: module.name,
      type: "userSelect",
      position: { x: 80 + index * 420, y: 160 },
      data: {
        module,
        active: module.name === selectedModuleName,
        status: runtime.runStateByModule[module.name] || "idle",
        previewOpen: previewModuleName === module.name,
        onTogglePreview: () => {
          if (previewModuleName === module.name) {
            setPreviewModuleName(null);
            return;
          }
          setPreviewModuleName(module.name);
          setSelectedModuleName(module.name);
          void runtime.runSelectedModule(module.name);
        },
        previewRequest:
          runtime.interactionRequest &&
          (runtime.pendingModuleName || selectedModuleName) === module.name
            ? runtime.interactionRequest
            : null,
        busy: runtime.busy,
        onSubmitPreview: (response: InteractionResponseData) =>
          void runtime.submitInteraction(response, module.name),
      },
    }));
  }, [
    modules,
    previewModuleName,
    runtime.busy,
    runtime.interactionRequest,
    runtime.pendingModuleName,
    runtime.runStateByModule,
    selectedModuleName,
  ]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">React Flow User Input PoC</h1>
          <p className="text-xs text-muted-foreground">
            `user.select` nodes use shared cards and a shared InteractionHost runtime panel.
          </p>
        </div>
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-[1fr_420px] grid-rows-[minmax(0,1fr)]">
        <div className="min-h-0 overflow-hidden border-r">
          <ReactFlow
            fitView
            edges={edges}
            nodeTypes={nodeTypes}
            nodes={nodes}
            onNodeClick={(_, node) => setSelectedModuleName(node.id)}
          >
            <Background gap={20} />
            <Controls />
            <MiniMap />
          </ReactFlow>
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

                <div className="mb-3 space-y-2">
                  <label className="flex items-center gap-2 rounded border bg-background px-2 py-1 text-xs">
                    <input
                      checked={runtime.autoResolveEnabled}
                      onChange={(event) =>
                        runtime.setAutoResolveEnabled(event.target.checked)
                      }
                      type="checkbox"
                    />
                    auto-resolve prerequisite selections
                  </label>
                  <button
                    className="w-full rounded border bg-background px-3 py-2 text-sm"
                    disabled={runtime.busy}
                    onClick={() => void runtime.runSelectedModule(selectedModule.name)}
                    type="button"
                  >
                    {runtime.busy ? "Running..." : "Run Selected Module"}
                  </button>
                  <button
                    className="w-full rounded border bg-background px-3 py-2 text-sm"
                    onClick={runtime.resetSession}
                    type="button"
                  >
                    Reset Virtual Session
                  </button>
                </div>

                <div className="mb-3 rounded border bg-background p-2 text-xs">
                  selected: <span className="font-medium">{selectedModule.name}</span>
                  <br />
                  state: <span>{runtime.runStateByModule[selectedModule.name] || "idle"}</span>
                </div>

                {runtime.error ? (
                  <div className="mb-3 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    {runtime.error}
                  </div>
                ) : null}

                <div className="space-y-2 text-xs">
                  <p className="font-semibold">Validation</p>
                  {selectedIssues.length ? (
                    <ul className="space-y-1 text-destructive">
                      {selectedIssues.map((issue) => (
                        <li key={issue}>- {issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-emerald-600">No validation issues.</p>
                  )}
                </div>

                <div className="mt-3">
                  <button
                    className="w-full rounded border bg-background px-3 py-2 text-sm"
                    onClick={() =>
                      setPreviewModuleName((current) =>
                        current === selectedModule.name ? null : selectedModule.name
                      )
                    }
                    type="button"
                  >
                    {previewModuleName === selectedModule.name
                      ? "Hide Card Preview"
                      : "Open Card Preview"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a module node to edit.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
