/**
 * InteractionHost - Unified host for all interaction types.
 *
 * Responsibilities:
 * - Provides InteractionContext for child components
 * - Renders title
 * - Routes to appropriate interaction component
 * - Renders action buttons (Continue, Retry All, Retry Selected)
 * - Renders global feedback textarea (if enabled)
 * - Renders feedback popup modal (triggered by child components)
 *
 * Child components register themselves via updateProvider() and can
 * trigger feedback popups via openFeedbackPopup().
 */

import { Check, RotateCcw, MessageSquare, Clock, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/core/utils";
import { api } from "@/core/api";
import { useWorkflowStore } from "@/state/workflow-store";
import type {
  InteractionRequest,
  InteractionResponseData,
  InteractionMode,
  SubActionDef,
  SSEEventType,
} from "@/core/types";
import {
  InteractionProvider,
  useInteractionHostInternal,
  ActionSlotTarget,
} from "@/state/interaction-context";

// Import interaction components
import { TextInputEnhanced } from "./types/text-input";
import { FileInputDropzone } from "./types/file-input";
import { FileDownload } from "./types/file-download";
import { StructuredSelect } from "./types/structured-select";
import { ReviewGrouped } from "./types/review-grouped";
import { FormInput } from "./types/form-input";
import { MediaGenerationHost } from "./types/media-generation";

// =============================================================================
// Types
// =============================================================================

interface RetryableOption {
  id: string;
  mode: "continue" | "retry" | "retry_all" | "retry_selected";
  label: string;
  shortcut?: string;
  target_module?: string;
  target_step?: string;
  feedback?: {
    enabled?: boolean;
    per_group?: boolean;
    global?: boolean;
    prompt?: string;
    default_message?: string;
  };
}

interface RetryableConfig {
  options?: RetryableOption[];
  feedback?: {
    enabled?: boolean;
    per_group?: boolean;
    global?: boolean;
  };
}

interface InteractionHostProps {
  request: InteractionRequest;
  onSubmit: (response: InteractionResponseData) => void;
  onCancel?: () => void;
  disabled?: boolean;
  /** Interaction mode - defaults to active (interactive) */
  mode?: InteractionMode;
  /** Optional timestamp to display next to title (for readonly mode) */
  timestamp?: string;
  /**
   * Called when a sub-action completes successfully.
   * Parent should refresh interaction display data.
   */
  onSubActionComplete?: () => void;
}

// =============================================================================
// Main Component
// =============================================================================

const DEFAULT_MODE: InteractionMode = { type: "active" };

export function InteractionHost({
  request,
  onSubmit,
  onCancel,
  disabled = false,
  mode = DEFAULT_MODE,
  timestamp,
  onSubActionComplete,
}: InteractionHostProps) {
  // Same structure for both active and readonly modes
  // Readonly mode just has disabled inputs and no retryable buttons
  return (
    <InteractionProvider
      request={request}
      disabled={disabled}
      mode={mode}
      onSubmit={onSubmit}
    >
      <div className="h-full flex flex-col">
        {/* Title - fixed at top */}
        {request.title && (
          <div className="flex-shrink-0 pb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{request.title}</h3>
            {timestamp && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{timestamp}</span>
              </div>
            )}
          </div>
        )}

        {/* Interaction Content - fills middle area */}
        <div className="flex-1 min-h-0">
          <div className="h-full">
            <InteractionContent type={request.interaction_type} />
          </div>
        </div>

        {/* Action Buttons - fixed at bottom */}
        <div className="flex-shrink-0 pt-4">
          <InteractionFooter onCancel={onCancel} onSubActionComplete={onSubActionComplete} />
        </div>

        {/* Feedback Popup */}
        <FeedbackPopup />
      </div>
    </InteractionProvider>
  );
}

// =============================================================================
// Content Router
// =============================================================================

function InteractionContent({ type }: { type: string }) {
  switch (type) {
    case "text_input":
      return <TextInputEnhanced />;
    case "file_input":
      return <FileInputDropzone />;
    case "file_download":
      return <FileDownload />;
    case "select_from_structured":
      return <StructuredSelect />;
    case "review_grouped":
      return <ReviewGrouped />;
    case "form_input":
      return <FormInput />;
    case "media_generation":
      return <MediaGenerationHost />;
    default:
      return (
        <div className="p-4 text-center text-muted-foreground">
          Unsupported interaction type: {type}
        </div>
      );
  }
}

// =============================================================================
// Footer (Global Feedback + Buttons)
// =============================================================================

interface InteractionFooterProps {
  onCancel?: () => void;
  onSubActionComplete?: () => void;
}

