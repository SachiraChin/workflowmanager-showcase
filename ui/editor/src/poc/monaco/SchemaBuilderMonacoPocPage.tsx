import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  TabulatorFull as Tabulator,
  type CellComponent,
  type RowComponent,
} from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.min.css";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wfm/shared";

type FieldType = "string" | "number" | "boolean" | "object" | "array";

type FieldRow = {
  id: string;
  key: string;
  type: FieldType;
  required: boolean;
  children?: FieldRow[];
};

type SchemaNode = {
  type: FieldType;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  required?: string[];
  additionalProperties?: boolean;
};

type RootSchema = {
  type: "object";
  properties: Record<string, SchemaNode>;
  required?: string[];
  additionalProperties: false;
};

function nextRowId(): string {
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToSchemaNode(row: FieldRow): SchemaNode {
  if (row.type === "object") {
    const properties: Record<string, SchemaNode> = {};
    const required: string[] = [];
    for (const child of row.children ?? []) {
      const key = child.key.trim();
      if (!key) continue;
      properties[key] = rowToSchemaNode(child);
      if (child.required) required.push(key);
    }
    return {
      type: "object",
      properties,
      required: required.length ? required : undefined,
      additionalProperties: false,
    };
  }

  if (row.type === "array") {
    return {
      type: "array",
      items: row.children?.[0] ? rowToSchemaNode(row.children[0]) : { type: "string" },
    };
  }

  return { type: row.type };
}

function rowsToSchema(rows: FieldRow[]): RootSchema {
  const properties: Record<string, SchemaNode> = {};
  const required: string[] = [];
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    properties[key] = rowToSchemaNode(row);
    if (row.required) required.push(key);
  }
  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
    additionalProperties: false,
  };
}

function schemaNodeToRow(key: string, node: SchemaNode, required: boolean): FieldRow {
  if (node.type === "object") {
    const requiredSet = new Set(node.required ?? []);
    const children = Object.entries(node.properties ?? {}).map(([childKey, childNode]) =>
      schemaNodeToRow(childKey, childNode, requiredSet.has(childKey))
    );
    return { id: nextRowId(), key, type: "object", required, children };
  }

  if (node.type === "array") {
    return {
      id: nextRowId(),
      key,
      type: "array",
      required,
      children: [schemaNodeToRow("item", node.items ?? { type: "string" }, false)],
    };
  }

  return { id: nextRowId(), key, type: node.type, required };
}

function schemaToRows(schema: RootSchema): FieldRow[] {
  const requiredSet = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, node]) =>
    schemaNodeToRow(key, node, requiredSet.has(key))
  );
}

function mapRows(rows: FieldRow[], rowId: string, update: (row: FieldRow) => FieldRow): FieldRow[] {
  return rows.map((row) => {
    if (row.id === rowId) return update(row);
    if (!row.children?.length) return row;
    return { ...row, children: mapRows(row.children, rowId, update) };
  });
}

function removeRowById(rows: FieldRow[], rowId: string): FieldRow[] {
  return rows
    .filter((row) => row.id !== rowId)
    .map((row) => (row.children?.length ? { ...row, children: removeRowById(row.children, rowId) } : row));
}

function isValidSchemaNode(node: unknown): node is SchemaNode {
  if (!node || typeof node !== "object") return false;
  const candidate = node as SchemaNode;
  if (!["string", "number", "boolean", "object", "array"].includes(candidate.type)) {
    return false;
  }
  if (candidate.type === "object") {
    if (!candidate.properties || typeof candidate.properties !== "object") return false;
    return Object.values(candidate.properties).every((child) => isValidSchemaNode(child));
  }
  if (candidate.type === "array") {
    return candidate.items ? isValidSchemaNode(candidate.items) : true;
  }
  return true;
}

