/**
 * UX Schema Editor Component
 *
 * A visual editor for configuring display schemas by dragging UX identifiers
 * onto data schema nodes. Supports:
 * - Containers (card-stack, grid, list) for arrays
 * - Layouts (card, section, passthrough) for objects
 * - Roles (card-title, card-subtitle) for fields
 * - Display modes (visible, hidden, passthrough)
 * - Nudges (copy, swatch, preview) for enhancements
 * - Toggles (selectable, highlight) for boolean flags
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Editor from "@monaco-editor/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  RenderProvider,
  SchemaRenderer,
  getUx,
  normalizeDisplay,
  type DisplayMode,
  type SchemaProperty,
} from "@wfm/shared";
import type {
  UxSchemaEditorProps,
  DataSchemaNode,
  ConfiguredNode,
  NodeUxConfig,
  NodeDiffStatus,
} from "./types";

// =============================================================================
// UX Palette Categories
// =============================================================================

const UX_PALETTE = {
  containers: {
    label: "Containers (for arrays)",
    items: ["card-stack", "grid", "list", "section-list", "tabs"],
  },
  layouts: {
    label: "Layouts (for objects)",
    items: ["card", "section", "passthrough"],
  },
  roles: {
    label: "Roles (for fields in containers)",
    items: [
      "card-title",
      "card-subtitle",
      "section-header",
      "section-title",
      "section-badge",
      "section-summary",
    ],
  },
  terminal: {
    label: "Terminal (how to render value)",
    items: ["text", "color", "url", "datetime", "number", "image"],
  },
  display: {
    label: "Display Mode",
    items: ["visible", "hidden", "passthrough"],
  },
  nudges: {
    label: "Nudges (enhancements)",
    items: ["copy", "swatch", "external-link", "preview", "download", "index-badge"],
  },
  toggles: {
    label: "Toggles (boolean flags)",
    items: ["selectable", "highlight"],
  },
} as const;

type UxCategory = keyof typeof UX_PALETTE;
type UxItem = {
  category: UxCategory;
  value: string;
};

// =============================================================================
// Tree Building - DisplaySchema as Primary, with DataSchema Diff
// =============================================================================

/**
 * Extract UX config from a schema node.
 * Uses shared getUx() to handle both _ux object and _ux.* flat notation.
 */
function extractUxFromSchema(schema?: SchemaProperty): NodeUxConfig {
  if (!schema) return {};

  const ux = getUx(schema as Record<string, unknown>);
  const config: NodeUxConfig = {};

  if (ux.render_as) config.render_as = ux.render_as;
  // Preserve display value (including false for hidden)
  if (ux.display !== undefined) config.display = ux.display;
  if (ux.nudges) config.nudges = [...ux.nudges];
  if (ux.selectable) config.selectable = true;
  if (ux.highlight) config.highlight = true;
  if (ux.display_label) config.display_label = ux.display_label;
  if (ux.display_order !== undefined) config.display_order = ux.display_order;

  return config;
}

/**
 * Infer schema type from a SchemaProperty.
 */
function getSchemaType(schema?: SchemaProperty): DataSchemaNode["type"] {
  return schema?.type || "object";
}

/**
 * Build configured tree from displaySchema (primary), with diff status from dataSchema.
 * 
 * Logic:
 * 1. displaySchema is the source of truth for tree structure
 * 2. dataSchema is used to determine diff status:
 *    - "normal": field exists in both
 *    - "deleted": field in displaySchema but not in dataSchema
 *    - "addable": field in dataSchema but not in displaySchema (added at end)
 */