function InteractionFooter({ onCancel, onSubActionComplete }: InteractionFooterProps) {
  const {
    providerState,
    feedbackByGroup,
    globalFeedback,
    setGlobalFeedback,
    handleAction,
  } = useInteractionHostInternal();

  return (
    <InteractionFooterInner
      providerState={providerState}
      feedbackByGroup={feedbackByGroup}
      globalFeedback={globalFeedback}
      setGlobalFeedback={setGlobalFeedback}
      handleAction={handleAction}
      onCancel={onCancel}
      onSubActionComplete={onSubActionComplete}
    />
  );
}

interface InteractionFooterInnerProps {
  providerState: { isValid: boolean; selectedCount: number; selectedGroupIds: string[] };
  feedbackByGroup: Record<string, string>;
  globalFeedback: string;
  setGlobalFeedback: (feedback: string) => void;
  handleAction: (action: "continue" | "retry_all" | "retry_selected") => void;
  onCancel?: () => void;
  onSubActionComplete?: () => void;
}

function InteractionFooterInner({
  providerState,
  feedbackByGroup,
  globalFeedback,
  setGlobalFeedback,
  handleAction,
  onCancel,
  onSubActionComplete,
}: InteractionFooterInnerProps) {
  const { request, disabled } = useInteractionFooterContext();
  const workflowRunId = useWorkflowStore((s) => s.workflowRunId);

  // Retryable config
  const retryable = (request.display_data?.retryable || {}) as RetryableConfig;
  const hasRetryableOptions = retryable.options && retryable.options.length > 0;
  const showGlobalFeedback = retryable.feedback?.global === true;

  // Sub-actions config
  const subActions = (request.display_data?.sub_actions || []) as SubActionDef[];
  const hasSubActions = subActions.length > 0;

  // Sub-action state
  const [runningSubAction, setRunningSubAction] = React.useState<string | null>(null);
  const [subActionProgress, setSubActionProgress] = React.useState<string | null>(null);
  const [subActionError, setSubActionError] = React.useState<string | null>(null);
  const [subActionFeedbackPopup, setSubActionFeedbackPopup] = React.useState<{
    subAction: SubActionDef;
    onSubmit: (feedback: string) => void;
  } | null>(null);

  // Check if any feedback exists (for retryable)
  const hasFeedback =
    Object.values(feedbackByGroup).some((f) => f) || globalFeedback.length > 0;

  // Handle sub-action execution
  const executeSubAction = React.useCallback(
    (subAction: SubActionDef, feedback?: string) => {
      if (!workflowRunId) return;

      setRunningSubAction(subAction.id);
      setSubActionProgress(subAction.loading_label || "Processing...");
      setSubActionError(null);

      const subActionRequest = {
        interaction_id: request.interaction_id,
        action_id: subAction.id,
        params: feedback ? { feedback } : undefined,
      };

      const handleEvent = (eventType: SSEEventType, data: Record<string, unknown>) => {
        switch (eventType) {
          case "progress":
            setSubActionProgress(data.message as string || "Processing...");
            break;
          case "complete":
            setRunningSubAction(null);
            setSubActionProgress(null);
            // Notify parent to refresh display data
            onSubActionComplete?.();
            break;
          case "error":
            setRunningSubAction(null);
            setSubActionProgress(null);
            setSubActionError(data.message as string || "Sub-action failed");
            break;
        }
      };

      const handleError = (err: Error) => {
        setRunningSubAction(null);
        setSubActionProgress(null);
        setSubActionError(err.message);
      };

      api.streamSubAction(workflowRunId, subActionRequest, handleEvent, handleError);
    },
    [workflowRunId, request.interaction_id, onSubActionComplete]
  );

  // Handle sub-action button click
  const handleSubActionClick = React.useCallback(
    (subAction: SubActionDef) => {
      // If feedback is enabled, show feedback popup first
      if (subAction.feedback?.enabled) {
        setSubActionFeedbackPopup({
          subAction,
          onSubmit: (feedback: string) => {
            setSubActionFeedbackPopup(null);
            executeSubAction(subAction, feedback);
          },
        });
      } else {
        executeSubAction(subAction);
      }
    },
    [executeSubAction]
  );

  return (
    <div className="space-y-4 pt-2 border-t">
      {/* Global feedback textarea */}
      {showGlobalFeedback && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Feedback (optional)</label>
          <Textarea
            value={globalFeedback}
            onChange={(e) => setGlobalFeedback(e.target.value)}
            placeholder="Enter feedback for regeneration..."
            className="min-h-[80px]"
            disabled={disabled}
          />
        </div>
      )}

      {/* Sub-action error */}
      {subActionError && (
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
          {subActionError}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {runningSubAction && subActionProgress ? (
            <span className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {subActionProgress}
            </span>
          ) : providerState.selectedCount > 0 ? (
            <span className="text-muted-foreground">{providerState.selectedCount} selected</span>
          ) : !providerState.isValid && request.interaction_type === "select_from_structured" ? (
            <span className="text-green-600">
              {request.max_selections === 1
                ? "Select an option to continue"
                : "Select all applicable options"}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Child-provided actions (e.g., Download button) */}
          <ActionSlotTarget />

          {/* Sub-action buttons */}
          {hasSubActions &&
            subActions.map((subAction) => {
              const isRunning = runningSubAction === subAction.id;
              return (
                <Button
                  key={subAction.id}
                  variant="outline"
                  onClick={() => handleSubActionClick(subAction)}
                  disabled={disabled || runningSubAction !== null}
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 mr-2" />
                  )}
                  {subAction.label}
                </Button>
              );
            })}

          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={disabled || runningSubAction !== null}>
              Cancel
            </Button>
          )}

          {hasRetryableOptions ? (
            // Render retryable options
            retryable.options!.map((option) => {
              const isContinue = option.mode === "continue";
              const isRetrySelected = option.mode === "retry_selected";
              const isRetryWithFeedback =
                (option.mode === "retry" || option.mode === "retry_all" || isRetrySelected) &&
                hasFeedback;

              // Map option mode to action
              const actionMap: Record<string, "continue" | "retry_all" | "retry_selected"> = {
                continue: "continue",
                retry: "retry_all",
                retry_all: "retry_all",
                retry_selected: "retry_selected",
              };
              const action = actionMap[option.mode] || "continue";

              const Icon = isContinue ? Check : RotateCcw;

              // Determine if button should be disabled
              const isDisabled =
                disabled ||
                runningSubAction !== null ||
                (isContinue && !providerState.isValid) ||
                (isRetrySelected && providerState.selectedCount === 0);

              return (
                <Button
                  key={option.id}
                  variant={isContinue ? "default" : "outline"}
                  onClick={() => handleAction(action)}
                  disabled={isDisabled}
                  className={cn(
                    isRetryWithFeedback && "ring-2 ring-primary ring-offset-2"
                  )}
                >
                  <Icon className="h-4 w-4 mr-2" />
                  {option.label}
                  {isRetrySelected && providerState.selectedCount > 0 && (
                    <Badge variant="secondary" className="ml-2">
                      {providerState.selectedCount}
                    </Badge>
                  )}
                  {isRetryWithFeedback && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      feedback
                    </Badge>
                  )}
                </Button>
              );
            })
          ) : (
            // Default continue button
            <Button
              onClick={() => handleAction("continue")}
              disabled={disabled || runningSubAction !== null || !providerState.isValid}
            >
              Continue
            </Button>
          )}
        </div>
      </div>

      {/* Sub-action feedback popup */}
      {subActionFeedbackPopup && (
        <SubActionFeedbackDialog
          subAction={subActionFeedbackPopup.subAction}
          onSubmit={subActionFeedbackPopup.onSubmit}
          onCancel={() => setSubActionFeedbackPopup(null)}
        />
      )}
    </div>
  );
}

