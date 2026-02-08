import { useState } from "react";
import { UserSelectRuntimePanel } from "@/runtime/UserSelectRuntimePanel";
import { useVirtualUserSelectRuntime } from "@/runtime/useVirtualUserSelectRuntime";

export function UserSelectVirtualRuntimePage() {
  const runtime = useVirtualUserSelectRuntime();
  const [selectedModuleName, setSelectedModuleName] = useState<string | null>(
    runtime.modules[0]?.name ?? null
  );

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b p-3">
        <div>
          <h1 className="text-lg font-semibold">Runtime: user.select via InteractionHost</h1>
          <p className="text-xs text-muted-foreground">
            Uses `/workflow/virtual/start` and `/workflow/virtual/respond` for real
            interaction payloads from server.
          </p>
        </div>
      </header>

      <div className="grid flex-1 min-h-0 grid-cols-[320px_1fr] grid-rows-[minmax(0,1fr)]">
        <div className="min-h-0 overflow-auto border-r p-3">
          <h2 className="mb-2 text-sm font-semibold">Modules</h2>
          <div className="space-y-2">
            {runtime.modules.map((module) => {
              const state = runtime.runStateByModule[module.name] || "idle";
              return (
                <button
                  className={[
                    "w-full rounded border px-3 py-2 text-left text-sm",
                    module.name === selectedModuleName ? "bg-muted" : "bg-background",
                  ].join(" ")}
                  key={module.name}
                  onClick={() => setSelectedModuleName(module.name)}
                  type="button"
                >
                  <p className="font-medium">{module.name}</p>
                  <p className="text-xs text-muted-foreground">state: {state}</p>
                </button>
              );
            })}
          </div>
        </div>

        <UserSelectRuntimePanel
          controller={runtime}
          modules={runtime.modules}
          selectedModuleName={selectedModuleName}
          onSelectModule={setSelectedModuleName}
        />
      </div>
    </div>
  );
}
