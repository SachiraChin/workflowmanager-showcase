import type { InteractionRequest, InteractionResponseData } from "@wfm/shared";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function isSelectable(schema: unknown): boolean {
  const obj = asObject(schema);
  if (!obj) return false;

  if (obj.selectable === true) return true;
  const ux = asObject(obj._ux);
  return ux?.selectable === true;
}

function unwrapSelectionPath(path: Array<string | number>): string | number | Array<string | number> {
  if (path.length === 1) return path[0];
  return path;
}

function selectionCandidatesAtLevel(
  data: unknown,
  pathPrefix: Array<string | number>
): Array<string | number | Array<string | number>> {
  if (Array.isArray(data)) {
    return data.map((_, idx) => unwrapSelectionPath([...pathPrefix, idx]));
  }

  const obj = asObject(data);
  if (!obj) return [];
  return Object.keys(obj).map((key) => unwrapSelectionPath([...pathPrefix, key]));
}

function collectSelectableCandidates(
  schema: unknown,
  data: unknown,
  path: Array<string | number> = []
): Array<string | number | Array<string | number>> {
  const schemaObj = asObject(schema);
  if (!schemaObj) return [];

  if (isSelectable(schemaObj)) {
    return selectionCandidatesAtLevel(data, path);
  }

  const type = typeof schemaObj.type === "string" ? schemaObj.type : undefined;

  if (type === "array" && Array.isArray(data)) {
    const itemSchema = schemaObj.items;
    if (isSelectable(itemSchema)) {
      return selectionCandidatesAtLevel(data, path);
    }

    if (data.length > 0 && itemSchema) {
      return collectSelectableCandidates(itemSchema, data[0], [...path, 0]);
    }
  }

  if (type === "object") {
    const dataObj = asObject(data);
    const properties = asObject(schemaObj.properties);

    if (dataObj && properties) {
      for (const key of Object.keys(properties)) {
        if (!(key in dataObj)) continue;
        const propSchema = properties[key];
        const propData = dataObj[key];

        if (isSelectable(propSchema)) {
          const candidates = selectionCandidatesAtLevel(propData, [...path, key]);
          if (candidates.length) return candidates;
        }

        const nested = collectSelectableCandidates(propSchema, propData, [...path, key]);
        if (nested.length) return nested;
      }
    }
  }

  return [];
}

function desiredSelectionCount(request: InteractionRequest): number {
  const displayData = asObject(request.display_data);
  const multi = displayData?.multi_select === true;

  if (!multi) return 1;

  const minSelections =
    typeof request.min_selections === "number" && request.min_selections > 0
      ? request.min_selections
      : 1;

  const maxSelections =
    typeof request.max_selections === "number" && request.max_selections > 0
      ? request.max_selections
      : minSelections;

  return Math.max(1, Math.min(minSelections, maxSelections));
}

export function buildAutoSelectionResponse(
  request: InteractionRequest
): InteractionResponseData | null {
  const displayData = asObject(request.display_data);
  if (!displayData) return null;

  const schema = displayData.schema;
  const data = displayData.data;
  if (!schema || data === undefined) return null;

  const candidates = collectSelectableCandidates(schema, data);
  if (!candidates.length) return null;

  const count = desiredSelectionCount(request);
  const selected = candidates.slice(0, count);

  return {
    selected_indices: selected,
    cancelled: false,
  };
}
