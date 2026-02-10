/**
 * Test page for VirtualRuntime.
 *
 * Provides a simple UI to test the virtual runtime with a sample workflow.
 * This is for development/testing purposes.
 */

import { useState } from "react";
import type { WorkflowDefinition } from "@wfm/shared";
import { useVirtualRuntime } from "./useVirtualRuntime";
import { VirtualPreview } from "./VirtualPreview";
import { buildUserInputVirtualWorkflow } from "../poc/data/ccUserInputVirtualWorkflow";
import type { ModuleLocation } from "./types";

// Build test workflow
const TEST_WORKFLOW = buildUserInputVirtualWorkflow() as unknown as WorkflowDefinition;

// Get module locations from workflow
function getModuleLocations(workflow: WorkflowDefinition): ModuleLocation[] {
  const locations: ModuleLocation[] = [];
  for (const step of workflow.steps) {
    for (const module of step.modules) {
      locations.push({
        step_id: step.step_id,
        module_name: module.name ?? "",
      });
    }
  }
  return locations;
}

const MODULE_LOCATIONS = getModuleLocations(TEST_WORKFLOW);

export function VirtualRuntimeTestPage() {
  const runtime = useVirtualRuntime();
  const [selectedModuleIndex, setSelectedModuleIndex] = useState(0);

  const selectedModule = MODULE_LOCATIONS[selectedModuleIndex];

  const handleRunModule = async () => {
    if (!selectedModule) return;
    await runtime.actions.runToModule(TEST_WORKFLOW, selectedModule, []);
  };

  const handleSubmit = async (response: Parameters<typeof runtime.actions.submitResponse>[2]) => {
    if (!selectedModule) return;
    await runtime.actions.submitResponse(TEST_WORKFLOW, selectedModule, response);
  };

  const handleReset = () => {
    runtime.actions.reset();
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b p-4">
        <div>
          <h1 className="text-lg font-semibold">Virtual Runtime Test</h1>
          <p className="text-xs text-muted-foreground">
            Test the new VirtualRuntime with checkpoint caching
          </p>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 min-h-0 grid grid-cols-[300px_1fr] gap-4 p-4">
        {/* Left panel - Controls */}
        <div className="space-y-4 overflow-auto">
          {/* Module selector */}
          <div className="rounded border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Target Module</h2>
            <select
              className="w-full rounded border bg-background px-2 py-1 text-sm"
              value={selectedModuleIndex}
              onChange={(e) => setSelectedModuleIndex(Number(e.target.value))}
            >
              {MODULE_LOCATIONS.map((loc, idx) => (
                <option key={`${loc.step_id}/${loc.module_name}`} value={idx}>
                  {loc.step_id} / {loc.module_name}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <button
              className="w-full rounded border bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={runtime.busy}
              onClick={handleRunModule}
              type="button"
            >
              {runtime.busy ? "Running..." : "Run to Module"}
            </button>
            <button
              className="w-full rounded border bg-card px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
              onClick={handleReset}
              type="button"
            >
              Reset Runtime
            </button>
          </div>

          {/* Workflow info */}
          <div className="rounded border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Workflow</h2>
            <p className="text-xs text-muted-foreground">
              {TEST_WORKFLOW.name ?? TEST_WORKFLOW.workflow_id}
            </p>
            <p className="mt-1 text-xs">
              Steps: {TEST_WORKFLOW.steps.length} | Modules:{" "}
              {MODULE_LOCATIONS.length}
            </p>
          </div>

          {/* Checkpoints */}
          <div className="rounded border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Checkpoints</h2>
            <div className="space-y-1 text-xs">
              {MODULE_LOCATIONS.map((loc) => {
                const checkpoint = runtime.actions.getCheckpoint(loc);
                return (
                  <div
                    key={`${loc.step_id}/${loc.module_name}`}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{loc.module_name}</span>
                    <span
                      className={
                        checkpoint
                          ? "text-emerald-600"
                          : "text-muted-foreground"
                      }
                    >
                      {checkpoint ? "cached" : "-"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right panel - Preview */}
        <div className="overflow-auto rounded border bg-card p-4">
          <VirtualPreview
            status={runtime.status}
            busy={runtime.busy}
            response={runtime.lastResponse}
            error={runtime.error}
            onSubmit={handleSubmit}
            showState={true}
          />
        </div>
      </div>
    </div>
  );
}
