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
  type SchemaProperty,
} from "@wfm/shared";
import {
  UxSchemaEditor,
  type DataSchemaNode,
} from "@/components/ux-schema-editor";
import {
  type UserSelectModule,
  type JsonRef,
  isJsonRefObject,
} from "@/modules/user-select/types";

// =============================================================================
// Types
// =============================================================================

export type UserSelectInputs = UserSelectModule["inputs"];

type UserSelectCardEditorProps = {
  value: UserSelectInputs;
  onChange: (next: UserSelectInputs) => void;
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Infer a DataSchemaNode from sample data.
 * Used when we have inline data but need to generate a schema for the UX editor.
 */
function inferDataSchema(data: unknown): DataSchemaNode {
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return { type: "array", items: { type: "object" } };
    }
    return {
      type: "array",
      items: inferDataSchema(data[0]),
    };
  }

  if (data !== null && typeof data === "object") {
    const properties: Record<string, DataSchemaNode> = {};
    for (const [key, value] of Object.entries(data)) {
      properties[key] = inferDataSchema(value);
    }
    return { type: "object", properties };
  }

  if (typeof data === "string") return { type: "string" };
  if (typeof data === "number") return { type: "number" };
  if (typeof data === "boolean") return { type: "boolean" };

  return { type: "string" };
}

/**
 * Check if data is inline (array) vs a reference ($ref)
 */
function isInlineData(data: unknown): data is unknown[] {
  return Array.isArray(data);
}

/**
 * Get data item count for display
 */
function getDataSummary(data: unknown): string {
  if (isInlineData(data)) {
    return `${data.length} inline option(s)`;
  }
  if (isJsonRefObject(data)) {
    return `Reference: ${(data as JsonRef).$ref}`;
  }
  if (typeof data === "string" && data.startsWith("{{")) {
    return `State reference: ${data}`;
  }
  return "Unknown data source";
}

/**
 * Get schema summary for display
 */
function getSchemaSummary(schema: unknown): string {
  if (isJsonRefObject(schema)) {
    return `Reference: ${(schema as JsonRef).$ref}`;
  }
  if (schema && typeof schema === "object") {
    return "Inline schema configured";
  }
  return "No schema configured";
}

// =============================================================================
// Component
// =============================================================================

export function UserSelectCardEditor({ value, onChange }: UserSelectCardEditorProps) {
  const [isUxEditorOpen, setIsUxEditorOpen] = useState(false);
  const [draftSchema, setDraftSchema] = useState<SchemaProperty | undefined>(undefined);

  // Determine if we can edit the UX schema
  // We can only edit if we have inline data (not a $ref)
  const hasInlineData = isInlineData(value.data);
  const hasInlineSchema = !isJsonRefObject(value.schema);

  // Build data schema from inline data for UX editor
  const dataSchema = useMemo<DataSchemaNode>(() => {
    if (hasInlineData) {
      return inferDataSchema(value.data);
    }
    // For $ref data, we can't infer schema - return empty array schema
    return { type: "array", items: { type: "object" } };
  }, [value.data, hasInlineData]);

  // Get the actual data for preview
  const previewData = useMemo(() => {
    if (hasInlineData) {
      return value.data;
    }
    // For $ref data, return empty array (would need to resolve at runtime)
    return [];
  }, [value.data, hasInlineData]);

  // Current display schema (inline or undefined for $ref)
  const currentDisplaySchema = useMemo<SchemaProperty | undefined>(() => {
    if (hasInlineSchema && value.schema && typeof value.schema === "object") {
      return value.schema as SchemaProperty;
    }
    return undefined;
  }, [value.schema, hasInlineSchema]);

  // Reset draft when dialog opens
  useEffect(() => {
    if (isUxEditorOpen) {
      setDraftSchema(currentDisplaySchema);
    }
  }, [isUxEditorOpen, currentDisplaySchema]);

  const handleSaveUxSchema = () => {
    if (draftSchema) {
      onChange({ ...value, schema: draftSchema });
    }
    setIsUxEditorOpen(false);
  };

  const canEditUx = hasInlineData;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">user.select configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Prompt */}
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

          {/* Multi-select toggle */}
          <label className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
            <Checkbox
              checked={value.multi_select}
              onCheckedChange={(checked) =>
                onChange({ ...value, multi_select: checked === true })
              }
            />
            Allow multi select
          </label>

          {/* Mode selector */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="flex gap-2">
              <label className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="select"
                  checked={value.mode === "select"}
                  onChange={() => onChange({ ...value, mode: "select" })}
                  className="accent-primary"
                />
                Select
              </label>
              <label className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  value="review"
                  checked={value.mode === "review"}
                  onChange={() => onChange({ ...value, mode: "review" })}
                  className="accent-primary"
                />
                Review
              </label>
            </div>
          </div>

          {/* Data source info */}
          <div className="space-y-2 rounded-md border p-3">
            <Label>Data Source</Label>
            <p className="text-xs text-muted-foreground">
              {getDataSummary(value.data)}
            </p>
          </div>

          {/* UX Definition */}
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label>UX Definition</Label>
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setIsUxEditorOpen(true)}
                disabled={!canEditUx}
                title={canEditUx ? undefined : "UX editing requires inline data"}
              >
                Manage
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {getSchemaSummary(value.schema)}
            </p>
            {!canEditUx && (
              <p className="text-xs text-amber-600">
                UX editing is only available with inline data. Resolve $ref to edit.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* UX Schema Editor Dialog */}
      <Dialog open={isUxEditorOpen} onOpenChange={setIsUxEditorOpen}>
        <DialogContent size="full" className="h-[90vh] max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>Manage UX Definition</DialogTitle>
            <DialogDescription>
              Configure how options are displayed by dragging UX identifiers onto schema nodes.
              Changes are previewed in real-time.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-hidden">
            <UxSchemaEditor
              dataSchema={dataSchema}
              data={previewData}
              displaySchema={draftSchema}
              onChange={setDraftSchema}
            />
          </div>

          <DialogFooter className="px-6 py-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDraftSchema(currentDisplaySchema);
                setIsUxEditorOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveUxSchema}>
              Save UX Definition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
