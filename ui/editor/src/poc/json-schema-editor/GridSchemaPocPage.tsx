import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { DataGrid, type Column } from "react-data-grid";
import "react-data-grid/lib/styles.css";
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
import {
  createField,
  DEFAULT_SCHEMA,
  FIELD_TYPES,
  fieldsToSchema,
  flattenFields,
  mapFields,
  parseSchemaText,
  removeFieldById,
  schemaToFields,
  type SchemaField,
  type SchemaFieldType,
} from "./schemaModel";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

type GridRow = {
  id: string;
  depth: number;
  path: string;
  key: string;
  type: SchemaFieldType;
  required: boolean;
  description: string;
  canNest: boolean;
};

export function GridSchemaPocPage() {
  const monacoTheme = useMonacoTheme();
  const [fields, setFields] = useState<SchemaField[]>(() => schemaToFields(DEFAULT_SCHEMA));
  const [jsonDraft, setJsonDraft] = useState<string>(() =>
    JSON.stringify(DEFAULT_SCHEMA, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const updateFields = (next: SchemaField[]) => {
    setFields(next);
    setJsonDraft(JSON.stringify(fieldsToSchema(next), null, 2));
    setJsonError(null);
  };

  const rows = useMemo<GridRow[]>(
    () =>
      flattenFields(fields).map((item) => ({
        id: item.id,
        depth: item.depth,
        path: item.path,
        key: item.field.key,
        type: item.field.type,
        required: item.field.required,
        description: item.field.description,
        canNest: item.field.type === "object" || item.field.type === "array",
      })),
    [fields]
  );

  const updateField = (id: string, patch: Partial<SchemaField>) => {
    updateFields(mapFields(fields, id, (field) => ({ ...field, ...patch })));
  };

  const addChild = (id: string) => {
    updateFields(
      mapFields(fields, id, (field) => {
        if (field.type === "array") {
          return {
            ...field,
            children: [field.children?.[0] ?? createField("string", "item")],
          };
        }
        if (field.type !== "object") return field;
        return {
          ...field,
          children: [...(field.children ?? []), createField("string", "field")],
        };
      })
    );
  };

  const applyJson = () => {
    const parsed = parseSchemaText(jsonDraft);
    if (!parsed.schema) {
      setJsonError(parsed.error);
      return;
    }
    setFields(schemaToFields(parsed.schema));
    setJsonError(null);
  };

  const columns: Column<GridRow>[] = [
      {
        key: "key",
        name: "Field",
        width: 250,
        renderCell: ({ row }) => (
          <div style={{ paddingLeft: `${row.depth * 16}px` }}>
            <input
              className="h-7 w-full rounded border bg-background px-2 text-xs"
              onChange={(event) => updateField(row.id, { key: event.target.value })}
              value={row.key}
            />
          </div>
        ),
      },
      {
        key: "type",
        name: "Type",
        width: 140,
        renderCell: ({ row }) => (
          <select
            className="h-7 w-full rounded border bg-background px-1 text-xs"
            onChange={(event) => {
              const nextType = event.target.value as SchemaFieldType;
              updateField(row.id, {
                type: nextType,
                children:
                  nextType === "object"
                    ? [createField("string", "field")]
                    : nextType === "array"
                      ? [createField("string", "item")]
                      : undefined,
              });
            }}
            value={row.type}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        ),
      },
      {
        key: "required",
        name: "Required",
        width: 100,
        renderCell: ({ row }) => (
          <label className="flex h-full items-center justify-center">
            <input
              checked={row.required}
              onChange={(event) => updateField(row.id, { required: event.target.checked })}
              type="checkbox"
            />
          </label>
        ),
      },
      {
        key: "description",
        name: "Description",
        renderCell: ({ row }) => (
          <input
            className="h-7 w-full rounded border bg-background px-2 text-xs"
            onChange={(event) => updateField(row.id, { description: event.target.value })}
            value={row.description}
          />
        ),
      },
      {
        key: "actions",
        name: "Actions",
        width: 180,
        renderCell: ({ row }) => (
          <div className="flex items-center justify-center gap-1">
            <Button
              disabled={!row.canNest}
              onClick={() => addChild(row.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Add
            </Button>
            <Button
              onClick={() => updateFields(removeFieldById(fields, row.id))}
              size="sm"
              type="button"
              variant="outline"
            >
              Remove
            </Button>
          </div>
        ),
      },
    ];

  return (
    <div className="mx-auto h-full max-w-[1500px] p-4">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>PoC C: Data Grid Builder (react-data-grid)</CardTitle>
          <CardDescription>
            Flat grid UX with depth-indented rows and inline controls. Uses a library grid instead
            of a custom nested table.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid h-[calc(100%-120px)] min-h-0 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Field Grid</CardTitle>
              <Button
                onClick={() => updateFields([...fields, createField("string", "new_field")])}
                type="button"
                variant="outline"
              >
                Add Root Field
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] p-0">
            <DataGrid
              className="h-full"
              columns={columns}
              rowHeight={42}
              rowKeyGetter={(row: GridRow) => row.id}
              rows={rows}
            />
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Monaco JSON</CardTitle>
              <Button onClick={applyJson} type="button" variant="outline">
                Apply JSON
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] p-0">
            <Editor
              defaultLanguage="json"
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
              }}
              theme={monacoTheme}
              value={jsonDraft}
              onChange={(nextValue) => setJsonDraft(nextValue ?? "")}
            />
          </CardContent>
        </Card>
      </div>

      {jsonError ? (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>{jsonError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
