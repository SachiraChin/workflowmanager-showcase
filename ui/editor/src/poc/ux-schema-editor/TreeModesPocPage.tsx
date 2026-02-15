import { useEffect, useMemo, useRef, useState } from "react";
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
  type SchemaProperty,
} from "@wfm/shared";
import {
  samplePetTypeData,
  sampleScenesData,
  petTypeDataSchema,
  scenesDataSchema,
  ALL_RENDER_AS,
  DISPLAY_MODES,
  NUDGES,
  type DataSchemaNode,
} from "./sample-data";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

type DatasetOption = "petTypes" | "scenes";
type LevelColorMode = "none" | "generated" | "fixed";
type DiffStatus = "normal" | "deleted" | "addable";

type NodeUx = {
  display?: string;
  render_as?: string;
  display_label?: string;
  display_format?: string;
  display_order?: number;
  nudges?: string[];
  selectable?: boolean;
  highlight?: boolean;
};

type TreeNode = {
  id: string;
  name: string;
  path: string[];
  schemaType: string;
  diffStatus: DiffStatus;
  ux: NodeUx;
  children: TreeNode[];
};

const LINK_BORDER_CLASS = "border-sky-400/60 dark:border-sky-500/50";
const LINK_FILL_CLASS = "bg-sky-500/10 dark:bg-sky-500/10";
const FIXED_LEVEL_HUES = [210, 160, 35, 285, 350, 95];

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

function indexToLineCol(text: string, index: number): { line: number; col: number } {
  const prefix = text.slice(0, Math.max(0, index));
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    col: (lines[lines.length - 1]?.length || 0) + 1,
  };
}

function findClosingBrace(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
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

  const normalizedKeys = selectedPath.map((p) => (p === "[items]" ? "items" : p));

  let searchIndex = 0;
  let lastValueStart = -1;
  let lastKeyStart = -1;

  for (const key of normalizedKeys) {
    const keyPattern = new RegExp(`"${key.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"\\s*:\\s*`, "g");
    keyPattern.lastIndex = searchIndex;
    const match = keyPattern.exec(text);
    if (!match) return null;

    const valueStart = match.index + match[0].length;
    lastKeyStart = match.index;
    lastValueStart = valueStart;
    searchIndex = valueStart;
  }

  if (lastValueStart < 0 || lastKeyStart < 0) return null;

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

function getSelectionColor(depth: number, mode: LevelColorMode): SelectionColor | null {
  if (mode === "none") return null;

  const hue = mode === "fixed"
    ? FIXED_LEVEL_HUES[depth % FIXED_LEVEL_HUES.length]
    : (depth * 41 + 205) % 360;

  return {
    border: `hsl(${hue} 70% 56% / 0.62)`,
    fill: `hsl(${hue} 82% 78% / 0.18)`,
    subtle: `hsl(${hue} 85% 82% / 0.14)`,
    ring: `hsl(${hue} 70% 56% / 0.34)`,
  };
}

const datasets: Record<
  DatasetOption,
  {
    data: unknown;
    schema: DataSchemaNode;
    label: string;
    displaySchema?: SchemaProperty;
  }
> = {
  petTypes: {
    data: samplePetTypeData,
    schema: petTypeDataSchema,
    label: "Pet Types (array/object)",
    displaySchema: {
      type: "array",
      _ux: { display: "visible", render_as: "card-stack" },
      items: {
        type: "object",
        _ux: { display: "visible", render_as: "card", selectable: true },
        properties: {
          id: { type: "string", _ux: { display: "hidden" } },
          label: { type: "string", _ux: { display: "visible", render_as: "card-title" } },
          description: {
            type: "string",
            _ux: { display: "visible", render_as: "card-subtitle" },
          },
        },
      },
    },
  },
  scenes: {
    data: sampleScenesData.scenes,
    schema: scenesDataSchema.properties?.scenes as DataSchemaNode,
    label: "Scenes (nested)",
  },
};

function pathKey(path: string[]): string {
  return path.length === 0 ? "(root)" : path.join(".");
}

function splitPath(key: string): string[] {
  return key === "(root)" ? [] : key.split(".");
}

function collectDataPaths(
  schema: DataSchemaNode,
  path: string[] = [],
  out: Map<string, string> = new Map()
): Map<string, string> {
  out.set(pathKey(path), schema.type);
  if (schema.type === "object" && schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      collectDataPaths(v, [...path, k], out);
    }
  }
  if (schema.type === "array" && schema.items) {
    collectDataPaths(schema.items, [...path, "[items]"], out);
  }
  return out;
}

