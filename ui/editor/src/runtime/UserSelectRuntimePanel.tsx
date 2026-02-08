import {
  InteractionHost,
  RenderProvider,
  type InteractionRequest,
  type InteractionResponseData,
} from "@wfm/shared";
import type { UserSelectModule } from "@/modules/user-select/types";
import { validateUserSelectModule } from "@/modules/user-select/types";
import { UserSelectModuleEditor } from "@/modules/user-select/UserSelectModuleEditor";
import type { ModuleRunState } from "@/runtime/useVirtualUserSelectRuntime";

type RuntimeController = {
  busy: boolean;
  error: string | null;
  rawResponse: unknown;
  interactionRequest: InteractionRequest | null;
  autoResolveEnabled: boolean;
  setAutoResolveEnabled: (value: boolean) => void;
  autoEvents: string[];
  runStateByModule: Record<string, ModuleRunState>;
  outputsByModule: Record<string, unknown>;
  runSelectedModule: (moduleName: string) => Promise<void>;
  submitInteraction: (
    response: InteractionResponseData,
    selectedModuleName: string | null
  ) => Promise<void>;
  resetSession: () => void;
  updateModule: (previousName: string, nextModule: UserSelectModule) => void;
};

type UserSelectRuntimePanelProps = {
  modules: UserSelectModule[];
  selectedModuleName: string | null;
  onSelectModule?: (moduleName: string) => void;
  controller: RuntimeController;
};

export function UserSelectRuntimePanel({
  modules,
  selectedModuleName,
  onSelectModule,
  controller,
}: UserSelectRuntimePanelProps) {
  const selectedModule = modules.find((module) => module.name === selectedModuleName);
  const issues = selectedModule ? validateUserSelectModule(selectedModule) : [];

  return (
    <aside className="min-h-0 overflow-auto p-3">
      {selectedModule ? (
        <div className="mb-3 space-y-3 rounded border bg-card p-3">
          <h2 className="text-sm font-semibold">Module Parameters</h2>
          <UserSelectModuleEditor
            onChange={(nextModule) => {
              controller.updateModule(selectedModule.name, nextModule);
              if (selectedModule.name !== nextModule.name && onSelectModule) {
                onSelectModule(nextModule.name);
              }
            }}
            value={selectedModule}
          />
          <section className="rounded border bg-background p-2">
            <h3 className="text-xs font-semibold">Validation</h3>
            {issues.length ? (
              <ul className="mt-2 space-y-1 text-xs text-destructive">
                {issues.map((issue) => (
                  <li key={issue}>- {issue}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-emerald-600">No validation issues.</p>
            )}
          </section>
        </div>
      ) : null}

      <div className="mb-3 space-y-2">
        <label className="flex items-center gap-2 rounded border bg-card px-2 py-1 text-xs">
          <input
            checked={controller.autoResolveEnabled}
            onChange={(event) => controller.setAutoResolveEnabled(event.target.checked)}
            type="checkbox"
          />
          auto-resolve prerequisite selections
        </label>
        <button
          className="w-full rounded border bg-card px-3 py-2 text-sm"
          disabled={controller.busy || !selectedModuleName}
          onClick={() => selectedModuleName && controller.runSelectedModule(selectedModuleName)}
          type="button"
        >
          {controller.busy ? "Running..." : "Run Selected Module"}
        </button>
        <button
          className="w-full rounded border bg-card px-3 py-2 text-sm"
          onClick={controller.resetSession}
          type="button"
        >
          Reset Virtual Session
        </button>
      </div>

      {selectedModule ? (
        <div className="mb-3 rounded border bg-card p-2 text-xs">
          selected: <span className="font-medium">{selectedModule.name}</span>
        </div>
      ) : null}

      {controller.error ? (
        <div className="mb-3 rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {controller.error}
        </div>
      ) : null}

      {controller.interactionRequest ? (
        <RenderProvider value={{ debugMode: false, readonly: false }}>
          <div className="mb-3 rounded border bg-card p-3">
            <InteractionHost
              disabled={controller.busy}
              onSubmit={(response) =>
                controller.submitInteraction(response, selectedModuleName)
              }
              request={controller.interactionRequest}
            />
          </div>
        </RenderProvider>
      ) : (
        <div className="mb-3 rounded border bg-card p-3 text-sm text-muted-foreground">
          Run a module to load real interaction payload from server.
        </div>
      )}

      <div className="space-y-2 text-xs">
        <p className="font-semibold">Outputs</p>
        <pre className="max-h-64 overflow-auto rounded border bg-card p-2">
          {JSON.stringify(controller.outputsByModule, null, 2)}
        </pre>
        <p className="font-semibold">Auto events</p>
        <ul className="max-h-36 overflow-auto rounded border bg-card p-2">
          {controller.autoEvents.length ? (
            controller.autoEvents.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)
          ) : (
            <li className="text-muted-foreground">No auto selections yet.</li>
          )}
        </ul>
      </div>

      <section className="mt-3">
        <h3 className="mb-2 text-xs font-semibold">Last Raw Response</h3>
        <pre className="max-h-80 overflow-auto rounded border bg-card p-2 text-xs">
          {controller.rawResponse
            ? JSON.stringify(controller.rawResponse, null, 2)
            : "No response yet"}
        </pre>
      </section>
    </aside>
  );
}
