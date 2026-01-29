/**
 * MediaGeneration - Main component for media generation interaction.
 *
 * Orchestrates:
 * - State management (generations, selection, loading)
 * - MediaGenerationContext for descendant components
 * - SchemaRenderer for schema-driven layout
 * - Sub-action API calls with SSE streaming
 * - Readonly mode for history view
 *
 * Input values are managed by InputSchemaContext (provided by InputSchemaComposer).
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useInteraction } from "@/state/interaction-context";
import { useWorkflowStore } from "@/state/workflow-store";
import { api } from "@/core/api";
import { toMediaUrl } from "@/core/config";
import { SchemaRenderer } from "../../SchemaRenderer";
import {
  MediaGenerationProvider,
  type MediaGenerationContextValue,
} from "./MediaGenerationContext";
import { pathToKey } from "../../schema/input/InputSchemaContext";
import type {
  SubActionConfig,
  GenerationResult,
  ProgressState,
  PreviewInfo,
  CropState,
} from "./types";
import type { SchemaProperty } from "../../schema/types";
import type { SubActionRequest, SSEEventType } from "@/core/types";

// =============================================================================
// Component
// =============================================================================

export function MediaGeneration() {
  const { request, disabled, updateProvider, mode } = useInteraction();
  const workflowRunId = useWorkflowStore((state) => state.workflowRunId);
  const isReadonly = mode.type === "readonly";

  // Extract from display_data
  const displayData = request.display_data || {};
  const data = displayData.data as Record<string, unknown>;
  const schema = displayData.schema as SchemaProperty | undefined;
  const subActions = (displayData.sub_actions || []) as SubActionConfig[];

  // State
  const [generations, setGenerations] = useState<Record<string, GenerationResult[]>>({});
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null);
  const [loadingPrompts, setLoadingPrompts] = useState<Set<string>>(new Set());
  const [progressByPrompt, setProgressByPrompt] = useState<Record<string, ProgressState>>({});
  const [errorsByPrompt, setErrorsByPrompt] = useState<Record<string, string>>({});
  // Track task IDs for reconnection support (value reserved for future UI display)
  const [_tasksByPrompt, setTasksByPrompt] = useState<Record<string, string>>({});
  void _tasksByPrompt;

  // Preview state
  const [previewByPrompt, setPreviewByPrompt] = useState<Record<string, PreviewInfo>>({});
  const [previewLoadingPrompts, setPreviewLoadingPrompts] = useState<Set<string>>(new Set());

  // Crop selection state (global, session-only)
  const [savedCrop, setSavedCrop] = useState<CropState | null>(null);
  const clearSavedCrop = useCallback(() => setSavedCrop(null), []);

  // Refs for getResponse closure
  const generationsRef = useRef(generations);
  generationsRef.current = generations;
  const selectedContentIdRef = useRef(selectedContentId);
  selectedContentIdRef.current = selectedContentId;

  // Initialize from readonly response
  useEffect(() => {
    if (isReadonly && mode.response) {
      const response = mode.response as {
        generations?: Record<string, GenerationResult[]>;
        selected_content_id?: string;
      };
      if (response.generations) {
        setGenerations(response.generations);
      }
      if (response.selected_content_id) {
        setSelectedContentId(response.selected_content_id);
      }
    }
  }, [isReadonly, mode]);

  // Determine content type from sub_actions - if any action is img2vid, we want video
  const contentType = subActions.some(a => a.action_type === "img2vid") ? "video" : "image";

  // Load previously generated content on mount
  useEffect(() => {
    if (!workflowRunId || !request.interaction_id || isReadonly) {
      return;
    }

    const loadGenerations = async () => {
      try {
        const response = await api.getInteractionGenerations(
          workflowRunId,
          request.interaction_id,
          contentType
        );

        if (response.generations.length > 0) {
          // Group generations by prompt path
          // Key format matches pathToKey(path) used by MediaPanel:
          // - With explicit prompt_id: prompts.{provider}.{prompt_id}
          // - With "default" prompt_id (flat schema): prompts.{provider}
          const grouped: Record<string, GenerationResult[]> = {};

          for (const gen of response.generations) {
            // "default" means flat schema structure - don't include in key
            const key = gen.prompt_id && gen.prompt_id !== "default"
              ? `prompts.${gen.provider}.${gen.prompt_id}`
              : `prompts.${gen.provider}`;
            if (!grouped[key]) {
              grouped[key] = [];
            }
            grouped[key].push({
              urls: gen.urls.map(toMediaUrl),
              metadata_id: gen.metadata_id,
              content_ids: gen.content_ids,
            });
          }

          setGenerations(grouped);
        }
      } catch (error) {
        console.error("[MediaGeneration] Failed to load generations:", error);
      }
    };

    loadGenerations();
  }, [workflowRunId, request.interaction_id, isReadonly, contentType]);

  // Reconnect to in-progress tasks on mount
  useEffect(() => {
    if (!workflowRunId || !request.interaction_id || isReadonly) {
      return;
    }

    const reconnectTasks = async () => {
      try {
        const response = await api.getTasksForWorkflow(workflowRunId);

        // Filter for in-progress media tasks for this interaction
        const inProgressTasks = response.tasks.filter(
          (task) =>
            task.actor === "media" &&
            task.status === "processing" &&
            task.payload?.interaction_id === request.interaction_id
        );

        for (const task of inProgressTasks) {
          const payload = task.payload as {
            provider?: string;
            prompt_id?: string;
          };

          if (!payload.provider || !payload.prompt_id) continue;

          const promptKey = `prompts.${payload.provider}.${payload.prompt_id}`;

          // Set loading state
          setLoadingPrompts((prev) => new Set(prev).add(promptKey));
          setTasksByPrompt((prev) => ({ ...prev, [promptKey]: task.task_id }));

          // Set current progress if available
          if (task.progress) {
            setProgressByPrompt((prev) => ({
              ...prev,
              [promptKey]: {
                elapsed_ms: task.progress?.elapsed_ms || 0,
                message: task.progress?.message || "Reconnecting...",
              },
            }));
          }

          // Reconnect to task stream
          api.streamTask(
            task.task_id,
            // onProgress
            (_status, progress) => {
              setProgressByPrompt((prev) => ({
                ...prev,
                [promptKey]: {
                  elapsed_ms: progress.elapsed_ms,
                  message: progress.message,
                },
              }));
            },
            // onComplete
            (result) => {
              const genResult: GenerationResult = {
                urls: (result.urls as string[]).map(toMediaUrl),
                metadata_id: result.metadata_id as string,
                content_ids: result.content_ids as string[],
              };
              setGenerations((prev) => ({
                ...prev,
                [promptKey]: [...(prev[promptKey] || []), genResult],
              }));
              setLoadingPrompts((prev) => {
                const next = new Set(prev);
                next.delete(promptKey);
                return next;
              });
              setProgressByPrompt((prev) => {
                const next = { ...prev };
                delete next[promptKey];
                return next;
              });
              setTasksByPrompt((prev) => {
                const next = { ...prev };
                delete next[promptKey];
                return next;
              });
            },
            // onError
            (error) => {
              setErrorsByPrompt((prev) => ({
                ...prev,
                [promptKey]: error.message,
              }));
              setLoadingPrompts((prev) => {
                const next = new Set(prev);
                next.delete(promptKey);
                return next;
              });
              setProgressByPrompt((prev) => {
                const next = { ...prev };
                delete next[promptKey];
                return next;
              });
              setTasksByPrompt((prev) => {
                const next = { ...prev };
                delete next[promptKey];
                return next;
              });
            }
          );
        }
      } catch (error) {
        console.error("[MediaGeneration] Failed to reconnect tasks:", error);
      }
    };

    reconnectTasks();
  }, [workflowRunId, request.interaction_id, isReadonly]);

  // Register provider with InteractionHost
  useEffect(() => {
    updateProvider({
      getState: () => ({
        isValid: selectedContentIdRef.current !== null,
        selectedCount: selectedContentIdRef.current ? 1 : 0,
        selectedGroupIds: [],
      }),
      getResponse: () => ({
        selected_content_id: selectedContentIdRef.current ?? undefined,
        generations: generationsRef.current,
      }),
    });
  }, [updateProvider]);

  // Update provider when selection changes
  useEffect(() => {
    updateProvider({
      getState: () => ({
        isValid: selectedContentId !== null,
        selectedCount: selectedContentId ? 1 : 0,
        selectedGroupIds: [],
      }),
      getResponse: () => ({
        selected_content_id: selectedContentIdRef.current ?? undefined,
        generations: generationsRef.current,
      }),
    });
  }, [selectedContentId, updateProvider]);

  // Execute sub-action with SSE streaming
  const executeSubAction = useCallback(
    async (
      path: string[],
      action: SubActionConfig,
      params: Record<string, unknown>,
      metadata: { provider: string; promptId: string }
    ) => {
      const promptKey = pathToKey(path);
      const { provider, promptId } = metadata;

      // Get original prompt data by traversing the data object
      let promptData: unknown = data;
      for (const key of path) {
        if (promptData && typeof promptData === "object") {
          promptData = (promptData as Record<string, unknown>)[key];
        } else {
          promptData = undefined;
          break;
        }
      }

      // Set loading state
      setLoadingPrompts((prev) => new Set(prev).add(promptKey));
      setProgressByPrompt((prev) => ({
        ...prev,
        [promptKey]: { elapsed_ms: 0, message: "Starting..." },
      }));
      setErrorsByPrompt((prev) => {
        const next = { ...prev };
        delete next[promptKey];
        return next;
      });

      if (!workflowRunId) {
        setErrorsByPrompt((prev) => ({
          ...prev,
          [promptKey]: "No active workflow",
        }));
        setLoadingPrompts((prev) => {
          const next = new Set(prev);
          next.delete(promptKey);
          return next;
        });
        return;
      }

      const subActionRequest: SubActionRequest = {
        workflow_run_id: workflowRunId,
        interaction_id: request.interaction_id,
        provider,
        action_type: action.action_type,
        prompt_id: promptId,
        params,
        source_data: promptData,
      };

      const handleEvent = (eventType: SSEEventType, eventData: Record<string, unknown>) => {
        switch (eventType) {
          case "progress":
            setProgressByPrompt((prev) => ({
              ...prev,
              [promptKey]: {
                elapsed_ms: eventData.elapsed_ms as number,
                message: eventData.message as string,
              },
            }));
            break;

          case "complete":
            const result: GenerationResult = {
              urls: (eventData.urls as string[]).map(toMediaUrl),
              metadata_id: eventData.metadata_id as string,
              content_ids: eventData.content_ids as string[],
            };
            setGenerations((prev) => ({
              ...prev,
              [promptKey]: [...(prev[promptKey] || []), result],
            }));
            // Clear loading state on complete
            setLoadingPrompts((prev) => {
              const next = new Set(prev);
              next.delete(promptKey);
              return next;
            });
            setProgressByPrompt((prev) => {
              const next = { ...prev };
              delete next[promptKey];
              return next;
            });
            break;

          case "error":
            setErrorsByPrompt((prev) => ({
              ...prev,
              [promptKey]: eventData.message as string,
            }));
            // Clear loading state on error
            setLoadingPrompts((prev) => {
              const next = new Set(prev);
              next.delete(promptKey);
              return next;
            });
            setProgressByPrompt((prev) => {
              const next = { ...prev };
              delete next[promptKey];
              return next;
            });
            // Clear saved crop on generation error
            clearSavedCrop();
            break;
        }
      };

      const handleError = (error: Error) => {
        setErrorsByPrompt((prev) => ({
          ...prev,
          [promptKey]: error.message,
        }));
        setLoadingPrompts((prev) => {
          const next = new Set(prev);
          next.delete(promptKey);
          return next;
        });
        setProgressByPrompt((prev) => {
          const next = { ...prev };
          delete next[promptKey];
          return next;
        });
        // Clear saved crop on generation error
        clearSavedCrop();
      };

      api.streamSubAction(subActionRequest, handleEvent, handleError);
    },
    [data, workflowRunId, request.interaction_id, clearSavedCrop]
  );

  // Fetch preview for a prompt
  const fetchPreview = useCallback(
    async (
      path: string[],
      provider: string,
      actionType: string,
      params: Record<string, unknown>
    ) => {
      if (!workflowRunId || isReadonly) return;

      const promptKey = pathToKey(path);

      // Set loading state
      setPreviewLoadingPrompts((prev) => new Set(prev).add(promptKey));

      try {
        const preview = await api.getMediaPreview(workflowRunId, {
          provider,
          action_type: actionType,
          params,
        });

        setPreviewByPrompt((prev) => ({
          ...prev,
          [promptKey]: preview,
        }));
      } catch (error) {
        console.error("[MediaGeneration] Failed to fetch preview:", error);
        // Don't set error state for preview - it's not critical
      } finally {
        setPreviewLoadingPrompts((prev) => {
          const next = new Set(prev);
          next.delete(promptKey);
          return next;
        });
      }
    },
    [workflowRunId, isReadonly]
  );

  // Build context value
  const mediaContextValue = useMemo<MediaGenerationContextValue>(
    () => ({
      subActions,
      getGenerations: (path: string[]) => {
        const key = pathToKey(path);
        return generations[key] || [];
      },
      isLoading: (path: string[]) => {
        const key = pathToKey(path);
        return loadingPrompts.has(key);
      },
      getProgress: (path: string[]) => {
        const key = pathToKey(path);
        return progressByPrompt[key];
      },
      getError: (path: string[]) => {
        const key = pathToKey(path);
        return errorsByPrompt[key];
      },
      selectedContentId,
      onSelectContent: setSelectedContentId,
      executeSubAction,
      readonly: isReadonly,
      disabled: disabled || isReadonly,
      getPreview: (path: string[]) => {
        const key = pathToKey(path);
        return previewByPrompt[key];
      },
      isPreviewLoading: (path: string[]) => {
        const key = pathToKey(path);
        return previewLoadingPrompts.has(key);
      },
      fetchPreview,
      getDataAtPath: (path: string[]) => {
        let current: unknown = data;
        for (const key of path) {
          if (current && typeof current === "object") {
            current = (current as Record<string, unknown>)[key];
          } else {
            return undefined;
          }
        }
        return current;
      },
      // Crop selection state
      savedCrop,
      setSavedCrop,
      clearSavedCrop,
    }),
    [
      subActions,
      generations,
      loadingPrompts,
      progressByPrompt,
      errorsByPrompt,
      selectedContentId,
      executeSubAction,
      isReadonly,
      disabled,
      previewByPrompt,
      previewLoadingPrompts,
      fetchPreview,
      data,
      savedCrop,
      clearSavedCrop,
    ]
  );

  // If no data or schema, show placeholder
  if (!data || !schema) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <MediaGenerationProvider value={mediaContextValue}>
      <div className="h-full overflow-auto">
        <SchemaRenderer
          data={data}
          schema={schema}
          path={[]}
          disabled={disabled || isReadonly}
          readonly={isReadonly}
        />
      </div>
    </MediaGenerationProvider>
  );
}
