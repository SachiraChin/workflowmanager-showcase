/**
 * ImageGeneration - Self-contained component for image generation.
 *
 * Manages its own local state:
 * - generations (array of results)
 * - loading/progress
 * - error
 * - preview
 *
 * Uses shared context for:
 * - subActions (action buttons config)
 * - selectedContentId / onSelectContent (global selection)
 * - registerGeneration (report results to parent)
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useInteraction } from "@/state/interaction-context";
import { useWorkflowStore } from "@/state/workflow-store";
import { api } from "@/core/api";
import { toMediaUrl } from "@/core/config";
import { useInputSchemaOptional, pathToKey } from "../../schema/input/InputSchemaContext";
import { useMediaGeneration } from "./MediaGenerationContext";
import { MediaGrid } from "./MediaGrid";
import type { SchemaProperty, UxConfig } from "../../schema/types";
import type {
  SubActionConfig,
  GenerationResult,
  ProgressState,
  PreviewInfo,
} from "./types";
import type { SubActionRequest, SSEEventType } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

interface ImageGenerationProps {
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

export function ImageGeneration({
  data,
  schema: _schema,
  path,
  ux,
}: ImageGenerationProps) {
  void _schema; // Schema is available but we use ux for config

  // All hooks must be called unconditionally and in the same order
  const mediaContext = useMediaGeneration();
  const inputContext = useInputSchemaOptional();
  const { request } = useInteraction();
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);

  // LOCAL state - each instance manages its own
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Extract config from ux
  const provider = ux.provider;
  const promptId = ux.prompt_id || "default";
  const promptKey = pathToKey(path);

  // Extract values from context (with defaults if context is null)
  const subActions = mediaContext?.subActions ?? [];
  const selectedContentId = mediaContext?.selectedContentId ?? null;
  const onSelectContent = mediaContext?.onSelectContent ?? (() => {});
  const registerGeneration = mediaContext?.registerGeneration ?? (() => {});
  const readonly = mediaContext?.readonly ?? false;
  const disabled = mediaContext?.disabled ?? false;

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
          "image"
        );

        // Filter for this provider/promptId
        const myGenerations = response.generations.filter(
          (g) => g.provider === provider && g.prompt_id === promptId
        );

        if (myGenerations.length > 0) {
          setGenerations(
            myGenerations.map((g) => ({
              urls: g.urls.map(toMediaUrl),
              metadata_id: g.metadata_id,
              content_ids: g.content_ids,
            }))
          );
        }
      } catch (err) {
        console.error("[ImageGeneration] Failed to load generations:", err);
      }
    };

    loadGenerations();
  }, [mediaContext, workflowRunId, request.interaction_id, readonly, provider, promptId]);

  // Fetch preview when input values change (debounced)
  useEffect(() => {
    if (!mediaContext || readonly || !workflowRunId || !provider) return;

    const params = inputContext?.getMappedValues() || {};
    params.prompt_id = promptId;

    setPreviewLoading(true);

    const timeoutId = setTimeout(async () => {
      try {
        const previewResult = await api.getMediaPreview(workflowRunId, {
          provider,
          action_type: "txt2img",
          params,
        });
        setPreview(previewResult);
      } catch (err) {
        console.error("[ImageGeneration] Preview fetch failed:", err);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [mediaContext, inputContext?.values, readonly, workflowRunId, provider, promptId]);

  // Execute generation via SSE
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

      setLoading(true);
      setProgress({ elapsed_ms: 0, message: "Starting..." });
      setError(null);

      const subActionRequest: SubActionRequest = {
        workflow_run_id: workflowRunId,
        interaction_id: request.interaction_id,
        provider,
        action_type: action.action_type,
        prompt_id: promptId,
        params,
        source_data: data,
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
            break;
        }
      };

      const handleError = (err: Error) => {
        setError(err.message);
        setLoading(false);
        setProgress(null);
      };

      api.streamSubAction(subActionRequest, handleEvent, handleError);
    },
    [
      mediaContext,
      workflowRunId,
      request.interaction_id,
      inputContext,
      provider,
      promptId,
      promptKey,
      data,
      ux.input_schema,
      registerGeneration,
    ]
  );

  // Guard: must be inside MediaGenerationContext
  if (!mediaContext) {
    console.warn("[ImageGeneration] Rendered outside MediaGenerationContext");
    return null;
  }

  // Validation
  if (!provider) {
    return (
      <div className="text-sm text-destructive">
        ImageGeneration requires _ux.provider to be set at path: {path.join(".")}
      </div>
    );
  }

  // Filter actions for image types
  const imageActions = subActions.filter((a) =>
    ["txt2img", "img2img"].includes(a.action_type)
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
                    {preview.credits.credits} ({preview.credits.credits_per_image}/img)
                  </span>
                </>
              )}
              {preview.credits.total_cost_usd > 0 && (
                <>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">Cost:</span>
                    ${preview.credits.total_cost_usd.toFixed(4)} ($
                    {preview.credits.cost_per_image_usd.toFixed(4)}/img)
                  </span>
                </>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Action Buttons */}
      {!readonly && imageActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageActions.map((action) => (
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
    </div>
  );
}
