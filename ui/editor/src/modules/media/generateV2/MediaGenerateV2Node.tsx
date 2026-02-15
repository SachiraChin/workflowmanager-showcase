import { memo, useCallback, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import {
  PromptEditor,
  type PromptEditorStructuredConfig,
  type StateVariable,
} from "@/components/prompt-editor";
import {
  Button,
  Input,
  Label,
} from "@wfm/shared";
import { ModuleNodeShell } from "@/components/module-node/ModuleNodeShell";
import {
  ACTION_TYPE_LABELS,
  PROVIDERS_BY_ACTION,
  PROVIDER_LABELS,
  SHARED_PROMPT_REF_TOKEN,
  type ActionType,
  type MediaGenerateV2Module,
  type ProviderId,
} from "./types";
import type {
  ContentRef,
  InputContent,
  SystemMessageItem,
} from "@/modules/api/llm";

export type MediaGenerateV2NodeData = {
  module: MediaGenerateV2Module;
  onModuleChange: (module: MediaGenerateV2Module) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onViewState?: () => void;
  onPreview?: () => void;
};

function getSharedPrompt(module: MediaGenerateV2Module): string {
  return getPromptText(module.inputs.prompt_config.shared_prompt);
}

function getPromptText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if ("$ref" in value && typeof (value as { $ref?: unknown }).$ref === "string") {
      return (value as { $ref: string }).$ref;
    }
    if (
      "content" in value &&
      typeof (value as { content?: unknown }).content === "string"
    ) {
      return (value as { content: string }).content;
    }
  }
  return "";
}

function getUserInputContent(value: unknown): InputContent {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof (value as { $ref?: unknown }).$ref === "string"
  ) {
    return value as ContentRef;
  }
  return getPromptText(value);
}

function CollapsedView({
  module,
  onExpand,
  onViewState,
  onPreview,
}: {
  module: MediaGenerateV2Module;
  onExpand: () => void;
  onViewState?: () => void;
  onPreview?: () => void;
}) {
  return (
    <ModuleNodeShell
      expanded={false}
      borderClass="border-rose-500/50"
      badgeText="Media"
      badgeClass="bg-rose-500"
      moduleId="media.generateV2"
      title={<p className="truncate text-sm font-semibold">{module.name}</p>}
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
      onContainerClick={onExpand}
      onBodyClick={onExpand}
      bodyClassName="space-y-1 text-xs text-muted-foreground"
    >
      <div>
        <p>{ACTION_TYPE_LABELS[module.inputs.action_type]}</p>
        <p>{module.inputs.providers.length} provider(s)</p>
      </div>
    </ModuleNodeShell>
  );
}