function collectDisplayPaths(
  schema: SchemaProperty | undefined,
  path: string[] = [],
  outTypes: Map<string, string> = new Map(),
  outUx: Map<string, NodeUx> = new Map()
): { types: Map<string, string>; ux: Map<string, NodeUx> } {
  if (!schema) {
    return { types: outTypes, ux: outUx };
  }

  outTypes.set(pathKey(path), schema.type || "object");
  const ux = getUx(schema as Record<string, unknown>);
  outUx.set(pathKey(path), {
    display: ux.display as string | undefined,
    render_as: ux.render_as,
    display_label: ux.display_label,
    display_format: ux.display_format,
    display_order: ux.display_order,
    nudges: ux.nudges ? [...ux.nudges] : undefined,
    selectable: ux.selectable,
    highlight: ux.highlight,
  });

  if (schema.type === "object" && schema.properties) {
    for (const [k, v] of Object.entries(schema.properties)) {
      collectDisplayPaths(v, [...path, k], outTypes, outUx);
    }
  }
  if (schema.type === "array" && schema.items) {
    collectDisplayPaths(schema.items, [...path, "[items]"], outTypes, outUx);
  }

  return { types: outTypes, ux: outUx };
}

function buildDisplaySchemaFromData(schema: DataSchemaNode, uxByPath: Map<string, NodeUx>, path: string[] = []): SchemaProperty {
  const key = pathKey(path);
  const ux = uxByPath.get(key) || {};
  const next: SchemaProperty = { type: schema.type };
  const nextUx: Record<string, unknown> = {};

  if (ux.display !== undefined) nextUx.display = ux.display;
  if (ux.render_as) nextUx.render_as = ux.render_as;
  if (ux.display_label) nextUx.display_label = ux.display_label;
  if (ux.display_format) nextUx.display_format = ux.display_format;
  if (ux.display_order !== undefined && !Number.isNaN(ux.display_order)) {
    nextUx.display_order = ux.display_order;
  }
  if (ux.nudges && ux.nudges.length > 0) nextUx.nudges = ux.nudges;
  if (ux.selectable) nextUx.selectable = true;
  if (ux.highlight) nextUx.highlight = true;
  if (Object.keys(nextUx).length > 0) {
    (next as Record<string, unknown>)._ux = nextUx;
  }

  if (schema.type === "object" && schema.properties) {
    next.properties = {};
    for (const [k, child] of Object.entries(schema.properties)) {
      next.properties[k] = buildDisplaySchemaFromData(child, uxByPath, [...path, k]);
    }
  }
  if (schema.type === "array" && schema.items) {
    next.items = buildDisplaySchemaFromData(schema.items, uxByPath, [...path, "[items]"]);
  }

  return next;
}

function buildTree(
  dataPaths: Map<string, string>,
  displayPaths: Map<string, string>,
  uxByPath: Map<string, NodeUx>
): TreeNode {
  const allKeys = new Set<string>([...dataPaths.keys(), ...displayPaths.keys()]);
  allKeys.add("(root)");

  const nodes = new Map<string, TreeNode>();
  for (const key of allKeys) {
    const path = splitPath(key);
    const inData = dataPaths.has(key);
    const inDisplay = displayPaths.has(key);
    const diffStatus: DiffStatus = inData && inDisplay ? "normal" : inDisplay ? "deleted" : "addable";
    const name = path.length === 0 ? "(root)" : path[path.length - 1];
    nodes.set(key, {
      id: key,
      name,
      path,
      schemaType: displayPaths.get(key) || dataPaths.get(key) || "string",
      diffStatus,
      ux: uxByPath.get(key) || {},
      children: [],
    });
  }

  for (const key of allKeys) {
    if (key === "(root)") continue;
    const path = splitPath(key);
    const parentPath = path.slice(0, -1);
    const parentKey = pathKey(parentPath);
    const node = nodes.get(key);
    const parent = nodes.get(parentKey);
    if (node && parent) {
      parent.children.push(node);
    }
  }

  for (const node of nodes.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
  }

  return nodes.get("(root)")!;
}

