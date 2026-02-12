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

import React, { useState, useCallback } from "react";
import {
  Check,
  RotateCcw,
  MessageSquare,
  Clock,
  Loader2,
  Sparkles,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { JsonEditorDialog } from "../components/ui/json-editor-dialog";
import { Textarea } from "../components/ui/textarea";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { cn } from "../utils/cn";
import { useRenderContext } from "../contexts/RenderContext";
import type {
  InteractionRequest,
  InteractionResponseData,
  InteractionMode,
  SubActionDef,
  ValidationConfig,
  ValidationMessage,
} from "../types/index";
import {
  InteractionProvider,
  useInteraction,
  useInteractionHostInternal,
  ActionSlotTarget,
} from "../contexts/interaction-context";
import {
  SubActionProvider,
  useSubAction,
  type SubActionExecutor,
} from "../contexts/sub-action-context";
import {
  ValidationProviderWithRequest,
  useValidation,
} from "../contexts/validation-context";

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
  /** Hide this option from footer */
  hidden?: boolean;
  feedback?: {
    enabled?: boolean;
    per_group?: boolean;
    global?: boolean;
    prompt?: string;
    default_message?: string;
  };
  /** Validation rules for this action */
  validations?: ValidationConfig[];
}

interface RetryableConfig {
  options?: RetryableOption[];
  feedback?: {
    enabled?: boolean;
    per_group?: boolean;
    global?: boolean;
  };
  /** Hide retryable buttons from footer */
  hidden?: boolean;
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
   * Injectable sub-action executor.
   * webui provides real implementation, editor can provide mock.
   */
  subActionExecutor?: SubActionExecutor;
  /**
   * Called when a sub-action completes successfully.
   * Parent should refresh interaction display data.
   */
  onSubActionComplete?: () => void;
  /**
   * If true, sub-actions return mock data instead of real API calls.
   * Used for preview mode in the editor.
   */
  mockMode?: boolean;
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
  subActionExecutor,
  onSubActionComplete,
  mockMode = false,
}: InteractionHostProps) {
  // Debug mode from RenderContext
  const { debugMode, onUpdateDisplayData } = useRenderContext();
  const [isEditOpen, setIsEditOpen] = useState(false);

  // Handle save from JSON editor
  const handleSaveDisplayData = useCallback(
    (newValue: unknown) => {
      onUpdateDisplayData?.([], newValue, null);
    },
    [onUpdateDisplayData]
  );

  // Extract sub-actions from display_data for SubActionProvider
  const subActions = (request.display_data?.sub_actions || []) as SubActionDef[];

  // Same structure for both active and readonly modes
  // Readonly mode just has disabled inputs and no retryable buttons
  return (
    <InteractionProvider
      request={request}
      disabled={disabled}
      mode={mode}
      onSubmit={onSubmit}
    >
      <SubActionProvider
        subActions={subActions}
        interactionId={request.interaction_id}
        executor={subActionExecutor}
        onComplete={onSubActionComplete}
        mockMode={mockMode}
      >
        <InteractionHostContent
          request={request}
          mode={mode}
          timestamp={timestamp}
          isDebugMode={debugMode}
          isEditOpen={isEditOpen}
          setIsEditOpen={setIsEditOpen}
          handleSaveDisplayData={handleSaveDisplayData}
          onCancel={onCancel}
        />
      </SubActionProvider>
    </InteractionProvider>
  );
}

// =============================================================================
// Host Content (wrapped with ValidationProvider)
// =============================================================================

interface InteractionHostContentProps {
  request: InteractionRequest;
  mode: InteractionMode;
  timestamp?: string;
  isDebugMode: boolean;
  isEditOpen: boolean;
  setIsEditOpen: (open: boolean) => void;
  handleSaveDisplayData: (value: unknown) => void;
  onCancel?: () => void;
}

