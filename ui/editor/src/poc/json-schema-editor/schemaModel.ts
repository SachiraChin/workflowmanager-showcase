export type SchemaFieldType = "string" | "number" | "boolean" | "object" | "array";

export type JsonSchemaNode = {
  type: SchemaFieldType;
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean;
};

export type JsonSchemaObject = {
  type: "object";
  description?: string;
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties: false;
};

export type SchemaField = {
  id: string;
  key: string;
  type: SchemaFieldType;
  required: boolean;
  description: string;
  children?: SchemaField[];
};

export const DEFAULT_SCHEMA: JsonSchemaObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Title shown in UI" },
    score: { type: "number", description: "Confidence score" },
    tags: {
      type: "array",
      description: "List of tags",
      items: { type: "string" },
    },
    meta: {
      type: "object",
      description: "Additional metadata",
      properties: {
        source: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  required: ["title"],
};

export const FIELD_TYPES: SchemaFieldType[] = [
  "string",
  "number",
  "boolean",
  "object",
  "array",
];

export function createField(
  type: SchemaFieldType = "string",
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

  return {
    id: nextFieldId(),
    key,
    type,
    required,
    description: "",
  };
}

function nextFieldId(): string {
  return `schema_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

export function schemaToFields(schema: JsonSchemaObject): SchemaField[] {
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

export function fieldsToSchema(fields: SchemaField[]): JsonSchemaObject {
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
    additionalProperties: false,
    properties,
    required: required.length ? required : undefined,
  };
}

export function mapFields(
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

export function removeFieldById(fields: SchemaField[], id: string): SchemaField[] {
  return fields
    .filter((field) => field.id !== id)
    .map((field) =>
      field.children?.length
        ? { ...field, children: removeFieldById(field.children, id) }
        : field
    );
}

export function findFieldById(fields: SchemaField[], id: string): SchemaField | null {
  for (const field of fields) {
    if (field.id === id) return field;
    if (field.children?.length) {
      const found = findFieldById(field.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function parseSchemaText(value: string): {
  schema: JsonSchemaObject | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(value) as Partial<JsonSchemaObject>;
    if (parsed.type !== "object") {
      return { schema: null, error: "Root type must be object." };
    }
    if (!parsed.properties || typeof parsed.properties !== "object") {
      return { schema: null, error: "Schema must include object properties." };
    }
    return {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: parsed.properties,
        required: parsed.required,
      },
      error: null,
    };
  } catch {
    return { schema: null, error: "Invalid JSON." };
  }
}

export function collectExpandableIds(fields: SchemaField[]): Set<string> {
  const ids = new Set<string>();
  const walk = (nodes: SchemaField[]) => {
    for (const node of nodes) {
      if (node.type === "object" || node.type === "array") {
        ids.add(node.id);
      }
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(fields);
  return ids;
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

function buildExampleFromNode(node: JsonSchemaNode): unknown {
  if (node.type === "string") {
    return loremWords(3);
  }
  if (node.type === "number") {
    return 42;
  }
  if (node.type === "boolean") {
    return true;
  }
  if (node.type === "array") {
    const itemNode = node.items ?? { type: "string" };
    return [buildExampleFromNode(itemNode), buildExampleFromNode(itemNode)];
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    result[key] = buildExampleFromNode(child);
  }
  return result;
}

export function generateExampleDataFromSchema(schema: JsonSchemaObject): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, node] of Object.entries(schema.properties)) {
    output[key] = buildExampleFromNode(node);
  }
  return output;
}

export type FlattenedField = {
  id: string;
  parentId: string | null;
  depth: number;
  path: string;
  field: SchemaField;
};

export function flattenFields(
  fields: SchemaField[],
  parentId: string | null = null,
  parentPath = ""
): FlattenedField[] {
  const out: FlattenedField[] = [];
  for (const field of fields) {
    const path = parentPath ? `${parentPath}.${field.key || "(new)"}` : field.key || "(new)";
    const depth = parentPath ? parentPath.split(".").length : 0;
    out.push({ id: field.id, parentId, depth, path, field });
    if (field.children?.length) {
      out.push(...flattenFields(field.children, field.id, path));
    }
  }
  return out;
}