export function SchemaBuilderMonacoPocPage() {
  const [rows, setRows] = useState<FieldRow[]>([
    { id: "id", key: "id", type: "string", required: true },
    { id: "label", key: "label", type: "string", required: true },
    {
      id: "meta",
      key: "meta",
      type: "object",
      required: false,
      children: [
        { id: "source", key: "source", type: "string", required: false },
        {
          id: "tags",
          key: "tags",
          type: "array",
          required: false,
          children: [
            {
              id: "tag_item",
              key: "item",
              type: "object",
              required: false,
              children: [{ id: "tag_id", key: "id", type: "string", required: false }],
            },
          ],
        },
      ],
    },
  ]);
  const [lastEditSource, setLastEditSource] = useState<"grid" | "monaco">("grid");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const nestedTableHostRef = useRef<HTMLDivElement | null>(null);
  const nestedTableRef = useRef<Tabulator | null>(null);

  const generatedSchema = useMemo(() => rowsToSchema(rows), [rows]);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(generatedSchema, null, 2));
  const nestedParentRows = useMemo(() => rows, [rows]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (lastEditSource !== "grid") return;
    setJsonText(JSON.stringify(generatedSchema, null, 2));
    setJsonError(null);
  }, [generatedSchema, lastEditSource]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateRow = (rowId: string, patch: Partial<FieldRow>) => {
    setLastEditSource("grid");
    setRows((current) =>
      mapRows(current, rowId, (row) => {
        const nextType = (patch.type ?? row.type) as FieldType;
        const baseRow: FieldRow = { ...row, ...patch, type: nextType };

        if (nextType === "object") {
          return {
            ...baseRow,
            children:
              row.children && row.children.length
                ? row.children
                : [{ id: nextRowId(), key: "child", type: "string", required: false }],
          };
        }

        if (nextType === "array") {
          const first = row.children?.[0];
          return {
            ...baseRow,
            children: [
              first ?? { id: nextRowId(), key: "item", type: "string", required: false },
            ],
          };
        }

        return { ...baseRow, children: undefined };
      })
    );
  };

  const removeRow = (rowId: string) => {
    setLastEditSource("grid");
    setRows((current) => removeRowById(current, rowId));
  };

  const addRoot = () => {
    setLastEditSource("grid");
    setRows((current) => [
      ...current,
      { id: nextRowId(), key: "", type: "string", required: false },
    ]);
  };

  const addChild = (rowId: string) => {
    setLastEditSource("grid");
    setRows((current) =>
      mapRows(current, rowId, (row) => {
        if (row.type === "array") {
          return {
            ...row,
            children: [{ id: nextRowId(), key: "item", type: "string", required: false }],
          };
        }
        return {
          ...row,
          children: [
            ...(row.children ?? []),
            { id: nextRowId(), key: "", type: "string", required: false },
          ],
        };
      })
    );
  };

  useEffect(() => {
    if (!nestedTableHostRef.current || nestedTableRef.current) return;

    const createNestedTable = (
      host: HTMLElement,
      data: FieldRow[],
      level = 0,
      parentName?: string
    ): Tabulator => {
      return new Tabulator(host, {
        data,
        layout: "fitColumns",
        columns: [
          {
            title: level === 0 ? "Field" : `${parentName || "Field"}'s child field`,
            field: "key",
            editor: "input",
            cellEdited: (cell: CellComponent) => {
              const row = cell.getRow().getData() as FieldRow;
              updateRow(row.id, { key: String(cell.getValue() ?? "") });
            },
          },
          {
            title: "Type",
            field: "type",
            editor: "list",
            editorParams: {
              values: ["string", "number", "boolean", "object", "array"],
            },
            cellEdited: (cell: CellComponent) => {
              const row = cell.getRow().getData() as FieldRow;
              updateRow(row.id, { type: cell.getValue() as FieldType });
            },
          },
          {
            title: "Required",
            field: "required",
            formatter: "tickCross",
            editor: true,
            width: 110,
            cellEdited: (cell: CellComponent) => {
              const row = cell.getRow().getData() as FieldRow;
              updateRow(row.id, { required: Boolean(cell.getValue()) });
            },
          },
          {
            title: "Actions",
            field: "id",
            width: 120,
            hozAlign: "center",
            headerSort: false,
            formatter: (cell: CellComponent) => {
              const row = cell.getRow().getData() as FieldRow;
              const canNest = row.type === "object" || row.type === "array";
              return `<div style="display:flex;justify-content:center;gap:8px;">${
                canNest ? '<button class="n-add" type="button">+</button>' : ""
              }<button class="n-remove" type="button">x</button></div>`;
            },
            cellClick: (event: UIEvent, cell: CellComponent) => {
              const target = event.target as HTMLElement;
              const row = cell.getRow().getData() as FieldRow;
              if (target.closest(".n-remove")) {
                removeRow(row.id);
              }
              if (target.closest(".n-add")) {
                addChild(row.id);
              }
            },
          },
        ],
        rowFormatter: (row: RowComponent) => {
          const rowData = row.getData() as FieldRow;
          const rowElement = row.getElement();
          let subHolder = rowElement.querySelector<HTMLDivElement>(".nested-subtable-host");
          const existing = (subHolder as unknown as { _tabulator?: Tabulator } | null)
            ?._tabulator;

          const canNest = rowData.type === "object" || rowData.type === "array";
          if (!canNest) {
            if (existing) existing.destroy();
            if (subHolder) subHolder.remove();
            return;
          }

          if (!subHolder) {
            subHolder = document.createElement("div");
            subHolder.className = "nested-subtable-host";
            subHolder.style.boxSizing = "border-box";
            subHolder.style.padding = "8px 16px 12px 16px";
            subHolder.style.borderTop = "1px solid var(--border)";
            rowElement.appendChild(subHolder);
          }

          if (existing) {
            existing.destroy();
          }

          const detailTable = createNestedTable(
            subHolder,
            rowData.children ?? [],
            level + 1,
            rowData.key || "field"
          );
          (subHolder as unknown as { _tabulator?: Tabulator })._tabulator = detailTable;
        },
      });
    };

    const nestedTable = createNestedTable(nestedTableHostRef.current, nestedParentRows);

    nestedTableRef.current = nestedTable;

    return () => {
      nestedTable.destroy();
      nestedTableRef.current = null;
    };
  }, [nestedParentRows]);

  useEffect(() => {
    if (!nestedTableRef.current) return;
    nestedTableRef.current.setData(nestedParentRows);
  }, [nestedParentRows]);

  const applyRawJson = (nextText: string) => {
    try {
      const parsed = JSON.parse(nextText) as Partial<RootSchema>;
      if (parsed.type !== "object" || !parsed.properties) {
        setJsonError("Schema must be an object with properties.");
        return;
      }

      for (const value of Object.values(parsed.properties)) {
        if (!isValidSchemaNode(value)) {
          setJsonError(
            "Unsupported node found. Allowed: string, number, boolean, object, array."
          );
          return;
        }
      }

      setRows(schemaToRows(parsed as RootSchema));
      setLastEditSource("monaco");
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON syntax.");
    }
  };

  return (
    <main className="h-full min-h-0 overflow-auto p-4">
      <div className="mb-4">
        <h1 className="text-lg font-semibold">PoC: Nested Tables + Monaco Sync</h1>
        <p className="text-sm text-muted-foreground">
          Left shows nested-table schema editing. Right is Monaco. Both stay in sync.
        </p>
      </div>

      <div className="grid min-h-0 gap-4 lg:h-[78vh] lg:grid-cols-[2fr_1fr]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Nested Tables: Schema Editing</CardTitle>
                <CardDescription>
                  Parent rows render recursive nested child-field tables.
                </CardDescription>
              </div>
              <Button type="button" variant="outline" onClick={addRoot}>
                Add Root Field
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] p-0">
            <div
              className="h-full w-full [&_.tabulator]:h-full [&_.tabulator-cell]:text-sm [&_.tabulator-header]:text-sm"
              ref={nestedTableHostRef}
            />
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <CardTitle>JSON Schema (Monaco)</CardTitle>
            <CardDescription>
              Edit raw schema. Valid changes sync into the TreeGrid.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] p-0">
            <Editor
              defaultLanguage="json"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                formatOnPaste: true,
                formatOnType: true,
                scrollBeyondLastLine: false,
              }}
              theme="vs-dark"
              value={jsonText}
              onChange={(value) => {
                const nextText = value ?? "";
                setJsonText(nextText);
                applyRawJson(nextText);
              }}
            />
          </CardContent>
        </Card>
      </div>

      {jsonError ? (
        <Alert className="mt-3" variant="destructive">
          <AlertDescription>{jsonError}</AlertDescription>
        </Alert>
      ) : null}
    </main>
  );
}
