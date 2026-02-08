import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import {
  TabulatorFull as Tabulator,
  type CellComponent,
  type RowComponent,
} from "tabulator-tables";
import "tabulator-tables/dist/css/tabulator.min.css";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle } from "@wfm/shared";

export type JsonSchemaType = "string" | "number" | "boolean" | "object" | "array";

export type JsonSchemaNode = {
  type: JsonSchemaType;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean;
};

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties: false;
};

type JsonSchemaEditorProps = {
  value: JsonSchemaObject;
  onChange: (next: JsonSchemaObject) => void;
};

type FieldRow = {
  id: string;
  key: string;
  type: JsonSchemaType;
  required: boolean;
  children?: FieldRow[];
};

function nextFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToSchemaNode(row: FieldRow): JsonSchemaNode {
  if (row.type === "object") {
    const properties: Record<string, JsonSchemaNode> = {};
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

function rowsToSchema(rows: FieldRow[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaNode> = {};
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

function schemaNodeToRow(key: string, node: JsonSchemaNode, required: boolean): FieldRow {
  if (node.type === "object") {
    const requiredSet = new Set(node.required ?? []);
    const children = Object.entries(node.properties ?? {}).map(([childKey, childNode]) =>
      schemaNodeToRow(childKey, childNode, requiredSet.has(childKey))
    );

    return { id: nextFieldId(), key, type: "object", required, children };
  }

  if (node.type === "array") {
    return {
      id: nextFieldId(),
      key,
      type: "array",
      required,
      children: [schemaNodeToRow("item", node.items ?? { type: "string" }, false)],
    };
  }

  return { id: nextFieldId(), key, type: node.type, required };
}

function schemaToRows(schema: JsonSchemaObject): FieldRow[] {
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
    .map((row) =>
      row.children?.length ? { ...row, children: removeRowById(row.children, rowId) } : row
    );
}

function isValidSchemaNode(node: unknown): node is JsonSchemaNode {
  if (!node || typeof node !== "object") return false;
  const candidate = node as JsonSchemaNode;
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

export function JsonSchemaEditor({ value, onChange }: JsonSchemaEditorProps) {
  const [rows, setRows] = useState<FieldRow[]>(() => schemaToRows(value));
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [tableHostEl, setTableHostEl] = useState<HTMLDivElement | null>(null);
  const tableRef = useRef<Tabulator | null>(null);
  const lastSentSchemaRef = useRef<string>(JSON.stringify(value));

  const schemaFromRows = useMemo(() => rowsToSchema(rows), [rows]);

  const setRowsAndEmit = (updater: (current: FieldRow[]) => FieldRow[]) => {
    setRows((current) => {
      const next = updater(current);
      const nextSchema = rowsToSchema(next);
      const serialized = JSON.stringify(nextSchema);
      lastSentSchemaRef.current = serialized;
      onChange(nextSchema);
      return next;
    });
  };

  const updateRow = (rowId: string, patch: Partial<FieldRow>) => {
    setRowsAndEmit((current) =>
      mapRows(current, rowId, (row) => {
        const nextType = (patch.type ?? row.type) as JsonSchemaType;
        const baseRow: FieldRow = { ...row, ...patch, type: nextType };

        if (nextType === "object") {
          return {
            ...baseRow,
            children:
              row.children && row.children.length
                ? row.children
                : [{ id: nextFieldId(), key: "child", type: "string", required: false }],
          };
        }

        if (nextType === "array") {
          const first = row.children?.[0];
          return {
            ...baseRow,
            children: [
              first ?? { id: nextFieldId(), key: "item", type: "string", required: false },
            ],
          };
        }

        return { ...baseRow, children: undefined };
      })
    );
  };

  const removeRow = (rowId: string) => {
    setRowsAndEmit((current) => removeRowById(current, rowId));
  };

  const addRoot = () => {
    setRowsAndEmit((current) => [
      ...current,
      { id: nextFieldId(), key: `field_${current.length + 1}`, type: "string", required: false },
    ]);
  };

  const addChild = (rowId: string) => {
    setRowsAndEmit((current) =>
      mapRows(current, rowId, (row) => {
        if (row.type === "array") {
          return {
            ...row,
            children: [{ id: nextFieldId(), key: "item", type: "string", required: false }],
          };
        }

        return {
          ...row,
          children: [
            ...(row.children ?? []),
            { id: nextFieldId(), key: "", type: "string", required: false },
          ],
        };
      })
    );
  };

  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized === lastSentSchemaRef.current) return;
    setRows(schemaToRows(value));
    setJsonText(JSON.stringify(value, null, 2));
    setJsonError(null);
  }, [value]);

  useEffect(() => {
    setJsonText(JSON.stringify(schemaFromRows, null, 2));
    setJsonError(null);
  }, [schemaFromRows]);

  useEffect(() => {
    if (!tableHostEl || tableRef.current) return;

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
            title: level === 0 ? "Field" : `${parentName || "field"}'s child field`,
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
            editor: (
              cell: CellComponent,
              onRendered: (callback: () => void) => void,
              success: (...args: unknown[]) => void,
              cancel: (...args: unknown[]) => void
            ) => {
              const select = document.createElement("select");
              const options: JsonSchemaType[] = [
                "string",
                "number",
                "boolean",
                "object",
                "array",
              ];
              const currentValue = String(cell.getValue() ?? "string");

              for (const optionValue of options) {
                const option = document.createElement("option");
                option.value = optionValue;
                option.text = optionValue;
                if (optionValue === currentValue) option.selected = true;
                select.appendChild(option);
              }

              select.style.width = "100%";
              select.style.height = "28px";
              select.style.border = "1px solid var(--border)";
              select.style.borderRadius = "6px";
              select.style.background = "var(--background)";
              select.style.color = "var(--foreground)";

              select.addEventListener("change", () => success(select.value));
              select.addEventListener("blur", () => success(select.value));
              select.addEventListener("keydown", (event) => {
                if (event.key === "Escape") cancel(false);
              });

              onRendered(() => {
                select.focus();
              });

              return select;
            },
            formatter: (cell: CellComponent) => String(cell.getValue() ?? "string"),
            cellClick: (_event: UIEvent, cell: CellComponent) => {
              void cell.edit(true);
            },
            cellEdited: (cell: CellComponent) => {
              const row = cell.getRow().getData() as FieldRow;
              updateRow(row.id, { type: cell.getValue() as JsonSchemaType });
            },
          },
          {
            title: "Required",
            field: "required",
            width: 110,
            formatter: "tickCross",
            editor: true,
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
                canNest ? '<button class="u-add" type="button">+</button>' : ""
              }<button class="u-remove" type="button">x</button></div>`;
            },
            cellClick: (event: UIEvent, cell: CellComponent) => {
              const target = event.target as HTMLElement;
              const row = cell.getRow().getData() as FieldRow;
              if (target.closest(".u-remove")) removeRow(row.id);
              if (target.closest(".u-add")) addChild(row.id);
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

          if (existing) existing.destroy();

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

    tableRef.current = createNestedTable(tableHostEl, rows);

    return () => {
      tableRef.current?.destroy();
      tableRef.current = null;
    };
  }, [tableHostEl]);

  useEffect(() => {
    if (!tableRef.current) return;
    tableRef.current.setData(rows);
  }, [rows]);

  const applyRawJson = (nextText: string) => {
    try {
      const parsed = JSON.parse(nextText) as Partial<JsonSchemaObject>;
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

      const nextSchema = parsed as JsonSchemaObject;
      const nextRows = schemaToRows(nextSchema);
      setRows(nextRows);
      lastSentSchemaRef.current = JSON.stringify(nextSchema);
      onChange(nextSchema);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON syntax.");
    }
  };

  return (
    <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[2fr_1fr]">
      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Nested Tables</CardTitle>
            <Button type="button" variant="outline" onClick={addRoot}>
              Add Root Field
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-[calc(100%-5.25rem)] p-0">
          <div
            className="h-full min-h-[420px] w-full [&_.tabulator]:h-full [&_.tabulator-cell]:text-sm [&_.tabulator-header]:text-sm"
            ref={setTableHostEl}
          />
        </CardContent>
      </Card>

      <Card className="min-h-0 overflow-hidden">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-base">JSON Schema (Monaco)</CardTitle>
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
            onChange={(nextValue) => {
              const nextText = nextValue ?? "";
              setJsonText(nextText);
              applyRawJson(nextText);
            }}
          />
        </CardContent>
      </Card>

      {jsonError ? (
        <Alert className="lg:col-span-2" variant="destructive">
          <AlertDescription>{jsonError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
