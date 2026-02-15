/**
 * Custom ReactFlow node for api.llm module.
 *
 * Features:
 * - Collapsed state: Shows module summary (name, provider, input/output summary)
 * - Expanded state: Shows configuration details with prompt editor
 */

import { memo, useRef, useCallback, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Label,
} from "@wfm/shared";
import {
  type LLMModule,
  type SystemMessageItem,
  type InputContent,
  getInputSummary,
  getOutputSchemaSummary,
  isContentRef,
} from "./types";
import { PromptEditor, type StateVariable } from "@/components/prompt-editor";

// =============================================================================
// Types
// =============================================================================

export type LLMNodeData = {
  module: LLMModule;
  onModuleChange: (module: LLMModule) => void;
  /** Whether this module is expanded */
  expanded: boolean;
  /** Callback when expanded state changes */
  onExpandedChange: (expanded: boolean) => void;
  /** Callback to view state up to this module (runs module, opens state panel) */
  onViewState?: () => void;
};

// =============================================================================
// Constants
// =============================================================================

/** Width of module (same for collapsed and expanded) */
export const MODULE_WIDTH = 340;

// =============================================================================
// Helpers
// =============================================================================

function getProviderDisplay(provider: string | undefined): string {
  const providers: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
  };
  return providers[provider ?? "openai"] ?? provider ?? "OpenAI";
}

function getModelDisplay(model: string | undefined): string {
  if (!model) return "default";
  // Shorten common model names
  if (model.startsWith("gpt-")) return model;
  if (model.startsWith("claude-")) return model.replace("claude-", "claude ");
  return model;
}

// =============================================================================
// Collapsed View
// =============================================================================

function CollapsedView({
  module,
  onExpand,
  onViewState,
}: {
  module: LLMModule;
  onExpand: () => void;
  onViewState?: () => void;
}) {
  const provider = module.inputs.provider ?? "openai";
  const model = module.inputs.ai_config?.model ?? module.inputs.model;

  return (
    <div className="relative w-[340px] rounded-lg border-2 border-purple-500/50 bg-card shadow-sm">
      {/* API Badge */}
      <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-500 text-white shadow-sm">
        LLM
      </div>

      {/* Header - matches expanded CardHeader layout */}
      <div className="flex items-start justify-between gap-2 p-3 pb-2">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            api.llm
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

      {/* Content - clickable area to expand */}
      <div
        className="px-3 pb-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onExpand}
      >
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{getProviderDisplay(provider)}</span>
          <span>•</span>
          <span>{getModelDisplay(model)}</span>
        </div>

        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          <div className="flex justify-between">
            <span>Input:</span>
            <span className="text-foreground/70 truncate max-w-[180px]">
              {getInputSummary(module.inputs.input)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Output:</span>
            <span className="text-foreground/70 truncate max-w-[180px]">
              {getOutputSchemaSummary(module.inputs.output_schema)}
            </span>
          </div>
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
  stateVariables,
}: {
  module: LLMModule;
  onChange: (module: LLMModule) => void;
  onCollapse: () => void;
  onViewState?: () => void;
  stateVariables: StateVariable[];
}) {
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);
  
  const provider = module.inputs.provider ?? "openai";
  const model = module.inputs.ai_config?.model ?? module.inputs.model;

  const updateInputs = (patch: Partial<LLMModule["inputs"]>) => {
    onChange({
      ...module,
      inputs: { ...module.inputs, ...patch },
    });
  };

  const handlePromptsSave = (
    system: SystemMessageItem[],
    input: InputContent
  ) => {
    updateInputs({
      system: system.length > 0 ? system : undefined,
      input,
    });
  };

  // Count prompts for summary
  const systemCount = Array.isArray(module.inputs.system)
    ? module.inputs.system.length
    : module.inputs.system
    ? 1
    : 0;
  const inputCount = Array.isArray(module.inputs.input)
    ? module.inputs.input.length
    : module.inputs.input
    ? 1
    : 0;

  return (
    <>
      <Card className="relative w-[340px] shadow-lg border-2 border-purple-500/50">
        {/* API Badge */}
        <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-500 text-white shadow-sm z-10">
          LLM
        </div>

        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              api.llm
            </p>
            <input
              className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full"
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
          {/* Provider & Model */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Provider & Model</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Provider</span>
                <select
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                  value={provider}
                  onChange={(e) => updateInputs({ provider: e.target.value })}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Model</span>
                <input
                  className="w-full rounded border bg-background px-2 py-1 text-xs"
                  value={model ?? ""}
                  onChange={(e) => updateInputs({ model: e.target.value || undefined })}
                  placeholder="default"
                />
              </div>
            </div>
          </div>

          {/* Prompts - Combined section */}
          <div className="rounded-md border p-2 space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Prompts</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => setIsPromptEditorOpen(true)}
              >
                Edit
              </Button>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>{systemCount} system</span>
              <span>•</span>
              <span>{inputCount} user</span>
            </div>
            <p className="text-[10px] text-muted-foreground/70 truncate">
              {getInputSummary(module.inputs.input)}
            </p>
          </div>

          {/* Output Schema */}
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Output Schema</Label>
            <p className="text-xs text-muted-foreground">
              {getOutputSchemaSummary(module.inputs.output_schema)}
            </p>
            {isContentRef(module.inputs.output_schema) && (
              <p className="text-[10px] text-muted-foreground/70 font-mono">
                {module.inputs.output_schema.$ref}
              </p>
            )}
          </div>

          {/* Outputs */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Outputs to State</Label>
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground">response</span>
              <input
                className="w-full rounded border bg-background px-2 py-1 text-xs"
                value={module.outputs_to_state.response}
                onChange={(e) =>
                  onChange({
                    ...module,
                    outputs_to_state: {
                      ...module.outputs_to_state,
                      response: e.target.value,
                    },
                  })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Prompt Editor Dialog */}
      <PromptEditor
        open={isPromptEditorOpen}
        onOpenChange={setIsPromptEditorOpen}
        system={module.inputs.system}
        input={module.inputs.input}
        stateVariables={stateVariables}
        onSave={handlePromptsSave}
      />
    </>
  );
}

// =============================================================================
// Main Node Component
// =============================================================================

function LLMNodeComponent({ id, data }: NodeProps) {
  const { module, onModuleChange, expanded, onExpandedChange, onViewState } =
    data as unknown as LLMNodeData;
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
          stateVariables={[]}  // TODO: Pass actual state variables from workflow context
        />
      ) : (
        <CollapsedView module={module} onExpand={handleExpand} onViewState={onViewState} />
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

export const LLMNode = memo(LLMNodeComponent);