function buildConfiguredTree(
  displaySchema: SchemaProperty | undefined,
  dataSchema: DataSchemaNode | undefined,
  path: string[] = [],
  name = "(root)"
): ConfiguredNode {
  const id = path.length === 0 ? "(root)" : path.join(".");
  const schemaType = getSchemaType(displaySchema);
  
  // Determine diff status for this node
  let diffStatus: NodeDiffStatus = "normal";
  if (path.length > 0 && !dataSchema) {
    // This node exists in displaySchema but not in dataSchema
    diffStatus = "deleted";
  }

  const node: ConfiguredNode = {
    id,
    name,
    path,
    schemaType,
    isLeaf: schemaType !== "object" && schemaType !== "array",
    ux: extractUxFromSchema(displaySchema),
    diffStatus,
  };

  const children: ConfiguredNode[] = [];

  // Handle object type
  if (schemaType === "object") {
    const displayProps = displaySchema?.properties || {};
    const displayAdditionalProps = displaySchema?.additionalProperties;
    const dataProps = dataSchema?.type === "object" ? dataSchema.properties || {} : {};

    // 1. Add all fields from displaySchema properties
    for (const [key, childDisplaySchema] of Object.entries(displayProps)) {
      const childDataSchema = dataProps[key];
      children.push(
        buildConfiguredTree(
          childDisplaySchema,
          childDataSchema,
          [...path, key],
          key
        )
      );
    }

    // 2. If displaySchema has additionalProperties, use it as template for data fields
    //    that aren't in displaySchema.properties
    if (displayAdditionalProps) {
      for (const key of Object.keys(dataProps)) {
        if (!(key in displayProps)) {
          // This field exists in data but uses additionalProperties schema
          children.push(
            buildConfiguredTree(
              displayAdditionalProps,
              dataProps[key],
              [...path, key],
              key
            )
          );
        }
      }
    }

    // 3. Add "addable" fields from dataSchema not in displaySchema
    //    (only if no additionalProperties, otherwise they're handled above)
    if (!displayAdditionalProps) {
      for (const [key, childDataSchema] of Object.entries(dataProps)) {
        if (!(key in displayProps)) {
          // Field exists in dataSchema but not in displaySchema - mark as addable
          children.push(
            buildConfiguredTreeFromDataOnly(
              childDataSchema,
              [...path, key],
              key
            )
          );
        }
      }
    }
  }
  // Handle array type
  else if (schemaType === "array") {
    const itemsDisplaySchema = displaySchema?.items;
    const itemsDataSchema = dataSchema?.type === "array" ? dataSchema.items : undefined;
    
    if (itemsDisplaySchema || itemsDataSchema) {
      children.push(
        buildConfiguredTree(
          itemsDisplaySchema,
          itemsDataSchema,
          [...path, "[items]"],
          "[items]"
        )
      );
    }
  }

  if (children.length > 0) {
    node.children = children;
  }

  return node;
}

/**
 * Build a tree node from dataSchema only (for "addable" fields).
 * These are fields that exist in data but have no UX config yet.
 */
function buildConfiguredTreeFromDataOnly(
  dataSchema: DataSchemaNode,
  path: string[],
  name: string
): ConfiguredNode {
  const id = path.join(".");

  const node: ConfiguredNode = {
    id,
    name,
    path,
    schemaType: dataSchema.type,
    isLeaf: dataSchema.type !== "object" && dataSchema.type !== "array",
    ux: {}, // No UX config yet
    diffStatus: "addable",
  };

  if (dataSchema.type === "object" && dataSchema.properties) {
    node.children = Object.entries(dataSchema.properties).map(([key, value]) =>
      buildConfiguredTreeFromDataOnly(value, [...path, key], key)
    );
  } else if (dataSchema.type === "array" && dataSchema.items) {
    node.children = [
      buildConfiguredTreeFromDataOnly(dataSchema.items, [...path, "[items]"], "[items]"),
    ];
  }

  return node;
}

// =============================================================================
// Tree Manipulation Functions
// =============================================================================

/**
 * Deep clone and update a node's UX config.
 */
function updateNodeUx(
  tree: ConfiguredNode,
  targetId: string,
  uxUpdate: Partial<NodeUxConfig>
): ConfiguredNode {
  if (tree.id === targetId) {
    return {
      ...tree,
      ux: { ...tree.ux, ...uxUpdate },
      children: tree.children,
    };
  }

  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) => updateNodeUx(child, targetId, uxUpdate)),
    };
  }

  return tree;
}

/**
 * Add a nudge to a node.
 */
function addNudgeToNode(
  tree: ConfiguredNode,
  targetId: string,
  nudge: string
): ConfiguredNode {
  if (tree.id === targetId) {
    const currentNudges = tree.ux.nudges || [];
    if (currentNudges.includes(nudge)) return tree;
    return {
      ...tree,
      ux: { ...tree.ux, nudges: [...currentNudges, nudge] },
    };
  }

  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) => addNudgeToNode(child, targetId, nudge)),
    };
  }

  return tree;
}

