import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import { PromptEditor, type StateVariable } from "@/components/prompt-editor";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Label,
} from "@wfm/shared";
import {
  ACTION_TYPE_LABELS,
  PROVIDERS_BY_ACTION,
  PROVIDER_LABELS,
  SHARED_PROMPT_REF_TOKEN,
  type ActionType,
  type MediaGenerateV2Module,
  type ProviderId,
} from "./types";

export const MODULE_HEIGHT_COLLAPSED = 120;
export const MODULE_HEIGHT_EXPANDED = 460;

export type MediaGenerateV2NodeData = {
  module: MediaGenerateV2Module;
  onModuleChange: (module: MediaGenerateV2Module) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean, estimatedHeight: number) => void;
  onViewState?: () => void;
  onPreview?: () => void;
};

function CollapsedView({
  module,
  onExpand,
}: {
  module: MediaGenerateV2Module;
  onExpand: () => void;
}) {
  return (
    <Card className="w-[340px] shadow-lg border-2 border-rose-500/50 cursor-pointer" onClick={onExpand}>
      <CardHeader className="pb-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">media.generateV2</p>
        <p className="text-sm font-semibold">{module.name}</p>
      </CardHeader>
      <CardContent className="space-y-1 text-xs text-muted-foreground">
        <p>{ACTION_TYPE_LABELS[module.inputs.action_type]}</p>
        <p>{module.inputs.providers.length} provider(s)</p>
      </CardContent>
    </Card>
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
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(
    module.inputs.providers[0] ?? null
  );

  const actionType = module.inputs.action_type;
  const availableProviders = PROVIDERS_BY_ACTION[actionType];
  const selected = selectedProvider && module.inputs.providers.includes(selectedProvider)
    ? selectedProvider
    : module.inputs.providers[0] ?? null;

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
    setSelectedProvider(nextProviders[0]);
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
    setSelectedProvider(nextProviders[0] ?? null);
  };

  const handleProviderPromptChange = (provider: ProviderId, value: string) => {
    const map = { ...(module.inputs.prompt_config.provider_prompts || {}) };
    if (!value.trim()) {
      map[provider] = `Use ${SHARED_PROMPT_REF_TOKEN}.`;
    } else {
      map[provider] = value;
    }
    updateInputs({
      prompt_config: {
        ...module.inputs.prompt_config,
        provider_prompts: map,
      },
    });
  };

  return (
    <>
      <Card className="w-[340px] shadow-lg border-2 border-rose-500/50">
        <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">media.generateV2</p>
            <Input
              className="h-7 text-sm font-semibold border-0 px-0"
              value={module.name}
              onChange={(e) => onChange({ ...module, name: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-1">
            {onViewState && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onViewState}>State</Button>}
            {onPreview && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onPreview}>Preview</Button>}
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCollapse}>Collapse</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Action Type</Label>
            <div className="flex rounded border bg-background p-0.5 text-xs">
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
              <Label className="text-xs">Shared Prompt</Label>
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => setIsPromptEditorOpen(true)}>
                Edit System
              </Button>
            </div>
            <textarea
              className="w-full rounded border bg-background px-2 py-1 text-xs min-h-20"
              value={module.inputs.prompt_config.shared_user || ""}
              onChange={(e) =>
                updateInputs({
                  prompt_config: {
                    ...module.inputs.prompt_config,
                    shared_user: e.target.value,
                  },
                })
              }
            />
          </div>

          <div className="rounded-md border p-2 space-y-2">
            <Label className="text-xs">Provider Prompt</Label>
            <select
              className="w-full rounded border bg-background px-2 py-1 text-xs"
              value={selected || ""}
              onChange={(e) => setSelectedProvider(e.target.value as ProviderId)}
            >
              {(module.inputs.providers || []).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
            {selected ? (
              <textarea
                className="w-full rounded border bg-background px-2 py-1 text-xs min-h-20"
                value={module.inputs.prompt_config.provider_prompts?.[selected] || `Use ${SHARED_PROMPT_REF_TOKEN}.`}
                onChange={(e) => handleProviderPromptChange(selected, e.target.value)}
              />
            ) : null}
          </div>

          <div className="rounded-md border p-2 space-y-1">
            <Label className="text-xs">Outputs to State</Label>
            <Input className="h-7 text-xs" value={module.outputs_to_state.selected_content_id} onChange={(e) => updateOutputs("selected_content_id", e.target.value)} />
            <Input className="h-7 text-xs" value={module.outputs_to_state.selected_content} onChange={(e) => updateOutputs("selected_content", e.target.value)} />
            <Input className="h-7 text-xs" value={module.outputs_to_state.generations} onChange={(e) => updateOutputs("generations", e.target.value)} />
            <Input className="h-7 text-xs" value={module.outputs_to_state.generated_prompts} onChange={(e) => updateOutputs("generated_prompts", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <PromptEditor
        open={isPromptEditorOpen}
        onOpenChange={setIsPromptEditorOpen}
        system={module.inputs.prompt_config.system}
        input={module.inputs.prompt_config.shared_user}
        stateVariables={[] as StateVariable[]}
        onSave={(system, input) => {
          updateInputs({
            prompt_config: {
              ...module.inputs.prompt_config,
              system,
              shared_user: typeof input === "string" ? input : module.inputs.prompt_config.shared_user,
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
  const updateNodeInternals = useUpdateNodeInternals();
  const containerRef = useRef<HTMLDivElement>(null);

  useReportNodeHeight(id, containerRef);

  useEffect(() => {
    const timer = setTimeout(() => updateNodeInternals(id), 50);
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
        <CollapsedView module={module} onExpand={handleExpand} />
      )}
      <Handle type="source" position={Position.Bottom} id="out" className="!bg-primary" />
    </div>
  );
}

export const MediaGenerateV2Node = memo(MediaGenerateV2NodeComponent);
