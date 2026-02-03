/**
 * useGenerationQueue - Hook for managing queued generation tasks.
 *
 * Tracks multiple concurrent generation tasks, providing:
 * - Active task management (add, update, complete, error)
 * - Progress display for oldest task with queue count
 * - Button label logic (Generate vs Queue)
 * - Brief disable state during request start
 *
 * Usage:
 *   const queue = useGenerationQueue(generations.length, disabled);
 *
 *   // In handleGenerate:
 *   const taskId = queue.actions.startTask();
 *   // On progress event:
 *   queue.actions.onStreamStarted();
 *   queue.actions.updateProgress(taskId, { elapsed_ms, message });
 *   // On complete:
 *   queue.actions.completeTask(taskId);
 *   // On error:
 *   queue.actions.failTask(taskId, errorMessage);
 *
 *   // In JSX:
 *   <Button disabled={queue.derived.buttonDisabled}>
 *     {queue.derived.buttonLabel}
 *   </Button>
 *   {queue.derived.isLoading && <span>{queue.derived.progressMessage}</span>}
 *   {queue.state.error && <span>{queue.state.error}</span>}
 */

import { useState, useMemo, useCallback } from "react";
import type { ProgressState } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface ActiveTask {
  /** Unique ID for this task */
  id: string;
  /** Timestamp for sorting (oldest first) */
  createdAt: number;
  /** Current progress state */
  progress: ProgressState | null;
}

export interface GenerationQueueState {
  /** All active tasks (running + queued) */
  activeTasks: ActiveTask[];
  /** Last error message */
  error: string | null;
  /** Brief disable state during request start */
  isStarting: boolean;
}

export interface GenerationQueueActions {
  /** Start a new task, returns task ID */
  startTask: () => string;
  /** Update progress for a specific task */
  updateProgress: (taskId: string, progress: ProgressState) => void;
  /** Mark task as complete, remove from active */
  completeTask: (taskId: string) => void;
  /** Mark task as failed, remove from active, set error */
  failTask: (taskId: string, errorMessage: string) => void;
  /** Clear the current error */
  clearError: () => void;
  /** Called when stream response starts (re-enables button) */
  onStreamStarted: () => void;
}

export interface GenerationQueueDerived {
  /** Whether any tasks are active */
  isLoading: boolean;
  /** Number of active tasks */
  queueCount: number;
  /** Progress message with queue count appended */
  progressMessage: string;
  /** Button label: "Generate" or "Queue" */
  buttonLabel: string;
  /** Button disabled state */
  buttonDisabled: boolean;
}

export interface UseGenerationQueueResult {
  state: GenerationQueueState;
  actions: GenerationQueueActions;
  derived: GenerationQueueDerived;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for managing queued generation tasks.
 *
 * @param generationsCount - Number of completed generations (for button label)
 * @param externalDisabled - External disabled state (e.g., from context)
 * @returns Queue state, actions, and derived values
 */
export function useGenerationQueue(
  generationsCount: number,
  externalDisabled: boolean = false
): UseGenerationQueueResult {
  // State
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Sorted tasks (oldest first)
  const sortedTasks = useMemo(
    () => [...activeTasks].sort((a, b) => a.createdAt - b.createdAt),
    [activeTasks]
  );

  // Derived values
  const isLoading = activeTasks.length > 0;
  const queueCount = activeTasks.length;
  const currentTask = sortedTasks[0];

  const progressMessage = useMemo(() => {
    if (!currentTask?.progress?.message) return "";
    const baseMessage = currentTask.progress.message;
    if (queueCount > 1) {
      return `${baseMessage} (${queueCount - 1} generations in queue)`;
    }
    return baseMessage;
  }, [currentTask, queueCount]);

  const buttonLabel = useMemo(
    () =>
      generationsCount > 0 || activeTasks.length > 0 ? "Queue" : "Generate",
    [generationsCount, activeTasks.length]
  );

  const buttonDisabled = isStarting || externalDisabled;

  // Actions
  const startTask = useCallback((): string => {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const task: ActiveTask = {
      id: taskId,
      createdAt: Date.now(),
      progress: { elapsed_ms: 0, message: "Starting..." },
    };
    setActiveTasks((prev) => [...prev, task]);
    setIsStarting(true);
    setError(null);
    return taskId;
  }, []);

  const updateProgress = useCallback(
    (taskId: string, progress: ProgressState) => {
      setActiveTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, progress } : t))
      );
    },
    []
  );

  const completeTask = useCallback((taskId: string) => {
    setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const failTask = useCallback((taskId: string, errorMessage: string) => {
    setActiveTasks((prev) => prev.filter((t) => t.id !== taskId));
    setError(errorMessage);
    setIsStarting(false);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const onStreamStarted = useCallback(() => {
    setIsStarting(false);
  }, []);

  // Build result object
  const state = useMemo<GenerationQueueState>(
    () => ({ activeTasks, error, isStarting }),
    [activeTasks, error, isStarting]
  );

  const actions = useMemo<GenerationQueueActions>(
    () => ({
      startTask,
      updateProgress,
      completeTask,
      failTask,
      clearError,
      onStreamStarted,
    }),
    [startTask, updateProgress, completeTask, failTask, clearError, onStreamStarted]
  );

  const derived = useMemo<GenerationQueueDerived>(
    () => ({
      isLoading,
      queueCount,
      progressMessage,
      buttonLabel,
      buttonDisabled,
    }),
    [isLoading, queueCount, progressMessage, buttonLabel, buttonDisabled]
  );

  return { state, actions, derived };
}
