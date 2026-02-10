/**
 * Custom ReactFlow node for user.select module.
 * 
 * Features:
 * - Collapsed state: Shows module summary (name, prompt, data count)
 * - Expanded state: Shows full configuration form inline
 * - Integrates UxSchemaEditor for display schema editing
 */

import { useState, useMemo, memo, useEffect, useRef, useCallback } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
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
  Textarea,
  type SchemaProperty,
} from "@wfm/shared";
import {
  UxSchemaEditor,
  type DataSchemaNode,
} from "@/components/ux-schema-editor";
import {
  JsonSchemaEditor,
  type JsonSchemaObject,
} from "@/components/JsonSchemaEditor";
import {
  type UserSelectModule,
  isJsonRefObject,
} from "@/modules/user-select/types";

// =============================================================================
// Types
// =============================================================================

export type UserSelectNodeData = {
  module: UserSelectModule;
  onModuleChange: (module: UserSelectModule) => void;
  /** Whether this module is expanded */
  expanded: boolean;
  /** Callback when expanded state changes (includes estimated height for layout) */
  onExpandedChange: (expanded: boolean, estimatedHeight: number) => void;
};

// =============================================================================
// Constants
// =============================================================================

/** Height of module when collapsed */
export const MODULE_HEIGHT_COLLAPSED = 120;
/** Height of module when expanded */
export const MODULE_HEIGHT_EXPANDED = 620;
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
}: {
  module: UserSelectModule;
  onExpand: () => void;
}) {
  return (
    <div className="relative w-[340px] rounded-lg border-2 border-amber-500/50 bg-card shadow-sm">
      {/* User Interaction Badge */}
      <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500 text-white shadow-sm">
        User Input
      </div>

      {/* Header - matches expanded CardHeader layout */}
      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            user.select
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
    </div>
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
}: {
  module: UserSelectModule;
  onChange: (module: UserSelectModule) => void;
  onCollapse: () => void;
}) {
  const [isUxEditorOpen, setIsUxEditorOpen] = useState(false);
  const [isDataSchemaEditorOpen, setIsDataSchemaEditorOpen] = useState(false);
  const [draftSchema, setDraftSchema] = useState<SchemaProperty | undefined>(undefined);
  const [draftDataSchema, setDraftDataSchema] = useState<JsonSchemaObject | null>(null);

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
    setIsUxEditorOpen(true);
  };

  const handleSaveUxSchema = () => {
    if (draftSchema) {
      updateInputs({ schema: draftSchema });
    }
    setIsUxEditorOpen(false);
  };

  return (
    <>
      <Card className="relative w-[340px] shadow-lg border-2 border-amber-500/50">
        {/* User Interaction Badge */}
        <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-amber-500 text-white shadow-sm z-10">
          User Input
        </div>

        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              user.select
            </p>
            <input
              className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full"
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
              <div className="flex rounded border bg-background p-0.5 text-xs">
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
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
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
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
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
        </CardContent>
      </Card>

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
              onChange={setDraftSchema}
            />
          </div>

          <DialogFooter className="px-6 py-4 border-t">
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
  const { module, onModuleChange, expanded, onExpandedChange } = data as unknown as UserSelectNodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const containerRef = useRef<HTMLDivElement>(null);

  // Report height changes to parent for layout calculations
  useReportNodeHeight(id, containerRef);

  // Notify ReactFlow when node size changes (expand/collapse)
  useEffect(() => {
    // Small delay to allow DOM to update before measuring
    const timer = setTimeout(() => {
      updateNodeInternals(id);
    }, 50);
    return () => clearTimeout(timer);
  }, [expanded, id, updateNodeInternals]);

  // Handlers that include estimated height for synchronous layout update
  const handleExpand = useCallback(() => {
    onExpandedChange(true, MODULE_HEIGHT_EXPANDED);
  }, [onExpandedChange]);

  const handleCollapse = useCallback(() => {
    onExpandedChange(false, MODULE_HEIGHT_COLLAPSED);
  }, [onExpandedChange]);

  return (
    <div ref={containerRef} className="relative">
      <Handle type="target" position={Position.Top} id="in" className="!bg-primary" />
      
      {expanded ? (
        <ExpandedView
          module={module}
          onChange={onModuleChange}
          onCollapse={handleCollapse}
        />
      ) : (
        <CollapsedView
          module={module}
          onExpand={handleExpand}
        />
      )}

      <Handle type="source" position={Position.Bottom} id="out" className="!bg-primary" />
    </div>
  );
}

export const UserSelectNode = memo(UserSelectNodeComponent);