function InteractionHostContent({
  request,
  mode,
  timestamp,
  isDebugMode,
  isEditOpen,
  setIsEditOpen,
  handleSaveDisplayData,
  onCancel,
}: InteractionHostContentProps) {
  // Get providerState from InteractionContext for ValidationProvider
  const { providerState } = useInteractionHostInternal();

  // Extract retryable config
  const retryable = request.display_data?.retryable as
    | Record<string, unknown>
    | undefined;

  return (
    <ValidationProviderWithRequest
      request={request}
      retryable={retryable}
      providerState={providerState}
    >
      <div className="h-full flex flex-col">
        {/* Title - fixed at top */}
        {request.title && (
          <div className="flex-shrink-0 pb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{request.title}</h3>
              {/* Debug mode: Edit display_data button */}
              {isDebugMode && mode.type === "active" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditOpen(true)}
                  className="h-7 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30"
                  title="Edit display_data (Debug Mode)"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit Data
                </Button>
              )}
            </div>
            {timestamp && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>{timestamp}</span>
              </div>
            )}
          </div>
        )}

        {/* Debug mode: JSON Editor Dialog */}
        {isDebugMode && (
          <JsonEditorDialog
            open={isEditOpen}
            onOpenChange={setIsEditOpen}
            value={request.display_data}
            title="Edit display_data"
            onSave={handleSaveDisplayData}
          />
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

        {/* Validation Warning Popup */}
        <ValidationWarningPopup />
      </div>
    </ValidationProviderWithRequest>
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
}

function InteractionFooter({ onCancel }: InteractionFooterProps) {
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
    />
  );
}

interface InteractionFooterInnerProps {
  providerState: {
    isValid: boolean;
    selectedCount: number;
    selectedGroupIds: string[];
  };
  feedbackByGroup: Record<string, string>;
  globalFeedback: string;
  setGlobalFeedback: (feedback: string) => void;
  handleAction: (
    action: "continue" | "retry_all" | "retry_selected",
    options?: { actionId?: string; confirmedWarnings?: string[] }
  ) => void;
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
  const { request, disabled } = useInteraction();

  // Validation context
  const { getErrorsForAction, handleActionWithValidation } = useValidation();

  // Retryable config - filter out hidden options (same pattern as SubActions)
  const retryable = (request.display_data?.retryable || {}) as RetryableConfig;
  const visibleRetryableOptions = (retryable.options || []).filter(
    (opt) => !opt.hidden
  );
  const hasRetryableOptions =
    !retryable.hidden && visibleRetryableOptions.length > 0;
  const showGlobalFeedback =
    !retryable.hidden && retryable.feedback?.global === true;

  // Sub-actions from context (already filtered for visible only)
  const {
    visibleSubActions,
    state: subActionState,
    trigger: triggerSubAction,
    clearError,
  } = useSubAction();
  const hasSubActions = visibleSubActions.length > 0;

  // Sub-action feedback popup state (local to footer)
  const [subActionFeedbackPopup, setSubActionFeedbackPopup] = React.useState<{
    subAction: SubActionDef;
    onSubmit: (feedback: string) => void;
  } | null>(null);

  // Check if any feedback exists (for retryable)
  const hasFeedback =
    Object.values(feedbackByGroup).some((f) => f) || globalFeedback.length > 0;

  // Handle sub-action button click
  const handleSubActionClick = React.useCallback(
    (subAction: SubActionDef) => {
      // If feedback is enabled, show feedback popup first
      if (subAction.feedback?.enabled) {
        setSubActionFeedbackPopup({
          subAction,
          onSubmit: (feedback: string) => {
            setSubActionFeedbackPopup(null);
            triggerSubAction(subAction.id, { feedback });
          },
        });
      } else {
        triggerSubAction(subAction.id);
      }
    },
    [triggerSubAction]
  );

  // Handle retryable action click with validation
  const handleRetryableActionClick = React.useCallback(
    (
      option: RetryableOption,
      action: "continue" | "retry_all" | "retry_selected"
    ) => {
      // Use validation context to handle validation and warning popup
      handleActionWithValidation(option.id, (confirmedWarnings) => {
        handleAction(action, {
          actionId: option.id,
          confirmedWarnings,
        });
      });
    },
    [handleActionWithValidation, handleAction]
  );

