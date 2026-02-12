/**
 * Custom ReactFlow node for media.generate module.
 *
 * Features:
 * - Collapsed state: Shows module summary (name, action type, provider count)
 * - Expanded state: Action type selector + two editor buttons
 * - Configure Providers dialog: Tab-based editor for provider schemas
 * - Configure Layout dialog: Overall display layout editor (placeholder)
 */

import { useState, memo, useEffect, useRef, useCallback, useMemo } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Input,
} from "@wfm/shared";
import { Trash2, Settings, Layout } from "lucide-react";
import Editor from "@monaco-editor/react";
import {
  type MediaGenerateModule,
  type ActionType,
  type ProviderInstance,
  type ProviderId,
  PROVIDERS_BY_ACTION,
  PROVIDER_LABELS,
  ACTION_TYPE_LABELS,
  isJsonRefObject,
  extractProvidersFromSchema,
  buildSchemaFromProviders,
  createDefaultProviderInstance,
} from "./types";
import {
  getModuleSummary,
  getPromptsSummary,
  getSchemaSummary,
} from "./presentation";

// =============================================================================
// Types
// =============================================================================

export type MediaGenerateNodeData = {
  module: MediaGenerateModule;
  onModuleChange: (module: MediaGenerateModule) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean, estimatedHeight: number) => void;
  onViewState?: () => void;
  onPreview?: () => void;
  /** Load preview data by running previous module */
  onLoadPreviewData?: () => Promise<Record<string, unknown> | null>;
};

// =============================================================================
// Constants
// =============================================================================

export const MODULE_HEIGHT_COLLAPSED = 120;
export const MODULE_HEIGHT_EXPANDED = 380;
export const MODULE_WIDTH = 340;

// =============================================================================
// Provider Tab Component
// =============================================================================