function flattenTree(root: TreeNode, depth = 0, out: Array<{ node: TreeNode; depth: number }> = []) {
  out.push({ node: root, depth });
  for (const child of root.children) {
    flattenTree(child, depth + 1, out);
  }
  return out;
}

function NodeBadge({ status }: { status: DiffStatus }) {
  if (status === "deleted") {
    return <Badge className="text-[10px] bg-red-500/15 text-red-600">deleted</Badge>;
  }
  if (status === "addable") {
    return <Badge className="text-[10px] bg-green-500/15 text-green-600">addable</Badge>;
  }
  return null;
}

function TreeRow({
  node,
  selected,
  onSelect,
  depth,
  levelColorMode,
}: {
  node: TreeNode;
  selected: boolean;
  onSelect: (id: string) => void;
  depth: number;
  levelColorMode: LevelColorMode;
}) {
  const selectionColor = getSelectionColor(depth, levelColorMode);

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      className={[
        "w-full rounded px-2 py-1.5 text-left text-xs border",
        "flex items-center gap-2",
        selected
          ? `${selectionColor ? "" : LINK_FILL_CLASS}`
          : "bg-card border-transparent hover:bg-muted/40",
      ].join(" ")}
      style={{
        paddingLeft: depth * 14 + 8,
        borderColor: selected
          ? (selectionColor?.border ?? undefined)
          : undefined,
        backgroundColor: selected && selectionColor ? selectionColor.fill : undefined,
        boxShadow: selected && selectionColor
          ? `inset 0 0 0 1px ${selectionColor.ring}`
          : undefined,
      }}
    >
      <span className="font-medium">{node.name}</span>
      <span className="text-muted-foreground">[{node.schemaType}]</span>
      <NodeBadge status={node.diffStatus} />
      {node.ux.render_as ? <Badge variant="outline" className="text-[10px]">{node.ux.render_as}</Badge> : null}
      {node.ux.display ? <Badge variant="outline" className="text-[10px]">display={node.ux.display}</Badge> : null}
      {node.ux.display_label ? <Badge variant="outline" className="text-[10px]">display_label={node.ux.display_label}</Badge> : null}
      {node.ux.display_format ? <Badge variant="outline" className="text-[10px]">display_format={node.ux.display_format}</Badge> : null}
      {node.ux.display_order !== undefined ? (
        <Badge variant="outline" className="text-[10px]">display_order={node.ux.display_order}</Badge>
      ) : null}
      {node.ux.nudges?.map((n) => (
        <Badge key={`${node.id}-${n}`} variant="outline" className="text-[10px]">{n}</Badge>
      ))}
      {node.ux.selectable ? <Badge variant="outline" className="text-[10px]">selectable</Badge> : null}
      {node.ux.highlight ? <Badge variant="outline" className="text-[10px]">highlight</Badge> : null}
    </button>
  );
}

function OutlineTree({
  root,
  selectedId,
  onSelect,
  levelColorMode,
}: {
  root: TreeNode;
  selectedId: string;
  onSelect: (id: string) => void;
  levelColorMode: LevelColorMode;
}) {
  const flat = useMemo(() => flattenTree(root), [root]);
  return (
    <div className="space-y-1 max-h-[460px] overflow-auto rounded border p-2">
      {flat.map(({ node, depth }) => (
        <TreeRow
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          onSelect={onSelect}
          depth={depth}
          levelColorMode={levelColorMode}
        />
      ))}
    </div>
  );
}

