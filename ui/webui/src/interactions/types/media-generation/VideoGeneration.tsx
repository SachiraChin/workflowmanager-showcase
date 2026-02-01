/**
 * VideoGeneration - Self-contained component for video generation.
 *
 * Similar to ImageGeneration but with:
 * - Crop modal for img2vid
 * - Source image handling
 * - Video-specific action types
 *
 * Manages its own local state:
 * - generations, loading, progress, error, preview
 * - savedCrop, showCropModal (video-specific)
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Crop, X } from "lucide-react";
import { useInteraction } from "@/state/interaction-context";
import { useWorkflowStore } from "@/state/workflow-store";
import { api } from "@/core/api";
import { toMediaUrl } from "@/core/config";
import { useInputSchemaOptional, pathToKey } from "../../schema/input/InputSchemaContext";
import { useMediaGeneration } from "./MediaGenerationContext";
import { MediaGrid } from "./MediaGrid";
import { CropSelectionModal } from "./CropSelectionModal";
import type { SchemaProperty, UxConfig } from "../../schema/types";
import type {
  SubActionConfig,
  GenerationResult,
  ProgressState,
  PreviewInfo,
  CropState,
  CropRegion,
} from "./types";
import type { SubActionRequest, SSEEventType } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

interface VideoGenerationProps {
  /** The data for this schema node */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function VideoGeneration({
  data,
  schema: _schema,
  path,
  ux,
  disabled: _disabled,
  readonly: _readonly,
}: VideoGenerationProps) {
  void _disabled; // Props accepted for API consistency - component reads from useInteraction()
  void _readonly;
  void _schema;

  // All hooks must be called unconditionally
  const mediaContext = useMediaGeneration();
  const inputContext = useInputSchemaOptional();
  const { request } = useInteraction();
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);

  // LOCAL state
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Video-specific: crop state
  const [savedCrop, setSavedCrop] = useState<CropState | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropModalViewOnly, setCropModalViewOnly] = useState(false);
  const [pendingAction, setPendingAction] = useState<SubActionConfig | null>(null);
  const [pendingParams, setPendingParams] = useState<Record<string, unknown> | null>(null);

  // Source image for crop modal
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);

  // Extract config from ux
  const provider = ux.provider;
  const promptId = ux.prompt_id || "default";
  const promptKey = pathToKey(path);

  // Extract from context
  const subActions = mediaContext?.subActions ?? [];
  const selectedContentId = mediaContext?.selectedContentId ?? null;
  const onSelectContent = mediaContext?.onSelectContent ?? (() => {});
  const registerGeneration = mediaContext?.registerGeneration ?? (() => {});
  const rootData = mediaContext?.rootData ?? {};
  const readonly = mediaContext?.readonly ?? false;
  const disabled = mediaContext?.disabled ?? false;

  // Get source image from root data (for img2vid)
  const sourceImageData = rootData._source_image as {
    url?: string;
    local_path?: string;
  } | undefined;

  // Update source image URL when source image changes
  useEffect(() => {
    if (sourceImageData?.url) {
      setSourceImageUrl(toMediaUrl(sourceImageData.url));
    }
  }, [sourceImageData?.url]);

  // Load existing generations on mount (also in readonly mode to show history)
  useEffect(() => {
    if (!mediaContext || !workflowRunId || !request.interaction_id || !provider) {
      return;
    }

    const loadGenerations = async () => {
      try {
        const response = await api.getInteractionGenerations(
          workflowRunId,
          request.interaction_id,
          "video"
        );

        const myGenerations = response.generations.filter(
          (g) => g.provider === provider && g.prompt_id === promptId
        );

        if (myGenerations.length > 0) {
          // Restore input values from most recent generation's request_params
          const latestGen = myGenerations[myGenerations.length - 1];
          if (latestGen.request_params && inputContext) {
            for (const [key, value] of Object.entries(latestGen.request_params)) {
              // Skip internal fields that shouldn't be restored to inputs
              if (key === "prompt_id" || key === "prompt") continue;
              inputContext.setValue(key, value);
            }
          }

          setGenerations(
            myGenerations.map((g) => ({
              urls: g.urls.map(toMediaUrl),
              metadata_id: g.metadata_id,
              content_ids: g.content_ids,
            }))
          );
        }
      } catch (err) {
        console.error("[VideoGeneration] Failed to load generations:", err);
      }
    };

    loadGenerations();
  }, [mediaContext, workflowRunId, request.interaction_id, readonly, provider, promptId]);

  // Fetch preview when input values change
  useEffect(() => {
    if (!mediaContext || readonly || !workflowRunId || !provider) return;

    const params = inputContext?.getMappedValues() || {};
    params.prompt_id = promptId;

    setPreviewLoading(true);

    const timeoutId = setTimeout(async () => {
      try {
        const previewResult = await api.getMediaPreview(workflowRunId, {
          provider,
          action_type: "img2vid",
          params,
        });
        setPreview(previewResult);
      } catch (err) {
        console.error("[VideoGeneration] Preview fetch failed:", err);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [mediaContext, inputContext?.values, readonly, workflowRunId, provider, promptId]);

  // Execute generation with crop
  const executeWithCrop = useCallback(
    async (action: SubActionConfig, params: Record<string, unknown>, cropRegion?: CropRegion) => {
      if (!mediaContext || !workflowRunId || !provider) return;

      const finalParams = { ...params };

      // Add source_image to params
      if (sourceImageData) {
        finalParams.source_image = sourceImageData;
      }

      // Add crop region if provided
      if (cropRegion) {
        finalParams.crop_region = cropRegion;
      }

      setLoading(true);
      setProgress({ elapsed_ms: 0, message: "Starting..." });
      setError(null);

      // Build generic sub-action request with all params
      const subActionRequest: SubActionRequest = {
        interaction_id: request.interaction_id,
        action_id: action.id,
        params: {
          provider,
          action_type: action.action_type,
          prompt_id: promptId,
          params: finalParams,
          source_data: data,
        },
      };

      const handleEvent = (
        eventType: SSEEventType,
        eventData: Record<string, unknown>
      ) => {
        switch (eventType) {
          case "progress":
            setProgress({
              elapsed_ms: eventData.elapsed_ms as number,
              message: eventData.message as string,
            });
            break;

          case "complete": {
            const result: GenerationResult = {
              urls: (eventData.urls as string[]).map(toMediaUrl),
              metadata_id: eventData.metadata_id as string,
              content_ids: eventData.content_ids as string[],
            };
            setGenerations((prev) => [...prev, result]);
            registerGeneration(promptKey, result);
            setLoading(false);
            setProgress(null);
            break;
          }

          case "error":
            setError(eventData.message as string);
            setLoading(false);
            setProgress(null);
            // Clear saved crop on error
            setSavedCrop(null);
            break;
        }
      };

      const handleError = (err: Error) => {
        setError(err.message);
        setLoading(false);
        setProgress(null);
        setSavedCrop(null);
      };

      api.streamSubAction(workflowRunId, subActionRequest, handleEvent, handleError);
    },
    [
      mediaContext,
      workflowRunId,
      request.interaction_id,
      provider,
      promptId,
      promptKey,
      data,
      sourceImageData,
      registerGeneration,
    ]
  );

  // Handle crop modal confirm
  const handleCropConfirm = useCallback(
    (cropRegion: CropRegion | null, savePreference: boolean, aspectRatio: string) => {
      if (cropRegion && savePreference) {
        setSavedCrop({ region: cropRegion, aspectRatio });
      }

      if (pendingAction && pendingParams && cropRegion) {
        executeWithCrop(pendingAction, pendingParams, cropRegion);
      }

      setShowCropModal(false);
      setPendingAction(null);
      setPendingParams(null);
    },
    [pendingAction, pendingParams, executeWithCrop]
  );

  // Handle generate click
  const handleGenerate = useCallback(
    async (action: SubActionConfig) => {
      if (!mediaContext || !workflowRunId || !inputContext || !provider) return;

      const params = inputContext.getMappedValues();

      // Validate required fields
      const errors: string[] = [];
      inputContext.clearAllErrors();

      const properties =
        (ux.input_schema as { properties?: Record<string, unknown> })?.properties || {};
      for (const [key, fieldSchema] of Object.entries(properties)) {
        const schemaRecord = fieldSchema as Record<string, unknown>;
        if (schemaRecord.required === true) {
          const value = params[key];
          if (value === undefined || value === null || value === "") {
            const fieldTitle = (schemaRecord.title as string) || key;
            const errorMsg = `${fieldTitle} is required`;
            errors.push(errorMsg);
            inputContext.setError(key, errorMsg);
          }
        }
      }

      if (errors.length > 0) {
        setError(errors.join(", "));
        return;
      }

      setError(null);

      // For img2vid, show crop modal or use saved crop
      if (action.action_type === "img2vid" && sourceImageUrl) {
        if (savedCrop) {
          executeWithCrop(action, params, savedCrop.region);
        } else {
          setPendingAction(action);
          setPendingParams(params);
          setCropModalViewOnly(false);
          setShowCropModal(true);
        }
      } else {
        // For other actions, execute directly
        executeWithCrop(action, params);
      }
    },
    [
      mediaContext,
      workflowRunId,
      inputContext,
      ux.input_schema,
      sourceImageUrl,
      savedCrop,
      executeWithCrop,
    ]
  );

  // Guard: must be inside context
  if (!mediaContext) {
    console.warn("[VideoGeneration] Rendered outside MediaGenerationContext");
    return null;
  }

  if (!provider) {
    return (
      <div className="text-sm text-destructive">
        VideoGeneration requires _ux.provider at path: {path.join(".")}
      </div>
    );
  }

  // Filter for video action types
  const videoActions = subActions.filter((a) =>
    ["img2vid", "txt2vid"].includes(a.action_type)
  );

  return (
    <div className="space-y-4">
      {/* Preview Info */}
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
                    {preview.credits.credits} ({preview.credits.credits_per_image}/vid)
                  </span>
                </>
              )}
              {preview.credits.total_cost_usd > 0 && (
                <>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">Cost:</span>
                    ${preview.credits.total_cost_usd.toFixed(4)} (${preview.credits.cost_per_image_usd.toFixed(4)}/vid)
                  </span>
                </>
              )}
              {/* Crop selection info */}
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
                      className="h-5 w-5 p-0 ml-1"
                      onClick={() => {
                        setCropModalViewOnly(true);
                        setShowCropModal(true);
                      }}
                    >
                      <span className="text-xs underline">view</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 w-5 p-0"
                      onClick={() => setSavedCrop(null)}
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
      {!readonly && videoActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {videoActions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              onClick={() => handleGenerate(action)}
              disabled={loading || disabled}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {/* Error */}
      {error && <div className="text-sm text-destructive">{error}</div>}

      {/* Progress */}
      {loading && progress && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{progress.message}</span>
        </div>
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

      {/* Crop Selection Modal */}
      {sourceImageUrl && (
        <CropSelectionModal
          open={showCropModal}
          onClose={() => {
            setShowCropModal(false);
            setCropModalViewOnly(false);
            setPendingAction(null);
            setPendingParams(null);
          }}
          imageUrl={sourceImageUrl}
          onConfirm={handleCropConfirm}
          initialCrop={savedCrop || undefined}
          viewOnly={cropModalViewOnly}
        />
      )}
    </div>
  );
}
