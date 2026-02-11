/**
 * StatePanel - Left slide-out panel showing workflow state variables.
 *
 * Features:
 * - Shows only state-mapped values (what users can reference as {{ state.key }})
 * - Groups state by source module with separators
 * - Each separator appears BELOW the state keys and shows which module can USE
 *   that state (i.e., "state available to step_1 → module_2")
 * - Click to copy state path
 */

import { useMemo, useCallback, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  type WorkflowDefinition,
} from "@wfm/shared";
import { Copy, Check, ChevronRight, ChevronDown, Circle, Loader2 } from "lucide-react";
import type { ModuleLocation, VirtualStateResponse } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface StatePanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Called when panel should close */
  onOpenChange: (open: boolean) => void;
  /** Current workflow definition */
  workflow: WorkflowDefinition | null;
  /** Current state from virtual runtime */
  state: VirtualStateResponse | null;
  /** Whether state is currently loading */
  loading?: boolean;
  /** Optional: only show state up to this module (exclusive) */
  upToModule?: ModuleLocation | null;
  /** Called when user selects a state path */
  onSelectPath?: (path: string) => void;
}

interface ModuleInfo {
  stepId: string;
  moduleName: string;
  moduleId: string;
  stepIndex: number;
  moduleIndex: number;
}

interface StateGroup {
  /** Module that produced these state keys */
  sourceModule: ModuleInfo;
  /** The next module that can use this state (null if last module) */
  availableTo: ModuleInfo | null;
  /** State keys and values from this module */
  entries: Array<[string, unknown]>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build ordered list of modules with full info.
 */
function getModuleList(workflow: WorkflowDefinition): ModuleInfo[] {
  const list: ModuleInfo[] = [];
  for (let stepIdx = 0; stepIdx < workflow.steps.length; stepIdx++) {
    const step = workflow.steps[stepIdx];
    for (let modIdx = 0; modIdx < step.modules.length; modIdx++) {
      const mod = step.modules[modIdx];
      list.push({
        stepId: step.step_id,
        moduleName: mod.name ?? "",
        moduleId: mod.module_id ?? "",
        stepIndex: stepIdx,
        moduleIndex: modIdx,
      });
    }
  }
  return list;
}

/**
 * Extract state keys that came from a specific module.
 * The raw module output contains _state_mapped with the keys it produced.
 */
function getStateKeysFromModule(
  state: Record<string, unknown>,
  moduleName: string
): string[] {
  const moduleOutput = state[moduleName];
  if (!moduleOutput || typeof moduleOutput !== "object") {
    return [];
  }
  const stateMapped = (moduleOutput as Record<string, unknown>)["_state_mapped"];
  if (!stateMapped || typeof stateMapped !== "object") {
    return [];
  }
  return Object.keys(stateMapped as Record<string, unknown>);
}

/**
 * Build state groups - each group contains state keys from one module
 * with a separator indicating which module can use that state.
 */
function buildStateGroups(
  workflow: WorkflowDefinition,
  state: Record<string, unknown>,
  upToModule?: ModuleLocation | null
): StateGroup[] {
  const moduleList = getModuleList(workflow);
  const groups: StateGroup[] = [];

  for (let i = 0; i < moduleList.length; i++) {
    const mod = moduleList[i];

    // Stop if we've reached the upToModule
    if (
      upToModule &&
      mod.stepId === upToModule.step_id &&
      mod.moduleName === upToModule.module_name
    ) {
      break;
    }

    // Check if this module has output in state
    if (state[mod.moduleName] === undefined) {
      continue;
    }

    // Get state keys produced by this module
    const stateKeys = getStateKeysFromModule(state, mod.moduleName);
    if (stateKeys.length === 0) {
      continue;
    }

    // Build entries (key-value pairs from root state)
    const entries: Array<[string, unknown]> = [];
    for (const key of stateKeys) {
      if (state[key] !== undefined) {
        entries.push([key, state[key]]);
      }
    }

    if (entries.length === 0) {
      continue;
    }

    // Find next module (for "available to" label)
    const nextModule = i + 1 < moduleList.length ? moduleList[i + 1] : null;

    groups.push({
      sourceModule: mod,
      availableTo: nextModule,
      entries,
    });
  }

  return groups;
}

/**
 * Format step/module reference for display.
 * e.g., "step_1 → module_2"
 */
function formatModuleRef(mod: ModuleInfo): string {
  return `${mod.stepId} → ${mod.moduleName}`;
}

// =============================================================================
// Sub-components
// =============================================================================

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
      title={`Copy: ${text}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function formatValuePreview(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    if (value.length > 40) return `"${value.slice(0, 40)}..."`;
    return `"${value}"`;
  }
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `Array[${value.length}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }
  return String(value);
}

interface StateNodeProps {
  stateKey: string;
  value: unknown;
  level?: number;
}

function StateNode({ stateKey, value, level = 0 }: StateNodeProps) {
  // All nodes start collapsed by default
  const [isOpen, setIsOpen] = useState(false);
  const isLeaf = value === null || typeof value !== "object";
  const templatePath = `{{ state.${stateKey} }}`;

  const handleToggle = useCallback(() => {
    if (!isLeaf) {
      setIsOpen(!isOpen);
    }
  }, [isLeaf, isOpen]);

  const renderChildren = () => {
    if (isLeaf || !isOpen) return null;

    if (Array.isArray(value)) {
      return (
        <div className="border-l border-border/50 ml-3">
          {value.slice(0, 10).map((item, idx) => (
            <StateNode
              key={idx}
              stateKey={`${stateKey}[${idx}]`}
              value={item}
              level={level + 1}
            />
          ))}
          {value.length > 10 && (
            <div
              className="py-1 px-2 text-xs text-muted-foreground italic"
              style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
            >
              ... and {value.length - 10} more items
            </div>
          )}
        </div>
      );
    }

    if (typeof value === "object" && value !== null) {
      const entries = Object.entries(value as Record<string, unknown>);
      return (
        <div className="border-l border-border/50 ml-3">
          {entries.slice(0, 20).map(([k, v]) => (
            <StateNode
              key={k}
              stateKey={`${stateKey}.${k}`}
              value={v}
              level={level + 1}
            />
          ))}
          {entries.length > 20 && (
            <div
              className="py-1 px-2 text-xs text-muted-foreground italic"
              style={{ paddingLeft: `${(level + 1) * 16 + 8}px` }}
            >
              ... and {entries.length - 20} more keys
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const displayKey = stateKey.includes(".")
    ? stateKey.split(".").pop()
    : stateKey.includes("[")
    ? stateKey.split("[").pop()?.replace("]", "")
    : stateKey;

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 ${
          !isLeaf ? "cursor-pointer" : ""
        }`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleToggle}
      >
        {isLeaf ? (
          <Circle className="h-2 w-2 text-muted-foreground shrink-0" />
        ) : isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className="font-mono text-sm text-primary">
          {displayKey}
        </span>

        <span className="text-xs text-muted-foreground truncate flex-1">
          {formatValuePreview(value)}
        </span>

        {level === 0 && <CopyButton text={templatePath} />}
      </div>

      {renderChildren()}
    </div>
  );
}

interface AvailabilityDividerProps {
  /** The module that can use the state above this line */
  availableTo: ModuleInfo;
}

function AvailabilityDivider({ availableTo }: AvailabilityDividerProps) {
  return (
    <div className="flex items-center gap-2 py-2 my-1">
      <div className="flex-1 border-t border-dashed border-border" />
      <span className="text-[10px] text-muted-foreground px-2 whitespace-nowrap">
        state available to{" "}
        <span className="font-medium">{formatModuleRef(availableTo)}</span>
      </span>
      <div className="flex-1 border-t border-dashed border-border" />
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

/**
 * Transform VirtualStateResponse into the flat state format used by buildStateGroups.
 * 
 * The new format has:
 * - steps: { step_id: { module_name: { module_completed: {...} } } }
 * - state_mapped: { key: value }
 * 
 * We need to produce:
 * - { module_name: { ...outputs, _state_mapped: {...} }, state_key: value, ... }
 */
function transformStateForDisplay(state: VirtualStateResponse): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Extract module outputs from steps
  const steps = state.steps || {};
  for (const stepId of Object.keys(steps)) {
    const stepData = steps[stepId] as Record<string, unknown>;
    for (const moduleName of Object.keys(stepData)) {
      const moduleData = stepData[moduleName] as Record<string, unknown>;
      // Extract module_completed event data
      const moduleCompleted = moduleData?.module_completed as Record<string, unknown>;
      if (moduleCompleted) {
        result[moduleName] = moduleCompleted;
      }
    }
  }

  // Add state_mapped values at root level
  const stateMapped = state.state_mapped || {};
  for (const [key, value] of Object.entries(stateMapped)) {
    result[key] = value;
  }

  return result;
}

export function StatePanel({
  open,
  onOpenChange,
  workflow,
  state,
  loading = false,
  upToModule,
}: StatePanelProps) {
  const groups = useMemo(() => {
    if (!workflow || !state) return [];
    const flatState = transformStateForDisplay(state);
    return buildStateGroups(workflow, flatState, upToModule);
  }, [workflow, state, upToModule]);

  const hasState = groups.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[35vw]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Workflow State
          </SheetTitle>
          {upToModule ? (
            <p className="text-xs text-muted-foreground">
              State available to <span className="font-medium text-foreground/80">{upToModule.step_id} → {upToModule.module_name}</span>
            </p>
          ) : (
            <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-2 py-1 rounded font-medium">
              Full state up to currently processed steps and modules
            </p>
          )}
        </SheetHeader>

        <SheetBody>
          {/* Loading state */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p className="text-sm">Loading state...</p>
            </div>
          )}

          {/* Content when not loading */}
          {!loading && !workflow && (
            <div className="text-sm text-muted-foreground py-4">
              No workflow loaded
            </div>
          )}

          {!loading && workflow && !hasState && (
            <div className="text-sm text-muted-foreground py-4">
              No state available. Run a preview to populate state.
            </div>
          )}

          {!loading && workflow && hasState && (
            <div>
              {groups.map((group) => (
                <div key={group.sourceModule.moduleName}>
                  {/* State entries from this module */}
                  {group.entries.map(([key, value]) => (
                    <StateNode key={key} stateKey={key} value={value} />
                  ))}

                  {/* Separator showing which module can use this state */}
                  {group.availableTo && (
                    <AvailabilityDivider availableTo={group.availableTo} />
                  )}
                </div>
              ))}
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
