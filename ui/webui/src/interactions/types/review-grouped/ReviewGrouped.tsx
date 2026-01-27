/**
 * ReviewGrouped - Grouped review using InteractionContext.
 *
 * Uses SchemaInteractionHost for rendering and registers with
 * InteractionHost via updateProvider for response handling.
 *
 * Response format depends on action:
 * - "continue" -> { value: "accepted" }
 * - "retry_all" / "retry_selected" -> { retry_requested: true, retry_groups: [...], retry_feedback: "..." }
 */

import { useCallback, useEffect, useRef } from "react";
import { useInteraction, type ResponseParams } from "@/state/interaction-context";
import {
  SchemaInteractionHost,
  type SchemaInteractionState,
} from "../../schema";

/**
 * Build review response based on action and feedback
 */
function buildReviewResponse(
  action: ResponseParams["action"],
  selectedPaths: string[][],
  feedbackByGroup: Record<string, string>,
  globalFeedback: string
) {
  // Continue action - accept all
  if (action === "continue") {
    return { value: "accepted" };
  }

  // Build retry groups from selection or all
  const retryGroups =
    action === "retry_all"
      ? Object.keys(feedbackByGroup)
      : selectedPaths.map((path) => path.join("."));

  // Build feedback string
  const feedbackLines: string[] = [];
  if (globalFeedback) {
    feedbackLines.push(globalFeedback);
  }
  for (const [groupId, feedback] of Object.entries(feedbackByGroup)) {
    if (feedback && (action === "retry_all" || retryGroups.includes(groupId))) {
      feedbackLines.push(`[${groupId}]: ${feedback}`);
    }
  }

  return {
    retry_requested: true,
    retry_groups: retryGroups,
    retry_feedback: feedbackLines.join("\n"),
  };
}

export function ReviewGrouped() {
  const { request, disabled, updateProvider, mode } = useInteraction();

  const isReadonly = mode.type === "readonly";

  // Keep ref for getResponse closure (reads latest state at submit time)
  const stateRef = useRef<SchemaInteractionState | null>(null);

  // Handle state changes from SchemaInteractionHost
  // Call updateProvider directly to notify parent immediately (not via useEffect with ref deps)
  const handleStateChange = useCallback(
    (state: SchemaInteractionState) => {
      stateRef.current = state;
      updateProvider({
        getResponse: ({ action, feedbackByGroup, globalFeedback }) => {
          const currentState = stateRef.current;
          return buildReviewResponse(
            action,
            currentState?.selectedPaths || [],
            feedbackByGroup,
            globalFeedback
          );
        },
        getState: () => ({
          isValid: true, // Review is always valid
          selectedCount: state.selectedCount,
          selectedGroupIds: state.selectedPaths?.map((p) => p.join(".")) ?? [],
        }),
      });
    },
    [updateProvider]
  );

  // Register provider on mount (for initial state before any selection)
  useEffect(() => {
    updateProvider({
      getResponse: ({ action, feedbackByGroup, globalFeedback }) => {
        const state = stateRef.current;
        return buildReviewResponse(
          action,
          state?.selectedPaths || [],
          feedbackByGroup,
          globalFeedback
        );
      },
      getState: () => {
        const state = stateRef.current;
        return {
          isValid: true,
          selectedCount: state?.selectedCount ?? 0,
          selectedGroupIds: state?.selectedPaths?.map((p) => p.join(".")) ?? [],
        };
      },
    });
  }, [updateProvider]);

  return (
    <SchemaInteractionHost
      request={request}
      mode="review"
      variant="cards"
      disabled={disabled || isReadonly}
      onStateChange={handleStateChange}
    />
  );
}