function ExpandedView({
  module,
  onChange,
  onCollapse,
  onViewState,
  onPreview,
}: {
  module: MediaGenerateV2Module;
  onChange: (module: MediaGenerateV2Module) => void;
  onCollapse: () => void;
  onViewState?: () => void;
  onPreview?: () => void;
}) {
  const [isPromptEditorOpen, setIsPromptEditorOpen] = useState(false);

  const actionType = module.inputs.action_type;
  const availableProviders = PROVIDERS_BY_ACTION[actionType];

  const updateInputs = (patch: Partial<MediaGenerateV2Module["inputs"]>) => {
    onChange({ ...module, inputs: { ...module.inputs, ...patch } });
  };

  const updateOutputs = (key: keyof MediaGenerateV2Module["outputs_to_state"], value: string) => {
    onChange({
      ...module,
      outputs_to_state: {
        ...module.outputs_to_state,
        [key]: value,
      },
    });
  };

  const handleActionTypeChange = (next: ActionType) => {
    const allowed = new Set(PROVIDERS_BY_ACTION[next]);
    const filteredProviders = module.inputs.providers.filter((p) => allowed.has(p));
    const nextProviders = filteredProviders.length > 0 ? filteredProviders : [PROVIDERS_BY_ACTION[next][0]];
    const nextPromptMap = { ...(module.inputs.prompt_config.provider_prompts || {}) };
    for (const key of Object.keys(nextPromptMap) as ProviderId[]) {
      if (!nextProviders.includes(key)) {
        delete nextPromptMap[key];
      }
    }

    updateInputs({
      action_type: next,
      providers: nextProviders,
      prompt_config: {
        ...module.inputs.prompt_config,
        provider_prompts: nextPromptMap,
      },
    });
  };

  const handleProviderToggle = (provider: ProviderId) => {
    const has = module.inputs.providers.includes(provider);
    let nextProviders: ProviderId[];
    if (has) {
      nextProviders = module.inputs.providers.filter((p) => p !== provider);
      if (nextProviders.length === 0) return;
    } else {
      nextProviders = [...module.inputs.providers, provider];
    }

    const nextPromptMap = { ...(module.inputs.prompt_config.provider_prompts || {}) };
    if (!has && !nextPromptMap[provider]) {
      nextPromptMap[provider] = `Use ${SHARED_PROMPT_REF_TOKEN}.`;
    }
    if (has) {
      delete nextPromptMap[provider];
    }

    updateInputs({
      providers: nextProviders,
      prompt_config: {
        ...module.inputs.prompt_config,
        provider_prompts: nextPromptMap,
      },
    });
  };

  const structuredConfig: PromptEditorStructuredConfig = {
    title: "Suggested Prompt Structure",
    description:
      "These fields guide media.generateV2 prompt config. You can still add any normal prompts below.",
    fields: [
      {
        key: "shared_prompt",
        label: "Shared Prompt",
        value: getSharedPrompt(module),
        inputType: "textarea",
        description:
          "Common instructions shared by all selected providers.",
      },
      ...module.inputs.providers.map((provider) => ({
        key: `provider:${provider}`,
        label: `${PROVIDER_LABELS[provider]} Prompt`,
        value: getPromptText(module.inputs.prompt_config.provider_prompts?.[provider]),
        inputType: "textarea" as const,
        defaultValue: `Use ${SHARED_PROMPT_REF_TOKEN}.`,
        description:
          "Optional provider-specific instructions. Leave empty to omit this provider block.",
      })),
    ],
  };

  return (
    <>
      <ModuleNodeShell
        expanded
        borderClass="border-rose-500/50"
        badgeText="Media"
        badgeClass="bg-rose-500"
        moduleId="media.generateV2"
        title={
          <Input
            className="h-7 w-full border-0 px-0 text-sm font-semibold"
            value={module.name}
            onChange={(e) => onChange({ ...module, name: e.target.value })}
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
        bodyClassName="space-y-3"
      >
        <div className="space-y-3">
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Action Type</Label>
            <div className="ui-segmented-track">
              {(Object.keys(ACTION_TYPE_LABELS) as ActionType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`flex-1 rounded px-2 py-1 ${actionType === type ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  onClick={() => handleActionTypeChange(type)}
                >
                  {ACTION_TYPE_LABELS[type].split(" ")[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Providers</Label>
            <div className="flex flex-wrap gap-1">
              {availableProviders.map((provider) => {
                const active = module.inputs.providers.includes(provider);
                return (
                  <button
                    key={provider}
                    type="button"
                    className={`rounded border px-2 py-1 text-[11px] ${active ? "bg-primary/15 border-primary" : "hover:bg-muted"}`}
                    onClick={() => handleProviderToggle(provider)}
                  >
                    {PROVIDER_LABELS[provider]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-md border p-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Prompt Configuration</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={() => setIsPromptEditorOpen(true)}
              >
                Edit Prompts
              </Button>
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>{module.inputs.prompt_config.system ? "System configured" : "No system prompt"}</p>
              <p>{module.inputs.prompt_config.user ? "User prompt configured" : "No user prompt"}</p>
              <p>
                {Object.values(module.inputs.prompt_config.provider_prompts || {}).filter(
                  (v) => getPromptText(v).trim().length > 0
                ).length} provider-specific prompt(s)
              </p>
            </div>
          </div>

          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Outputs to State</Label>
            <Input className="h-7 text-xs" value={module.outputs_to_state.selected_content_id} onChange={(e) => updateOutputs("selected_content_id", e.target.value)} />
            <Input className="h-7 text-xs" value={module.outputs_to_state.selected_content} onChange={(e) => updateOutputs("selected_content", e.target.value)} />
            <Input className="h-7 text-xs" value={module.outputs_to_state.generations} onChange={(e) => updateOutputs("generations", e.target.value)} />
            <Input className="h-7 text-xs" value={module.outputs_to_state.generated_prompts} onChange={(e) => updateOutputs("generated_prompts", e.target.value)} />
          </div>
        </div>
      </ModuleNodeShell>

      <PromptEditor
        open={isPromptEditorOpen}
        onOpenChange={setIsPromptEditorOpen}
        system={module.inputs.prompt_config.system}
        input={getUserInputContent(module.inputs.prompt_config.user)}
        stateVariables={[] as StateVariable[]}
        structuredConfig={structuredConfig}
        onSave={(system, input) => {
          updateInputs({
            prompt_config: {
              ...module.inputs.prompt_config,
              system,
              user: input,
            },
          });
        }}
        onStructuredSave={(values) => {
          const nextProviderPrompts: Partial<Record<ProviderId, SystemMessageItem>> = {};

          const currentProviderPrompts =
            module.inputs.prompt_config.provider_prompts || {};

          for (const provider of module.inputs.providers) {
            const value = values[`provider:${provider}`];
            const currentRaw = currentProviderPrompts[provider];
            const currentText = getPromptText(currentRaw);
            if (typeof value !== "string" || value.trim().length === 0) {
              continue;
            }

            if (currentRaw && value === currentText) {
              nextProviderPrompts[provider] = currentRaw;
            } else {
              nextProviderPrompts[provider] = value;
            }
          }

          const currentSharedRaw = module.inputs.prompt_config.shared_prompt;
          const currentSharedText = getPromptText(currentSharedRaw);
          const nextSharedValue = values.shared_prompt || "";

          updateInputs({
            prompt_config: {
              ...module.inputs.prompt_config,
              shared_prompt:
                currentSharedRaw && nextSharedValue === currentSharedText
                  ? currentSharedRaw
                  : nextSharedValue,
              provider_prompts: nextProviderPrompts,
            },
          });
        }}
      />
    </>
  );
}

function MediaGenerateV2NodeComponent({ id, data }: NodeProps) {
  const {
    module,
    onModuleChange,
    expanded,
    onExpandedChange,
    onViewState,
    onPreview,
  } = data as unknown as MediaGenerateV2NodeData;
  const containerRef = useRef<HTMLDivElement>(null);

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

export const MediaGenerateV2Node = memo(MediaGenerateV2NodeComponent);
