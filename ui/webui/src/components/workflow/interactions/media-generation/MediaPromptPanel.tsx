/**
 * MediaPromptPanel - Content panel with media generation capabilities.
 *
 * Used by ContentPanelSchemaRenderer when in MediaGeneration context.
 * Renders:
 * - Editable prompt text (from display_format)
 * - Parameter inputs (from input_schema)
 * - Generated content grid
 * - Action buttons
 */

import { useMemo, useEffect, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { renderTemplate } from "@/lib/template-service";
import { useWorkflowStateContext } from "@/contexts/WorkflowStateContext";
import { useInput } from "../schema-interaction/InputContext";
import { getUx } from "../schema-interaction/ux-utils";
import {
  TextareaInputRenderer,
  SelectInputRenderer,
  SliderInputRenderer,
  type ControlConfig,
} from "../schema-interaction/renderers";
import { MediaGrid } from "./MediaGrid";
import { useMediaGeneration } from "./MediaGenerationContext";
import type { SchemaProperty, UxConfig } from "../schema-interaction/types";
import type { SubActionConfig } from "./types";

// =============================================================================
// Types
// =============================================================================

interface MediaPromptPanelProps {
  /** The prompt data */
  data: unknown;
  /** The schema for this prompt (unused but kept for interface consistency) */
  schema: SchemaProperty;
  /** Path to this prompt in the data tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
}

// Destructure schema but prefix with _ to indicate intentionally unused
// Schema is passed for interface consistency with other renderers

// =============================================================================
// Component
// =============================================================================

export function MediaPromptPanel({
  data,
  schema: _schema,
  path,
  ux,
}: MediaPromptPanelProps) {
  void _schema; // Kept for interface consistency
  const mediaContext = useMediaGeneration();
  const inputContext = useInput();
  const { state: workflowState } = useWorkflowStateContext();
  const templateState = (workflowState.state_mapped || {}) as Record<string, unknown>;

  // Should never happen if called correctly, but guard anyway
  if (!mediaContext) {
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
    getDataAtPath,
  } = mediaContext;

  // Header from display_label
  const header = ux.display_label || path[path.length - 1];

  // Build path for prompt text value (append _text to distinguish from original data)
  const promptTextPath = useMemo(() => [...path, "_text"], [path]);

  // Build path prefix for parameters
  const paramsPathPrefix = useMemo(() => [...path, "_params"], [path]);

  // Render initial prompt text from display_format template
  const initialPromptText = useMemo(() => {
    if (ux.display_format) {
      return renderTemplate(ux.display_format, data, templateState);
    }
    // Fallback: if data is string, use directly; otherwise stringify
    if (typeof data === "string") return data;
    if (data && typeof data === "object") {
      return Object.values(data).join(" ");
    }
    return String(data ?? "");
  }, [ux.display_format, data, templateState]);

  // Get current prompt text (edited or initial)
  const currentPromptText = useMemo(() => {
    const editedValue = inputContext.getValue(promptTextPath);
    if (editedValue !== undefined && editedValue !== null) {
      return String(editedValue);
    }
    return initialPromptText;
  }, [inputContext, promptTextPath, initialPromptText]);

  // Extract input_schema for parameters
  const inputSchema = ux.input_schema as SchemaProperty | undefined;
  const inputProperties = (inputSchema?.properties || {}) as Record<string, SchemaProperty>;
  const parameterKeys = Object.keys(inputProperties);

  // Get parent path and data for source_field lookups
  // e.g., for path ["prompts", "stable_diffusion", "prompt"], parent is ["prompts", "stable_diffusion"]
  const parentPath = useMemo(() => path.slice(0, -1), [path]);
  const parentData = useMemo(
    () => getDataAtPath(parentPath) as Record<string, unknown> | undefined,
    [getDataAtPath, parentPath]
  );

  // Helper to get initial value for a parameter (checks source_field)
  const getParamInitialValue = useCallback(
    (key: string): unknown => {
      const propSchema = inputProperties[key] as Record<string, unknown>;
      const propUx = (propSchema?._ux || {}) as Record<string, unknown>;

      // Check for source_field - get value from parent data
      const sourceField = propUx.source_field as string | undefined;
      if (sourceField && parentData && sourceField in parentData) {
        return parentData[sourceField];
      }

      // Fall back to schema default
      return propSchema?.default;
    },
    [inputProperties, parentData]
  );

  // Initialize source_field parameter values on mount
  useEffect(() => {
    if (readonly) return;

    for (const key of parameterKeys) {
      const propSchema = inputProperties[key] as Record<string, unknown>;
      const propUx = (propSchema?._ux || {}) as Record<string, unknown>;
      const sourceField = propUx.source_field as string | undefined;

      // Only initialize if source_field is specified and value not already set
      if (sourceField && parentData && sourceField in parentData) {
        const paramPath = [...paramsPathPrefix, key];
        const existingValue = inputContext.getValue(paramPath);
        if (existingValue === undefined) {
          inputContext.setValue(paramPath, parentData[sourceField]);
        }
      }
    }
    // Run only once on mount (when parentData becomes available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentData !== undefined]);

  // Get state for this prompt
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

  // Extract provider from path (e.g., ["prompts", "leonardo", "phoenix_1_0"] -> "leonardo")
  const provider = path.length >= 2 ? path[path.length - 2] : "unknown";

  // Extract prompt_id from path (e.g., ["prompts", "leonardo", "phoenix_1_0"] -> "phoenix_1_0")
  // Used by backend to determine model type (isPhoenix, isSDXL, etc.)
  const promptId = path.length >= 1 ? path[path.length - 1] : "unknown";

  // Get first sub-action type for preview (default to txt2img)
  const defaultActionType = subActions.length > 0 ? subActions[0].action_type : "txt2img";

  // Stable path key for dependencies
  const pathKey = path.join(".");

  // Build current params object (reserved for future direct params access)
  const _currentParams = useMemo(() => {
    const params: Record<string, unknown> = {};
    for (const key of parameterKeys) {
      const paramPath = [...paramsPathPrefix, key];
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
  }, [pathKey, parameterKeys.join(","), getParamInitialValue]); // Only recompute when path or param keys change, not on every inputContext change
  void _currentParams;

  // Get current param values as a stable string for change detection
  const paramValuesKey = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const key of parameterKeys) {
      const paramPath = [...paramsPathPrefix, key];
      const value = inputContext.getValue(paramPath);
      if (value !== undefined) {
        values[key] = value;
      } else {
        // Use initial value (from source_field or schema default)
        values[key] = getParamInitialValue(key);
      }
    }
    return JSON.stringify(values);
  }, [parameterKeys, paramsPathPrefix, inputContext, getParamInitialValue]);

  // Fetch preview when params change (debounced)
  useEffect(() => {
    if (readonly) return;

    // Parse current values for the API call
    const params = JSON.parse(paramValuesKey) as Record<string, unknown>;
    // Include prompt_id for backend to determine model type (isPhoenix, isSDXL, etc.)
    params.prompt_id = promptId;

    // Use a small delay to avoid excessive API calls during rapid changes
    const timeoutId = setTimeout(() => {
      fetchPreview(path, provider, defaultActionType, params);
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly, pathKey, provider, defaultActionType, paramValuesKey, promptId]); // Use stable keys, fetchPreview is stable from context

  // Handle generate button click
  const handleGenerate = (action: SubActionConfig) => {
    // Collect current parameter values
    const params: Record<string, unknown> = {
      prompt: currentPromptText,
    };

    // Add parameter values from input context
    for (const key of parameterKeys) {
      const paramPath = [...paramsPathPrefix, key];
      const value = inputContext.getValue(paramPath);
      // Skip undefined, null, and empty string values
      if (value !== undefined && value !== null && value !== "") {
        params[key] = value;
      } else {
        // Use initial value (from source_field or schema default)
        const initialValue = getParamInitialValue(key);
        if (initialValue !== undefined && initialValue !== null && initialValue !== "") {
          params[key] = initialValue;
        }
      }
    }

    // Validate required fields
    const errors: string[] = [];
    for (const fieldKey of requiredFields) {
      const value = params[fieldKey];
      if (value === undefined || value === null || value === "") {
        const propSchema = inputProperties[fieldKey] as Record<string, unknown>;
        const fieldTitle = (propSchema?.title as string) || fieldKey;
        errors.push(`${fieldTitle} is required`);
      }
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    // Clear any previous validation errors
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
        {/* Prompt Text */}
        <TextareaInputRenderer
          path={promptTextPath}
          value={initialPromptText}
          placeholder="Enter prompt..."
          minRows={4}
          readonly={readonly}
          disabled={loading}
        />

        {/* Parameters */}
        {parameterKeys.length > 0 && !readonly && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {parameterKeys.map((key) => {
              const propSchema = inputProperties[key];
              const propUx = getUx(propSchema as Record<string, unknown>);
              const paramPath = [...paramsPathPrefix, key];

              return (
                <ParameterField
                  key={key}
                  fieldKey={key}
                  path={paramPath}
                  schema={propSchema}
                  ux={propUx}
                  disabled={loading}
                />
              );
            })}
          </div>
        )}

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

        {/* Action Buttons - fixed below inputs */}
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
            <span className="tabular-nums">
              ({Math.round(progress.elapsed_ms / 1000)}s)
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        {/* Generated Content - latest at top */}
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

