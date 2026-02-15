import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RenderProvider,
  SchemaRenderer,
  getUx,
  normalizeDisplay,
  type DisplayMode,
  type SchemaProperty,
} from "@wfm/shared";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";
import type {
  ConfiguredNode,
  DataSchemaNode,
  NodeDiffStatus,
  NodeUxConfig,
  UxSchemaEditorProps,
} from "./types";

type LevelColorMode = "none" | "generated" | "fixed";

type SelectionColor = {
  border: string;
  fill: string;
  subtle: string;
  ring: string;
};

type TextRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

const RENDER_AS_OPTIONS = [
  "card-stack",
  "grid",
  "list",
  "section-list",
  "tabs",
  "card",
  "section",
  "table",
  "content-panel",
  "card-title",
  "card-subtitle",
  "section-header",
  "section-title",
  "section-badge",
  "section-summary",
  "column",
  "row",
  "cell",
  "tab",
  "text",
  "color",
  "url",
  "datetime",
  "number",
  "image",
  "media",
  "image_generation",
  "video_generation",
  "audio_generation",
] as const;

const NUDGE_OPTIONS = [
  "copy",
  "swatch",
  "external-link",
  "preview",
  "download",
  "index-badge",
] as const;

const FIXED_LEVEL_HUES = [210, 160, 35, 285, 350, 95];

function getSelectionColor(depth: number, mode: LevelColorMode): SelectionColor | null {
  if (mode === "none") return null;
  const hue =
    mode === "fixed"
      ? FIXED_LEVEL_HUES[depth % FIXED_LEVEL_HUES.length]
      : (depth * 41 + 205) % 360;

  return {
    border: `hsl(${hue} 70% 56% / 0.62)`,
    fill: `hsl(${hue} 82% 78% / 0.18)`,
    subtle: `hsl(${hue} 85% 82% / 0.14)`,
    ring: `hsl(${hue} 70% 56% / 0.34)`,
  };
}

function extractUxFromSchema(schema?: SchemaProperty): NodeUxConfig {
  if (!schema) return {};
  const ux = getUx(schema as Record<string, unknown>);
  return {
    render_as: ux.render_as,
    display: ux.display,
    display_format: ux.display_format,
    nudges: ux.nudges ? [...ux.nudges] : undefined,
    selectable: ux.selectable,
    highlight: ux.highlight,
    display_label: ux.display_label,
    display_order: ux.display_order,
  };
}

function getSchemaType(schema?: SchemaProperty): DataSchemaNode["type"] {
  return schema?.type || "object";
}

