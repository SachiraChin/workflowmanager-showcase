/**
 * ImageGeneration - Self-contained component for image generation.
 *
 * Manages its own local state:
 * - generations (array of results)
 * - queue state (via useGenerationQueue hook)
 * - preview
 *
 * Uses shared context for:
 * - subActions (action buttons config)
 * - selectedContentId / onSelectContent (global selection)
 * - registerGeneration (report results to parent)
 */

import { useState, useEffect, useCallback } from "react";
import { Button } from "../../../components/ui/button";
import { Loader2 } from "lucide-react";
import { useInteraction } from "../../../contexts/interaction-context";
import {
  useInputSchemaActionsOptional,
  useInputSchemaStateOptional,
  pathToKey,
} from "../../../schema/input/InputSchemaContext";
import { useMediaGeneration } from "./MediaGenerationContext";
import { useGenerationQueue } from "./useGenerationQueue";
import { MediaGrid } from "./MediaGrid";
import { api } from "../../../core/api";
import { toMediaUrl } from "../../../core/config";
import { useWorkflowStore } from "../../../state/workflow-store";
import type { SchemaProperty, UxConfig } from "../../../types/schema";
import type {
  GenerationResult,
  PreviewInfo,
} from "./types";
import type { SubActionRequest, SSEEventType } from "../../../types/index";

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
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function ImageGeneration({
  data,
  schema: _schema,
  path,
  ux,
  disabled: _disabled,
  readonly: _readonly,
}: ImageGenerationProps) {
  void _schema; // Schema is available but we use ux for config
  void _disabled; // Props accepted for API consistency - component reads from useInteraction()
  void _readonly;

  // All hooks must be called unconditionally and in the same order
  const mediaContext = useMediaGeneration();
  // Split input context: actions are stable (no re-renders), state is reactive
  const inputActions = useInputSchemaActionsOptional();
  const inputState = useInputSchemaStateOptional();
  const { request } = useInteraction();
  
  // Get workflow state directly from store
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);
  const selectedProvider = useWorkflowStore((s) => s.selectedProvider);
  const selectedModel = useWorkflowStore((s) => s.selectedModel);

  // Extract values from context (with defaults if context is null)
  // NOTE: These must be extracted before using in hooks
  const subActions = mediaContext?.subActions ?? [];
  const selectedContentId = mediaContext?.selectedContentId ?? null;
  const onSelectContent = mediaContext?.onSelectContent ?? (() => {});
  const registerGeneration = mediaContext?.registerGeneration ?? (() => {});
  const readonly = mediaContext?.readonly ?? false;
  const disabled = mediaContext?.disabled ?? false;

  // Extract config from ux (must be before hooks that use these values)
  const provider = ux.provider;
  const promptId = ux.prompt_id || "default";
  const promptKey = pathToKey(path);

  // LOCAL state - each instance manages its own
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Queue management for concurrent generation tasks (persisted in Zustand)
  const queue = useGenerationQueue(promptKey, generations.length, disabled);

  // Load existing generations on mount (also in readonly mode to show history)
  // Uses inputActions (stable) instead of full inputContext to avoid re-triggering
  // when values change. The setValue calls would change values, but inputActions
  // reference is stable so the effect doesn't re-run.
  // NOTE: Do NOT depend on mediaContext - it changes on selection, we only want to load once on mount
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
          (g: Record<string, unknown>) => g.provider === provider && g.prompt_id === promptId
        );

        if (myGenerations.length > 0) {
          // Restore input values from most recent generation's request_params
          const latestGen = myGenerations[myGenerations.length - 1] as Record<string, unknown>;
          if (latestGen.request_params && inputActions) {
            for (const [key, value] of Object.entries(latestGen.request_params as Record<string, unknown>)) {
              // Skip internal fields that shouldn't be restored to inputs
              if (key === "prompt_id" || key === "prompt") continue;
              inputActions.setValue(key, value);
            }
          }

          const loadedGenerations = myGenerations.map((g: Record<string, unknown>) => ({
            urls: (g.urls as string[]).map((url) => toMediaUrl(url)),
            metadata_id: g.metadata_id as string,
            content_ids: g.content_ids as string[],
          }));

          setGenerations(loadedGenerations);

          // Register loaded generations for validation tracking
          for (const gen of loadedGenerations) {
            registerGeneration(promptKey, gen);
          }
        }
      } catch (err) {
        console.error("[ImageGeneration] Failed to load generations:", err);
      }
    };

    loadGenerations();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on mount, not on selection change
  }, [workflowRunId, request.interaction_id, provider, promptId, promptKey, inputActions]);

  // Fetch preview when input values change (debounced)
  // Uses inputState?.values to trigger re-fetch when values change
  // NOTE: Do NOT depend on mediaContext directly - it changes when selection changes
  // which would cause unnecessary preview refreshes
  useEffect(() => {
    // Guard: skip if no provider configured or empty string
    if (!mediaContext || readonly || !workflowRunId || !provider || provider === '') return;

    const params = inputActions?.getMappedValues() || {};
    params.prompt_id = promptId;

    setPreviewLoading(true);

    const timeoutId = setTimeout(async () => {
      try {
        const previewResult = await api.getMediaPreview(workflowRunId, {
          provider,
          action_type: "txt2img",
          params,
        });
        setPreview(previewResult as unknown as PreviewInfo);
      } catch (err) {
        console.error("[ImageGeneration] Preview fetch failed:", err);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally exclude mediaContext to avoid re-fetch on selection change
  }, [inputState?.values, readonly, workflowRunId, provider, promptId, inputActions]);



  // Execute generation via SSE
  const handleGenerate = useCallback(
    async () => {
      if (!mediaContext || !workflowRunId || !inputActions || !provider) return;

      const params = inputActions.getMappedValues();

      // Validate required fields
      const errors: string[] = [];
      inputActions.clearAllErrors();

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
            inputActions.setError(key, errorMsg);
          }
        }
      }

      if (errors.length > 0) {
        queue.actions.failTask("", errors.join(", "));
        return;
      }

      // Start tracking this task in the queue
      const taskId = queue.actions.startTask();

      // Build generic sub-action request with all params
      // Get sub_action_id from first available sub_action in context
      const subActionId = subActions[0]?.id;
      if (!subActionId) {
        queue.actions.failTask(taskId, "No sub-action configured");
        return;
      }

      const subActionRequest: SubActionRequest = {
        interaction_id: request.interaction_id,
        sub_action_id: subActionId,
        params: {
          provider,
          action_type: "txt2img",
          prompt_id: promptId,
          params,
          source_data: data,
        },
        // Include ai_config if model is selected
        ...(selectedModel && {
          ai_config: {
            provider: selectedProvider || undefined,
            model: selectedModel,
          },
        }),
      };

      const handleEvent = (
        eventType: SSEEventType,
        eventData: Record<string, unknown>
      ) => {
        switch (eventType) {
          case "progress": {
            // Re-enable button after first progress event
            queue.actions.onStreamStarted();
            // Handle both flat (message) and nested (progress.message) formats
            const progressData = eventData.progress as Record<string, unknown> | undefined;
            queue.actions.updateProgress(taskId, {
              elapsed_ms: (progressData?.elapsed_ms ?? eventData.elapsed_ms ?? 0) as number,
              message: (progressData?.message ?? eventData.message ?? "") as string,
            });
            break;
          }

          case "complete": {
            // Remove task from queue
            queue.actions.completeTask(taskId);
            // Result is in sub_action_result for clean separation
            const subActionResult = eventData.sub_action_result as Record<string, unknown> | undefined;
            if (subActionResult) {
              const result: GenerationResult = {
                urls: (subActionResult.urls as string[]).map((url) => toMediaUrl(url)),
                metadata_id: subActionResult.metadata_id as string,
                content_ids: subActionResult.content_ids as string[],
              };
              setGenerations((prev) => [...prev, result]);
              registerGeneration(promptKey, result);
            }
            break;
          }

          case "error":
            queue.actions.failTask(taskId, eventData.message as string);
            break;
        }
      };

      const handleError = (err: Error) => {
        queue.actions.failTask(taskId, err.message);
      };

      // Start streaming - fire and forget, let it complete naturally
      api.streamSubAction(
        workflowRunId,
        subActionRequest,
        handleEvent,
        handleError
      );
    },
    [
      mediaContext,
      workflowRunId,
      request.interaction_id,
      inputActions,
      provider,
      promptId,
      promptKey,
      data,
      ux.input_schema,
      registerGeneration,
      subActions,
      queue.actions,
      selectedProvider,
      selectedModel,
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

  return (
    <div className="space-y-4">
      {/* Preview Info (Resolution/Credits/Cost) - always show container to prevent layout shift */}
      {!readonly && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground bg-muted/30 rounded-md px-3 py-2 min-h-[36px]">
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
          ) : (
            <span className="text-muted-foreground/70">Preview will load when inputs are set</span>
          )}
        </div>
      )}

      {/* Generate/Queue Button + Progress (all status text on same row) */}
      {!readonly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="default"
            size="sm"
            onClick={handleGenerate}
            disabled={queue.derived.buttonDisabled}
          >
            {queue.derived.buttonLabel}
          </Button>
          {/* Generation progress indicator */}
          {queue.derived.isLoading && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              {queue.derived.progressMessage && (
                <span>{queue.derived.progressMessage}</span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {queue.state.error && (
        <div className="text-sm text-destructive">{queue.state.error}</div>
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