/**
 * Remove a nudge from a node.
 */
function removeNudgeFromNode(
  tree: ConfiguredNode,
  targetId: string,
  nudge: string
): ConfiguredNode {
  if (tree.id === targetId) {
    const currentNudges = tree.ux.nudges || [];
    return {
      ...tree,
      ux: { ...tree.ux, nudges: currentNudges.filter((n) => n !== nudge) },
    };
  }

  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) => removeNudgeFromNode(child, targetId, nudge)),
    };
  }

  return tree;
}

/**
 * Clear a specific UX property from a node.
 */
function clearNodeUxKey(
  tree: ConfiguredNode,
  targetId: string,
  key: keyof NodeUxConfig
): ConfiguredNode {
  if (tree.id === targetId) {
    const newUx = { ...tree.ux };
    delete newUx[key];
    return {
      ...tree,
      ux: newUx,
      children: tree.children,
    };
  }

  if (tree.children) {
    return {
      ...tree,
      children: tree.children.map((child) => clearNodeUxKey(child, targetId, key)),
    };
  }

  return tree;
}

// =============================================================================
// Generate Display Schema from Configured Tree
// =============================================================================

/**
 * Generate a SchemaProperty from the configured tree.
 * The tree structure (from displaySchema) is the source of truth.
 * Skip "addable" nodes as they haven't been configured yet.
 */
function generateDisplaySchema(node: ConfiguredNode): SchemaProperty {
  // Skip addable nodes - they don't have UX config yet
  if (node.diffStatus === "addable") {
    return { type: node.schemaType as SchemaProperty["type"] };
  }

  const schema: SchemaProperty = {
    type: node.schemaType as SchemaProperty["type"],
  };

  // Build _ux config
  const uxConfig: Record<string, unknown> = {
    display: normalizeDisplay(node.ux.display),
  };

  if (node.ux.render_as) {
    uxConfig.render_as = node.ux.render_as;
  }

  if (node.ux.nudges && node.ux.nudges.length > 0) {
    uxConfig.nudges = node.ux.nudges;
  }

  if (node.ux.selectable) {
    uxConfig.selectable = true;
  }

  if (node.ux.highlight) {
    uxConfig.highlight = true;
  }

  if (node.ux.display_label) {
    uxConfig.display_label = node.ux.display_label;
  }

  if (node.ux.display_order !== undefined) {
    uxConfig.display_order = node.ux.display_order;
  }

  (schema as Record<string, unknown>)["_ux"] = uxConfig;

  // Handle children based on node's schema type
  if (node.schemaType === "object" && node.children) {
    schema.properties = {};
    for (const child of node.children) {
      // Skip addable children when generating schema
      if (child.diffStatus !== "addable") {
        schema.properties[child.name] = generateDisplaySchema(child);
      }
    }
  } else if (node.schemaType === "array" && node.children?.[0]) {
    schema.items = generateDisplaySchema(node.children[0]);
  }

  return schema;
}

// =============================================================================
// Draggable Palette Item
// =============================================================================