function buildConfiguredTree(
  displaySchema: SchemaProperty | undefined,
  dataSchema: DataSchemaNode | undefined,
  path: string[] = [],
  name = "(root)"
): ConfiguredNode {
  const id = path.length === 0 ? "(root)" : path.join(".");
  const schemaType = getSchemaType(displaySchema) || dataSchema?.type || "object";

  let diffStatus: NodeDiffStatus = "normal";
  if (path.length > 0 && !dataSchema) {
    diffStatus = displaySchema ? "deleted" : "addable";
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

  if (schemaType === "object") {
    const displayProps = displaySchema?.properties || {};
    const displayAdditional = displaySchema?.additionalProperties;
    const dataProps = dataSchema?.type === "object" ? dataSchema.properties || {} : {};

    for (const [key, childDisplaySchema] of Object.entries(displayProps)) {
      const childDataSchema = dataProps[key];
      children.push(
        buildConfiguredTree(childDisplaySchema, childDataSchema, [...path, key], key)
      );
    }

    if (displayAdditional) {
      for (const key of Object.keys(dataProps)) {
        if (!(key in displayProps)) {
          children.push(
            buildConfiguredTree(displayAdditional, dataProps[key], [...path, key], key)
          );
        }
      }
    } else {
      for (const [key, childDataSchema] of Object.entries(dataProps)) {
        if (!(key in displayProps)) {
          children.push(buildConfiguredTreeFromDataOnly(childDataSchema, [...path, key], key));
        }
      }
    }
  } else if (schemaType === "array") {
    const itemsDisplaySchema = displaySchema?.items;
    const itemsDataSchema = dataSchema?.type === "array" ? dataSchema.items : undefined;
    if (itemsDisplaySchema || itemsDataSchema) {
      children.push(
        buildConfiguredTree(itemsDisplaySchema, itemsDataSchema, [...path, "[items]"], "[items]")
      );
    }
  }

  if (children.length > 0) node.children = children;
  return node;
}

function buildConfiguredTreeFromDataOnly(
  dataSchema: DataSchemaNode,
  path: string[],
  name: string
): ConfiguredNode {
  const node: ConfiguredNode = {
    id: path.join("."),
    name,
    path,
    schemaType: dataSchema.type,
    isLeaf: dataSchema.type !== "object" && dataSchema.type !== "array",
    ux: {},
    diffStatus: "addable",
  };

  if (dataSchema.type === "object" && dataSchema.properties) {
    node.children = Object.entries(dataSchema.properties).map(([k, v]) =>
      buildConfiguredTreeFromDataOnly(v, [...path, k], k)
    );
  } else if (dataSchema.type === "array" && dataSchema.items) {
    node.children = [
      buildConfiguredTreeFromDataOnly(dataSchema.items, [...path, "[items]"], "[items]"),
    ];
  }

  return node;
}

function flattenTree(
  node: ConfiguredNode,
  depth = 0,
  out: Array<{ node: ConfiguredNode; depth: number }> = []
): Array<{ node: ConfiguredNode; depth: number }> {
  out.push({ node, depth });
  if (node.children) {
    for (const child of node.children) {
      flattenTree(child, depth + 1, out);
    }
  }
  return out;
}

function hasAnyUx(ux: NodeUxConfig): boolean {
  return Boolean(
    ux.render_as ||
      ux.display !== undefined ||
      ux.display_format ||
      ux.display_label ||
      ux.display_order !== undefined ||
      (ux.nudges && ux.nudges.length > 0) ||
      ux.selectable ||
      ux.highlight
  );
}

function updateNode(
  tree: ConfiguredNode,
  targetId: string,
  updater: (node: ConfiguredNode) => ConfiguredNode
): ConfiguredNode {
  if (tree.id === targetId) {
    return updater(tree);
  }
  if (!tree.children) return tree;
  return {
    ...tree,
    children: tree.children.map((child) => updateNode(child, targetId, updater)),
  };
}

function shouldIncludeNode(node: ConfiguredNode): boolean {
  if (node.diffStatus !== "addable") return true;
  if (hasAnyUx(node.ux)) return true;
  return Boolean(node.children?.some((child) => shouldIncludeNode(child)));
}

function generateDisplaySchema(node: ConfiguredNode): SchemaProperty {
  const schema: SchemaProperty = {
    type: node.schemaType as SchemaProperty["type"],
  };

  const uxConfig: Record<string, unknown> = {};
  if (node.ux.display !== undefined) {
    uxConfig.display = normalizeDisplay(node.ux.display);
  }
  if (node.ux.render_as) uxConfig.render_as = node.ux.render_as;
  if (node.ux.display_format) uxConfig.display_format = node.ux.display_format;
  if (node.ux.display_label) uxConfig.display_label = node.ux.display_label;
  if (node.ux.display_order !== undefined) uxConfig.display_order = node.ux.display_order;
  if (node.ux.nudges && node.ux.nudges.length > 0) uxConfig.nudges = node.ux.nudges;
  if (node.ux.selectable) uxConfig.selectable = true;
  if (node.ux.highlight) uxConfig.highlight = true;

  if (Object.keys(uxConfig).length > 0) {
    (schema as Record<string, unknown>)._ux = uxConfig;
  }

  if (node.schemaType === "object" && node.children) {
    schema.properties = {};
    for (const child of node.children) {
      if (shouldIncludeNode(child)) {
        schema.properties[child.name] = generateDisplaySchema(child);
      }
    }
  } else if (node.schemaType === "array" && node.children?.[0]) {
    schema.items = generateDisplaySchema(node.children[0]);
  }

  return schema;
}

function indexToLineCol(text: string, index: number): { line: number; col: number } {
  const prefix = text.slice(0, Math.max(0, index));
  const lines = prefix.split("\n");
  return { line: lines.length, col: (lines[lines.length - 1]?.length || 0) + 1 };
}

function findClosingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findSelectedPathRange(text: string, selectedPath: string[]): TextRange | null {
  if (!text.trim()) return null;
  if (selectedPath.length === 0) {
    const lines = text.split("\n");
    return {
      startLine: 1,
      startColumn: 1,
      endLine: lines.length,
      endColumn: (lines[lines.length - 1]?.length || 0) + 1,
    };
  }

  const keys = selectedPath.map((x) => (x === "[items]" ? "items" : x));
  let searchIndex = 0;
  let lastKeyStart = -1;
  let lastValueStart = -1;

  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`"${escaped}"\\s*:\\s*`, "g");
    regex.lastIndex = searchIndex;
    const match = regex.exec(text);
    if (!match) return null;
    lastKeyStart = match.index;
    lastValueStart = match.index + match[0].length;
    searchIndex = lastValueStart;
  }

  if (lastKeyStart < 0 || lastValueStart < 0) return null;
  let start = lastValueStart;
  while (start < text.length && /\s/.test(text[start])) start += 1;
  if (text[start] !== "{") return null;

  const end = findClosingBrace(text, start);
  if (end < 0) return null;

  const startPos = indexToLineCol(text, lastKeyStart);
  const endPos = indexToLineCol(text, end);
  return {
    startLine: startPos.line,
    startColumn: startPos.col,
    endLine: endPos.line,
    endColumn: endPos.col + 1,
  };
}

