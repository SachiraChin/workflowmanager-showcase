import { useEffect, useMemo, useRef, useState } from "react";
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
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

export type JsonSchemaType = "string" | "number" | "boolean" | "object" | "array";

export type JsonSchemaNode = {
  type: JsonSchemaType;
  description?: string;
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

type SchemaField = {
  id: string;
  key: string;
  type: JsonSchemaType;
  required: boolean;
  description: string;
  children?: SchemaField[];
};

const FIELD_TYPES: JsonSchemaType[] = ["string", "number", "boolean", "object", "array"];

function nextFieldId(): string {
  return `schema_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createField(
  type: JsonSchemaType = "string",
  key = "",
  required = false
): SchemaField {
  if (type === "object") {
    return {
      id: nextFieldId(),
      key,
      type,
      required,
      description: "",
      children: [createField("string", "field")],
    };
  }

  if (type === "array") {
    return {
      id: nextFieldId(),
      key,
      type,
      required,
      description: "",
      children: [createField("string", "item")],
    };
  }

  return { id: nextFieldId(), key, type, required, description: "" };
}

function schemaNodeToField(key: string, node: JsonSchemaNode, required: boolean): SchemaField {
  if (node.type === "object") {
    const requiredSet = new Set(node.required ?? []);
    const children = Object.entries(node.properties ?? {}).map(([childKey, childNode]) =>
      schemaNodeToField(childKey, childNode, requiredSet.has(childKey))
    );
    return {
      id: nextFieldId(),
      key,
      type: "object",
      required,
      description: node.description ?? "",
      children,
    };
  }

  if (node.type === "array") {
    return {
      id: nextFieldId(),
      key,
      type: "array",
      required,
      description: node.description ?? "",
      children: [schemaNodeToField("item", node.items ?? { type: "string" }, false)],
    };
  }

  return {
    id: nextFieldId(),
    key,
    type: node.type,
    required,
    description: node.description ?? "",
  };
}

function schemaToFields(schema: JsonSchemaObject): SchemaField[] {
  const requiredSet = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, node]) =>
    schemaNodeToField(key, node, requiredSet.has(key))
  );
}

function fieldToSchemaNode(field: SchemaField): JsonSchemaNode {
  if (field.type === "object") {
    const properties: Record<string, JsonSchemaNode> = {};
    const required: string[] = [];
    for (const child of field.children ?? []) {
      const key = child.key.trim();
      if (!key) continue;
      properties[key] = fieldToSchemaNode(child);
      if (child.required) required.push(key);
    }
    return {
      type: "object",
      description: field.description || undefined,
      properties,
      required: required.length ? required : undefined,
      additionalProperties: false,
    };
  }

  if (field.type === "array") {
    return {
      type: "array",
      description: field.description || undefined,
      items: field.children?.[0] ? fieldToSchemaNode(field.children[0]) : { type: "string" },
    };
  }

  return {
    type: field.type,
    description: field.description || undefined,
  };
}

function fieldsToSchema(fields: SchemaField[]): JsonSchemaObject {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const field of fields) {
    const key = field.key.trim();
    if (!key) continue;
    properties[key] = fieldToSchemaNode(field);
    if (field.required) required.push(key);
  }

  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
    additionalProperties: false,
  };
}

function mapFields(
  fields: SchemaField[],
  id: string,
  updater: (field: SchemaField) => SchemaField
): SchemaField[] {
  return fields.map((field) => {
    if (field.id === id) return updater(field);
    if (!field.children?.length) return field;
    return { ...field, children: mapFields(field.children, id, updater) };
  });
}

function removeFieldById(fields: SchemaField[], id: string): SchemaField[] {
  return fields
    .filter((field) => field.id !== id)
    .map((field) =>
      field.children?.length
        ? { ...field, children: removeFieldById(field.children, id) }
        : field
    );
}

function collectExpandableIds(fields: SchemaField[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: SchemaField[]) => {
    for (const node of nodes) {
      if (node.type === "object" || node.type === "array") {
        ids.add(node.id);
      }
      if (node.children?.length) walk(node.children);
    }
  };
  walk(fields);
  return ids;
}

function isValidSchemaNode(node: unknown): node is JsonSchemaNode {
  if (!node || typeof node !== "object") return false;
  const candidate = node as JsonSchemaNode;
  if (!FIELD_TYPES.includes(candidate.type)) return false;

  if (candidate.type === "object") {
    if (!candidate.properties || typeof candidate.properties !== "object") return false;
    return Object.values(candidate.properties).every((child) => isValidSchemaNode(child));
  }

  if (candidate.type === "array") {
    return candidate.items ? isValidSchemaNode(candidate.items) : true;
  }

  return true;
}

function loremWords(count: number): string {
  const words = [
    "lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "consectetur",
    "adipiscing",
    "elit",
    "sed",
    "do",
    "eiusmod",
    "tempor",
  ];
  return Array.from({ length: count }, (_, index) => words[index % words.length]).join(" ");
}

function exampleFromNode(node: JsonSchemaNode): unknown {
  if (node.type === "string") return loremWords(3);
  if (node.type === "number") return 42;
  if (node.type === "boolean") return true;
  if (node.type === "array") {
    const item = node.items ?? { type: "string" as const };
    return [exampleFromNode(item), exampleFromNode(item)];
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    output[key] = exampleFromNode(child);
  }
  return output;
}

function generateExampleData(schema: JsonSchemaObject): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(schema.properties)) {
    output[key] = exampleFromNode(node);
  }
  return output;
}

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
        className="rounded border border-border/80 bg-card p-2"
        style={{ marginLeft: `${depth * 18}px` }}
      >
        <div className="grid grid-cols-[28px_1fr_120px_95px] items-center gap-2">
          <button
            className={[
              "h-7 w-7 rounded-md border text-xs font-semibold transition-colors",
              canNest
                ? "border-border bg-card text-foreground hover:bg-muted"
                : "border-border bg-card text-muted-foreground opacity-60",
            ].join(" ")}
            disabled={!canNest}
            onClick={() => onToggle(field.id)}
            type="button"
          >
            {canNest ? (expanded ? "-" : "+") : "-"}
          </button>

          <input
            className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
            onChange={(event) => onUpdate(field.id, { key: event.target.value })}
            placeholder="field_name"
            value={field.key}
          />

          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm text-foreground"
            onChange={(event) => {
              const nextType = event.target.value as JsonSchemaType;
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
            className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs text-foreground"
            onChange={(event) => onUpdate(field.id, { description: event.target.value })}
            placeholder="description (optional)"
            value={field.description}
          />
          <div className="flex items-center gap-1">
            <Button
              disabled={!canNest}
              onClick={() => onAddChild(field.id)}
              size="sm"
              type="button"
              variant="outline"
            >
              Add Child
            </Button>
            <Button
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

export function JsonSchemaEditor({ value, onChange }: JsonSchemaEditorProps) {
  const monacoTheme = useMonacoTheme();
  const initialFields = useMemo(() => schemaToFields(value), [value]);
  const [fields, setFields] = useState<SchemaField[]>(initialFields);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    collectExpandableIds(initialFields)
  );
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const lastSentSchemaRef = useRef<string>(JSON.stringify(value));

  const schema = useMemo(() => fieldsToSchema(fields), [fields]);
  const exampleData = useMemo(() => generateExampleData(schema), [schema]);

  const updateFields = (next: SchemaField[], emit = true) => {
    setFields(next);
    setExpandedIds(collectExpandableIds(next));
    const nextSchema = fieldsToSchema(next);
    const serialized = JSON.stringify(nextSchema);
    lastSentSchemaRef.current = serialized;
    setJsonText(JSON.stringify(nextSchema, null, 2));
    setJsonError(null);
    if (emit) {
      onChange(nextSchema);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const serialized = JSON.stringify(value);
    if (serialized === lastSentSchemaRef.current) return;
    const next = schemaToFields(value);
    setFields(next);
    setExpandedIds(collectExpandableIds(next));
    setJsonText(JSON.stringify(value, null, 2));
    setJsonError(null);
  }, [value]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const applyRawJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<JsonSchemaObject>;
      if (parsed.type !== "object" || !parsed.properties) {
        setJsonError("Schema must be an object with properties.");
        return;
      }

      for (const node of Object.values(parsed.properties)) {
        if (!isValidSchemaNode(node)) {
          setJsonError(
            "Unsupported node found. Allowed: string, number, boolean, object, array."
          );
          return;
        }
      }

      const nextSchema: JsonSchemaObject = {
        type: "object",
        additionalProperties: false,
        properties: parsed.properties,
        required: parsed.required,
      };
      updateFields(schemaToFields(nextSchema));
    } catch {
      setJsonError("Invalid JSON syntax.");
    }
  };

  return (
    <div className="grid h-full min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[1.25fr_1fr]">
      <Card className="h-full min-h-0 overflow-hidden">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Schema Tree</CardTitle>
            <Button
              onClick={() => updateFields([...fields, createField("string", "new_field")])}
              type="button"
              variant="outline"
            >
              Add Root Field
            </Button>
          </div>
        </CardHeader>
        <CardContent className="h-[calc(100%-5.25rem)] space-y-3 overflow-y-auto p-3">
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

      <div className="grid h-full min-h-0 gap-4" style={{ gridTemplateRows: "3fr 2fr" }}>
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">JSON Schema (Monaco)</CardTitle>
              <Button onClick={applyRawJson} type="button" variant="outline">
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
                formatOnPaste: true,
                formatOnType: true,
                scrollBeyondLastLine: false,
              }}
              theme={monacoTheme}
              value={jsonText}
              onChange={(nextValue) => {
                setJsonText(nextValue ?? "");
                setJsonError(null);
              }}
            />
          </CardContent>
        </Card>

        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <CardTitle className="text-base">Generated Example Data</CardTitle>
            <CardDescription>
              Auto-generated sample payload for quick schema sanity checks.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] overflow-auto p-0">
            <pre className="h-full overflow-auto bg-muted/50 p-3 text-xs">
              {JSON.stringify(exampleData, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>

      {jsonError ? (
        <Alert className="lg:col-span-2" variant="destructive">
          <AlertDescription>{jsonError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
