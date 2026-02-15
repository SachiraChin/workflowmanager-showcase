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
  createField,
  DEFAULT_SCHEMA,
  FIELD_TYPES,
  fieldsToSchema,
  findFieldById,
  mapFields,
  parseSchemaText,
  schemaToFields,
  type JsonSchemaObject,
  type SchemaField,
  type SchemaFieldType,
} from "./schemaModel";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

const TEMPLATES: Array<{ id: string; label: string; schema: JsonSchemaObject }> = [
  {
    id: "basic",
    label: "Basic Object",
    schema: DEFAULT_SCHEMA,
  },
  {
    id: "media",
    label: "Media Result",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prompt: { type: "string" },
        generations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string" },
              provider: { type: "string" },
            },
            additionalProperties: false,
          },
        },
      },
      required: ["generations"],
    },
  },
  {
    id: "review",
    label: "Review Payload",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        selected_ids: {
          type: "array",
          items: { type: "string" },
        },
        reasoning: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["selected_ids"],
    },
  },
];

export function TemplateFlowSchemaPocPage() {
  const monacoTheme = useMonacoTheme();
  const [fields, setFields] = useState<SchemaField[]>(() => schemaToFields(DEFAULT_SCHEMA));
  const [activeTemplate, setActiveTemplate] = useState<string>("basic");
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [jsonDraft, setJsonDraft] = useState<string>(() =>
    JSON.stringify(DEFAULT_SCHEMA, null, 2)
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const focusNode = useMemo(
    () => (focusNodeId ? findFieldById(fields, focusNodeId) : null),
    [fields, focusNodeId]
  );

  const currentFields = focusNode ? (focusNode.children ?? []) : fields;
  const focusLabel = focusNode ? `${focusNode.key || "(unnamed)"} (${focusNode.type})` : "root";

  const updateFields = (next: SchemaField[]) => {
    setFields(next);
    setJsonDraft(JSON.stringify(fieldsToSchema(next), null, 2));
    setJsonError(null);
  };

  const mutateCurrentScope = (updater: (current: SchemaField[]) => SchemaField[]) => {
    if (!focusNode) {
      updateFields(updater(fields));
      return;
    }
    updateFields(
      mapFields(fields, focusNode.id, (field) => ({
        ...field,
        children: updater(field.children ?? []),
      }))
    );
  };

  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setActiveTemplate(templateId);
    setFocusNodeId(null);
    const next = schemaToFields(template.schema);
    setFields(next);
    setJsonDraft(JSON.stringify(template.schema, null, 2));
    setJsonError(null);
  };

  const updateCurrentField = (id: string, patch: Partial<SchemaField>) => {
    mutateCurrentScope((current) =>
      current.map((field) => (field.id === id ? { ...field, ...patch } : field))
    );
  };

  const addFieldToScope = (type: SchemaFieldType) => {
    mutateCurrentScope((current) => [...current, createField(type, type === "array" ? "items" : "field")]);
  };

  const removeFieldFromScope = (id: string) => {
    mutateCurrentScope((current) => current.filter((field) => field.id !== id));
  };

  const applyJson = () => {
    const parsed = parseSchemaText(jsonDraft);
    if (!parsed.schema) {
      setJsonError(parsed.error);
      return;
    }
    setFields(schemaToFields(parsed.schema));
    setFocusNodeId(null);
    setJsonError(null);
  };

  return (
    <div className="mx-auto h-full max-w-[1500px] p-4">
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>PoC B: Template + Scope Editor</CardTitle>
          <CardDescription>
            Template-driven flow where users edit one object scope at a time instead of a deep
            nested table.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TEMPLATES.map((template) => (
          <Button
            key={template.id}
            onClick={() => applyTemplate(template.id)}
            type="button"
            variant={activeTemplate === template.id ? "default" : "outline"}
          >
            {template.label}
          </Button>
        ))}
      </div>

      <div className="grid h-[calc(100%-170px)] min-h-0 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="min-h-0 overflow-hidden">
          <CardHeader className="border-b pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Current Scope: {focusLabel}</CardTitle>
                <CardDescription>
                  Click "Open" on object/array fields to drill down.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  disabled={!focusNode}
                  onClick={() => setFocusNodeId(null)}
                  type="button"
                  variant="outline"
                >
                  Back to Root
                </Button>
                <Button onClick={() => addFieldToScope("string")} type="button" variant="outline">
                  Add Field
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="h-[calc(100%-5.25rem)] space-y-2 overflow-auto p-3">
            {currentFields.length === 0 ? (
              <p className="text-sm text-muted-foreground">No fields in this scope yet.</p>
            ) : null}

            {currentFields.map((field) => {
              const canOpen = field.type === "object" || field.type === "array";
              return (
                <div className="rounded border bg-background p-2" key={field.id}>
                  <div className="grid grid-cols-[1fr_120px_90px_auto] items-center gap-2">
                    <input
                      className="h-8 rounded border bg-background px-2 text-sm"
                      onChange={(event) =>
                        updateCurrentField(field.id, { key: event.target.value })
                      }
                      placeholder="field_name"
                      value={field.key}
                    />
                    <select
                      className="h-8 rounded border bg-background px-2 text-sm"
                      onChange={(event) =>
                        updateCurrentField(field.id, {
                          type: event.target.value as SchemaFieldType,
                        })
                      }
                      value={field.type}
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center justify-end gap-2 text-xs">
                      req
                      <input
                        checked={field.required}
                        onChange={(event) =>
                          updateCurrentField(field.id, { required: event.target.checked })
                        }
                        type="checkbox"
                      />
                    </label>
                    <div className="flex items-center gap-1">
                      <Button
                        disabled={!canOpen}
                        onClick={() => setFocusNodeId(field.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open
                      </Button>
                      <Button
                        onClick={() => removeFieldFromScope(field.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  <input
                    className="mt-2 h-8 w-full rounded border bg-background px-2 text-xs"
                    onChange={(event) =>
                      updateCurrentField(field.id, { description: event.target.value })
                    }
                    placeholder="description"
                    value={field.description}
                  />
                </div>
              );
            })}
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