function DiffBadge({ status }: { status: NodeDiffStatus }) {
  if (status === "deleted") {
    return <Badge className="text-[10px] bg-red-500/15 text-red-600">deleted</Badge>;
  }
  if (status === "addable") {
    return <Badge className="text-[10px] bg-green-500/15 text-green-600">addable</Badge>;
  }
  return null;
}

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
  const monacoTheme = useMonacoTheme();
  const [levelColorMode, setLevelColorMode] = useState<LevelColorMode>("generated");
  const [isDirty, setIsDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState("(root)");

  const [editorText, setEditorText] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isEditorFocused, setIsEditorFocused] = useState(false);

  const initialTree = useMemo(
    () => buildConfiguredTree(initialDisplaySchema, dataSchema),
    [initialDisplaySchema, dataSchema]
  );
  const [configuredTree, setConfiguredTree] = useState(initialTree);

  const monacoEditorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Only rehydrate from props when editor is not locally dirty.
    // This prevents selection/focus jumps when parent echoes onChange updates.
    if (isDirty) return;

    setConfiguredTree(buildConfiguredTree(initialDisplaySchema, dataSchema));
    setSelectedNodeId("(root)");
    setEditorError(null);
  }, [initialDisplaySchema, dataSchema, isDirty]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const displaySchema = useMemo(() => generateDisplaySchema(configuredTree), [configuredTree]);

  const flatNodes = useMemo(() => flattenTree(configuredTree), [configuredTree]);
  const selected =
    flatNodes.find((x) => x.node.id === selectedNodeId) || flatNodes[0];
  const selectedNode = selected.node;
  const selectedDepth = selected.depth;
  const selectedColor = getSelectionColor(selectedDepth, levelColorMode);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!flatNodes.some((x) => x.node.id === selectedNodeId)) {
      setSelectedNodeId("(root)");
    }
  }, [flatNodes, selectedNodeId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isEditorFocused) {
      setEditorText(JSON.stringify(displaySchema, null, 2));
      setEditorError(null);
    }
  }, [displaySchema, isEditorFocused]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isDirty) onChange?.(displaySchema);
  }, [displaySchema, isDirty, onChange]);

  useEffect(() => {
    const editor = monacoEditorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const domNode = editor.getDomNode();
    if (domNode) {
      domNode.style.setProperty(
        "--ux-poc-selection-border",
        selectedColor?.border || "color-mix(in oklch, var(--ring) 55%, transparent)"
      );
      domNode.style.setProperty(
        "--ux-poc-selection-fill",
        selectedColor?.subtle || "color-mix(in oklch, var(--accent) 45%, transparent)"
      );
    }

    const range = findSelectedPathRange(editorText, selectedNode.path);
    if (!range) {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      return;
    }

    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, [
      {
        range: new monaco.Range(
          range.startLine,
          range.startColumn,
          range.endLine,
          range.endColumn
        ),
        options: {
          className: "ux-poc-json-selection",
          minimap: { color: selectedColor?.border || "#60a5fa", position: 1 },
          overviewRuler: { color: selectedColor?.border || "#60a5fa", position: 2 },
        },
      },
    ]);
  }, [selectedNode.path, editorText, selectedColor]);

  const updateSelectedUx = useCallback(
    (patch: Partial<NodeUxConfig>) => {
      setConfiguredTree((prev) =>
        updateNode(prev, selectedNode.id, (node) => {
          const nextUx = { ...node.ux, ...patch };
          Object.keys(nextUx).forEach((k) => {
            const key = k as keyof NodeUxConfig;
            const val = nextUx[key];
            if (
              val === undefined ||
              val === "" ||
              (Array.isArray(val) && val.length === 0)
            ) {
              delete nextUx[key];
            }
          });

          return {
            ...node,
            ux: nextUx,
            diffStatus: node.diffStatus === "addable" && hasAnyUx(nextUx) ? "normal" : node.diffStatus,
          };
        })
      );
      setIsDirty(true);
    },
    [selectedNode.id]
  );

  const clearUxKey = useCallback(
    (key: keyof NodeUxConfig) => {
      setConfiguredTree((prev) =>
        updateNode(prev, selectedNode.id, (node) => {
          const ux = { ...node.ux };
          delete ux[key];
          return { ...node, ux };
        })
      );
      setIsDirty(true);
    },
    [selectedNode.id]
  );

  const toggleNudge = useCallback(
    (nudge: string) => {
      const current = selectedNode.ux.nudges || [];
      if (current.includes(nudge)) {
        updateSelectedUx({ nudges: current.filter((x) => x !== nudge) });
      } else {
        updateSelectedUx({ nudges: [...current, nudge] });
      }
    },
    [selectedNode.ux.nudges, updateSelectedUx]
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) return;
      setEditorText(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        try {
          const parsed = JSON.parse(value) as SchemaProperty;
          setConfiguredTree(buildConfiguredTree(parsed, dataSchema));
          setEditorError(null);
          setIsDirty(true);
        } catch (e) {
          setEditorError(e instanceof Error ? e.message : "Invalid JSON");
        }
      }, 500);
    },
    [dataSchema]
  );

  const handleSave = () => {
    onSave?.(displaySchema);
    setIsDirty(false);
  };

  return (
    <div className={`h-full min-h-0 flex flex-col bg-background ${className || ""}`}>
      <div className="grid grid-cols-2 grid-rows-2 gap-4 flex-1 min-h-0 p-4">
        <Card className="min-h-0 overflow-auto">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Schema Outline</CardTitle>
              <select
                className="h-8 rounded border bg-background px-2 text-xs"
                value={levelColorMode}
                onChange={(e) => setLevelColorMode(e.target.value as LevelColorMode)}
              >
                <option value="none">Selected Outline: Default</option>
                <option value="generated">Selected Outline: Generated</option>
                <option value="fixed">Selected Outline: Fixed Set</option>
              </select>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {flatNodes.map(({ node, depth }) => {
              const nodeColor = getSelectionColor(depth, levelColorMode);
              const selectedRow = selectedNode.id === node.id;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNodeId(node.id)}
                  className={[
                    "w-full rounded px-2 py-1.5 text-left text-xs border",
                    "flex items-center gap-2",
                    selectedRow ? "" : "bg-card border-transparent hover:bg-muted/40",
                  ].join(" ")}
                  style={{
                    paddingLeft: depth * 14 + 8,
                    borderColor: selectedRow ? (nodeColor?.border ?? undefined) : undefined,
                    backgroundColor: selectedRow
                      ? (nodeColor?.fill ?? "color-mix(in oklch, var(--accent) 16%, transparent)")
                      : undefined,
                    boxShadow:
                      selectedRow && nodeColor
                        ? `inset 0 0 0 1px ${nodeColor.ring}`
                        : undefined,
                  }}
                >
                  <span className="font-medium">{node.name}</span>
                  <span className="text-muted-foreground">[{node.schemaType}]</span>
                  <DiffBadge status={node.diffStatus} />
                  {node.ux.render_as ? <Badge variant="outline" className="text-[10px]">{node.ux.render_as}</Badge> : null}
                  {node.ux.display !== undefined ? <Badge variant="outline" className="text-[10px]">display={String(node.ux.display)}</Badge> : null}
                  {node.ux.display_label ? <Badge variant="outline" className="text-[10px]">display_label={node.ux.display_label}</Badge> : null}
                  {node.ux.display_format ? <Badge variant="outline" className="text-[10px]">display_format={node.ux.display_format}</Badge> : null}
                  {node.ux.display_order !== undefined ? <Badge variant="outline" className="text-[10px]">display_order={node.ux.display_order}</Badge> : null}
                  {node.ux.nudges?.map((n) => (
                    <Badge key={`${node.id}-${n}`} variant="outline" className="text-[10px]">{n}</Badge>
                  ))}
                  {node.ux.selectable ? <Badge variant="outline" className="text-[10px]">selectable</Badge> : null}
                  {node.ux.highlight ? <Badge variant="outline" className="text-[10px]">highlight</Badge> : null}
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card
          className="min-h-0 overflow-auto border"
          style={{ borderColor: selectedColor?.border }}
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Inspector (selected node)</CardTitle>
              <Badge
                variant="outline"
                className="text-[10px]"
                style={{
                  borderColor: selectedColor?.border,
                  backgroundColor: selectedColor?.subtle,
                }}
              >
                Linked Selection
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div
              className="rounded border p-2"
              style={{
                borderColor: selectedColor?.border,
                backgroundColor: selectedColor?.subtle,
              }}
            >
              <div>Path: <code>{selectedNode.id}</code></div>
              <div>Type: <code>{selectedNode.schemaType}</code></div>
              <div>Status: <code>{selectedNode.diffStatus}</code></div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span>Display</span>
                <select
                  className="w-full rounded border bg-background px-2 py-1"
                  value={selectedNode.ux.display === undefined ? "" : String(selectedNode.ux.display)}
                  onChange={(e) =>
                    updateSelectedUx({
                      display: (e.target.value || undefined) as DisplayMode | undefined,
                    })
                  }
                >
                  <option value="">(unset)</option>
                  <option value="visible">visible</option>
                  <option value="hidden">hidden</option>
                  <option value="passthrough">passthrough</option>
                </select>
              </label>

              <label className="space-y-1">
                <span>render_as</span>
                <select
                  className="w-full rounded border bg-background px-2 py-1"
                  value={selectedNode.ux.render_as || ""}
                  onChange={(e) => updateSelectedUx({ render_as: e.target.value || undefined })}
                >
                  <option value="">(unset)</option>
                  {RENDER_AS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span>display_label</span>
                <input
                  className="w-full rounded border bg-background px-2 py-1"
                  value={selectedNode.ux.display_label || ""}
                  onChange={(e) => updateSelectedUx({ display_label: e.target.value || undefined })}
                />
              </label>
              <label className="space-y-1">
                <span>display_order</span>
                <input
                  type="number"
                  className="w-full rounded border bg-background px-2 py-1"
                  value={selectedNode.ux.display_order ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateSelectedUx({ display_order: v === "" ? undefined : Number(v) });
                  }}
                />
              </label>
            </div>

            <label className="space-y-1 block">
              <span>display_format</span>
              <input
                className="w-full rounded border bg-background px-2 py-1"
                value={selectedNode.ux.display_format || ""}
                onChange={(e) => updateSelectedUx({ display_format: e.target.value || undefined })}
              />
            </label>

            <div className="space-y-1">
              <span>Nudges</span>
              <div className="flex flex-wrap gap-1">
                {NUDGE_OPTIONS.map((nudge) => {
                  const active = (selectedNode.ux.nudges || []).includes(nudge);
                  return (
                    <button
                      key={nudge}
                      type="button"
                      className={[
                        "rounded border px-2 py-0.5 text-[11px]",
                        active ? "bg-primary/15 border-primary" : "bg-card",
                      ].join(" ")}
                      onClick={() => toggleNudge(nudge)}
                    >
                      {nudge}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedNode.ux.selectable === true}
                  onChange={(e) => updateSelectedUx({ selectable: e.target.checked || undefined })}
                />
                selectable
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={selectedNode.ux.highlight === true}
                  onChange={(e) => updateSelectedUx({ highlight: e.target.checked || undefined })}
                />
                highlight
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => clearUxKey("render_as")}>Clear render_as</Button>
              <Button size="sm" variant="outline" onClick={() => clearUxKey("display")}>Clear display</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm">Display Schema</CardTitle>
              {editorError && <Badge variant="destructive" className="text-xs">JSON Error</Badge>}
            </div>
            {onSave ? (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!isDirty || !!editorError}
                variant={isDirty ? "default" : "outline"}
              >
                {isDirty ? "Save Changes" : "Saved"}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="h-[calc(100%-3.5rem)] p-0">
            <Editor
              height="100%"
              defaultLanguage="json"
              value={editorText}
              onChange={handleEditorChange}
              onMount={(editor, monaco) => {
                monacoEditorRef.current = editor;
                monacoRef.current = monaco;
                editor.onDidFocusEditorText(() => setIsEditorFocused(true));
                editor.onDidBlurEditorText(() => setIsEditorFocused(false));
              }}
              options={{
                readOnly: false,
                minimap: { enabled: true },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                folding: true,
                wordWrap: "on",
                automaticLayout: true,
              }}
                theme={monacoTheme}
            />
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm">Live Preview</CardTitle>
              {previewControls && <div className="flex items-center gap-2">{previewControls}</div>}
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-3.5rem)] overflow-auto">
            {customPreview ?? (
              <RenderProvider value={{ debugMode: false, readonly: false }}>
                <SchemaRenderer data={data} schema={displaySchema} />
              </RenderProvider>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
