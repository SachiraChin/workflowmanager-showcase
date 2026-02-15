/**
 * Custom ReactFlow node for user.select module.
 * 
 * Features:
 * - Collapsed state: Shows module summary (name, prompt, data count)
 * - Expanded state: Shows full configuration form inline
 * - Integrates UxSchemaEditor for display schema editing
 */

import { useState, useMemo, memo, useEffect, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
  type InteractionRequest,
  type SchemaProperty,
} from "@wfm/shared";
import { ModuleNodeShell } from "@/components/module-node/ModuleNodeShell";
import {
  UxSchemaEditor,
  type DataSchemaNode,
} from "@/components/ux-schema-editor";
import {
  JsonSchemaEditor,
  type JsonSchemaObject,
} from "@/components/JsonSchemaEditor";
import { EmbeddedRuntimePreview } from "@/runtime";
import { type UserSelectModule, isJsonRefObject } from "./types";
import type { NodeDataFactoryParams } from "@/modules";

// =============================================================================
// Types
// =============================================================================

export type UserSelectNodeData = {
  module: UserSelectModule;
  onModuleChange: (module: UserSelectModule) => void;
  /** Whether this module is expanded */
  expanded: boolean;
  /** Callback when expanded state changes */
  onExpandedChange: (expanded: boolean) => void;
  /** Callback to view state up to this module (runs module, opens state panel) */
  onViewState?: () => void;
  /** Callback to preview this module in virtual runtime */
  onPreview?: () => void;
  /** Callback to preview this module with draft override in virtual runtime */
  onPreviewWithOverride?: (moduleOverride: UserSelectModule) => Promise<void>;
  /** Runtime preview bindings for embedded preview. */
  runtimePreview?: NodeDataFactoryParams["runtimePreview"];
};

// =============================================================================
// Constants
// =============================================================================

/** Width of module (same for collapsed and expanded) */
export const MODULE_WIDTH = 340;

// =============================================================================
// Helpers
// =============================================================================

function inferDataSchema(data: unknown): DataSchemaNode {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { type: "array", items: { type: "object" } };
    }
    return { type: "array", items: inferDataSchema(data[0]) };
  }

  if (data !== null && typeof data === "object") {
    const properties: Record<string, DataSchemaNode> = {};
    for (const [key, value] of Object.entries(data)) {
      properties[key] = inferDataSchema(value);
    }
    return { type: "object", properties };
  }

  if (typeof data === "string") return { type: "string" };
  if (typeof data === "number") return { type: "number" };
  if (typeof data === "boolean") return { type: "boolean" };
  return { type: "string" };
}

function getDataSummary(data: unknown): string {
  if (Array.isArray(data)) {
    return `${data.length} option(s)`;
  }
  if (isJsonRefObject(data)) {
    return `$ref: ${data.$ref}`;
  }
  if (typeof data === "string" && data.startsWith("{{")) {
    return `state: ${data}`;
  }
  return "unknown";
}

// =============================================================================
// Collapsed View
// =============================================================================

function CollapsedView({
  module,
  onExpand,
  onViewState,
  onPreview,
}: {
  module: UserSelectModule;
  onExpand: () => void;
  onViewState?: () => void;
  onPreview?: () => void;
}) {
  return (
    <ModuleNodeShell
      expanded={false}
      borderClass="border-amber-500/50"
      badgeText="User Input"
      badgeClass="bg-amber-500"
      moduleId="user.select"
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
          {onPreview && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onPreview();
              }}
            >
              Preview
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
        <p className="text-xs text-muted-foreground line-clamp-2">
          {module.inputs.prompt}
        </p>

        <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>{getDataSummary(module.inputs.data)}</span>
          <span>•</span>
          <span>{module.inputs.multi_select ? "multi" : "single"}</span>
          <span>•</span>
          <span>{module.inputs.mode}</span>
        </div>
      </div>
    </ModuleNodeShell>
  );
}

// =============================================================================
// Expanded View
// =============================================================================

/**
 * Convert DataSchemaNode to JsonSchemaNode recursively.
 */
function dataSchemaNodeToJsonSchemaNode(node: DataSchemaNode): JsonSchemaObject["properties"][string] {
  if (node.type === "object" && node.properties) {
    const properties: Record<string, JsonSchemaObject["properties"][string]> = {};
    for (const [key, value] of Object.entries(node.properties)) {
      properties[key] = dataSchemaNodeToJsonSchemaNode(value);
    }
    return {
      type: "object",
      properties,
      additionalProperties: false,
    };
  }

  if (node.type === "array" && node.items) {
    return {
      type: "array",
      items: dataSchemaNodeToJsonSchemaNode(node.items),
    };
  }

  return { type: node.type };
}

