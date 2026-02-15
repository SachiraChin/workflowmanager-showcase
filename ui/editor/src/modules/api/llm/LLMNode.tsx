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
  Label,
} from "@wfm/shared";
import { ModuleNodeShell } from "@/components/module-node/ModuleNodeShell";
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
    <ModuleNodeShell
      expanded={false}
      borderClass="border-purple-500/50"
      badgeText="LLM"
      badgeClass="bg-purple-500"
      moduleId="api.llm"
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
      <ModuleNodeShell
        expanded
        borderClass="border-purple-500/50"
        badgeText="LLM"
        badgeClass="bg-purple-500"
        moduleId="api.llm"
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
          {/* Provider & Model */}
          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Provider & Model</Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">Provider</span>
                <select
                  className="ui-control-compact w-full"
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
                  className="ui-control-compact w-full"
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
                className="ui-control-compact w-full"
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
        </div>
      </ModuleNodeShell>

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
