/**
 * AudioGeneration - Self-contained component for audio generation.
 *
 * Similar to ImageGeneration but for audio:
 * - Uses WaveSurfer.js for waveform display
 * - Audio player with play/pause, progress
 * - Track list instead of image grid
 *
 * Manages its own local state:
 * - generations, loading, progress, error, preview
 * - playingId, currentTime (audio-specific)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Pause, Volume2 } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { useInteraction } from "@/state/interaction-context";
import { useWorkflowStore } from "@/state/workflow-store";
import { api } from "@/core/api";
import { toMediaUrl } from "@/core/config";
import { useInputSchemaOptional, pathToKey } from "../../schema/input/InputSchemaContext";
import { useMediaGeneration } from "./MediaGenerationContext";
import type { SchemaProperty, UxConfig } from "../../schema/types";
import type {
  SubActionConfig,
  GenerationResult,
  ProgressState,
  PreviewInfo,
} from "./types";
import type { SubActionRequest, SSEEventType } from "@/core/types";
import { cn } from "@/core/utils";

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
  metadataId: string;
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
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);

  // LOCAL state
  const [generations, setGenerations] = useState<GenerationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewInfo | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Audio-specific state
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Extract config
  const provider = ux.provider;
  const promptId = ux.prompt_id || "default";
  const promptKey = pathToKey(path);

  // Context values
  const subActions = mediaContext?.subActions ?? [];
  const selectedContentId = mediaContext?.selectedContentId ?? null;
  const onSelectContent = mediaContext?.onSelectContent ?? (() => {});
  const registerGeneration = mediaContext?.registerGeneration ?? (() => {});
  const readonly = mediaContext?.readonly ?? false;
  const disabled = mediaContext?.disabled ?? false;

  // Load existing generations on mount
  useEffect(() => {
    if (!mediaContext || !workflowRunId || !request.interaction_id || !provider) {
      return;
    }

    const loadGenerations = async () => {
      try {
        const response = await api.getInteractionGenerations(
          workflowRunId,
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

          setGenerations(
            myGenerations.map((g) => ({
              urls: g.urls.map(toMediaUrl),
              metadata_id: g.metadata_id,
              content_ids: g.content_ids,
            }))
          );
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
        const previewResult = await api.getMediaPreview(workflowRunId, {
          provider,
          action_type: "txt2audio",
          params,
        });
        setPreview(previewResult);
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

  // Build track list from generations
  const tracks: AudioTrack[] = generations.flatMap((gen) =>
    gen.urls.map((url, idx) => ({
      url,
      contentId: gen.content_ids[idx],
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

  // Filter for audio action types
  const audioActions = subActions.filter((a) => a.action_type === "txt2audio");

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

      {/* Action Buttons */}
      {!readonly && audioActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {audioActions.map((action) => (
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

      {/* Generated Audio Tracks */}
      {tracks.length > 0 && (
        <div className="space-y-3">
          {tracks.map((track) => (
            <AudioTrackItem
              key={track.contentId}
              track={track}
              isSelected={selectedContentId === track.contentId}
              isPlaying={playingId === track.contentId}
              onSelect={() => onSelectContent(track.contentId)}
              onPlay={() => {
                // Stop any currently playing track
                setPlayingId(track.contentId);
              }}
              onPause={() => {
                setPlayingId(null);
              }}
              disabled={readonly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
