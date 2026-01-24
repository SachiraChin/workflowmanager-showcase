/**
 * MediaPanel - Schema renderer for media generation.
 *
 * Renders when render_as: "media" is set in schema.
 * Handles:
 * - Editable prompt text (from source field or data)
 * - Parameter inputs (from input_schema)
 * - Generation preview (resolution, credits)
 * - Action buttons (generate)
 * - Generated media grid
 *
 * This is the explicit entry point for media generation UI,
 * replacing the implicit ContentPanelSchemaRenderer check.
 */

import { useMemo, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useWorkflowStateContext } from "@/contexts/WorkflowStateContext";
import { useInput } from "../schema-interaction/InputContext";
import { useInputSchemaOptional } from "../schema-interaction/InputSchemaContext";
import { MediaGrid } from "./MediaGrid";
import { useMediaGeneration } from "./MediaGenerationContext";
import type { SchemaProperty, UxConfig } from "../schema-interaction/types";
import type { SubActionConfig } from "./types";

// =============================================================================
// Types
// =============================================================================

interface MediaPanelProps {
  /** The data for this schema node */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
}

// =============================================================================
// Component
// =============================================================================

export function MediaPanel({
  data,
  schema: _schema,
  path,
  ux,
}: MediaPanelProps) {
  void _schema; // Schema is available but we primarily use ux.input_schema
  const mediaContext = useMediaGeneration();
  const inputContext = useInput();
  const inputSchemaContext = useInputSchemaOptional();
  const { state: workflowState } = useWorkflowStateContext();
  // Reserved for future template expansion in display_format
  const _templateState = (workflowState.state_mapped || {}) as Record<string, unknown>;
  void _templateState;

  // Should never happen if routed correctly, but guard anyway
  if (!mediaContext) {
    console.warn("[MediaPanel] Rendered outside MediaGenerationContext");
    return null;
  }

  const {
    subActions,
    getGenerations,
    isLoading,
    getProgress,
    getError,
    selectedContentId,
    onSelectContent,
    executeSubAction,
    readonly,
    getPreview,
    isPreviewLoading,
    fetchPreview,
    getDataAtPath: _getDataAtPath,
  } = mediaContext;
  void _getDataAtPath; // Reserved for nested data access

  // Header from display_label
  const header = ux.display_label || path[path.length - 1];

  // Get the data object for this path (for source_field lookups)
  const panelData = useMemo(
    () => (typeof data === "object" && data !== null ? data as Record<string, unknown> : {}),
    [data]
  );

  // Extract input_schema for parameters
  const inputSchema = ux.input_schema as SchemaProperty | undefined;
  const inputProperties = (inputSchema?.properties || {}) as Record<string, SchemaProperty>;
  const parameterKeys = Object.keys(inputProperties);

  // Helper to get initial value for a parameter (checks source_field)
  const getParamInitialValue = useCallback(
    (key: string): unknown => {
      const propSchema = inputProperties[key] as Record<string, unknown>;
      const propUx = (propSchema?._ux || {}) as Record<string, unknown>;

      // Check for source_field - get value from panel data
      const sourceField = propUx.source_field as string | undefined;
      if (sourceField && sourceField in panelData) {
        return panelData[sourceField];
      }

      // Fall back to schema default
      return propSchema?.default;
    },
    [inputProperties, panelData]
  );

  // Resolve {field} placeholders in a template string using panel data
  const resolveSourceData = useCallback((template: string): string => {
    return template.replace(/\{(\w+)\}/g, (_, field) => {
      const value = panelData[field];
      return value !== undefined ? String(value) : "";
    });
  }, [panelData]);

  // Initialize source_field/source_data parameter values on mount
  useEffect(() => {
    if (readonly) return;

    for (const key of parameterKeys) {
      const propSchema = inputProperties[key] as Record<string, unknown>;
      const propUx = (propSchema?._ux || {}) as Record<string, unknown>;
      const sourceField = propUx.source_field as string | undefined;
      const sourceData = propUx.source_data as string | undefined;

      const paramPath = [...path, key];
      const existingValue = inputContext.getValue(paramPath);
      if (existingValue !== undefined) continue;

      // source_data takes precedence - supports {field} template syntax
      if (sourceData) {
        inputContext.setValue(paramPath, resolveSourceData(sourceData));
      } else if (sourceField && sourceField in panelData) {
        inputContext.setValue(paramPath, panelData[sourceField]);
      }
    }
    // Run only once on mount (when panelData becomes available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelData !== undefined]);

  // Get state for this path
  const generations = getGenerations(path);
  const loading = isLoading(path);
  const progress = getProgress(path);
  const error = getError(path);
  const preview = getPreview(path);
  const previewLoading = isPreviewLoading(path);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Extract required fields from schema
  const requiredFields = useMemo(() => {
    const required: string[] = [];
    for (const [key, schema] of Object.entries(inputProperties)) {
      const schemaRecord = schema as Record<string, unknown>;
      if (schemaRecord.required === true) {
        required.push(key);
      }
    }
    return required;
  }, [inputProperties]);

  // Read provider from schema metadata (required)
  const provider = ux.provider;
  if (!provider) {
    throw new Error(`MediaPanel requires _ux.provider to be set in schema at path: ${path.join(".")}`);
  }

  // Read prompt_id from schema metadata (defaults to "default" for DB storage)
  const promptId = ux.prompt_id || "default";

  // Get first sub-action type for preview (default to txt2img)
  const defaultActionType = subActions.length > 0 ? subActions[0].action_type : "txt2img";

  // Stable path key for dependencies
  const pathKey = path.join(".");

  // Build current params object (reserved for future direct params access)
  const _currentParams = useMemo(() => {
    const params: Record<string, unknown> = {};
    for (const key of parameterKeys) {
      const paramPath = [...path, key];
      const value = inputContext.getValue(paramPath);
      if (value !== undefined) {
        params[key] = value;
      } else {
        // Use initial value (from source_field or schema default)
        const initialValue = getParamInitialValue(key);
        if (initialValue !== undefined) {
          params[key] = initialValue;
        }
      }
    }
    return params;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathKey, parameterKeys.join(","), getParamInitialValue]);
  void _currentParams;

  // Get current param values as a stable string for change detection
  const paramValuesKey = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const key of parameterKeys) {
      const paramPath = [...path, key];
      const value = inputContext.getValue(paramPath);
      if (value !== undefined) {
        values[key] = value;
      } else {
        values[key] = getParamInitialValue(key);
      }
    }
    return JSON.stringify(values);
  }, [parameterKeys, path, inputContext, getParamInitialValue]);

  // Fetch preview when params change (debounced)
  useEffect(() => {
    if (readonly) return;

    const params = JSON.parse(paramValuesKey) as Record<string, unknown>;
    params.prompt_id = promptId;

    const timeoutId = setTimeout(() => {
      fetchPreview(path, provider, defaultActionType, params);
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly, pathKey, provider, defaultActionType, paramValuesKey, promptId]);

  // Get the prompt text value
  const promptTextPath = useMemo(() => [...path, "_text"], [path]);
  const currentPromptText = useMemo(() => {
    const editedValue = inputContext.getValue(promptTextPath);
    if (editedValue !== undefined && editedValue !== null) {
      return String(editedValue);
    }
    // Fall back to source_field from _text input or first available prompt
    const textSchema = inputProperties._text as Record<string, unknown> | undefined;
    const textUx = (textSchema?._ux || {}) as Record<string, unknown>;
    const sourceField = textUx.source_field as string | undefined;
    if (sourceField && sourceField in panelData) {
      return String(panelData[sourceField] ?? "");
    }
    return "";
  }, [inputContext, promptTextPath, inputProperties, panelData]);

  // Handle generate button click
  const handleGenerate = (action: SubActionConfig) => {
    if (!inputSchemaContext) {
      console.warn("[MediaPanel] No InputSchemaContext available for generation");
      return;
    }

    const params: Record<string, unknown> = {
      prompt: currentPromptText,
      ...inputSchemaContext.values,
    };

    // Validate required fields and set errors via context (shows red border on inputs)
    const errors: string[] = [];
    inputSchemaContext.clearAllErrors();

    for (const fieldKey of requiredFields) {
      const value = params[fieldKey];
      if (value === undefined || value === null || value === "") {
        const propSchema = inputProperties[fieldKey] as Record<string, unknown>;
        const fieldTitle = (propSchema?.title as string) || fieldKey;
        const errorMsg = `${fieldTitle} is required`;
        errors.push(errorMsg);
        inputSchemaContext.setError(fieldKey, errorMsg);
      }
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    executeSubAction(path, action, params, { provider, promptId });
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-4 py-2.5 bg-muted/50 border-b">
        <span className="font-medium text-sm text-foreground capitalize">
          {String(header).replace(/_/g, " ")}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-4">
        {/* Preview Info - Resolution and Credits */}
        {!readonly && (preview || previewLoading) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
            {previewLoading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading preview...
              </span>
            ) : preview ? (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">Resolution:</span>
                  {preview.resolution.width} × {preview.resolution.height}
                  <span className="text-xs">({preview.resolution.megapixels}MP)</span>
                </span>
                {preview.credits.credits > 0 && (
                  <>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">Credits:</span>
                      {preview.credits.credits}
                      {preview.credits.total_cost_usd > 0 && (
                        <span className="text-xs">(${preview.credits.total_cost_usd.toFixed(4)})</span>
                      )}
                    </span>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">Per Image:</span>
                      {preview.credits.credits_per_image} credits
                      {preview.credits.cost_per_image_usd > 0 && (
                        <span className="text-xs">(${preview.credits.cost_per_image_usd.toFixed(4)})</span>
                      )}
                    </span>
                  </>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* Action Buttons */}
        {!readonly && subActions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {subActions.map((action) => (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                onClick={() => handleGenerate(action)}
                disabled={loading}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="text-sm text-destructive">
            {validationErrors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}

        {/* Progress */}
        {loading && progress && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{progress.message}</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        {/* Generated Content */}
        {generations.length > 0 && (
          <MediaGrid
            generations={generations}
            selectedContentId={selectedContentId}
            onSelect={onSelectContent}
            lazyLoad={readonly}
            disabled={readonly}
          />
        )}
      </div>
    </div>
  );
}
