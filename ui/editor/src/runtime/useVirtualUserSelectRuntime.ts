import { useState } from "react";
import type {
  InteractionRequest,
  InteractionResponseData,
  WorkflowResponse,
} from "@wfm/shared";
import {
  buildUserInputVirtualModules,
  buildUserInputVirtualWorkflow,
} from "@/poc/data/ccUserInputVirtualWorkflow";
import type { UserSelectModule } from "@/modules/user-select/types";
import { buildAutoSelectionResponse } from "@/runtime/auto-select";
import { virtualRespond, virtualStart } from "@/runtime/virtual-api";

export type ModuleRunState = "idle" | "awaiting_input" | "completed" | "error";

function readVirtualDb(response: WorkflowResponse): string | null {
  const value = response.result?.virtual_db;
  return typeof value === "string" ? value : null;
}

function readModuleOutputs(response: WorkflowResponse): Record<string, unknown> | null {
  const value = response.result?.module_outputs;
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

export function useVirtualUserSelectRuntime() {
  const [modules, setModules] = useState<UserSelectModule[]>(() =>
    buildUserInputVirtualModules()
  );

  const [interactionRequest, setInteractionRequest] = useState<InteractionRequest | null>(
    null
  );
  const [virtualDb, setVirtualDb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<WorkflowResponse | null>(null);
  const [pendingModuleName, setPendingModuleName] = useState<string | null>(null);
  const [autoResolveEnabled, setAutoResolveEnabled] = useState(true);
  const [autoEvents, setAutoEvents] = useState<string[]>([]);
  const [runStateByModule, setRunStateByModule] = useState<Record<string, ModuleRunState>>(
    Object.fromEntries(modules.map((module) => [module.name, "idle"]))
  );
  const [outputsByModule, setOutputsByModule] = useState<Record<string, unknown>>({});

  const runSingleModule = async (
    moduleName: string,
    autoResolve: boolean,
    currentVirtualDb: string | null
  ): Promise<{
    status: "completed" | "awaiting_manual" | "error";
    virtualDb: string | null;
  }> => {
    const startResponse = await virtualStart({
      workflow: buildUserInputVirtualWorkflow(modules),
      virtual_db: currentVirtualDb,
      target_step_id: "user_input",
      target_module_name: moduleName,
    });

    setRawResponse(startResponse);
    const startVirtualDb = readVirtualDb(startResponse);
    setVirtualDb(startVirtualDb);

    if (startResponse.status === "error") {
      setRunStateByModule((current) => ({
        ...current,
        [moduleName]: "error",
      }));
      setError(startResponse.error || "Virtual start failed");
      return { status: "error", virtualDb: startVirtualDb };
    }

    if (startResponse.status === "awaiting_input" && startResponse.interaction_request) {
      setRunStateByModule((current) => ({
        ...current,
        [moduleName]: "awaiting_input",
      }));

      if (!autoResolve) {
        setPendingModuleName(moduleName);
        setInteractionRequest(startResponse.interaction_request);
        return { status: "awaiting_manual", virtualDb: startVirtualDb };
      }

      const autoResponse = buildAutoSelectionResponse(startResponse.interaction_request);
      if (!autoResponse) {
        setPendingModuleName(moduleName);
        setInteractionRequest(startResponse.interaction_request);
        setAutoEvents((current) => [
          ...current,
          `${moduleName}: auto selection unavailable, manual input required`,
        ]);
        return { status: "awaiting_manual", virtualDb: startVirtualDb };
      }

      const responseResult = await virtualRespond({
        workflow: buildUserInputVirtualWorkflow(modules),
        virtual_db: startVirtualDb || currentVirtualDb || "{}",
        target_step_id: "user_input",
        target_module_name: moduleName,
        interaction_id: startResponse.interaction_request.interaction_id,
        response: autoResponse,
      });

      setRawResponse(responseResult);
      const respondedVirtualDb = readVirtualDb(responseResult);
      setVirtualDb(respondedVirtualDb);

      if (responseResult.status === "error") {
        setRunStateByModule((current) => ({
          ...current,
          [moduleName]: "error",
        }));
        setError(responseResult.error || "Virtual respond failed");
        return { status: "error", virtualDb: respondedVirtualDb };
      }

      const outputs = readModuleOutputs(responseResult);
      if (outputs) {
        setOutputsByModule((current) => ({
          ...current,
          [moduleName]: outputs,
        }));
      }

      setRunStateByModule((current) => ({
        ...current,
        [moduleName]: "completed",
      }));
      setAutoEvents((current) => [
        ...current,
        `${moduleName}: auto-selected (${JSON.stringify(autoResponse.selected_indices)})`,
      ]);
      setInteractionRequest(null);
      setPendingModuleName(null);
      return { status: "completed", virtualDb: respondedVirtualDb };
    }

    const outputs = readModuleOutputs(startResponse);
    if (outputs) {
      setOutputsByModule((current) => ({
        ...current,
        [moduleName]: outputs,
      }));
    }
    setRunStateByModule((current) => ({
      ...current,
      [moduleName]: "completed",
    }));
    setInteractionRequest(null);
    setPendingModuleName(null);
    return { status: "completed", virtualDb: startVirtualDb };
  };

  const runSelectedModule = async (moduleName: string) => {
    setBusy(true);
    setError(null);
    setInteractionRequest(null);
    setPendingModuleName(null);

    try {
      let sessionVirtualDb = virtualDb;
      const selectedIndex = modules.findIndex((module) => module.name === moduleName);

      if (autoResolveEnabled && selectedIndex > 0) {
        const prerequisites = modules
          .slice(0, selectedIndex)
          .map((module) => module.name)
          .filter((name) => runStateByModule[name] !== "completed");

        for (const prerequisite of prerequisites) {
          const result = await runSingleModule(prerequisite, true, sessionVirtualDb);
          sessionVirtualDb = result.virtualDb;
          if (result.status !== "completed") {
            return;
          }
        }
      }

      await runSingleModule(moduleName, false, sessionVirtualDb);
    } catch (err) {
      setRunStateByModule((current) => ({
        ...current,
        [moduleName]: "error",
      }));
      setInteractionRequest(null);
      setPendingModuleName(null);
      setError(err instanceof Error ? err.message : "Virtual start failed");
    } finally {
      setBusy(false);
    }
  };

  const submitInteraction = async (
    response: InteractionResponseData,
    selectedModuleName: string | null
  ) => {
    const activeModuleName = pendingModuleName || selectedModuleName;
    if (!activeModuleName || !interactionRequest || !virtualDb) return;
    setBusy(true);
    setError(null);

    try {
      const result = await virtualRespond({
        workflow: buildUserInputVirtualWorkflow(modules),
        virtual_db: virtualDb,
        target_step_id: "user_input",
        target_module_name: activeModuleName,
        interaction_id: interactionRequest.interaction_id,
        response,
      });

      setRawResponse(result);
      setVirtualDb(readVirtualDb(result));

      if (result.status === "error") {
        setRunStateByModule((current) => ({
          ...current,
          [activeModuleName]: "error",
        }));
        setError(result.error || "Virtual respond failed");
      } else {
        const outputs = readModuleOutputs(result);
        if (outputs) {
          setOutputsByModule((current) => ({
            ...current,
            [activeModuleName]: outputs,
          }));
        }
        setRunStateByModule((current) => ({
          ...current,
          [activeModuleName]: "completed",
        }));
      }

      setInteractionRequest(null);
      setPendingModuleName(null);
    } catch (err) {
      setRunStateByModule((current) => ({
        ...current,
        [activeModuleName]: "error",
      }));
      setError(err instanceof Error ? err.message : "Virtual respond failed");
    } finally {
      setBusy(false);
    }
  };

  const resetSession = () => {
    setVirtualDb(null);
    setInteractionRequest(null);
    setError(null);
    setRawResponse(null);
    setOutputsByModule({});
    setAutoEvents([]);
    setPendingModuleName(null);
    setRunStateByModule(
      Object.fromEntries(modules.map((module) => [module.name, "idle"]))
    );
  };

  const updateModule = (previousName: string, nextModule: UserSelectModule) => {
    setModules((current) =>
      current.map((module) => (module.name === previousName ? nextModule : module))
    );

    if (previousName !== nextModule.name) {
      setRunStateByModule((current) => {
        const next = { ...current };
        if (previousName in next) {
          next[nextModule.name] = next[previousName];
          delete next[previousName];
        }
        return next;
      });

      setOutputsByModule((current) => {
        if (!(previousName in current)) return current;
        const next = { ...current };
        next[nextModule.name] = next[previousName];
        delete next[previousName];
        return next;
      });
    }
  };

  return {
    modules,
    busy,
    error,
    rawResponse,
    interactionRequest,
    pendingModuleName,
    autoResolveEnabled,
    setAutoResolveEnabled,
    autoEvents,
    runStateByModule,
    outputsByModule,
    runSelectedModule,
    submitInteraction,
    resetSession,
    updateModule,
  };
}
