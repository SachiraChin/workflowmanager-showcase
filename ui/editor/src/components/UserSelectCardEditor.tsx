import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from "@wfm/shared";
import {
  JsonSchemaEditor,
  type JsonSchemaNode,
  type JsonSchemaObject,
  type JsonSchemaType,
} from "@/components/JsonSchemaEditor";

export type UserSelectFieldType = "string" | "number" | "boolean" | "object" | "array";

export type UserSelectField = {
  id: string;
  key: string;
  label: string;
  type: UserSelectFieldType;
  required?: boolean;
  children?: UserSelectField[];
};

export type UserSelectCardConfig = {
  prompt: string;
  multiSelect: boolean;
  fields: UserSelectField[];
};

type UserSelectCardEditorProps = {
  value: UserSelectCardConfig;
  onChange: (next: UserSelectCardConfig) => void;
};

function nextFieldId(): string {
  return `field_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fieldToSchemaNode(field: UserSelectField): JsonSchemaNode {
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
      properties,
      required: required.length ? required : undefined,
      additionalProperties: false,
    };
  }

  if (field.type === "array") {
    return {
      type: "array",
      items: field.children?.[0] ? fieldToSchemaNode(field.children[0]) : { type: "string" },
    };
  }

  return { type: field.type };
}

function fieldsToSchema(fields: UserSelectField[]): JsonSchemaObject {
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

function schemaNodeToField(key: string, node: JsonSchemaNode, required: boolean): UserSelectField {
  if (node.type === "object") {
    const requiredSet = new Set(node.required ?? []);
    const children = Object.entries(node.properties ?? {}).map(([childKey, childNode]) =>
      schemaNodeToField(childKey, childNode, requiredSet.has(childKey))
    );
    return {
      id: nextFieldId(),
      key,
      label: key,
      type: "object",
      required,
      children,
    };
  }

  if (node.type === "array") {
    return {
      id: nextFieldId(),
      key,
      label: key,
      type: "array",
      required,
      children: [schemaNodeToField("item", node.items ?? { type: "string" }, false)],
    };
  }

  return {
    id: nextFieldId(),
    key,
    label: key,
    type: node.type as JsonSchemaType,
    required,
  };
}

function schemaToFields(schema: JsonSchemaObject): UserSelectField[] {
  const requiredSet = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([key, node]) =>
    schemaNodeToField(key, node, requiredSet.has(key))
  );
}

function countAllFields(fields: UserSelectField[]): number {
  return fields.reduce(
    (sum, field) => sum + 1 + (field.children?.length ? countAllFields(field.children) : 0),
    0
  );
}

export function UserSelectCardEditor({ value, onChange }: UserSelectCardEditorProps) {
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [draftSchema, setDraftSchema] = useState<JsonSchemaObject>(() =>
    fieldsToSchema(value.fields)
  );

  const allFieldCount = useMemo(() => countAllFields(value.fields), [value.fields]);

  useEffect(() => {
    if (!isManageOpen) return;
    setDraftSchema(fieldsToSchema(value.fields));
  }, [isManageOpen, value.fields]);

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">user.select card setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user-select-prompt">Prompt</Label>
            <Textarea
              id="user-select-prompt"
              className="min-h-20"
              placeholder="What would you like to select?"
              value={value.prompt}
              onChange={(event) => onChange({ ...value, prompt: event.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={value.multiSelect}
              onCheckedChange={(checked) =>
                onChange({ ...value, multiSelect: checked === true })
              }
            />
            Allow multi select
          </label>

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>Data structure</Label>
              <Button size="sm" type="button" variant="outline" onClick={() => setIsManageOpen(true)}>
                Manage
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {value.fields.length} root field(s), {allFieldCount} total field(s)
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isManageOpen} onOpenChange={setIsManageOpen}>
        <DialogContent size="full" className="h-[86vh] max-h-[86vh] p-4">
          <DialogHeader>
            <DialogTitle>Manage Data Structure</DialogTitle>
            <DialogDescription>
              Edit schema fields in nested tables and JSON. Both views are synced.
            </DialogDescription>
          </DialogHeader>

          <JsonSchemaEditor value={draftSchema} onChange={setDraftSchema} />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftSchema(fieldsToSchema(value.fields));
                setIsManageOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange({ ...value, fields: schemaToFields(draftSchema) });
                setIsManageOpen(false);
              }}
            >
              Save Structure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
