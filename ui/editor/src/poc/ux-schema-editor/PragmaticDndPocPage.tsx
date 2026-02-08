/**
 * UX Schema Editor PoC using @atlaskit/pragmatic-drag-and-drop
 *
 * This PoC demonstrates:
 * - Data schema tree with draggable fields (native HTML5 DnD)
 * - Drop zones for configuring render_as
 * - Live preview of the resulting display schema
 */

import { useState, useMemo, useEffect, useRef } from "react";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import Editor from "@monaco-editor/react";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@wfm/shared";
import {
  petTypeDataSchema,
  scenesDataSchema,
  schemaToTreeNodes,
  samplePetTypeData,
  sampleScenesData,
  ALL_RENDER_AS,
  DISPLAY_MODES,
  type SchemaTreeNode,
  type UxConfig,
  type DataSchemaNode,
} from "./sample-data";

// =============================================================================
// Draggable Tree Node Component (custom, not using react-arborist)
// =============================================================================

const TYPE_COLORS: Record<string, string> = {
  string: "bg-green-500/20 text-green-700",
  number: "bg-blue-500/20 text-blue-700",
  boolean: "bg-purple-500/20 text-purple-700",
  array: "bg-orange-500/20 text-orange-700",
  object: "bg-cyan-500/20 text-cyan-700",
};

type DraggableTreeNodeProps = {
  node: SchemaTreeNode;
  depth: number;
};

