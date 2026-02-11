export type JsonRef = {
  $ref: string;
  type: "json";
};

export type UserSelectOption = {
  id: string;
  label: string;
  description: string;
};

export type UserSelectDataSource = UserSelectOption[] | JsonRef;

export type UserSelectModule = {
  module_id: "user.select";
  name: string;
  inputs: {
    resolver_schema?: {
      type: string;
      properties?: Record<string, { resolver: string }>;
    };
    prompt: string;
    data: UserSelectDataSource;
    schema: JsonRef | Record<string, unknown>;
    multi_select: boolean;
    mode: string;
  };
  outputs_to_state: {
    selected_indices: string;
    selected_data: string;
  };
};

export function isJsonRef(value: UserSelectDataSource): value is JsonRef {
  return !Array.isArray(value);
}

export function isJsonRefObject(value: unknown): value is JsonRef {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.$ref === "string" && rec.type === "json";
}

export function validateUserSelectModule(module: UserSelectModule): string[] {
  const issues: string[] = [];

  if (!module.name.trim()) {
    issues.push("Module name is required");
  }
  if (!module.inputs.prompt.trim()) {
    issues.push("Prompt is required");
  }

  if (Array.isArray(module.inputs.data)) {
    if (!module.inputs.data.length) {
      issues.push("At least one option is required for inline data");
    }

    const ids = new Set<string>();
    module.inputs.data.forEach((item, index) => {
      if (!item.id.trim()) {
        issues.push(`Option ${index + 1} is missing id`);
      }
      if (!item.label.trim()) {
        issues.push(`Option ${index + 1} is missing label`);
      }
      if (item.id.trim()) {
        if (ids.has(item.id)) {
          issues.push(`Option id '${item.id}' is duplicated`);
        }
        ids.add(item.id);
      }
    });
  } else if (!module.inputs.data.$ref.trim()) {
    issues.push("Data reference path is required");
  }

  if (isJsonRefObject(module.inputs.schema) && !module.inputs.schema.$ref.trim()) {
    issues.push("Schema reference path is required");
  }
  if (!module.outputs_to_state.selected_indices.trim()) {
    issues.push("selected_indices output key is required");
  }
  if (!module.outputs_to_state.selected_data.trim()) {
    issues.push("selected_data output key is required");
  }

  return issues;
}