function ProviderTab({
  instance,
  isActive,
  onClick,
  onRemove,
  onLabelChange,
}: {
  instance: ProviderInstance;
  isActive: boolean;
  onClick: () => void;
  onRemove: () => void;
  onLabelChange: (label: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState(instance.tabLabel);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditLabel(instance.tabLabel);
  };

  const handleBlur = () => {
    setIsEditing(false);
    if (editLabel.trim() && editLabel !== instance.tabLabel) {
      onLabelChange(editLabel.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleBlur();
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditLabel(instance.tabLabel);
    }
  };

  return (
    <div
      className={`
        flex items-center gap-1 px-3 py-2 cursor-pointer border-b-2 transition-colors
        ${isActive ? "border-primary bg-muted/50" : "border-transparent hover:bg-muted/30"}
      `}
      onClick={onClick}
    >
      {isEditing ? (
        <input
          className="w-24 px-1 py-0.5 text-sm bg-background border rounded"
          value={editLabel}
          onChange={(e) => setEditLabel(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="text-sm font-medium"
          onDoubleClick={handleDoubleClick}
        >
          {instance.tabLabel}
        </span>
      )}
      <button
        className="ml-1 p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// =============================================================================
// Provider Schema Editor Dialog
// =============================================================================

function ProviderSchemaEditorDialog({
  open,
  onOpenChange,
  providers,
  onProvidersChange,
  actionType,
  onLoadPreviewData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ProviderInstance[];
  onProvidersChange: (providers: ProviderInstance[]) => void;
  actionType: ActionType;
  onLoadPreviewData?: () => Promise<Record<string, unknown> | null>;
}) {
  const [localProviders, setLocalProviders] = useState<ProviderInstance[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Initialize local state when dialog opens
  useEffect(() => {
    if (open) {
      setLocalProviders(providers);
      setActiveTabId(providers[0]?.id || null);
      setPreviewData(null); // Reset preview data when dialog opens
    }
  }, [open, providers]);

  const handleLoadData = async () => {
    if (!onLoadPreviewData) return;
    setIsLoadingData(true);
    try {
      const data = await onLoadPreviewData();
      console.log("[MediaGenerate] Loaded preview data:", data);
      setPreviewData(data);
    } catch (error) {
      console.error("Failed to load preview data:", error);
    } finally {
      setIsLoadingData(false);
    }
  };

  const activeProvider = localProviders.find((p) => p.id === activeTabId);
  const availableProviders = PROVIDERS_BY_ACTION[actionType];

  const handleAddProvider = (providerId: ProviderId) => {
    const newInstance = createDefaultProviderInstance(providerId, actionType);
    setLocalProviders([...localProviders, newInstance]);
    setActiveTabId(newInstance.id);
  };

  const handleRemoveProvider = (id: string) => {
    const newProviders = localProviders.filter((p) => p.id !== id);
    setLocalProviders(newProviders);
    if (activeTabId === id) {
      setActiveTabId(newProviders[0]?.id || null);
    }
  };

  const handleLabelChange = (id: string, label: string) => {
    setLocalProviders(
      localProviders.map((p) => (p.id === id ? { ...p, tabLabel: label } : p))
    );
  };

  const handleSchemaChange = (id: string, schemaJson: string) => {
    try {
      const parsed = JSON.parse(schemaJson);
      setLocalProviders(
        localProviders.map((p) =>
          p.id === id
            ? {
                ...p,
                schema: {
                  ...p.schema,
                  _ux: {
                    ...p.schema._ux,
                    input_schema: parsed,
                  },
                },
              }
            : p
        )
      );
    } catch {
      // Invalid JSON, ignore
    }
  };

  const handleSave = () => {
    onProvidersChange(localProviders);
    onOpenChange(false);
  };

  const inputSchemaJson = activeProvider?.schema._ux?.input_schema
    ? JSON.stringify(activeProvider.schema._ux.input_schema, null, 2)
    : "{}";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="full"
        className="h-[90vh] max-h-[90vh] flex flex-col p-0"
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>Configure Providers</DialogTitle>
          <DialogDescription>
            Add providers and configure their input schemas. Double-click tab
            labels to rename.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col px-6">
          {/* Tabs header */}
          <div className="flex items-center border-b">
            <div className="flex-1 flex overflow-x-auto">
              {localProviders.map((instance) => (
                <ProviderTab
                  key={instance.id}
                  instance={instance}
                  isActive={instance.id === activeTabId}
                  onClick={() => setActiveTabId(instance.id)}
                  onRemove={() => handleRemoveProvider(instance.id)}
                  onLabelChange={(label) =>
                    handleLabelChange(instance.id, label)
                  }
                />
              ))}
            </div>

            {/* Add provider dropdown */}
            <div className="relative ml-2">
              <select
                className="h-8 px-2 pr-6 text-sm border rounded bg-background cursor-pointer"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleAddProvider(e.target.value as ProviderId);
                  }
                }}
              >
                <option value="">+ Add Provider</option>
                {availableProviders.map((providerId) => (
                  <option key={providerId} value={providerId}>
                    {PROVIDER_LABELS[providerId]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tab content - vertical stack 50/50 */}
          {activeProvider ? (
            <div className="flex-1 min-h-0 flex flex-col gap-4 py-4 overflow-hidden">
              {/* Top: UX Preview - 50% */}
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-sm font-medium">UX Preview</Label>
                  {onLoadPreviewData && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={handleLoadData}
                      disabled={isLoadingData}
                    >
                      {isLoadingData ? "Loading..." : "Load Data"}
                    </Button>
                  )}
                </div>
                <div className="flex-1 min-h-0 border rounded bg-muted/30 p-4 overflow-auto">
                  <SchemaPreview
                    inputSchema={activeProvider.schema._ux?.input_schema}
                    previewData={previewData}
                    providerKey={activeProvider.provider}
                  />
                </div>
              </div>

              {/* Bottom: Schema JSON editor - 50% */}
              <div className="flex-1 min-h-0 flex flex-col">
                <Label className="mb-2 text-sm font-medium">
                  Input Schema (JSON)
                </Label>
                <div className="flex-1 min-h-0 border rounded overflow-hidden">
                  <Editor
                    height="100%"
                    language="json"
                    theme="vs-dark"
                    value={inputSchemaJson}
                    onChange={(value) =>
                      handleSchemaChange(activeProvider.id, value ?? "{}")
                    }
                    options={{
                      minimap: { enabled: false },
                      fontSize: 12,
                      lineNumbers: "on",
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                      wordWrap: "on",
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <p>No providers configured</p>
                <p className="text-sm mt-1">
                  Click "Add Provider" to get started
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Providers</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Schema Preview Component
// =============================================================================

function SchemaPreview({
  inputSchema,
  previewData,
  providerKey,
}: {
  inputSchema?: Record<string, unknown>;
  previewData?: Record<string, unknown> | null;
  providerKey?: string;
}) {
  if (!inputSchema) {
    return (
      <p className="text-sm text-muted-foreground">No input schema defined</p>
    );
  }

  const properties = inputSchema.properties as
    | Record<string, Record<string, unknown>>
    | undefined;

  if (!properties || Object.keys(properties).length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No fields in input schema
      </p>
    );
  }

  // Extract provider-specific data from previewData
  // State structure varies - could be:
  // 1. Direct: { prompts: { midjourney: {...} } } 
  // 2. From state_mapped: { image_prompts: { prompts: { midjourney: {...} } } }
  // We need to find the provider data by searching through the structure
  let providerData: Record<string, unknown> | undefined;
  
  if (previewData && providerKey) {
    // Try to find provider data in various locations
    const findProviderData = (obj: Record<string, unknown>): Record<string, unknown> | undefined => {
      // Check if this object has 'prompts' with our provider
      if (obj.prompts && typeof obj.prompts === 'object') {
        const prompts = obj.prompts as Record<string, unknown>;
        if (prompts[providerKey] && typeof prompts[providerKey] === 'object') {
          return prompts[providerKey] as Record<string, unknown>;
        }
      }
      // Check direct provider key
      if (obj[providerKey] && typeof obj[providerKey] === 'object') {
        return obj[providerKey] as Record<string, unknown>;
      }
      // Search one level deep in state_mapped values
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const found = findProviderData(value as Record<string, unknown>);
          if (found) return found;
        }
      }
      return undefined;
    };
    
    providerData = findProviderData(previewData);
    console.log("[SchemaPreview] Provider data for", providerKey, ":", providerData);
  }

  return (
    <div className="space-y-3">
      {previewData && !providerData && (
        <div className="text-xs text-amber-500 mb-2">
          <p>No data found for provider "{providerKey}"</p>
          <p className="text-muted-foreground mt-1">
            Available keys: {Object.keys(previewData).join(", ")}
          </p>
        </div>
      )}
      {Object.entries(properties).map(([key, field]) => (
        <PreviewField
          key={key}
          fieldKey={key}
          field={field}
          value={providerData?.[key]}
        />
      ))}
    </div>
  );
}

function PreviewField({
  fieldKey,
  field,
  value,
}: {
  fieldKey: string;
  field: Record<string, unknown>;
  value?: unknown;
}) {
  const ux = field._ux as Record<string, unknown> | undefined;
  const inputType = ux?.input_type || "text";
  const title = (field.title as string) || fieldKey;
  const colSpan = ux?.col_span;
  const sourceField = ux?.source_field as string | undefined;

  // Get display value - check source_field mapping
  const displayValue = value !== undefined
    ? String(value)
    : sourceField
      ? `[from ${sourceField}]`
      : undefined;

  const wrapperClass = colSpan === "full" ? "col-span-full" : "";

  return (
    <div className={`space-y-1 ${wrapperClass}`}>
      <label className="text-xs font-medium text-muted-foreground">
        {title}
      </label>
      {inputType === "textarea" ? (
        <div className="w-full min-h-16 rounded border bg-background px-2 py-1 text-xs whitespace-pre-wrap">
          {displayValue || <span className="text-muted-foreground">Textarea field</span>}
        </div>
      ) : inputType === "select" ? (
        <div className="w-full h-8 rounded border bg-background px-2 py-1 text-xs flex items-center">
          {displayValue || <span className="text-muted-foreground">Select dropdown</span>}
        </div>
      ) : inputType === "slider" ? (
        <div className="w-full h-8 rounded border bg-background px-2 py-1 flex items-center gap-2">
          <div className="flex-1 h-1 bg-muted rounded-full">
            <div className="w-1/3 h-full bg-primary rounded-full" />
          </div>
          {displayValue && <span className="text-xs">{displayValue}</span>}
        </div>
      ) : (
        <div className="w-full h-8 rounded border bg-background px-2 py-1 text-xs flex items-center">
          {displayValue || <span className="text-muted-foreground">Text input</span>}
        </div>
      )}
    </div>
  );
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
  module: MediaGenerateModule;
  onExpand: () => void;
  onViewState?: () => void;
  onPreview?: () => void;
}) {
  const summary = getModuleSummary(module);

  return (
    <div className="relative w-[340px] rounded-lg border-2 border-pink-500/50 bg-card shadow-sm">
      {/* Module Type Badge */}
      <div
        className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px]
                    font-medium bg-pink-500 text-white shadow-sm"
      >
        Media
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            media.generate
          </p>
          <h3 className="text-sm font-semibold truncate">{module.name}</h3>
        </div>
        <div className="flex items-center gap-1">
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
        </div>
      </div>

      {/* Content */}
      <div
        className="px-3 pb-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onExpand}
      >
        <p className="text-xs text-muted-foreground">{summary}</p>
        <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>Prompts: {getPromptsSummary(module)}</span>
        </div>
      </div>
    </div>
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
  onPreview,
  onLoadPreviewData,
}: {
  module: MediaGenerateModule;
  onChange: (module: MediaGenerateModule) => void;
  onCollapse: () => void;
  onViewState?: () => void;
  onPreview?: () => void;
  onLoadPreviewData?: () => Promise<Record<string, unknown> | null>;
}) {
  const [isProviderEditorOpen, setIsProviderEditorOpen] = useState(false);
  const [isLayoutEditorOpen, setIsLayoutEditorOpen] = useState(false);

  const actionType = module.inputs.action_type || "txt2img";
  const hasInlineSchema = !isJsonRefObject(module.inputs.schema);

  // Extract providers from current schema
  const providers = useMemo(() => {
    if (hasInlineSchema) {
      return extractProvidersFromSchema(
        module.inputs.schema as Record<string, unknown>
      );
    }
    return [];
  }, [module.inputs.schema, hasInlineSchema]);

  const handleActionTypeChange = (newActionType: ActionType) => {
    onChange({
      ...module,
      inputs: {
        ...module.inputs,
        action_type: newActionType,
      },
    });
  };

  const handleProvidersChange = (newProviders: ProviderInstance[]) => {
    const newSchema = buildSchemaFromProviders(
      newProviders,
      hasInlineSchema
        ? (module.inputs.schema as Record<string, unknown>)
        : undefined
    );

    onChange({
      ...module,
      inputs: {
        ...module.inputs,
        schema: newSchema,
      },
    });
  };

  const updateOutputs = (key: keyof MediaGenerateModule["outputs_to_state"], value: string) => {
    onChange({
      ...module,
      outputs_to_state: {
        ...module.outputs_to_state,
        [key]: value,
      },
    });
  };

  return (
    <>
      <Card className="relative w-[340px] shadow-lg border-2 border-pink-500/50">
        {/* Module Type Badge */}
        <div
          className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px]
                      font-medium bg-pink-500 text-white shadow-sm z-10"
        >
          Media
        </div>

        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              media.generate
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
          <div className="flex items-center gap-1">
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
          </div>
        </CardHeader>

        <CardContent className="space-y-3" onClick={(e) => e.stopPropagation()}>
          {/* Action Type */}
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Action Type</Label>
            <div className="flex rounded border bg-background p-0.5 text-xs">
              {(["txt2img", "img2vid", "txt2audio"] as ActionType[]).map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    className={`
                      flex-1 rounded px-2 py-1 transition-colors text-center
                      ${actionType === type ? "bg-primary text-primary-foreground" : "hover:bg-muted"}
                    `}
                    onClick={() => handleActionTypeChange(type)}
                  >
                    {ACTION_TYPE_LABELS[type].split(" ")[0]}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Title */}
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Title</Label>
            <Input
              className="h-8 text-xs"
              value={module.inputs.title || ""}
              onChange={(e) =>
                onChange({
                  ...module,
                  inputs: { ...module.inputs, title: e.target.value },
                })
              }
              placeholder="Generate Media"
            />
          </div>

          {/* Schema Editors */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Schema Configuration</Label>
            <p className="text-[10px] text-muted-foreground">
              {getSchemaSummary(module)} - {providers.length} provider(s)
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8 text-xs"
                onClick={() => setIsProviderEditorOpen(true)}
                disabled={!hasInlineSchema}
              >
                <Settings className="h-3 w-3 mr-1" />
                Providers
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8 text-xs"
                onClick={() => setIsLayoutEditorOpen(true)}
                disabled={!hasInlineSchema}
              >
                <Layout className="h-3 w-3 mr-1" />
                Layout
              </Button>
            </div>
          </div>

          {/* Outputs */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Outputs to State</Label>
            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  selected_content_id
                </span>
                <Input
                  className="h-7 text-xs"
                  value={module.outputs_to_state.selected_content_id}
                  onChange={(e) =>
                    updateOutputs("selected_content_id", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  selected_content
                </span>
                <Input
                  className="h-7 text-xs"
                  value={module.outputs_to_state.selected_content}
                  onChange={(e) =>
                    updateOutputs("selected_content", e.target.value)
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  generations
                </span>
                <Input
                  className="h-7 text-xs"
                  value={module.outputs_to_state.generations}
                  onChange={(e) =>
                    updateOutputs("generations", e.target.value)
                  }
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Provider Schema Editor Dialog */}
      <ProviderSchemaEditorDialog
        open={isProviderEditorOpen}
        onOpenChange={setIsProviderEditorOpen}
        providers={providers}
        onProvidersChange={handleProvidersChange}
        actionType={actionType}
        onLoadPreviewData={onLoadPreviewData}
      />

      {/* Layout Editor Dialog (placeholder) */}
      <Dialog open={isLayoutEditorOpen} onOpenChange={setIsLayoutEditorOpen}>
        <DialogContent size="full" className="h-[90vh] max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Configure Layout</DialogTitle>
            <DialogDescription>
              Configure how providers are rendered together. (Coming soon)
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <p>Layout editor will be implemented in a future update.</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setIsLayoutEditorOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// Main Node Component
// =============================================================================

function MediaGenerateNodeComponent({ id, data }: NodeProps) {
  const {
    module,
    onModuleChange,
    expanded,
    onExpandedChange,
    onViewState,
    onPreview,
    onLoadPreviewData,
  } = data as unknown as MediaGenerateNodeData;
  const updateNodeInternals = useUpdateNodeInternals();
  const containerRef = useRef<HTMLDivElement>(null);

  useReportNodeHeight(id, containerRef);

  useEffect(() => {
    const timer = setTimeout(() => {
      updateNodeInternals(id);
    }, 50);
    return () => clearTimeout(timer);
  }, [expanded, id, updateNodeInternals]);

  const handleExpand = useCallback(() => {
    onExpandedChange(true, MODULE_HEIGHT_EXPANDED);
  }, [onExpandedChange]);

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
        <ExpandedView
          module={module}
          onChange={onModuleChange}
          onCollapse={handleCollapse}
          onViewState={onViewState}
          onPreview={onPreview}
          onLoadPreviewData={onLoadPreviewData}
        />
      ) : (
        <CollapsedView
          module={module}
          onExpand={handleExpand}
          onViewState={onViewState}
          onPreview={onPreview}
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

export const MediaGenerateNode = memo(MediaGenerateNodeComponent);