/**
 * Convert DataSchemaNode to JsonSchemaObject for the schema editor.
 * The editor expects an object schema at the root.
 */
function dataSchemaToJsonSchema(schema: DataSchemaNode | undefined): JsonSchemaObject {
  if (!schema) {
    // No data schema available (e.g., data from state reference)
    // Return empty object schema as fallback
    return {
      type: "object",
      properties: {
        id: { type: "string" },
        label: { type: "string" },
        description: { type: "string" },
      },
      additionalProperties: false,
    };
  }

  // If it's an array, extract the items schema as the object to edit
  if (schema.type === "array" && schema.items) {
    if (schema.items.type === "object" && schema.items.properties) {
      const properties: Record<string, JsonSchemaObject["properties"][string]> = {};
      for (const [key, value] of Object.entries(schema.items.properties)) {
        properties[key] = dataSchemaNodeToJsonSchemaNode(value);
      }
      return {
        type: "object",
        properties,
        additionalProperties: false,
      };
    }
  }
  
  // If it's already an object
  if (schema.type === "object" && schema.properties) {
    const properties: Record<string, JsonSchemaObject["properties"][string]> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      properties[key] = dataSchemaNodeToJsonSchemaNode(value);
    }
    return {
      type: "object",
      properties,
      additionalProperties: false,
    };
  }

  // Fallback: empty object schema with sample fields
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      label: { type: "string" },
      description: { type: "string" },
    },
    additionalProperties: false,
  };
}

