import { useEffect, useState } from "react";
import {
  addFlowNode,
  connectNodes,
  createReteInstance,
  zoomToNodes,
} from "@/poc/rete/rete-helpers";
import { userSelectNodeLabel } from "@/modules/user-select/presentation";
import { UserSelectModuleEditor } from "@/modules/user-select/UserSelectModuleEditor";
import { validateUserSelectModule } from "@/modules/user-select/types";
import { UserSelectRuntimePanel } from "@/runtime/UserSelectRuntimePanel";
import { useVirtualUserSelectRuntime } from "@/runtime/useVirtualUserSelectRuntime";

export function ReteUserInputPocPage() {
  const runtime = useVirtualUserSelectRuntime();
  const modules = runtime.modules;
  const [selectedModuleName, setSelectedModuleName] = useState<string>(modules[0]?.name);
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedModule = modules.find((module) => module.name === selectedModuleName);
  const selectedIssues = selectedModule ? validateUserSelectModule(selectedModule) : [];

  useEffect(() => {
    const container = document.getElementById("rete-user-input-canvas") as HTMLDivElement | null;
    if (!container) return;
    let active = true;

    const start = async () => {
      const rete = await createReteInstance(container);
      const nodeToModule = new Map<string, string>();

      (rete.area as any).addPipe((context: any) => {
        if (context?.type === "nodepicked") {
          const moduleName = nodeToModule.get(context.data?.id);
          if (moduleName) {
            setSelectedModuleName(moduleName);
          }
        }
        return context;
      });

      const stepRoot = await addFlowNode(
        rete.editor,
        rete.area,
        "user_input | Step 1",
        80,
        80
      );

      let previousNode: Awaited<ReturnType<typeof addFlowNode>> | null = null;

      for (let i = 0; i < modules.length && active; i += 1) {
        const module = modules[i];
        const node = await addFlowNode(
          rete.editor,
          rete.area,
          `${userSelectNodeLabel(module)}\nstate: ${runtime.runStateByModule[module.name] || "idle"}`,
          180 + i * 620,
          260
        );
        nodeToModule.set(node.id, module.name);

        await connectNodes(rete.editor, stepRoot, node);
        if (previousNode) {
          await connectNodes(rete.editor, previousNode, node);
        }
        previousNode = node;
      }

      if (active) {
        await zoomToNodes(rete.area, rete.editor);
      }

      return rete;
    };

    const instancePromise = start();

    return () => {
      active = false;
      instancePromise.then((instance) => instance.destroy()).catch(() => undefined);
    };
  }, [modules, runtime.runStateByModule]);

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">Rete User Input PoC</h1>
          <p className="text-xs text-muted-foreground">
            `user.select` nodes show module summary and shared runtime panel.
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
          <div className="rete-canvas h-full w-full rounded-md border" id="rete-user-input-canvas" />
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
              <h2 className="text-sm font-semibold">Rete Runtime Preview</h2>
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
