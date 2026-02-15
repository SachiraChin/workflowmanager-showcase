/**
 * Custom ReactFlow node for transform.extract module.
 *
 * Features:
 * - Collapsed state: Shows module summary (name, extraction count)
 * - Expanded state: Key-value editor with add/remove rows
 * - Each row: key (input name), value (Jinja2 expression), stateKey (output)
 */

import { useState, memo, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useReportNodeHeight } from "@/hooks/useNodeHeights";
import {
  Button,
  Input,
  Label,
} from "@wfm/shared";
import { ModuleNodeShell } from "@/components/module-node/ModuleNodeShell";
import { Plus, Trash2 } from "lucide-react";
import {
  type ExtractModule,
  type ExtractionEntry,
  moduleToEntries,
  entriesToModule,
} from "./types";
import {
  getExtractSummary,
  createEmptyEntry,
  findDuplicateKeys,
} from "./presentation";

// =============================================================================
// Types
// =============================================================================

export type ExtractNodeData = {
  module: ExtractModule;
  onModuleChange: (module: ExtractModule) => void;
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
// Entry Row Component
// =============================================================================

function EntryRow({
  entry,
  onChange,
  onRemove,
  isDuplicate,
}: {
  entry: ExtractionEntry;
  onChange: (updated: ExtractionEntry) => void;
  onRemove: () => void;
  isDuplicate: boolean;
}) {
  return (
    <div className="rounded-md border p-2 space-y-2 bg-muted/30">
      <div className="flex items-center gap-2">
        {/* Key input */}
        <div className="flex-1">
          <Label className="text-[10px] text-muted-foreground">Key</Label>
          <Input
            className={`h-7 text-xs font-mono ${isDuplicate ? "border-destructive" : ""}`}
            value={entry.key}
            onChange={(e) => onChange({ ...entry, key: e.target.value })}
            placeholder="input_key"
          />
        </div>
        {/* State key input */}
        <div className="flex-1">
          <Label className="text-[10px] text-muted-foreground">State Key</Label>
          <Input
            className="h-7 text-xs font-mono"
            value={entry.stateKey}
            onChange={(e) => onChange({ ...entry, stateKey: e.target.value })}
            placeholder="state_key"
          />
        </div>
        {/* Remove button */}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 mt-4 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* Value input (full width) */}
      <div>
        <Label className="text-[10px] text-muted-foreground">Value (Jinja2)</Label>
        <Input
          className="h-7 text-xs font-mono"
          value={entry.value}
          onChange={(e) => onChange({ ...entry, value: e.target.value })}
          placeholder="{{ state.some_value }}"
        />
      </div>
      {isDuplicate && (
        <p className="text-[10px] text-destructive">Duplicate key</p>
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
}: {
  module: ExtractModule;
  onExpand: () => void;
  onViewState?: () => void;
}) {
  const summary = getExtractSummary(module);

  return (
    <ModuleNodeShell
      expanded={false}
      borderClass="border-emerald-500/50"
      badgeText="Extract"
      badgeClass="bg-emerald-500"
      moduleId="transform.extract"
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
        <p className="text-xs text-muted-foreground">{summary}</p>
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
  module: ExtractModule;
  onChange: (module: ExtractModule) => void;
  onCollapse: () => void;
  onViewState?: () => void;
}) {
  // Convert module to editable entries - only initialize once
  const [entries, setEntries] = useState<ExtractionEntry[]>(() =>
    moduleToEntries(module)
  );

  // Find duplicate keys for validation display
  const duplicateKeys = findDuplicateKeys(entries);

  // Sync entries back to module on change
  const syncToModule = useCallback(
    (newEntries: ExtractionEntry[]) => {
      onChange(entriesToModule(newEntries, module));
    },
    [module, onChange]
  );

  const handleEntryChange = useCallback(
    (index: number, updated: ExtractionEntry) => {
      setEntries((prev) => {
        const newEntries = [...prev];
        newEntries[index] = updated;
        syncToModule(newEntries);
        return newEntries;
      });
    },
    [syncToModule]
  );

  const handleAddEntry = useCallback(() => {
    setEntries((prev) => {
      const newEntries = [...prev, createEmptyEntry()];
      syncToModule(newEntries);
      return newEntries;
    });
  }, [syncToModule]);

  const handleRemoveEntry = useCallback(
    (index: number) => {
      setEntries((prev) => {
        const newEntries = prev.filter((_, i) => i !== index);
        syncToModule(newEntries);
        return newEntries;
      });
    },
    [syncToModule]
  );

  return (
    <ModuleNodeShell
      expanded
      borderClass="border-emerald-500/50"
      badgeText="Extract"
      badgeClass="bg-emerald-500"
      moduleId="transform.extract"
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
      bodyClassName="space-y-2"
    >
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        {/* Entries list with scroll */}
        <div className="max-h-[320px] overflow-y-auto space-y-2 pr-1">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No extractions configured. Click "Add" to create one.
            </p>
          ) : (
            entries.map((entry, index) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                onChange={(updated) => handleEntryChange(index, updated)}
                onRemove={() => handleRemoveEntry(index)}
                isDuplicate={duplicateKeys.has(entry.key)}
              />
            ))
          )}
        </div>

        {/* Add button */}
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs"
          onClick={handleAddEntry}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Extraction
        </Button>
      </div>
    </ModuleNodeShell>
  );
}

// =============================================================================
// Main Node Component
// =============================================================================

function ExtractNodeComponent({ id, data }: NodeProps) {
  const { module, onModuleChange, expanded, onExpandedChange, onViewState } =
    data as unknown as ExtractNodeData;
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

export const ExtractNode = memo(ExtractNodeComponent);