function DraggableTreeNode({ node, depth }: DraggableTreeNodeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return draggable({
      element: el,
      getInitialData: () => ({ node }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [node]);

  return (
    <div>
      <div
        ref={ref}
        style={{ paddingLeft: depth * 16 }}
        className={[
          "flex items-center gap-2 px-2 py-1.5 rounded cursor-grab select-none",
          "hover:bg-muted/50 transition-colors",
          isDragging ? "opacity-50 bg-muted" : "",
        ].join(" ")}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="w-4 h-4 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="text-sm font-medium">{node.name}</span>
        <Badge variant="secondary" className={TYPE_COLORS[node.schemaType] || ""}>
          {node.schemaType}
        </Badge>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <DraggableTreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function SchemaTree({ nodes }: { nodes: SchemaTreeNode[] }) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <DraggableTreeNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}

// =============================================================================
// Drop Zone Component
// =============================================================================

type DropZoneProps = {
  id: string;
  label: string;
  acceptedNode: SchemaTreeNode | null;
  onDrop: (zoneId: string, node: SchemaTreeNode) => void;
  onConfigure: (nodeId: string, config: Partial<UxConfig>) => void;
  onRemove: (nodeId: string) => void;
};

function DropZone({ id, label, acceptedNode, onDrop, onConfigure, onRemove }: DropZoneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);
  const [selectedRenderAs, setSelectedRenderAs] = useState<string>("");
  const [selectedDisplay, setSelectedDisplay] = useState<string>("visible");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: ({ source }) => {
        setIsOver(false);
        const data = source.data as { node?: SchemaTreeNode };
        if (data.node) {
          onDrop(id, data.node);
        }
      },
    });
  }, [id, onDrop]);

  const handleRenderAsChange = (value: string) => {
    setSelectedRenderAs(value);
    if (acceptedNode) {
      onConfigure(acceptedNode.id, { render_as: value, display: selectedDisplay as UxConfig["display"] });
    }
  };

  const handleDisplayChange = (value: string) => {
    setSelectedDisplay(value);
    if (acceptedNode) {
      onConfigure(acceptedNode.id, { render_as: selectedRenderAs, display: value as UxConfig["display"] });
    }
  };

  return (
    <div
      ref={ref}
      className={[
        "min-h-24 rounded-lg border-2 border-dashed p-3 transition-colors",
        isOver ? "border-primary bg-primary/10" : "border-muted-foreground/30",
        acceptedNode ? "border-solid border-primary/50" : "",
      ].join(" ")}
    >
      <p className="text-xs text-muted-foreground mb-2">{label}</p>

      {acceptedNode ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{acceptedNode.name}</span>
              <Badge variant="outline">{acceptedNode.schemaType}</Badge>
            </div>
            <button
              type="button"
              onClick={() => onRemove(acceptedNode.id)}
              className="text-xs text-destructive hover:underline"
            >
              Remove
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">display</label>
              <select
                value={selectedDisplay}
                onChange={(e) => handleDisplayChange(e.target.value)}
                className="w-full text-xs rounded border bg-background px-2 py-1"
              >
                {DISPLAY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">render_as</label>
              <select
                value={selectedRenderAs}
                onChange={(e) => handleRenderAsChange(e.target.value)}
                className="w-full text-xs rounded border bg-background px-2 py-1"
              >
                <option value="">-- select --</option>
                {ALL_RENDER_AS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground/50 text-center py-4">
          Drop a field here
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Canvas with Multiple Drop Zones
// =============================================================================

type CanvasProps = {
  slots: Record<string, SchemaTreeNode | null>;
  configurations: Record<string, UxConfig>;
  onDrop: (zoneId: string, node: SchemaTreeNode) => void;
  onConfigure: (nodeId: string, config: Partial<UxConfig>) => void;
  onRemove: (nodeId: string) => void;
};

function Canvas({ slots, onDrop, onConfigure, onRemove }: CanvasProps) {
  const zones = [
    { id: "container", label: "Container (array wrapper)" },
    { id: "card", label: "Card Layout (item wrapper)" },
    { id: "title", label: "Card Title" },
    { id: "subtitle", label: "Card Subtitle" },
    { id: "body1", label: "Body Field 1" },
    { id: "body2", label: "Body Field 2" },
    { id: "body3", label: "Body Field 3" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Drop Zones</h3>
      <div className="grid gap-3">
        {zones.map((zone) => (
          <DropZone
            key={zone.id}
            id={zone.id}
            label={zone.label}
            acceptedNode={slots[zone.id] || null}
            onDrop={onDrop}
            onConfigure={onConfigure}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Display Schema Generator
// =============================================================================

type SlotToRenderAs = {
  container: string;
  card: string;
  title: string;
  subtitle: string;
  body1: string;
  body2: string;
  body3: string;
};

const SLOT_RENDER_AS: SlotToRenderAs = {
  container: "card-stack",
  card: "card",
  title: "card-title",
  subtitle: "card-subtitle",
  body1: "text",
  body2: "text",
  body3: "text",
};

function generateDisplaySchema(
  slots: Record<string, SchemaTreeNode | null>,
  configurations: Record<string, UxConfig>
): Record<string, unknown> {
  // Build the display schema based on slot assignments
  const itemProperties: Record<string, unknown> = {};

  // Process each slot that has a field assigned
  for (const [slotId, node] of Object.entries(slots)) {
    if (!node || node.name === "(root)" || node.name === "[items]") continue;

    const fieldName = node.name;
    const config = configurations[node.id] || {};
    const defaultRenderAs = SLOT_RENDER_AS[slotId as keyof SlotToRenderAs] || "text";

    itemProperties[fieldName] = {
      type: node.schemaType,
      _ux: {
        display: config.display || "visible",
        render_as: config.render_as || defaultRenderAs,
        ...(config.display_label && { display_label: config.display_label }),
        ...(config.highlight && { highlight: true }),
      },
    };
  }

  // If no fields assigned, return empty schema
  if (Object.keys(itemProperties).length === 0) {
    return {
      type: "array",
      "_ux.display": "visible",
      "_ux.render_as": "card-stack",
      items: {
        type: "object",
        _ux: { display: "visible", render_as: "card" },
        properties: {},
      },
    };
  }

  // Build full display schema
  return {
    type: "array",
    "_ux.display": "visible",
    "_ux.render_as": "card-stack",
    items: {
      type: "object",
      _ux: {
        display: "visible",
        render_as: "card",
        selectable: true,
      },
      properties: itemProperties,
    },
  };
}

// =============================================================================
// Live Preview Component
// =============================================================================

type LivePreviewProps = {
  data: unknown;
  slots: Record<string, SchemaTreeNode | null>;
};

function LivePreview({ data, slots }: LivePreviewProps) {
  // Build a simple preview based on slot assignments
  const renderPreview = () => {
    if (!data || typeof data !== "object") {
      return <p className="text-muted-foreground">No data to preview</p>;
    }

    const items = Array.isArray(data) ? data : [];
    if (items.length === 0) {
      return <p className="text-muted-foreground">No items in data</p>;
    }

    const titleField = slots.title?.name;
    const subtitleField = slots.subtitle?.name;
    const bodyFields = [slots.body1?.name, slots.body2?.name, slots.body3?.name].filter(
      (f): f is string => Boolean(f) && f !== "(root)" && f !== "[items]"
    );

    // Check if any fields are assigned
    const hasAnyField = titleField || subtitleField || bodyFields.length > 0;
    if (!hasAnyField) {
      return (
        <p className="text-muted-foreground text-center py-8">
          Drag fields from the tree to the slots to see a preview
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border bg-card p-4 space-y-2">
            {titleField && titleField !== "(root)" && titleField !== "[items]" && item[titleField] && (
              <h4 className="font-semibold">{String(item[titleField])}</h4>
            )}
            {subtitleField && subtitleField !== "(root)" && subtitleField !== "[items]" && item[subtitleField] && (
              <p className="text-sm text-muted-foreground">{String(item[subtitleField])}</p>
            )}
            {bodyFields.length > 0 && (
              <div className="border-t pt-2 mt-2 space-y-1">
                {bodyFields.map((field) => {
                  if (!item[field]) return null;
                  const value = item[field];
                  const displayValue = Array.isArray(value) ? value.join(", ") : String(value);

                  return (
                    <div key={field} className="text-sm">
                      <span className="text-muted-foreground">{field}: </span>
                      <span>{displayValue}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">Live Preview</h3>
      <div className="rounded-lg border bg-muted/20 p-4 min-h-[200px]">
        {renderPreview()}
      </div>
    </div>
  );
}

// =============================================================================
// Main PoC Page
// =============================================================================

type DatasetOption = "petTypes" | "scenes";

const datasets: Record<DatasetOption, { data: unknown; schema: DataSchemaNode; label: string }> = {
  petTypes: { data: samplePetTypeData, schema: petTypeDataSchema, label: "Pet Types (simple)" },
  scenes: { data: sampleScenesData.scenes, schema: scenesDataSchema.properties!.scenes, label: "Scenes (nested)" },
};

export function PragmaticDndPocPage() {
  const [selectedDataset, setSelectedDataset] = useState<DatasetOption>("petTypes");
  const [slots, setSlots] = useState<Record<string, SchemaTreeNode | null>>({});
  const [configurations, setConfigurations] = useState<Record<string, UxConfig>>({});

  const { data, schema } = datasets[selectedDataset];
  const treeNodes = useMemo(() => schemaToTreeNodes(schema), [schema]);

  const handleDrop = (zoneId: string, node: SchemaTreeNode) => {
    setSlots((prev) => ({ ...prev, [zoneId]: node }));
  };

  const handleConfigure = (nodeId: string, config: Partial<UxConfig>) => {
    setConfigurations((prev) => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...config },
    }));
  };

  const handleRemove = (nodeId: string) => {
    setSlots((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        if (next[key]?.id === nodeId) {
          next[key] = null;
        }
      }
      return next;
    });
  };

  const handleDatasetChange = (value: string) => {
    setSelectedDataset(value as DatasetOption);
    setSlots({});
    setConfigurations({});
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      <header className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">
              UX Schema Editor PoC - Pragmatic Drag and Drop
            </h1>
            <p className="text-sm text-muted-foreground">
              Uses native HTML5 drag-and-drop API (Atlassian library)
            </p>
          </div>
          <select
            value={selectedDataset}
            onChange={(e) => handleDatasetChange(e.target.value)}
            className="rounded border bg-background px-3 py-1.5 text-sm"
          >
            {Object.entries(datasets).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr_1fr] gap-4 p-4">
        {/* Left: Schema Tree + JSON */}
        <div className="min-h-0 flex flex-col gap-4">
          <Card className="flex-1 min-h-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Data Schema (Tree)</CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-4rem)] overflow-auto">
              <SchemaTree nodes={treeNodes} />
            </CardContent>
          </Card>

          <Card className="flex-1 min-h-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Data Schema (JSON)</CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-4rem)] p-0">
              <Editor
                height="100%"
                defaultLanguage="json"
                value={JSON.stringify(schema, null, 2)}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "off",
                  scrollBeyondLastLine: false,
                  folding: true,
                  wordWrap: "on",
                }}
                theme="vs-dark"
              />
            </CardContent>
          </Card>
        </div>

        {/* Middle: Drop Zones / Canvas */}
        <Card className="min-h-0 overflow-auto">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Configuration Canvas</CardTitle>
          </CardHeader>
          <CardContent>
            <Canvas
              slots={slots}
              configurations={configurations}
              onDrop={handleDrop}
              onConfigure={handleConfigure}
              onRemove={handleRemove}
            />
          </CardContent>
        </Card>

        {/* Right: Preview + Generated Schema */}
        <div className="min-h-0 flex flex-col gap-4">
          <Card className="flex-1 min-h-0 overflow-auto">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <LivePreview data={data} slots={slots} />
            </CardContent>
          </Card>

          <Card className="flex-1 min-h-0 overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Generated Display Schema</CardTitle>
            </CardHeader>
            <CardContent className="h-[calc(100%-4rem)] p-0">
              <Editor
                height="100%"
                defaultLanguage="json"
                value={JSON.stringify(generateDisplaySchema(slots, configurations), null, 2)}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  fontSize: 12,
                  lineNumbers: "off",
                  scrollBeyondLastLine: false,
                  folding: true,
                  wordWrap: "on",
                }}
                theme="vs-dark"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
