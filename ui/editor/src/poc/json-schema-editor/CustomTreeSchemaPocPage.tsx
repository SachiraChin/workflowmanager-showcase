import { useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
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
  collectExpandableIds,
  createField,
  DEFAULT_SCHEMA,
  FIELD_TYPES,
  fieldsToSchema,
  generateExampleDataFromSchema,
  mapFields,
  parseSchemaText,
  removeFieldById,
  schemaToFields,
  type SchemaField,
  type SchemaFieldType,
} from "./schemaModel";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

function FieldTreeRow({
  field,
  depth,
  expandedIds,
  onToggle,
  onUpdate,
  onAddChild,
  onRemove,
}: {
  field: SchemaField;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: Partial<SchemaField>) => void;
  onAddChild: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const expanded = expandedIds.has(field.id);
  const canNest = field.type === "object" || field.type === "array";
  const hasChildren = (field.children?.length ?? 0) > 0;

  return (
    <div className="space-y-2">
      <div
        className="rounded border bg-background p-2"
        style={{ marginLeft: `${depth * 18}px` }}
      >
        <div className="grid grid-cols-[28px_1fr_120px_95px] items-center gap-2">
          <button
            className={[
              "h-7 rounded border text-xs font-semibold transition-colors",
              canNest
                ? "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                : "border-slate-200 bg-slate-100 text-slate-400 opacity-60",
            ].join(" ")}
            disabled={!canNest}
            onClick={() => onToggle(field.id)}
            type="button"
          >
            {canNest ? (expanded ? "-" : "+") : "-"}
          </button>
          <input
            className="h-8 rounded border bg-background px-2 text-sm"
            onChange={(event) => onUpdate(field.id, { key: event.target.value })}
            placeholder="field_name"
            value={field.key}
          />
          <select
            className="h-8 rounded border bg-background px-2 text-sm"
            onChange={(event) => {
              const nextType = event.target.value as SchemaFieldType;
              onUpdate(field.id, {
                type: nextType,
                children:
                  nextType === "object"
                    ? field.children && field.children.length > 0
                      ? field.children
                      : [createField("string", "field")]
                    : nextType === "array"
                      ? [field.children?.[0] ?? createField("string", "item")]
                      : undefined,
              });
            }}
            value={field.type}
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <label className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            req
            <input
              checked={field.required}
              onChange={(event) => onUpdate(field.id, { required: event.target.checked })}
              type="checkbox"
            />
          </label>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <input
            className="h-8 w-full rounded border bg-background px-2 text-xs"
            onChange={(event) => onUpdate(field.id, { description: event.target.value })}
            placeholder="description (optional)"
            value={field.description}
          />
          <div className="flex items-center gap-1">
            <Button
              className="border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              disabled={!canNest}
              onClick={() => onAddChild(field.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Add Child
            </Button>
            <Button
              className="border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
              onClick={() => onRemove(field.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Remove
            </Button>
          </div>
        </div>
      </div>

      {expanded && hasChildren
        ? field.children!.map((child) => (
            <FieldTreeRow
              depth={depth + 1}
              expandedIds={expandedIds}
              field={child}
              key={child.id}
              onAddChild={onAddChild}
              onRemove={onRemove}
              onToggle={onToggle}
              onUpdate={onUpdate}
            />
          ))
        : null}
    </div>
  );
}

export function CustomTreeSchemaPocPage() {
  const monacoTheme = useMonacoTheme();
  const [fields, setFields] = useState<SchemaField[]>(() => schemaToFields(DEFAULT_SCHEMA));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    collectExpandableIds(schemaToFields(DEFAULT_SCHEMA))
  );
  const [jsonDraft, setJsonDraft] = useState<string>(() =>
    JSON.stringify(DEFAULT_SCHEMA, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const schema = useMemo(() => fieldsToSchema(fields), [fields]);
  const exampleData = useMemo(() => generateExampleDataFromSchema(schema), [schema]);

  const updateFields = (next: SchemaField[]) => {
    setFields(next);
    setExpandedIds(collectExpandableIds(next));
    setJsonDraft(JSON.stringify(fieldsToSchema(next), null, 2));
    setJsonError(null);
  };

  const handleUpdate = (id: string, patch: Partial<SchemaField>) => {
    updateFields(mapFields(fields, id, (field) => ({ ...field, ...patch })));
  };

  const handleAddChild = (id: string) => {
    updateFields(
      mapFields(fields, id, (field) => {
        if (field.type === "array") {
          return { ...field, children: [createField("string", "item")] };
        }
        if (field.type !== "object") return field;
        return {
          ...field,
          children: [...(field.children ?? []), createField("string", "field")],
        };
      })
    );
    setExpandedIds((current) => new Set(current).add(id));
  };

  const handleRemove = (id: string) => {
    updateFields(removeFieldById(fields, id));
  };

  const handleToggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const applyJson = () => {
    const parsed = parseSchemaText(jsonDraft);
    if (!parsed.schema) {
      setJsonError(parsed.error);
      return;
    }
    updateFields(schemaToFields(parsed.schema));
  };

  return (
    <div className="mx-auto h-full max-w-[1500px] bg-gradient-to-b from-slate-50 to-white p-4">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>PoC A: Custom Tree Builder</CardTitle>
          <CardDescription>
            A fully custom tree UX with inline field editing, nesting controls, and Monaco
            round-trip.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid h-[calc(100%-120px)] min-h-0 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Schema Tree</CardTitle>
              <Button
                className="border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                onClick={() => updateFields([...fields, createField("string", "new_field")])}
                type="button"
                variant="outline"
              >
                Add Root Field
              </Button>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] space-y-3 overflow-auto p-3">
            {fields.map((field) => (
              <FieldTreeRow
                depth={0}
                expandedIds={expandedIds}
                field={field}
                key={field.id}
                onAddChild={handleAddChild}
                onRemove={handleRemove}
                onToggle={handleToggle}
                onUpdate={handleUpdate}
              />
            ))}
          </CardContent>
        </Card>

        <div className="grid min-h-0 gap-4" style={{ gridTemplateRows: "3fr 2fr" }}>
          <Card className="min-h-0 overflow-hidden">
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Monaco JSON</CardTitle>
                <Button
                  className="bg-slate-900 text-white hover:bg-slate-800"
                  onClick={applyJson}
                  type="button"
                  variant="outline"
                >
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

          <Card className="min-h-0 overflow-hidden">
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-base">Generated Example Data</CardTitle>
              <CardDescription>
                Generated from current schema using mock lorem/primitive values.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[calc(100%-5.25rem)] overflow-auto p-0">
              <pre className="h-full overflow-auto bg-slate-900 p-3 text-xs text-slate-100">
                {JSON.stringify(exampleData, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>

      {jsonError ? (
        <Alert className="mt-4" variant="destructive">
          <AlertDescription>{jsonError}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-sm">Current Schema Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-52 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(schema, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