  // Destructure sub-action state for easier use
  const { runningId, progress, error: subActionError } = subActionState;
  const isSubActionRunning = runningId !== null;

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
        <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md flex items-center justify-between">
          <span>{subActionError}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <div className="text-sm">
          {isSubActionRunning && progress ? (
            <span className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress}
            </span>
          ) : providerState.selectedCount > 0 ? (
            <span className="text-muted-foreground">
              {providerState.selectedCount} selected
            </span>
          ) : !providerState.isValid &&
            request.interaction_type === "select_from_structured" ? (
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

          {/* Sub-action buttons (visible ones only) */}
          {hasSubActions &&
            visibleSubActions.map((subAction) => {
              const isRunning = runningId === subAction.id;
              return (
                <Button
                  key={subAction.id}
                  variant="outline"
                  onClick={() => handleSubActionClick(subAction)}
                  disabled={disabled || isSubActionRunning}
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
            <Button
              variant="outline"
              onClick={onCancel}
              disabled={disabled || isSubActionRunning}
            >
              Cancel
            </Button>
          )}

          {hasRetryableOptions ? (
            // Render visible retryable options (hidden ones filtered out)
            visibleRetryableOptions.map((option) => {
              const isContinue = option.mode === "continue";
              const isRetrySelected = option.mode === "retry_selected";
              const isRetryWithFeedback =
                (option.mode === "retry" ||
                  option.mode === "retry_all" ||
                  isRetrySelected) &&
                hasFeedback;

              // Map option mode to action
              const actionMap: Record<
                string,
                "continue" | "retry_all" | "retry_selected"
              > = {
                continue: "continue",
                retry: "retry_all",
                retry_all: "retry_all",
                retry_selected: "retry_selected",
              };
              const action = actionMap[option.mode] || "continue";

              const Icon = isContinue ? Check : RotateCcw;

              // Check for validation errors (disables button)
              const validationErrors = getErrorsForAction(option.id);
              const hasValidationErrors = validationErrors.length > 0;

              // Determine if button should be disabled
              const isDisabled =
                disabled ||
                isSubActionRunning ||
                (isContinue && !providerState.isValid) ||
                (isRetrySelected && providerState.selectedCount === 0) ||
                hasValidationErrors;

              return (
                <Button
                  key={option.id}
                  variant={isContinue ? "default" : "outline"}
                  onClick={() => handleRetryableActionClick(option, action)}
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
              disabled={disabled || isSubActionRunning || !providerState.isValid}
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
// Validation Warning Popup
// =============================================================================

function ValidationWarningPopup() {
  const { warningPopup, confirmWarnings, cancelWarnings } = useValidation();

  if (!warningPopup) return null;

  return (
    <ValidationWarningDialog
      warnings={warningPopup.warnings}
      onConfirm={confirmWarnings}
      onCancel={cancelWarnings}
    />
  );
}

interface ValidationWarningDialogProps {
  warnings: ValidationMessage[];
  onConfirm: () => void;
  onCancel: () => void;
}

function ValidationWarningDialog({
  warnings,
  onConfirm,
  onCancel,
}: ValidationWarningDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent size="sm" className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Continue without generating?
          </DialogTitle>
          <DialogDescription>
            {warnings.length === 1
              ? warnings[0].message
              : "The following items need your attention:"}
          </DialogDescription>
        </DialogHeader>
        {warnings.length > 1 && (
          <ul className="list-disc pl-4 space-y-1 text-sm text-muted-foreground">
            {warnings.map((w) => (
              <li key={w.id}>{w.message}</li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Go Back
          </Button>
          <Button onClick={onConfirm}>Continue Anyway</Button>
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
            Enter your feedback for this item. This will be included when you
            retry.
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