function PaletteItem({ category, value }: { category: UxCategory; value: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${category}-${value}`,
    data: { category, value } as UxItem,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={[
        "px-2 py-1 text-xs rounded border cursor-grab select-none",
        "bg-card hover:bg-muted/50 transition-colors",
        isDragging ? "opacity-50" : "",
      ].join(" ")}
    >
      {value}
    </div>
  );
}

function UxPalette() {
  return (
    <div className="space-y-4">
      {Object.entries(UX_PALETTE).map(([category, { label, items }]) => (
        <div key={category}>
          <h4 className="text-xs font-semibold text-muted-foreground mb-2">{label}</h4>
          <div className="flex flex-wrap gap-1">
            {items.map((item) => (
              <PaletteItem key={item} category={category as UxCategory} value={item} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Droppable Tree Node
// =============================================================================

const TYPE_COLORS: Record<string, string> = {
  string: "text-green-600",
  number: "text-blue-600",
  boolean: "text-purple-600",
  array: "text-orange-600",
  object: "text-cyan-600",
};

type DropInfo = {
  nodeId: string;
  value: string;
} | null;

function DroppableTreeNode({
  node,
  depth,
  onRemoveNudge,
  onClearUx,
  justDropped,
}: {
  node: ConfiguredNode;
  depth: number;
  onRemoveNudge: (nodeId: string, nudge: string) => void;
  onClearUx: (nodeId: string, key: keyof NodeUxConfig) => void;
  justDropped: DropInfo;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: node.id,
    data: { node },
  });
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const wasJustDropped = justDropped?.nodeId === node.id;

  // Diff status styling
  const isDeleted = node.diffStatus === "deleted";
  const isAddable = node.diffStatus === "addable";

  return (
    <div>
      <div
        ref={setNodeRef}
        style={{ paddingLeft: depth * 16 }}
        className={[
          "flex items-center gap-2 px-2 py-1.5 rounded select-none",
          "transition-all duration-200",
          isOver ? "bg-primary/20 ring-2 ring-primary scale-[1.02]" : "",
          !isOver ? "hover:bg-muted/30" : "",
          isDeleted ? "bg-red-500/10 border-l-2 border-red-500" : "",
          isAddable ? "bg-green-500/10 border-l-2 border-green-500" : "",
        ].join(" ")}
      >
        {/* Expand/collapse toggle */}
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

        {/* Node name and type */}
        <span className={[
          "text-sm font-medium",
          isDeleted ? "line-through text-red-600" : "",
          isAddable ? "text-green-600 italic" : "",
        ].join(" ")}>
          {node.name}
        </span>
        <span className={`text-xs ${TYPE_COLORS[node.schemaType] || ""}`}>
          [{node.schemaType}]
        </span>

        {/* Diff status badge */}
        {isDeleted && (
          <Badge
            variant="outline"
            className="text-xs py-0 bg-red-500/20 text-red-600 border-red-500/50"
            title="This field exists in display schema but not in data"
          >
            deleted
          </Badge>
        )}
        {isAddable && (
          <Badge
            variant="outline"
            className="text-xs py-0 bg-green-500/20 text-green-600 border-green-500/50"
            title="This field exists in data but has no UX config"
          >
            + add UX
          </Badge>
        )}

        {/* UX config badges */}
        {node.ux.display && node.ux.display !== "visible" && (
          <Badge
            variant="outline"
            className="text-xs py-0 cursor-pointer hover:bg-destructive/20"
            onClick={() => onClearUx(node.id, "display")}
            title="Click to remove"
          >
            {node.ux.display} ×
          </Badge>
        )}
        {node.ux.render_as && (
          <Badge
            variant="secondary"
            className={[
              "text-xs py-0 transition-all duration-300 cursor-pointer hover:bg-destructive/20",
              wasJustDropped ? "animate-pulse ring-2 ring-primary scale-110" : "",
            ].join(" ")}
            onClick={() => onClearUx(node.id, "render_as")}
            title="Click to remove"
          >
            {node.ux.render_as} ×
          </Badge>
        )}
        {node.ux.selectable && (
          <Badge
            variant="outline"
            className="text-xs py-0 cursor-pointer hover:bg-destructive/20 bg-blue-500/10 text-blue-600"
            onClick={() => onClearUx(node.id, "selectable")}
            title="Click to remove"
          >
            selectable ×
          </Badge>
        )}
        {node.ux.highlight && (
          <Badge
            variant="outline"
            className="text-xs py-0 cursor-pointer hover:bg-destructive/20 bg-yellow-500/10 text-yellow-600"
            onClick={() => onClearUx(node.id, "highlight")}
            title="Click to remove"
          >
            highlight ×
          </Badge>
        )}
        {node.ux.nudges?.map((nudge) => (
          <Badge
            key={nudge}
            variant="outline"
            className={[
              "text-xs py-0 cursor-pointer hover:bg-destructive/20 transition-all duration-300",
              wasJustDropped && justDropped?.value === nudge
                ? "animate-pulse ring-2 ring-primary scale-110"
                : "",
            ].join(" ")}
            onClick={() => onRemoveNudge(node.id, nudge)}
            title="Click to remove"
          >
            +{nudge} ×
          </Badge>
        ))}

        {/* Drop hint */}
        {isOver && (
          <span className="text-xs text-primary ml-auto font-medium">← Drop here</span>
        )}
      </div>

      {/* Children */}
      {hasChildren && expanded && (
        <div>
          {node.children!.map((child) => (
            <DroppableTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onRemoveNudge={onRemoveNudge}
              onClearUx={onClearUx}
              justDropped={justDropped}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main UxSchemaEditor Component
// =============================================================================

export function UxSchemaEditor({
  displaySchema: initialDisplaySchema,
  dataSchema,
  data,
  onChange,
  onSave,
  className,
  customPreview,
  previewControls,
}: UxSchemaEditorProps) {
  const [activeItem, setActiveItem] = useState<UxItem | null>(null);
  const [justDropped, setJustDropped] = useState<DropInfo>(null);
  const [isDirty, setIsDirty] = useState(false);
  const dropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editor state for bidirectional sync
  const [editorText, setEditorText] = useState<string>("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTreeUpdateRef = useRef<number>(0);

  // Build initial tree from schemas (displaySchema is primary, dataSchema for diff)
  const initialTree = useMemo(
    () => buildConfiguredTree(initialDisplaySchema, dataSchema),
    [dataSchema, initialDisplaySchema]
  );
  const [configuredTree, setConfiguredTree] = useState<ConfiguredNode>(initialTree);

  // Reset tree when dataSchema or initialDisplaySchema changes
  useEffect(() => {
    setConfiguredTree(buildConfiguredTree(initialDisplaySchema, dataSchema));
    setIsDirty(false);
    setEditorError(null);
  }, [dataSchema, initialDisplaySchema]);

  // Generate display schema from current tree
  const displaySchema = useMemo(
    () => generateDisplaySchema(configuredTree),
    [configuredTree]
  );

  // Sync tree changes to editor text (only when not actively editing)
  useEffect(() => {
    if (!isEditorFocused) {
      setEditorText(JSON.stringify(displaySchema, null, 2));
      setEditorError(null);
    }
  }, [displaySchema, isEditorFocused]);

  // Call onChange when display schema changes
  useEffect(() => {
    if (isDirty) {
      onChange?.(displaySchema);
    }
  }, [displaySchema, isDirty, onChange]);

  // Parse editor text and sync back to tree (debounced)
  const syncEditorToTree = useCallback(
    (text: string) => {
      try {
        const parsed = JSON.parse(text) as SchemaProperty;
        // Rebuild tree from the edited schema (parsed becomes the new displaySchema)
        const newTree = buildConfiguredTree(parsed, dataSchema);
        setConfiguredTree(newTree);
        setEditorError(null);
        setIsDirty(true);
        lastTreeUpdateRef.current = Date.now();
      } catch (e) {
        setEditorError(e instanceof Error ? e.message : "Invalid JSON");
      }
    },
    [dataSchema]
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      setEditorText(value);

      // Debounce the sync to tree
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        syncEditorToTree(value);
      }, 500);
    },
    [syncEditorToTree]
  );

  const handleEditorFocus = useCallback(() => {
    setIsEditorFocused(true);
  }, []);

  const handleEditorBlur = useCallback(() => {
    setIsEditorFocused(false);
    // On blur, if there's no error, ensure text matches the tree
    if (!editorError) {
      setEditorText(JSON.stringify(displaySchema, null, 2));
    }
  }, [editorError, displaySchema]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const eventData = event.active.data.current as UxItem | undefined;
    if (eventData) {
      setActiveItem(eventData);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveItem(null);

    const { active, over } = event;
    if (!over) return;

    const dragData = active.data.current as UxItem | undefined;
    const dropData = over.data.current as { node?: ConfiguredNode } | undefined;

    if (!dragData || !dropData?.node) return;

    const targetId = dropData.node.id;
    const { category, value } = dragData;

    // Apply the UX config based on category
    if (category === "nudges") {
      setConfiguredTree((prev) => addNudgeToNode(prev, targetId, value));
    } else if (category === "display") {
      setConfiguredTree((prev) => updateNodeUx(prev, targetId, { display: value as DisplayMode }));
    } else if (category === "toggles") {
      if (value === "selectable") {
        setConfiguredTree((prev) => updateNodeUx(prev, targetId, { selectable: true }));
      } else if (value === "highlight") {
        setConfiguredTree((prev) => updateNodeUx(prev, targetId, { highlight: true }));
      }
    } else {
      // containers, layouts, roles, terminal all set render_as
      setConfiguredTree((prev) => updateNodeUx(prev, targetId, { render_as: value }));
    }

    setIsDirty(true);

    // Show visual feedback on the drop target
    setJustDropped({ nodeId: targetId, value });
    if (dropTimeoutRef.current) {
      clearTimeout(dropTimeoutRef.current);
    }
    dropTimeoutRef.current = setTimeout(() => {
      setJustDropped(null);
    }, 600);
  };

  const handleRemoveNudge = (nodeId: string, nudge: string) => {
    setConfiguredTree((prev) => removeNudgeFromNode(prev, nodeId, nudge));
    setIsDirty(true);
  };

  const handleClearUx = (nodeId: string, key: keyof NodeUxConfig) => {
    setConfiguredTree((prev) => clearNodeUxKey(prev, nodeId, key));
    setIsDirty(true);
  };

  const handleSave = () => {
    onSave?.(displaySchema);
    setIsDirty(false);
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={`h-full min-h-0 flex flex-col bg-background ${className || ""}`}>
        {/* Main content - 50/50 split */}
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4 p-4">
          {/* Left: Schema Tree + UX Palette */}
          <div className="min-h-0 flex flex-col gap-4">
            <Card className="min-h-0 overflow-auto">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Data Schema (drop targets)</CardTitle>
              </CardHeader>
              <CardContent>
                <DroppableTreeNode
                  node={configuredTree}
                  depth={0}
                  onRemoveNudge={handleRemoveNudge}
                  onClearUx={handleClearUx}
                  justDropped={justDropped}
                />
              </CardContent>
            </Card>

            <Card className="min-h-0 overflow-auto">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">UX Palette (drag from here)</CardTitle>
              </CardHeader>
              <CardContent>
                <UxPalette />
              </CardContent>
            </Card>
          </div>

          {/* Right: Preview + Generated Schema */}
          <div className="min-h-0 flex flex-col gap-4">
            <Card className="flex-1 min-h-0 overflow-auto">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm">Live Preview</CardTitle>
                  {previewControls && (
                    <div className="flex items-center gap-2">{previewControls}</div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {customPreview ?? (
                  <>
                    <RenderProvider value={{ debugMode: false, readonly: false }}>
                      <SchemaRenderer data={data} schema={displaySchema} />
                    </RenderProvider>
                    {/* Debug: show raw data if nothing renders */}
                    <details className="mt-4 text-xs">
                      <summary className="text-muted-foreground cursor-pointer">
                        Debug: Raw Data
                      </summary>
                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto max-h-40">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="flex-1 min-h-0 overflow-hidden">
              <CardHeader className="pb-2 flex flex-row items-center justify-between">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm">Display Schema</CardTitle>
                  {editorError && (
                    <Badge variant="destructive" className="text-xs">
                      JSON Error
                    </Badge>
                  )}
                  {isEditorFocused && !editorError && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Editing...
                    </Badge>
                  )}
                </div>
                {onSave && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!isDirty || !!editorError}
                    variant={isDirty ? "default" : "outline"}
                  >
                    {isDirty ? "Save Changes" : "Saved"}
                  </Button>
                )}
              </CardHeader>
              {editorError && (
                <div className="px-4 pb-2">
                  <p className="text-xs text-destructive">{editorError}</p>
                </div>
              )}
              <CardContent className="h-[calc(100%-4rem)] p-0">
                <Editor
                  height="100%"
                  defaultLanguage="json"
                  value={editorText}
                  onChange={handleEditorChange}
                  onMount={(editor) => {
                    editor.onDidFocusEditorText(handleEditorFocus);
                    editor.onDidBlurEditorText(handleEditorBlur);
                  }}
                  options={{
                    readOnly: false,
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineNumbers: "off",
                    scrollBeyondLastLine: false,
                    folding: true,
                    wordWrap: "on",
                    automaticLayout: true,
                  }}
                  theme="vs-dark"
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Drag overlay - no drop animation (just disappears at drop location) */}
        <DragOverlay dropAnimation={null}>
          {activeItem ? (
            <div className="px-3 py-1.5 text-sm rounded border bg-primary text-primary-foreground shadow-lg">
              {activeItem.value}
            </div>
          ) : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
