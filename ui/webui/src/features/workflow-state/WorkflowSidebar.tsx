/**
 * WorkflowSidebar - Sidebar for workflow execution status display.
 *
 * Shows:
 * - Execution status (progress, elapsed time, messages)
 * - Action buttons (cancel, start new)
 * - Model selector dropdown
 * - Project info (project name, run ID)
 */

import { useEffect } from "react";
import { LogOut, RefreshCw, Layers, Square, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// TODO: Re-enable when ExecutionStatus is fixed
// import { ExecutionStatus } from "./ExecutionStatus";
import { useWorkflowStore } from "@/state/workflow-store";
import { api, buildEditorWorkflowUrl } from "@/core/api";
import type { WorkflowProgress, WorkflowStatus } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

interface StatusDisplayField {
  id: string;
  label: string;
  value: string;
}

type PageState = "running" | "completed" | "error";

interface WorkflowSidebarProps {
  /** Current page state */
  pageState: PageState;
  /** Workflow status */
  status: WorkflowStatus | null;
  /** Workflow progress info */
  progress: WorkflowProgress | null;
  /** Whether workflow is currently processing */
  isProcessing: boolean;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Last status message */
  lastMessage: string;
  /** Error message if any */
  error: string | null;
  /** Dynamic status display fields */
  statusDisplayFields: StatusDisplayField[];
  /** Project name */
  projectName: string;
  /** Workflow run ID */
  workflowRunId: string;
  /** Workflow template ID (for editor link) */
  workflowTemplateId?: string;
  /** Workflow version ID (for editor link) */
  workflowVersionId?: string;
  /** Called when cancel button is clicked */
  onCancel: () => void;
  /** Called when start new button is clicked */
  onRestart: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowSidebar({
  pageState,
  // TODO: Re-enable when ExecutionStatus is fixed
  status: _status,
  progress: _progress,
  isProcessing: _isProcessing,
  elapsedMs: _elapsedMs,
  lastMessage: _lastMessage,
  error: _error,
  statusDisplayFields: _statusDisplayFields,
  projectName,
  workflowRunId,
  workflowTemplateId,
  workflowVersionId,
  onCancel,
  onRestart,
}: WorkflowSidebarProps) {
  // Suppress unused variable warnings for temporarily disabled props
  void _status;
  void _progress;
  void _isProcessing;
  void _elapsedMs;
  void _lastMessage;
  void _error;
  void _statusDisplayFields;
  const viewMode = useWorkflowStore((s) => s.viewMode);
  const toggleViewMode = useWorkflowStore((s) => s.toggleViewMode);
  const modelsConfig = useWorkflowStore((s) => s.modelsConfig);
  const selectedProvider = useWorkflowStore((s) => s.selectedProvider);
  const selectedModel = useWorkflowStore((s) => s.selectedModel);
  const setModelsConfig = useWorkflowStore((s) => s.setModelsConfig);
  const setSelectedModel = useWorkflowStore((s) => s.setSelectedModel);

  // Fetch models config on mount
  useEffect(() => {
    if (!modelsConfig) {
      api.getModels()
        .then(setModelsConfig)
        .catch((err) => console.error("Failed to fetch models:", err));
    }
  }, [modelsConfig, setModelsConfig]);

  // Build display value for model selector
  const getModelDisplayValue = () => {
    if (!modelsConfig) return "Loading...";
    if (!selectedModel) {
      // Show default
      const defaultModel = modelsConfig.default_model;
      const defaultProvider = modelsConfig.providers[modelsConfig.default_provider];
      const modelInfo = defaultProvider?.models.find((m) => m.id === defaultModel);
      return `Default (${modelInfo?.name || defaultModel})`;
    }
    // Show selected
    const provider = selectedProvider ? modelsConfig.providers[selectedProvider] : null;
    const modelInfo = provider?.models.find((m) => m.id === selectedModel);
    return modelInfo?.name || selectedModel;
  };

  // Handle model selection change
  const handleModelChange = (value: string) => {
    if (value === "default" || !modelsConfig) {
      setSelectedModel(null, null);
      return;
    }
    // Value is in format "provider:modelId"
    const [provider, modelId] = value.split(":");
    setSelectedModel(provider, modelId);
  };

  // Get current selection value for Select component
  const getSelectValue = () => {
    if (!selectedModel || !selectedProvider) return "default";
    return `${selectedProvider}:${selectedModel}`;
  };

  return (
    <div className="space-y-4">
      {/* TODO: Fix ExecutionStatus component - temporarily hidden
      <ExecutionStatus
        status={status}
        progress={progress}
        isProcessing={isProcessing}
        elapsedMs={elapsedMs}
        lastMessage={lastMessage}
        error={error}
        statusDisplayFields={statusDisplayFields}
      />
      */}

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {/* Exit button - always available */}
        <Button
          data-guidance="exit-button"
          variant="outline"
          onClick={onCancel}
          size="sm"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Exit
        </Button>
        {/* View mode toggle */}
        <Button
          data-guidance="view-mode-toggle"
          variant="outline"
          onClick={toggleViewMode}
          size="sm"
          title={viewMode === "scroll" ? "Switch to single view" : "Switch to scroll view"}
        >
          {viewMode === "scroll" ? (
            <Square className="mr-2 h-4 w-4" />
          ) : (
            <Layers className="mr-2 h-4 w-4" />
          )}
          {viewMode === "scroll" ? "Single" : "Scroll"}
        </Button>
        {/* Edit in editor button */}
        {workflowTemplateId && workflowVersionId && (
          <Button
            variant="outline"
            size="sm"
            asChild
            title="Edit this workflow in the visual editor (In Development)"
            className="gap-1"
          >
            <a href={buildEditorWorkflowUrl(workflowTemplateId, workflowVersionId)}>
              <Pencil className="h-4 w-4" />
              Edit
              <span className="text-xs text-amber-600 dark:text-amber-400">(Dev)</span>
            </a>
          </Button>
        )}
        {/* Start New button - only when workflow finished */}
        {(pageState === "completed" || pageState === "error") && (
          <Button variant="outline" onClick={onRestart} size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Start New
          </Button>
        )}
      </div>

      {/* Model selector */}
      <div data-guidance="model-selector" className="space-y-1">
        <label className="text-sm text-muted-foreground">Model</label>
        <Select value={getSelectValue()} onValueChange={handleModelChange}>
          <SelectTrigger className="w-full">
            <SelectValue>{getModelDisplayValue()}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">
              Default ({modelsConfig?.providers[modelsConfig.default_provider]?.models.find(
                (m) => m.id === modelsConfig.default_model
              )?.name || modelsConfig?.default_model || "..."})
            </SelectItem>
            {modelsConfig && Object.entries(modelsConfig.providers).map(([providerId, provider]) => (
              <SelectGroup key={providerId}>
                <SelectLabel>{provider.name}</SelectLabel>
                {provider.models.map((model) => (
                  <SelectItem key={model.id} value={`${providerId}:${model.id}`}>
                    {model.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Project info */}
      <Card className="gap-0 pb-0">
        <CardContent className="pb-3">
          <div className="text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Project: </span>
              <span className="font-mono">{projectName}</span>
            </div>
            {workflowRunId && (
              <div>
                <span className="text-muted-foreground">Run ID: </span>
                <span className="font-mono text-xs">{workflowRunId}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
