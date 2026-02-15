/**
 * Custom ReactFlow node for transform.query module.
 *
 * Features:
 * - Collapsed state: Shows module summary (name, data source, pipeline summary)
 * - Expanded state: Full configuration with Monaco editors for data and pipeline
 * - Reference list of common pipeline stages
 */

import { useState, memo, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@wfm/shared";
import { ModuleNodeShell } from "@/components/module-node/ModuleNodeShell";
import Editor from "@monaco-editor/react";
import { PipelineEditor } from "@/components/PipelineEditor";
import { type QueryModule, type PipelineStage } from "./types";
import {
  getPipelineSummary,
  getDataSourceSummary,
  formatPipelineForDisplay,
  parsePipelineString,
  formatDataForDisplay,
  parseDataString,
} from "./presentation";

// =============================================================================
// Types
// =============================================================================

export type QueryNodeData = {
  module: QueryModule;
  onModuleChange: (module: QueryModule) => void;
  /** Whether this module is expanded */
  expanded: boolean;
  /** Callback when expanded state changes */
  onExpandedChange: (expanded: boolean) => void;
  /** Callback to view state up to this module */
  onViewState?: () => void;
};

// =============================================================================
// Constants
// =============================================================================

/** Width of module (same for collapsed and expanded) */
export const MODULE_WIDTH = 340;

// =============================================================================
// Collapsed View
// =============================================================================

function CollapsedView({
  module,
  onExpand,
  onViewState,
}: {
  module: QueryModule;
  onExpand: () => void;
  onViewState?: () => void;
}) {
  const dataSummary = getDataSourceSummary(module.inputs.data);
  const pipelineSummary = getPipelineSummary(module.inputs.pipeline);

  return (
    <ModuleNodeShell
      expanded={false}
      borderClass="border-cyan-500/50"
      badgeText="Query"
      badgeClass="bg-cyan-500"
      moduleId="transform.query"
      title={<h3 className="truncate text-sm font-semibold">{module.name}</h3>}
      actions={
        <>
          {onViewState && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onViewState();
              }}
            >
              State
            </Button>
          )}
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
        </>
      }
      onBodyClick={onExpand}
      bodyClassName="hover:bg-muted/30 transition-colors"
    >
      <div>
        <p className="text-xs text-muted-foreground truncate">
          <span className="font-medium">Data:</span> {dataSummary}
        </p>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          <span className="font-medium">Pipeline:</span> {pipelineSummary}
        </p>
      </div>
    </ModuleNodeShell>
  );
}

// =============================================================================
// Expanded View
// =============================================================================

function ExpandedView({
  module,
  onChange,
  onCollapse,
  onViewState,
}: {
  module: QueryModule;
  onChange: (module: QueryModule) => void;
  onCollapse: () => void;
  onViewState?: () => void;
}) {
  // Dialog states
  const [isDataEditorOpen, setIsDataEditorOpen] = useState(false);
  const [isPipelineEditorOpen, setIsPipelineEditorOpen] = useState(false);
  const [draftData, setDraftData] = useState("");
  const [draftPipeline, setDraftPipeline] = useState("");

  const handleOpenDataEditor = () => {
    setDraftData(formatDataForDisplay(module.inputs.data));
    setIsDataEditorOpen(true);
  };

  const handleSaveData = () => {
    const parsed = parseDataString(draftData);
    onChange({
      ...module,
      inputs: {
        ...module.inputs,
        data: parsed,
      },
    });
    setIsDataEditorOpen(false);
  };

  const handleOpenPipelineEditor = () => {
    setDraftPipeline(formatPipelineForDisplay(module.inputs.pipeline));
    setIsPipelineEditorOpen(true);
  };

  const handleSavePipeline = () => {
    const parsed = parsePipelineString(draftPipeline);
    if (parsed) {
      onChange({
        ...module,
        inputs: {
          ...module.inputs,
          pipeline: parsed as PipelineStage[],
        },
      });
    }
    setIsPipelineEditorOpen(false);
  };

  const updateOutputs = (resultKey: string) => {
    onChange({
      ...module,
      outputs_to_state: { result: resultKey },
    });
  };

  return (
    <>
      <ModuleNodeShell
        expanded
        borderClass="border-cyan-500/50"
        badgeText="Query"
        badgeClass="bg-cyan-500"
        moduleId="transform.query"
        title={
          <input
            className="w-full border-b border-transparent bg-transparent text-sm font-semibold hover:border-border focus:border-primary focus:outline-none"
            value={module.name}
            onChange={(e) => onChange({ ...module, name: e.target.value })}
            onClick={(e) => e.stopPropagation()}
          />
        }
        actions={
          <>
            {onViewState && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={onViewState}
              >
                State
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={onCollapse}
            >
              Collapse
            </Button>
          </>
        }
        bodyClassName="space-y-3"
      >
        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
          {/* Data Source */}
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Data Source</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={handleOpenDataEditor}
              >
                Edit
              </Button>
            </div>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {getDataSourceSummary(module.inputs.data)}
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
              {getPipelineSummary(module.inputs.pipeline)}
            </p>
          </div>

          {/* Output */}
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Output to State</Label>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">result</span>
              <input
                className="w-full rounded border bg-background px-2 py-1 text-xs"
                value={module.outputs_to_state.result}
                onChange={(e) => updateOutputs(e.target.value)}
                placeholder="state_key_for_result"
              />
            </div>
          </div>
        </div>
      </ModuleNodeShell>

      {/* Data Source Editor Dialog */}
      <Dialog open={isDataEditorOpen} onOpenChange={setIsDataEditorOpen}>
        <DialogContent className="max-w-3xl h-[70vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Data Source</DialogTitle>
            <DialogDescription>
              Jinja2 expression (e.g., {"{{ state.my_array }}"}) or JSON array.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 border rounded overflow-hidden">
            <Editor
              height="100%"
              language="json"
              theme="vs-dark"
              value={draftData}
              onChange={(value) => setDraftData(value ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                wordWrap: "on",
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDataEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveData}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline Editor Dialog */}
      <Dialog open={isPipelineEditorOpen} onOpenChange={setIsPipelineEditorOpen}>
        <DialogContent className="max-w-4xl h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Pipeline</DialogTitle>
            <DialogDescription>
              MongoDB aggregation pipeline stages (JSON array).
            </DialogDescription>
          </DialogHeader>

          <PipelineEditor
            value={draftPipeline}
            onChange={setDraftPipeline}
          />

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
// Main Node Component
// =============================================================================

function QueryNodeComponent({ id, data }: NodeProps) {
  const { module, onModuleChange, expanded, onExpandedChange, onViewState } =
    data as unknown as QueryNodeData;
  const containerRef = useRef<HTMLDivElement>(null);

  // Report height changes and force immediate measurement when expanded flips.
  useReportNodeHeight(id, containerRef, expanded);

  const handleExpand = useCallback(() => {
    onExpandedChange(true);
  }, [onExpandedChange]);

  const handleCollapse = useCallback(() => {
    onExpandedChange(false);
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
        <ExpandedView
          module={module}
          onChange={onModuleChange}
          onCollapse={handleCollapse}
          onViewState={onViewState}
        />
      ) : (
        <CollapsedView
          module={module}
          onExpand={handleExpand}
          onViewState={onViewState}
        />
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

export const QueryNode = memo(QueryNodeComponent);