// Helper hook to access request from footer
import { useInteraction } from "@/state/interaction-context";

function useInteractionFooterContext() {
  const { request, disabled } = useInteraction();
  return { request, disabled };
}

// =============================================================================
// Sub-Action Feedback Dialog
// =============================================================================

interface SubActionFeedbackDialogProps {
  subAction: SubActionDef;
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}

function SubActionFeedbackDialog({
  subAction,
  onSubmit,
  onCancel,
}: SubActionFeedbackDialogProps) {
  const [feedback, setFeedback] = React.useState("");

  const prompt = subAction.feedback?.prompt || "What would you like different?";

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{subAction.label}</DialogTitle>
          <DialogDescription>{prompt}</DialogDescription>
        </DialogHeader>
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Enter your feedback..."
          className="min-h-[120px]"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(feedback)}>
            <Sparkles className="h-4 w-4 mr-2" />
            {subAction.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Feedback Popup
// =============================================================================

function FeedbackPopup() {
  const { feedbackPopup, handleFeedbackSubmit, handleFeedbackCancel } =
    useInteractionHostInternal();

  if (!feedbackPopup) return null;

  return (
    <FeedbackPopupDialog
      groupLabel={feedbackPopup.groupLabel}
      existingFeedback={feedbackPopup.existingFeedback}
      onSubmit={handleFeedbackSubmit}
      onCancel={handleFeedbackCancel}
    />
  );
}

interface FeedbackPopupDialogProps {
  groupLabel: string;
  existingFeedback: string;
  onSubmit: (feedback: string) => void;
  onCancel: () => void;
}

function FeedbackPopupDialog({
  groupLabel,
  existingFeedback,
  onSubmit,
  onCancel,
}: FeedbackPopupDialogProps) {
  const [feedback, setFeedback] = React.useState(existingFeedback);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Feedback for "{groupLabel}"</DialogTitle>
          <DialogDescription>
            Enter your feedback for this item. This will be included when you retry.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What changes would you like?"
          className="min-h-[120px]"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(feedback)}>
            <MessageSquare className="h-4 w-4 mr-2" />
            Save Feedback
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Need React import for useState in FeedbackPopupDialog
import React from "react";