function ExpandedView({
  module,
  onChange,
  onCollapse,
  onViewState,
  onPreview,
  onPreviewWithOverride,
  runtimePreview,
}: {
  module: UserSelectModule;
  onChange: (module: UserSelectModule) => void;
  onCollapse: () => void;
  onViewState?: () => void;
  onPreview?: () => void;
  onPreviewWithOverride?: (moduleOverride: UserSelectModule) => Promise<void>;
  runtimePreview?: NodeDataFactoryParams["runtimePreview"];
}) {
  const [isUxEditorOpen, setIsUxEditorOpen] = useState(false);
  const [isDataSchemaEditorOpen, setIsDataSchemaEditorOpen] = useState(false);
  const [draftSchema, setDraftSchema] = useState<SchemaProperty | undefined>(undefined);
  const [draftDataSchema, setDraftDataSchema] = useState<JsonSchemaObject | null>(null);
  const [autoRefreshPreview, setAutoRefreshPreview] = useState(true);
  const [isPreviewRefreshing, setIsPreviewRefreshing] = useState(false);
  const [hasEditedDraftSchema, setHasEditedDraftSchema] = useState(false);
  const [didInitialPreview, setDidInitialPreview] = useState(false);
  const [previewScale, setPreviewScale] = useState(0.7);
  const previewRequestSeqRef = useRef(0);

  const hasInlineData = Array.isArray(module.inputs.data);
  const hasInlineSchema = !isJsonRefObject(module.inputs.schema);

  // dataSchema is only available when we have inline data to infer from
  // When data is a state reference, dataSchema is undefined (displaySchema is primary)
  const dataSchema = useMemo<DataSchemaNode | undefined>(() => {
    if (hasInlineData) {
      return inferDataSchema(module.inputs.data);
    }
    return undefined;
  }, [module.inputs.data, hasInlineData]);

  const previewData = hasInlineData ? module.inputs.data : [];

  // displaySchema comes from module.inputs.schema (already resolved by workflow resolver)
  const currentDisplaySchema = useMemo<SchemaProperty | undefined>(() => {
    if (hasInlineSchema && module.inputs.schema && typeof module.inputs.schema === "object") {
      return module.inputs.schema as SchemaProperty;
    }
    return undefined;
  }, [module.inputs.schema, hasInlineSchema]);

  const updateInputs = (patch: Partial<UserSelectModule["inputs"]>) => {
    onChange({
      ...module,
      inputs: { ...module.inputs, ...patch },
    });
  };

  const handleOpenUxEditor = () => {
    setDraftSchema(currentDisplaySchema);
    setHasEditedDraftSchema(false);
    setDidInitialPreview(false);
    setIsUxEditorOpen(true);
  };

  const handleSaveUxSchema = () => {
    if (draftSchema) {
      updateInputs({ schema: draftSchema });
    }
    setIsUxEditorOpen(false);
  };

  const runRuntimePreview = useCallback(async () => {
    if (!onPreviewWithOverride || isPreviewRefreshing) return;

    const moduleOverride: UserSelectModule = {
      ...module,
      inputs: {
        ...module.inputs,
        schema: draftSchema ?? module.inputs.schema,
      },
    };

    const runId = ++previewRequestSeqRef.current;
    setIsPreviewRefreshing(true);
    try {
      await onPreviewWithOverride(moduleOverride);
    } finally {
      if (runId === previewRequestSeqRef.current) {
        setIsPreviewRefreshing(false);
      }
    }
  }, [onPreviewWithOverride, isPreviewRefreshing, module, draftSchema]);

  useEffect(() => {
    if (!isUxEditorOpen || didInitialPreview || !onPreviewWithOverride) {
      return;
    }

    setDidInitialPreview(true);
    void runRuntimePreview();
  }, [
    isUxEditorOpen,
    didInitialPreview,
    onPreviewWithOverride,
    runRuntimePreview,
  ]);

  useEffect(() => {
    if (
      !isUxEditorOpen ||
      !autoRefreshPreview ||
      !onPreviewWithOverride ||
      !hasEditedDraftSchema
    ) {
      return;
    }

    const timer = setTimeout(() => {
      void runRuntimePreview();
    }, 600);

    return () => clearTimeout(timer);
  }, [
    isUxEditorOpen,
    autoRefreshPreview,
    onPreviewWithOverride,
    draftSchema,
    hasEditedDraftSchema,
    runRuntimePreview,
  ]);

  const runtimeRequest = runtimePreview?.getPreviewRequest() ?? null;

  return (
    <>
      <ModuleNodeShell
        expanded
        borderClass="border-amber-500/50"
        badgeText="User Input"
        badgeClass="bg-amber-500"
        moduleId="user.select"
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
            {onPreview && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={onPreview}
              >
                Preview
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
        bodyClassName="space-y-4"
      >
        <div className="space-y-4" onClick={(e) => e.stopPropagation()}>
          {/* Prompt */}
          <div className="space-y-1">
            <Label className="text-xs">Prompt</Label>
            <Textarea
              className="min-h-16 text-sm"
              value={module.inputs.prompt}
              onChange={(e) => updateInputs({ prompt: e.target.value })}
            />
          </div>

          {/* Mode & Multi-select - grouped together */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Selection Mode</Label>
            <div className="flex items-center gap-3">
              {/* Mode toggle buttons */}
              <div className="ui-segmented-track">
                <button
                  type="button"
                  className={[
                    "rounded px-3 py-1 transition-colors",
                    module.inputs.mode === "select" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  ].join(" ")}
                  onClick={() => updateInputs({ mode: "select" })}
                >
                  Select
                </button>
                <button
                  type="button"
                  className={[
                    "rounded px-3 py-1 transition-colors",
                    module.inputs.mode === "review" ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  ].join(" ")}
                  onClick={() => updateInputs({ mode: "review" })}
                >
                  Review
                </button>
              </div>
              {/* Multi-select checkbox */}
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={module.inputs.multi_select}
                  onCheckedChange={(checked) =>
                    updateInputs({ multi_select: checked === true })
                  }
                />
                Multi-select
              </label>
            </div>
          </div>

          {/* Data Source */}
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Data Source</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => setIsDataSchemaEditorOpen(true)}
                disabled={!hasInlineData}
              >
                Manage
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {getDataSummary(module.inputs.data)}
            </p>
          </div>

          {/* UX Definition */}
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">UX Definition</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={handleOpenUxEditor}
                disabled={!hasInlineData}
              >
                Manage
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {hasInlineSchema ? "Inline schema" : `$ref: ${(module.inputs.schema as { $ref: string }).$ref}`}
            </p>
          </div>

          {/* Outputs */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Outputs to State</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">selected_indices</span>
                <input
                  className="ui-control-compact w-full"
                  value={module.outputs_to_state.selected_indices}
                  onChange={(e) =>
                    onChange({
                      ...module,
                      outputs_to_state: {
                        ...module.outputs_to_state,
                        selected_indices: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">selected_data</span>
                <input
                  className="ui-control-compact w-full"
                  value={module.outputs_to_state.selected_data}
                  onChange={(e) =>
                    onChange({
                      ...module,
                      outputs_to_state: {
                        ...module.outputs_to_state,
                        selected_data: e.target.value,
                      },
                    })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </ModuleNodeShell>

      {/* UX Editor Dialog */}
      <Dialog open={isUxEditorOpen} onOpenChange={setIsUxEditorOpen}>
        <DialogContent size="full" className="h-[90vh] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>Manage UX Definition</DialogTitle>
            <DialogDescription>
              Configure how options are displayed by dragging UX identifiers onto schema nodes.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden">
            <UxSchemaEditor
              dataSchema={dataSchema}
              data={previewData}
              displaySchema={draftSchema}
              onChange={(next) => {
                setDraftSchema(next);
                setHasEditedDraftSchema(true);
              }}
              customPreview={
                runtimePreview ? (
                  <EmbeddedRuntimePreview
                    request={runtimeRequest as InteractionRequest | null}
                    busy={runtimePreview.busy || isPreviewRefreshing}
                    error={runtimePreview.error}
                    mockMode={runtimePreview.mockMode}
                    scale={previewScale}
                    getVirtualDb={runtimePreview.getVirtualDb}
                    getVirtualRunId={runtimePreview.getVirtualRunId}
                    getWorkflow={runtimePreview.getWorkflow}
                    onVirtualDbUpdate={runtimePreview.onVirtualDbUpdate}
                  />
                ) : undefined
              }
              previewControls={
                onPreviewWithOverride ? (
                  <>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={autoRefreshPreview}
                        onCheckedChange={(checked) =>
                          setAutoRefreshPreview(checked === true)
                        }
                      />
                      Auto-refresh
                    </label>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-32"
                      onClick={() => {
                        void runRuntimePreview();
                      }}
                      disabled={isPreviewRefreshing}
                    >
                      {isPreviewRefreshing ? "Refreshing..." : "Refresh Preview"}
                    </Button>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      Zoom
                      <select
                        className="ui-control-compact h-8"
                        value={String(previewScale)}
                        onChange={(e) => setPreviewScale(Number(e.target.value))}
                      >
                        <option value="0.6">60%</option>
                        <option value="0.7">70%</option>
                        <option value="0.85">85%</option>
                        <option value="1">100%</option>
                      </select>
                    </label>
                  </>
                ) : undefined
              }
            />
          </div>

          <DialogFooter className="px-6 py-4 border-t">
            <div className="flex-1 flex items-center gap-3">
              {!onPreviewWithOverride && onPreview && (
                <Button variant="outline" onClick={onPreview}>
                  Preview Module
                </Button>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => setIsUxEditorOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveUxSchema}>
              Save UX Definition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Data Schema Editor Dialog */}
      <Dialog open={isDataSchemaEditorOpen} onOpenChange={setIsDataSchemaEditorOpen}>
        <DialogContent size="full" className="h-[86vh] max-h-[86vh] flex flex-col p-4">
          <DialogHeader>
            <DialogTitle>Manage Data Structure</DialogTitle>
            <DialogDescription>
              Edit the schema fields. Changes will affect how data is structured.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden">
            <JsonSchemaEditor
              value={draftDataSchema ?? dataSchemaToJsonSchema(dataSchema)}
              onChange={setDraftDataSchema}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDraftDataSchema(null);
                setIsDataSchemaEditorOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // TODO: Apply schema changes to module data
                // For now just close - we'll implement data migration in next iteration
                setDraftDataSchema(null);
                setIsDataSchemaEditorOpen(false);
              }}
            >
              Save Structure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// Main Node Component
// =============================================================================

function UserSelectNodeComponent({ id, data }: NodeProps) {
  const {
    module,
    onModuleChange,
    expanded,
    onExpandedChange,
    onViewState,
    onPreview,
    onPreviewWithOverride,
    runtimePreview,
  } = data as unknown as UserSelectNodeData;
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
      <Handle type="target" position={Position.Top} id="in" className="!bg-primary" />
      
      {expanded ? (
        <ExpandedView
          module={module}
          onChange={onModuleChange}
          onCollapse={handleCollapse}
          onViewState={onViewState}
          onPreview={onPreview}
          onPreviewWithOverride={onPreviewWithOverride}
          runtimePreview={runtimePreview}
        />
      ) : (
        <CollapsedView
          module={module}
          onExpand={handleExpand}
          onViewState={onViewState}
          onPreview={onPreview}
        />
      )}

      <Handle type="source" position={Position.Bottom} id="out" className="!bg-primary" />
    </div>
  );
}

export const UserSelectNode = memo(UserSelectNodeComponent);
