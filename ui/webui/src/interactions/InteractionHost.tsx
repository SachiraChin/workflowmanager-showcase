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

import { Check, RotateCcw, MessageSquare } from "lucide-react";
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
import type { InteractionRequest, InteractionResponseData, InteractionMode } from "@/core/types";
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
          <div className="flex-shrink-0 pb-4">
            <h3 className="text-lg font-semibold">{request.title}</h3>
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
          <InteractionFooter onCancel={onCancel} />
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

function InteractionFooter({ onCancel }: { onCancel?: () => void }) {
  const {
    providerState,
    feedbackByGroup,
    globalFeedback,
    setGlobalFeedback,
    handleAction,
  } = useInteractionHostInternal();

  // Get retryable config from request via context
  // We need to access it through the child context - let me use a different approach
  // Actually, we need to pass this through the context or read it here
  // For now, let's read from the provider's request

  return (
    <InteractionFooterInner
      providerState={providerState}
      feedbackByGroup={feedbackByGroup}
      globalFeedback={globalFeedback}
      setGlobalFeedback={setGlobalFeedback}
      handleAction={handleAction}
      onCancel={onCancel}
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
}

function InteractionFooterInner({
  providerState,
  feedbackByGroup,
  globalFeedback,
  setGlobalFeedback,
  handleAction,
  onCancel,
}: InteractionFooterInnerProps) {
  // Access request from context to get retryable config
  // We'll use a separate hook for this
  const { request, disabled } = useInteractionFooterContext();
  const retryable = (request.display_data?.retryable || {}) as RetryableConfig;
  const hasRetryableOptions = retryable.options && retryable.options.length > 0;
  const showGlobalFeedback = retryable.feedback?.global === true;

  // Check if any feedback exists
  const hasFeedback =
    Object.values(feedbackByGroup).some((f) => f) || globalFeedback.length > 0;

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

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {providerState.selectedCount > 0 ? (
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

          {onCancel && (
            <Button variant="outline" onClick={onCancel} disabled={disabled}>
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
              disabled={disabled || !providerState.isValid}
            >
              Continue
            </Button>
          )}
        </div>
      </div>
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
