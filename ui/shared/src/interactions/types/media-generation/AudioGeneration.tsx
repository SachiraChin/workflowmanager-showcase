/**
 * AudioGeneration - Self-contained component for audio generation.
 *
 * Similar to ImageGeneration but for audio:
 * - Uses WaveSurfer.js for waveform display
 * - Audio player with play/pause, progress
 * - Track list instead of image grid
 *
 * Manages its own local state:
 * - generations, queue state (via useGenerationQueue hook)
 * - preview, playingId (audio-specific)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "../../../components/ui/button";
import { Loader2, Play, Pause, Volume2, Download } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { useInteraction } from "../../../contexts/interaction-context";
import { useMediaAdapter } from "../../../contexts/MediaAdapterContext";
import { useInputSchemaOptional, pathToKey } from "../../../schema/input/InputSchemaContext";
import { useMediaGeneration } from "./MediaGenerationContext";
import { useGenerationQueue } from "./useGenerationQueue";
import type { SchemaProperty, UxConfig } from "../../../types/schema";
import type {
  GenerationResult,
  PreviewInfo,
} from "./types";
import type { SubActionRequest, SSEEventType } from "../../../types/index";
import { cn } from "../../../utils/cn";

// =============================================================================
// Types
// =============================================================================

interface AudioGenerationProps {
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

interface AudioTrack {
  url: string;
  contentId: string;
  metadataId?: string;
}

// =============================================================================
// AudioTrackItem Component
// =============================================================================

interface AudioTrackItemProps {
  track: AudioTrack;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onPause: () => void;
  disabled?: boolean;
}

function AudioTrackItem({
  track,
  isSelected,
  isPlaying,
  onSelect,
  onPlay,
  onPause,
  disabled,
}: AudioTrackItemProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isReady, setIsReady] = useState(false);

  // Store onPause in a ref to avoid re-creating the effect
  const onPauseRef = useRef(onPause);
  onPauseRef.current = onPause;

  // Initialize WaveSurfer - manually fetch audio to handle credentials properly
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "rgb(148, 163, 184)",
      progressColor: "rgb(59, 130, 246)",
      cursorColor: "rgb(59, 130, 246)",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 64,
      normalize: true,
    });

    // Manually fetch audio with credentials and load as blob
    fetch(track.url, { credentials: "include", mode: "cors" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        wavesurfer.loadBlob(blob);
      })
      .catch((err) => {
        console.error("[AudioTrackItem] Failed to load audio:", err);
      });

    wavesurfer.on("ready", () => {
      setDuration(wavesurfer.getDuration());
      setIsReady(true);
    });

    wavesurfer.on("timeupdate", (time) => {
      setCurrentTime(time);
    });

    wavesurfer.on("finish", () => {
      onPauseRef.current();
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      cancelled = true;
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [track.url]);

  // Handle play/pause from parent
  useEffect(() => {
    console.log("[AudioTrackItem] play/pause effect:", { isPlaying, isReady, hasWavesurfer: !!wavesurferRef.current });
    if (!wavesurferRef.current || !isReady) return;

    if (isPlaying) {
      console.log("[AudioTrackItem] Calling wavesurfer.play()");
      wavesurferRef.current.play().catch((err: Error) => {
        console.error("[AudioTrackItem] Play failed:", err);
      });
    } else {
      wavesurferRef.current.pause();
    }
  }, [isPlaying, isReady]);

  // Format time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 p-3 rounded-lg border transition-colors cursor-pointer",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-muted-foreground/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={() => !disabled && onSelect()}
    >
      {/* Waveform container */}
      <div className="w-full h-16 bg-muted/30 rounded overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
        {!isReady && (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground -mt-16">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading waveform...
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={(e) => {
            e.stopPropagation();
            if (isPlaying) {
              onPause();
            } else {
              onPlay();
            }
          }}
          disabled={disabled || !isReady}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Play className="w-4 h-4 ml-0.5" />
          )}
        </Button>

        <div className="flex-1 flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-mono text-xs">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
        </div>

        <Volume2 className="w-4 h-4 text-muted-foreground" />

        {/* Download link - always available */}
        <a
          href={`${track.url}?download=true`}
          download={track.url.split('/').pop() || 'audio.mp3'}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Download"
        >
          <Download className="w-4 h-4 text-muted-foreground hover:text-foreground" />
        </a>
      </div>
    </div>
  );
}

// =============================================================================
// AudioGeneration Component
// =============================================================================

