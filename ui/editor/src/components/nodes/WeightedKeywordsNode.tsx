/**
 * Custom ReactFlow node for io.weighted_keywords module.
 *
 * Features:
 * - Collapsed state: Shows module summary (name, mode, pipeline/source summary)
 * - Expanded state: Shows full configuration form with mode-specific inputs
 * - Pipeline editing via Monaco editor dialog (load mode)
 * - Jinja2 reference input for keywords source (save mode)
 */

import { useState, memo, useEffect, useRef, useCallback } from "react";
import {
  Handle,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@wfm/shared";
import Editor from "@monaco-editor/react";
import {
  type WeightedKeywordsModule,
  type WeightedKeywordsLoadInputs,
  type WeightedKeywordsSaveInputs,
  type WeightedKeywordsLoadOutputs,
  type WeightedKeywordsSaveOutputs,
  type PipelineStage,
  isLoadMode,
  isSaveMode,
} from "@/modules/weighted-keywords/types";
import {
  getPipelineSummary,
  getKeywordsSourceSummary,
  formatPipelineForDisplay,
  parsePipelineString,
} from "@/modules/weighted-keywords/presentation";

// =============================================================================
// Types
// =============================================================================

export type WeightedKeywordsNodeData = {
  module: WeightedKeywordsModule;
  onModuleChange: (module: WeightedKeywordsModule) => void;
  /** Whether this module is expanded */
  expanded: boolean;
  /** Callback when expanded state changes (includes estimated height for layout) */
  onExpandedChange: (expanded: boolean, estimatedHeight: number) => void;
};

// =============================================================================
// Constants
// =============================================================================

/** Height of module when collapsed */
export const MODULE_HEIGHT_COLLAPSED = 100;
/** Height of module when expanded (load mode) */
export const MODULE_HEIGHT_EXPANDED_LOAD = 340;
/** Height of module when expanded (save mode) */
export const MODULE_HEIGHT_EXPANDED_SAVE = 320;
/** Width of module (same for collapsed and expanded) */
export const MODULE_WIDTH = 340;

// =============================================================================
// Collapsed View
// =============================================================================

function CollapsedView({
  module,
  onExpand,
}: {
  module: WeightedKeywordsModule;
  onExpand: () => void;
}) {
  const modeLabel = module.inputs.mode === "load" ? "Load" : "Save";
  const modeBadgeClass =
    module.inputs.mode === "load"
      ? "bg-blue-500 text-white"
      : "bg-green-500 text-white";
  const borderClass =
    module.inputs.mode === "load"
      ? "border-blue-500/50"
      : "border-green-500/50";

  let summary: string;
  if (isLoadMode(module.inputs)) {
    summary = getPipelineSummary(module.inputs.pipeline);
  } else if (isSaveMode(module.inputs)) {
    summary = getKeywordsSourceSummary(module.inputs.weighted_keywords);
  } else {
    summary = "unknown mode";
  }

  return (
    <div className={`relative w-[340px] rounded-lg border-2 ${borderClass} bg-card shadow-sm`}>
      {/* Mode Badge */}
      <div
        className={`absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px]
                    font-medium shadow-sm ${modeBadgeClass}`}
      >
        {modeLabel}
      </div>

      {/* Header - matches expanded CardHeader layout */}
      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            io.weighted_keywords
          </p>
          <h3 className="text-sm font-semibold truncate">{module.name}</h3>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={(e) => {
            e.stopPropagation();
            onExpand();
          }}
        >
          Expand
        </Button>
      </div>

      {/* Content - clickable area to expand */}
      <div
        className="px-3 pb-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onExpand}
      >
        <p className="text-xs text-muted-foreground line-clamp-2">
          {summary}
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Expanded View - Load Mode
// =============================================================================

function ExpandedLoadView({
  module,
  onChange,
  onCollapse,
}: {
  module: WeightedKeywordsModule;
  onChange: (module: WeightedKeywordsModule) => void;
  onCollapse: () => void;
}) {
  const [isPipelineEditorOpen, setIsPipelineEditorOpen] = useState(false);
  const [draftPipeline, setDraftPipeline] = useState("");

  // Type assertion - this component is only rendered when mode is "load"
  const inputs = module.inputs as WeightedKeywordsLoadInputs;
  const outputs = module.outputs_to_state as WeightedKeywordsLoadOutputs;

  const handleOpenPipelineEditor = () => {
    setDraftPipeline(formatPipelineForDisplay(inputs.pipeline));
    setIsPipelineEditorOpen(true);
  };

  const handleSavePipeline = () => {
    const parsed = parsePipelineString(draftPipeline);
    if (parsed) {
      const newInputs: WeightedKeywordsLoadInputs = {
        ...inputs,
        pipeline: parsed as PipelineStage[],
      };
      onChange({
        ...module,
        inputs: newInputs,
      });
    }
    setIsPipelineEditorOpen(false);
  };

  const updateOutputs = (patch: Partial<WeightedKeywordsLoadOutputs>) => {
    onChange({
      ...module,
      outputs_to_state: { ...outputs, ...patch },
    });
  };

  return (
    <>
      <Card className="relative w-[340px] shadow-lg border-2 border-blue-500/50">
        {/* Mode Badge */}
        <div
          className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px]
                      font-medium bg-blue-500 text-white shadow-sm z-10"
        >
          Load
        </div>

        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              io.weighted_keywords
            </p>
            <input
              className="text-sm font-semibold bg-transparent border-b
                         border-transparent hover:border-border focus:border-primary
                         focus:outline-none w-full"
              value={module.name}
              onChange={(e) => onChange({ ...module, name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={onCollapse}
          >
            Collapse
          </Button>
        </CardHeader>

        <CardContent className="space-y-4" onClick={(e) => e.stopPropagation()}>
          {/* Mode indicator */}
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Mode</Label>
            <div className="flex rounded border bg-background p-0.5 text-xs">
              <button
                type="button"
                className="rounded px-3 py-1 bg-primary text-primary-foreground"
                disabled
              >
                Load
              </button>
              <button
                type="button"
                className="rounded px-3 py-1 hover:bg-muted opacity-50"
                disabled
              >
                Save
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Mode cannot be changed after creation
            </p>
          </div>

          {/* Pipeline */}
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Pipeline</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={handleOpenPipelineEditor}
              >
                Edit
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {getPipelineSummary(inputs.pipeline)}
            </p>
          </div>

          {/* Outputs */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Outputs to State</Label>
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  weighted_keywords
                </span>
                <input
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                  value={outputs.weighted_keywords}
                  onChange={(e) =>
                    updateOutputs({ weighted_keywords: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">count</span>
                <input
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                  value={outputs.count}
                  onChange={(e) => updateOutputs({ count: e.target.value })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Editor Dialog */}
      <Dialog open={isPipelineEditorOpen} onOpenChange={setIsPipelineEditorOpen}>
        <DialogContent className="max-w-3xl h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Pipeline</DialogTitle>
            <DialogDescription>
              MongoDB aggregation pipeline stages. Only safe stages are allowed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 border rounded overflow-hidden">
            <Editor
              height="100%"
              language="json"
              theme="vs-dark"
              value={draftPipeline}
              onChange={(value) => setDraftPipeline(value ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPipelineEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSavePipeline}>Save Pipeline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// Expanded View - Save Mode
// =============================================================================

function ExpandedSaveView({
  module,
  onChange,
  onCollapse,
}: {
  module: WeightedKeywordsModule;
  onChange: (module: WeightedKeywordsModule) => void;
  onCollapse: () => void;
}) {
  // Type assertion - this component is only rendered when mode is "save"
  const inputs = module.inputs as WeightedKeywordsSaveInputs;
  const outputs = module.outputs_to_state as WeightedKeywordsSaveOutputs;

  const updateInputs = (patch: Partial<WeightedKeywordsSaveInputs>) => {
    const newInputs: WeightedKeywordsSaveInputs = {
      ...inputs,
      ...patch,
    };
    onChange({
      ...module,
      inputs: newInputs,
    });
  };

  const updateOutputs = (patch: Partial<WeightedKeywordsSaveOutputs>) => {
    onChange({
      ...module,
      outputs_to_state: { ...outputs, ...patch },
    });
  };

  // Get the current source value as string
  const sourceValue =
    typeof inputs.weighted_keywords === "string"
      ? inputs.weighted_keywords
      : JSON.stringify(inputs.weighted_keywords);

  return (
    <Card className="relative w-[340px] shadow-lg border-2 border-green-500/50">
      {/* Mode Badge */}
      <div
        className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px]
                    font-medium bg-green-500 text-white shadow-sm z-10"
      >
        Save
      </div>

      <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            io.weighted_keywords
          </p>
          <input
            className="text-sm font-semibold bg-transparent border-b
                       border-transparent hover:border-border focus:border-primary
                       focus:outline-none w-full"
            value={module.name}
            onChange={(e) => onChange({ ...module, name: e.target.value })}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={onCollapse}
        >
          Collapse
        </Button>
      </CardHeader>

      <CardContent className="space-y-4" onClick={(e) => e.stopPropagation()}>
        {/* Mode indicator */}
        <div className="rounded-md border p-2 space-y-1">
          <Label className="text-xs">Mode</Label>
          <div className="flex rounded border bg-background p-0.5 text-xs">
            <button
              type="button"
              className="rounded px-3 py-1 hover:bg-muted opacity-50"
              disabled
            >
              Load
            </button>
            <button
              type="button"
              className="rounded px-3 py-1 bg-primary text-primary-foreground"
              disabled
            >
              Save
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Mode cannot be changed after creation
          </p>
        </div>

        {/* Keywords Source */}
        <div className="rounded-md border p-2 space-y-1">
          <Label className="text-xs">Keywords Source</Label>
          <input
            className="w-full rounded border bg-background px-2 py-1 text-xs
                       font-mono"
            value={sourceValue}
            onChange={(e) =>
              updateInputs({ weighted_keywords: e.target.value })
            }
            placeholder="{{ state.keywords }}"
          />
          <p className="text-[10px] text-muted-foreground">
            Jinja2 expression referencing state
          </p>
        </div>

        {/* Accumulate Weight */}
        <div className="rounded-md border p-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={inputs.accumulate_weight !== false}
              onCheckedChange={(checked) =>
                updateInputs({ accumulate_weight: checked === true })
              }
            />
            Accumulate weight
          </label>
          <p className="text-[10px] text-muted-foreground mt-1">
            If enabled, weight adds to existing. If disabled, replaces.
          </p>
        </div>

        {/* Outputs */}
        <div className="rounded-md border p-2 space-y-2">
          <Label className="text-xs">Outputs to State</Label>
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground">
              saved_count
            </span>
            <input
              className="w-full rounded border bg-background px-2 py-1 text-xs"
              value={outputs.saved_count}
              onChange={(e) => updateOutputs({ saved_count: e.target.value })}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Main Node Component
// =============================================================================

function WeightedKeywordsNodeComponent({ id, data }: NodeProps) {
  const { module, onModuleChange, expanded, onExpandedChange } =
    data as unknown as WeightedKeywordsNodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const containerRef = useRef<HTMLDivElement>(null);

  // Report height changes to parent for layout calculations
  useReportNodeHeight(id, containerRef);

  // Notify ReactFlow when node size changes (expand/collapse)
  useEffect(() => {
    const timer = setTimeout(() => {
      updateNodeInternals(id);
    }, 50);
    return () => clearTimeout(timer);
  }, [expanded, id, updateNodeInternals]);

  // Handlers that include estimated height for synchronous layout update
  const handleExpand = useCallback(() => {
    const height = isLoadMode(module.inputs)
      ? MODULE_HEIGHT_EXPANDED_LOAD
      : MODULE_HEIGHT_EXPANDED_SAVE;
    onExpandedChange(true, height);
  }, [module.inputs, onExpandedChange]);

  const handleCollapse = useCallback(() => {
    onExpandedChange(false, MODULE_HEIGHT_COLLAPSED);
  }, [onExpandedChange]);

  return (
    <div ref={containerRef} className="relative">
      <Handle
        type="target"
        position={Position.Top}
        id="in"
        className="!bg-primary"
      />

      {expanded ? (
        isLoadMode(module.inputs) ? (
          <ExpandedLoadView
            module={module}
            onChange={onModuleChange}
            onCollapse={handleCollapse}
          />
        ) : (
          <ExpandedSaveView
            module={module}
            onChange={onModuleChange}
            onCollapse={handleCollapse}
          />
        )
      ) : (
        <CollapsedView module={module} onExpand={handleExpand} />
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        id="out"
        className="!bg-primary"
      />
    </div>
  );
}

export const WeightedKeywordsNode = memo(WeightedKeywordsNodeComponent);