export function TreeModesPocPage() {
  const monacoTheme = useMonacoTheme();
  const [dataset, setDataset] = useState<DatasetOption>("petTypes");
  const [levelColorMode, setLevelColorMode] = useState<LevelColorMode>("generated");

  const active = datasets[dataset];
  const [displaySchema, setDisplaySchema] = useState<SchemaProperty | undefined>(active.displaySchema);
  const [selectedId, setSelectedId] = useState("(root)");
  const [editorText, setEditorText] = useState(
    JSON.stringify(active.displaySchema || buildDisplaySchemaFromData(active.schema, new Map()), null, 2)
  );
  const [editorError, setEditorError] = useState<string | null>(null);
  const [jsonFlash, setJsonFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monacoEditorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const decorationIdsRef = useRef<string[]>([]);

  const triggerJsonFlash = () => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    setJsonFlash(true);
    flashTimerRef.current = setTimeout(() => {
      setJsonFlash(false);
    }, 280);
  };

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    triggerJsonFlash();
  }, [selectedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const dataPathTypes = useMemo(() => collectDataPaths(active.schema), [active.schema]);

  const displayData = useMemo(
    () => collectDisplayPaths(displaySchema),
    [displaySchema]
  );

  const root = useMemo(
    () => buildTree(dataPathTypes, displayData.types, displayData.ux),
    [dataPathTypes, displayData]
  );

  const selectedNode = useMemo(() => {
    const flat = flattenTree(root);
    return flat.find((x) => x.node.id === selectedId)?.node || root;
  }, [root, selectedId]);
  const selectedDepth = selectedNode.path.length;
  const selectedColor = getSelectionColor(selectedDepth, levelColorMode);

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
          minimap: { color: "#60a5fa", position: 1 },
          overviewRuler: { color: "#60a5fa", position: 2 },
        },
      },
    ]);
  }, [selectedNode.path, editorText, selectedColor]);

  const applyUxPatch = (patch: Partial<NodeUx>) => {
    const uxByPath = new Map(displayData.ux);
    const current = uxByPath.get(selectedNode.id) || {};
    uxByPath.set(selectedNode.id, { ...current, ...patch });
    const next = buildDisplaySchemaFromData(active.schema, uxByPath);
    setDisplaySchema(next);
    setEditorText(JSON.stringify(next, null, 2));
    setEditorError(null);
    triggerJsonFlash();
  };

  const toggleNudge = (nudge: string) => {
    const current = selectedNode.ux.nudges || [];
    if (current.includes(nudge)) {
      applyUxPatch({ nudges: current.filter((n) => n !== nudge) });
      return;
    }
    applyUxPatch({ nudges: [...current, nudge] });
  };

  const resetForDataset = (nextDataset: DatasetOption) => {
    const next = datasets[nextDataset];
    const initial = next.displaySchema || buildDisplaySchemaFromData(next.schema, new Map());
    setDisplaySchema(initial);
    setEditorText(JSON.stringify(initial, null, 2));
    setEditorError(null);
    setSelectedId("(root)");
  };

  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(editorText) as SchemaProperty;
      setDisplaySchema(parsed);
      setEditorError(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  return (
    <div className="h-full min-h-0 p-4 flex flex-col gap-4 bg-background">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">UX Tree Modes PoC</h1>
        <Badge variant="outline">A+B hybrid pre-refactor</Badge>
      </div>

      <div className="flex items-center gap-3">
        <select
          className="rounded border bg-background px-3 py-1.5 text-sm"
          value={dataset}
          onChange={(e) => {
            const next = e.target.value as DatasetOption;
            setDataset(next);
            resetForDataset(next);
          }}
        >
          {Object.entries(datasets).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>

        <Badge variant="outline">Tree: Flat Outline</Badge>

        <select
          className="rounded border bg-background px-3 py-1.5 text-sm"
          value={levelColorMode}
          onChange={(e) => setLevelColorMode(e.target.value as LevelColorMode)}
        >
          <option value="none">Selected Outline: Default</option>
          <option value="generated">Selected Outline: Generated</option>
          <option value="fixed">Selected Outline: Fixed Set</option>
        </select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const initial = active.displaySchema || buildDisplaySchemaFromData(active.schema, new Map());
            setDisplaySchema(initial);
            setEditorText(JSON.stringify(initial, null, 2));
            setEditorError(null);
            setSelectedId("(root)");
          }}
        >
          Reset Schema
        </Button>
      </div>

      <div className="grid grid-cols-2 grid-rows-2 gap-4 min-h-0 flex-1">
        <Card className="min-h-0 overflow-auto">
          <CardHeader>
            <CardTitle className="text-sm">Tree Candidate</CardTitle>
          </CardHeader>
          <CardContent>
            <OutlineTree
              root={root}
              selectedId={selectedId}
              onSelect={setSelectedId}
              levelColorMode={levelColorMode}
            />
          </CardContent>
        </Card>

        <Card
          className={`min-h-0 overflow-auto border ${selectedColor ? "" : LINK_BORDER_CLASS}`}
          style={{ borderColor: selectedColor?.border }}
        >
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Inspector (selected node)</CardTitle>
              <Badge
                variant="outline"
                className={`text-[10px] ${selectedColor ? "" : `${LINK_BORDER_CLASS} ${LINK_FILL_CLASS}`}`}
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
              className={`rounded border p-2 ${selectedColor ? "" : `${LINK_BORDER_CLASS} ${LINK_FILL_CLASS}`}`}
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
                    value={selectedNode.ux.display || ""}
                    onChange={(e) => applyUxPatch({ display: e.target.value || undefined })}
                  >
                    <option value="">(unset)</option>
                    {DISPLAY_MODES.map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span>render_as</span>
                  <select
                    className="w-full rounded border bg-background px-2 py-1"
                    value={selectedNode.ux.render_as || ""}
                    onChange={(e) => applyUxPatch({ render_as: e.target.value || undefined })}
                  >
                    <option value="">(unset)</option>
                    {ALL_RENDER_AS.map((x) => (
                      <option key={x} value={x}>{x}</option>
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
                    onChange={(e) => applyUxPatch({ display_label: e.target.value || undefined })}
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
                      applyUxPatch({ display_order: v === "" ? undefined : Number(v) });
                    }}
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span>display_format</span>
                <input
                  className="w-full rounded border bg-background px-2 py-1"
                  value={selectedNode.ux.display_format || ""}
                  onChange={(e) => applyUxPatch({ display_format: e.target.value || undefined })}
                />
              </label>

              <div className="space-y-1">
                <span>Nudges</span>
                <div className="flex flex-wrap gap-1">
                  {NUDGES.map((n) => {
                    const activeNudge = (selectedNode.ux.nudges || []).includes(n);
                    return (
                      <button
                        type="button"
                        key={n}
                        onClick={() => toggleNudge(n)}
                        className={[
                          "rounded border px-2 py-0.5 text-[11px]",
                          activeNudge ? "bg-primary/15 border-primary" : "bg-card",
                        ].join(" ")}
                      >
                        {n}
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
                    onChange={(e) => applyUxPatch({ selectable: e.target.checked || undefined })}
                  />
                  selectable
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedNode.ux.highlight === true}
                    onChange={(e) => applyUxPatch({ highlight: e.target.checked || undefined })}
                  />
                  highlight
                </label>
              </div>
          </CardContent>
        </Card>

        <Card className={[
          "min-h-0 overflow-hidden border transition-colors duration-300",
          jsonFlash ? "border-sky-400/70 bg-sky-500/5" : "",
        ].join(" ")}>
          <CardHeader>
            <CardTitle className="text-sm">Display Schema JSON (two-way)</CardTitle>
          </CardHeader>
          <CardContent className="h-[calc(100%-3.5rem)] flex flex-col gap-2">
            <div className="flex-1 min-h-0 overflow-hidden rounded border">
              <Editor
                height="100%"
                defaultLanguage="json"
                value={editorText}
                onChange={(value) => setEditorText(value || "")}
                onMount={(editor, monaco) => {
                  monacoEditorRef.current = editor;
                  monacoRef.current = monaco;
                }}
                options={{
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
            </div>
            <div className="flex items-center justify-between">
              <div className="text-xs text-destructive">{editorError || ""}</div>
              <Button size="sm" onClick={handleJsonApply}>Apply JSON</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">Live Preview</CardTitle>
          </CardHeader>
          <CardContent className="h-[calc(100%-3.5rem)] overflow-auto">
            {displaySchema ? (
              <RenderProvider value={{ debugMode: false, readonly: false }}>
                <SchemaRenderer data={active.data} schema={displaySchema} />
              </RenderProvider>
            ) : (
              <div className="text-xs text-muted-foreground">No display schema loaded.</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground">
        PoC note: this prototype keeps `dataSchema` as the structural baseline and
        overlays UX config from `displaySchema` to compare tree navigation options.
      </div>
    </div>
  );
}