export function AudioGeneration({
  data,
  schema: _schema,
  path,
  ux,
  disabled: _disabled,
  readonly: _readonly,
}: AudioGenerationProps) {
  void _schema;
  void _disabled;
  void _readonly;

  // Hooks - must be called unconditionally
  const mediaContext = useMediaGeneration();
  const inputContext = useInputSchemaOptional();
  const { request } = useInteraction();
  const adapter = useMediaAdapter();
  const workflowRunId = adapter.getWorkflowRunId();
  const selectedProvider = adapter.getSelectedProvider();
  const selectedModel = adapter.getSelectedModel();

  // Context values (must be before hooks that use these values)
  const subActions = mediaContext?.subActions ?? [];
  const selectedContentId = mediaContext?.selectedContentId ?? null;
  const onSelectContent = mediaContext?.onSelectContent ?? (() => {});
  const registerGeneration = mediaContext?.registerGeneration ?? (() => {});
  const readonly = mediaContext?.readonly ?? false;
  const disabled = mediaContext?.disabled ?? false;

  // LOCAL state
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Queue management for concurrent generation tasks
  const queue = useGenerationQueue(generations.length, disabled);

  // Audio-specific state
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Extract config
  const provider = ux.provider;
  const promptId = ux.prompt_id || "default";
  const promptKey = pathToKey(path);

  // Load existing generations on mount
  useEffect(() => {
    if (!mediaContext || !workflowRunId || !request.interaction_id || !provider) {
      return;
    }

    const loadGenerations = async () => {
      try {
        const response = await adapter.getInteractionGenerations(
          request.interaction_id,
          "audio"
        );

        const myGenerations = response.generations.filter(
          (g) => g.provider === provider && g.prompt_id === promptId
        );

        if (myGenerations.length > 0) {
          // Restore input values
          const latestGen = myGenerations[myGenerations.length - 1];
          if (latestGen.request_params && inputContext) {
            for (const [key, value] of Object.entries(latestGen.request_params)) {
              if (key === "prompt_id" || key === "prompt") continue;
              inputContext.setValue(key, value);
            }
          }

          const loadedGenerations = myGenerations.map((g) => ({
            urls: g.urls.map((url) => adapter.toMediaUrl(url)),
            metadata_id: g.metadata_id,
            content_ids: g.content_ids,
          }));

          setGenerations(loadedGenerations);

          // Register loaded generations for validation tracking
          for (const gen of loadedGenerations) {
            registerGeneration(promptKey, gen);
          }
        }
      } catch (err) {
        console.error("[AudioGeneration] Failed to load generations:", err);
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
        const previewResult = await adapter.getMediaPreview( {
          provider,
          action_type: "txt2audio",
          params,
        });
        setPreview(previewResult as unknown as PreviewInfo);
      } catch (err) {
        console.error("[AudioGeneration] Preview fetch failed:", err);
      } finally {
        setPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [mediaContext, inputContext?.values, readonly, workflowRunId, provider, promptId]);

  // Execute generation via SSE
  const handleGenerate = useCallback(
    async () => {
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
        queue.actions.failTask("", errors.join(", "));
        return;
      }

      // Start tracking this task in the queue
      const taskId = queue.actions.startTask();

      // Get sub_action_id from first available sub_action in context
      const subActionId = subActions[0]?.id;
      if (!subActionId) {
        queue.actions.failTask(taskId, "No sub-action configured");
        return;
      }

      // Build generic sub-action request with all params
      const subActionRequest: SubActionRequest = {
        interaction_id: request.interaction_id,
        sub_action_id: subActionId,
        params: {
          provider,
          action_type: "txt2audio",
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
                urls: (subActionResult.urls as string[]).map((url) => adapter.toMediaUrl(url)),
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

      adapter.streamSubAction( subActionRequest, handleEvent, handleError);
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
      subActions,
      queue.actions,
      selectedProvider,
      selectedModel,
    ]
  );

  // Build track list from generations
  const tracks: AudioTrack[] = generations.flatMap((gen) =>
    gen.urls.map((url, idx) => ({
      url,
      contentId: gen.content_ids?.[idx] || `gen-${idx}`,
      metadataId: gen.metadata_id,
    }))
  );

  // Guard: must be inside context
  if (!mediaContext) {
    console.warn("[AudioGeneration] Rendered outside MediaGenerationContext");
    return null;
  }

  if (!provider) {
    return (
      <div className="text-sm text-destructive">
        AudioGeneration requires _ux.provider at path: {path.join(".")}
      </div>
    );
  }

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
              {preview.credits.total_cost_usd > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-foreground">Est. Cost:</span>
                  ${preview.credits.total_cost_usd.toFixed(2)}
                </span>
              )}
              {preview.credits.credits > 0 && (
                <>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-medium text-foreground">Credits:</span>
                    ~{preview.credits.credits}
                  </span>
                </>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Generate/Queue Button + Progress */}
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

      {/* Generated Audio Tracks */}
      {tracks.length > 0 && (
        <div className="space-y-3">
          {tracks.map((track) => (
            <AudioTrackItem
              key={track.contentId}
              track={track}
              isSelected={selectedContentId === track.contentId}
              isPlaying={playingId === track.contentId}
              onSelect={() => !readonly && onSelectContent(track.contentId)}
              onPlay={() => {
                // Stop any currently playing track
                setPlayingId(track.contentId);
              }}
              onPause={() => {
                setPlayingId(null);
              }}
              disabled={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