// =============================================================================
// Parameter Field Component
// =============================================================================

interface ParameterFieldProps {
  fieldKey: string;
  path: string[];
  schema: SchemaProperty;
  ux: UxConfig;
  disabled: boolean;
}

function ParameterField({ fieldKey, path, schema, ux, disabled }: ParameterFieldProps) {
  const schemaRecord = schema as Record<string, unknown>;
  const label = ux.display_label || (schemaRecord.title as string) || fieldKey;
  const inputType = ux.input_type;
  const minimum = schemaRecord.minimum as number | undefined;
  const maximum = schemaRecord.maximum as number | undefined;
  const step = schemaRecord.step as number | undefined;
  const defaultValue = schemaRecord.default;

  // Extract enum-related props for SelectInputRenderer
  const enumData = schemaRecord.enum as unknown[] | undefined;
  const valueKey = schemaRecord.value_key as string | undefined;
  const labelKey = schemaRecord.label_key as string | undefined;
  const controls = schemaRecord.controls as Record<string, ControlConfig> | undefined;
  const enumLabels = ux.enum_labels;

  // Select input - let SelectInputRenderer handle all modes
  const isSelectType = enumData !== undefined || inputType === "select" || valueKey !== undefined;
  if (isSelectType) {
    return (
      <SelectInputRenderer
        path={path}
        enumData={enumData}
        valueKey={valueKey}
        labelKey={labelKey}
        controls={controls}
        enumLabels={enumLabels}
        label={label}
        disabled={disabled}
        value={defaultValue as string}
      />
    );
  }

  // Slider input
  if (inputType === "slider" && minimum !== undefined && maximum !== undefined) {
    return (
      <SliderInputRenderer
        path={path}
        min={minimum}
        max={maximum}
        step={step}
        label={label}
        disabled={disabled}
        value={defaultValue as number}
      />
    );
  }

  // Textarea input
  if (inputType === "textarea") {
    const rows = (ux as Record<string, unknown>).rows as number | undefined;
    return (
      <div className="col-span-full">
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          {label}
        </label>
        <TextareaInputRenderer
          path={path}
          value={defaultValue as string}
          placeholder=""
          minRows={rows || 2}
          readonly={false}
          disabled={disabled}
        />
      </div>
    );
  }

  // Skip unsupported input types for now
  return null;
}
