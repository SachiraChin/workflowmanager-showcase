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

import { useMemo, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Crop, X } from "lucide-react";
import { useWorkflowStateContext } from "@/state/WorkflowStateContext";
import { useInputSchemaOptional } from "../../schema/input/InputSchemaContext";
import { MediaGrid } from "./MediaGrid";
import { CropSelectionModal } from "./CropSelectionModal";
import { useMediaGeneration } from "./MediaGenerationContext";
import { toMediaUrl } from "@/core/config";
import type { SchemaProperty, UxConfig } from "../../schema/types";
import type { SubActionConfig, CropRegion } from "./types";

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
  data: _data,
  schema: _schema,
  path,
  ux,
}: MediaPanelProps) {
  void _data; // Data is passed but values are managed by InputSchemaContext
  void _schema; // Schema is available but we primarily use ux.input_schema
  const mediaContext = useMediaGeneration();
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
    getDataAtPath,
    // Crop selection state
    savedCrop,
    setSavedCrop,
    clearSavedCrop,
  } = mediaContext;

  // Header from display_label
  const header = ux.display_label || path[path.length - 1];

  // Extract input_schema for parameters
  const inputSchema = ux.input_schema as SchemaProperty | undefined;
  const inputProperties = (inputSchema?.properties || {}) as Record<string, SchemaProperty>;

  // Get state for this path
  const generations = getGenerations(path);
  const loading = isLoading(path);
  const progress = getProgress(path);
  const error = getError(path);
  const preview = getPreview(path);
  const previewLoading = isPreviewLoading(path);

  // Validation state
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Crop modal state (for img2vid)
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropModalViewOnly, setCropModalViewOnly] = useState(false);
  const [pendingAction, setPendingAction] = useState<SubActionConfig | null>(null);
  const [pendingParams, setPendingParams] = useState<Record<string, unknown> | null>(null);

  // Get source image data for crop modal
  const sourceImageData = getDataAtPath(["_source_image"]) as {
    url?: string;
    local_path?: string;
  } | undefined;

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

  // Get current param values as a stable string for change detection (for preview)
  const paramValuesKey = useMemo(() => {
    if (!inputSchemaContext) return "{}";
    return JSON.stringify(inputSchemaContext.values);
  }, [inputSchemaContext?.values]);

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
  }, [readonly, path.join("."), provider, defaultActionType, paramValuesKey, promptId]);

  // Execute sub-action with optional crop region
  const executeWithCrop = useCallback(
    (action: SubActionConfig, params: Record<string, unknown>, cropRegion: CropRegion | null) => {
      const finalParams = { ...params };

      // Add source_image to params for img2vid
      if (action.action_type === "img2vid" && sourceImageData) {
        finalParams.source_image = sourceImageData;
      }

      // Add crop region if provided
      if (cropRegion) {
        finalParams.crop_region = cropRegion;
      }

      executeSubAction(path, action, finalParams, { provider, promptId });
    },
    [executeSubAction, path, provider, promptId, sourceImageData]
  );

  // Handle crop modal confirm
  const handleCropConfirm = useCallback(
    (cropRegion: CropRegion | null, savePreference: boolean, aspectRatio: string) => {
      setShowCropModal(false);

      if (!pendingAction || !pendingParams) return;

      // Save crop preference if requested
      if (savePreference && cropRegion) {
        setSavedCrop({
          region: cropRegion,
          aspectRatio,
        });
      }

      // Execute the action
      executeWithCrop(pendingAction, pendingParams, cropRegion);

      // Clear pending state
      setPendingAction(null);
      setPendingParams(null);
    },
    [pendingAction, pendingParams, executeWithCrop, setSavedCrop]
  );

  // Handle view crop button click
  const handleViewCrop = useCallback(() => {
    setCropModalViewOnly(true);
    setShowCropModal(true);
  }, []);

  // Handle generate button click
  const handleGenerate = (action: SubActionConfig) => {
    if (!inputSchemaContext) {
      console.warn("[MediaPanel] No InputSchemaContext available for generation");
      return;
    }

    // Get values with destination_field mapping applied
    const params: Record<string, unknown> = inputSchemaContext.getMappedValues();

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

    // For img2vid, show crop modal or use saved crop
    if (action.action_type === "img2vid" && sourceImageData?.url) {
      if (savedCrop) {
        // Use saved crop, skip modal
        executeWithCrop(action, params, savedCrop.region);
      } else {
        // Show crop modal
        setPendingAction(action);
        setPendingParams(params);
        setCropModalViewOnly(false);
        setShowCropModal(true);
      }
    } else {
      // txt2img/img2img or no source image - proceed directly
      executeSubAction(path, action, params, { provider, promptId });
    }
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
                      {preview.credits.credits} ({preview.credits.credits_per_image}/img)
                    </span>
                  </>
                )}
                {preview.credits.total_cost_usd > 0 && (
                  <>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium text-foreground">Cost:</span>
                      ${preview.credits.total_cost_usd.toFixed(4)} (${preview.credits.cost_per_image_usd.toFixed(4)}/img)
                    </span>
                  </>
                )}
                {/* Crop selection info (for img2vid) */}
                {savedCrop && (
                  <>
                    <span className="text-muted-foreground/50">•</span>
                    <span className="flex items-center gap-1.5">
                      <Crop className="w-3 h-3" />
                      <span className="font-medium text-foreground">Crop:</span>
                      {savedCrop.region.width} × {savedCrop.region.height}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-xs"
                        onClick={handleViewCrop}
                      >
                        View
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 px-1.5 text-xs"
                        onClick={clearSavedCrop}
                      >
                        <X className="w-3 h-3" />
                      </Button>
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

      {/* Crop Selection Modal (for img2vid) */}
      {sourceImageData?.url && (
        <CropSelectionModal
          open={showCropModal}
          onClose={() => {
            setShowCropModal(false);
            setCropModalViewOnly(false);
            setPendingAction(null);
            setPendingParams(null);
          }}
          imageUrl={toMediaUrl(sourceImageData.url)}
          onConfirm={handleCropConfirm}
          initialCrop={savedCrop || undefined}
          viewOnly={cropModalViewOnly}
        />
      )}
    </div>
  );
}
