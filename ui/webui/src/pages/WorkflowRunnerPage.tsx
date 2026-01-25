/**
 * WorkflowRunnerPage - Page for running and monitoring an active workflow.
 *
 * This page displays:
 * - Workflow status and progress (sidebar)
 * - Current interaction (when awaiting input)
 * - Completion/error states
 *
 * Note: This page works with useWorkflowExecution hook state.
 * The workflow should already be started before rendering this page.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MagneticScrollContainer, MagneticScrollCard } from "@/components/ui/magnetic-scroll-container";
import { Loader2 } from "lucide-react";
import { VersionDiffDialog } from "@/components/workflow/start/VersionDiffDialog";
import { WorkflowSidebar, StateTreeView, FilesTreeView } from "@/components/workflow/state";
import { InteractionPanel, WorkflowCompletion } from "@/components/workflow/runner";
import { CompletedInteractionCard } from "@/components/workflow/history";
import { useWorkflowExecution } from "@/hooks/useWorkflowExecution";
import { WorkflowStateProvider } from "@/contexts/WorkflowStateContext";
// import { api } from "@/lib/api";  // TEMPORARILY DISABLED - status display polling
import type { CompletedInteraction, InteractionResponseData } from "@/lib/types";

/** Interaction with step context for rendering */
interface InteractionWithStep extends CompletedInteraction {
  isFirstInStep: boolean;
}

// =============================================================================
// Types
// =============================================================================

interface StatusDisplayField {
  id: string;
  label: string;
  value: string;
}

type PageState = "running" | "completed" | "error";

interface WorkflowRunnerPageProps {
  /** Called when user wants to start a new workflow */
  onRestart?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowRunnerPage({ onRestart }: WorkflowRunnerPageProps) {
  // Status display fields from workflow config
  const [statusDisplayFields, setStatusDisplayFields] = useState<StatusDisplayField[]>([]);

  // Version confirmation loading state
  const [isConfirmingVersion, setIsConfirmingVersion] = useState(false);

  // Workflow execution hook
  const {
    workflowRunId,
    projectName,
    status,
    progress,
    error,
    currentInteraction,
    completedInteractions,
    isProcessing,
    elapsedMs,
    lastMessage,
    respond,
    disconnect,
    reset,
    // Version confirmation
    versionConfirmation,
    confirmVersionAndStart,
    cancelVersionConfirmation,
  } = useWorkflowExecution();

  // Ref for programmatic scrolling to cards
  const scrollToCardRef = useRef<((index: number, smooth?: boolean) => void) | null>(null);

  // Flatten interactions with step context (for showing step headers on first item)
  const interactionsWithSteps = useMemo<InteractionWithStep[]>(() => {
    if (!completedInteractions.length) return [];

    const seenSteps = new Set<string>();
    return completedInteractions.map((interaction) => {
      const stepId = interaction.step_id || "unknown";
      const isFirstInStep = !seenSteps.has(stepId);
      if (isFirstInStep) seenSteps.add(stepId);
      return { ...interaction, isFirstInStep };
    });
  }, [completedInteractions]);

  // Determine page state
  const pageState: PageState = (() => {
    if (status === "completed") return "completed";
    if (status === "error") return "error";
    return "running";
  })();

  // Calculate total card count
  const totalCards = useMemo(() => {
    let count = interactionsWithSteps.length;
    // Add 1 for current interaction or processing state
    if (pageState === "running") count += 1;
    // Add 1 for completion/error state
    if (pageState === "completed" || pageState === "error") count += 1;
    return Math.max(count, 1);
  }, [interactionsWithSteps.length, pageState]);

  // Auto-scroll to current interaction card when it changes
  useEffect(() => {
    if (currentInteraction && scrollToCardRef.current) {
      // Scroll to the current interaction card (last card in the list)
      const currentCardIndex = interactionsWithSteps.length;
      const timer = setTimeout(() => {
        scrollToCardRef.current?.(currentCardIndex, true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentInteraction, interactionsWithSteps.length]);

  // Fetch status display fields when workflow is running
  // TEMPORARILY DISABLED for debugging
  // useEffect(() => {
  //   if (!workflowRunId || status === "completed" || status === "error") {
  //     return;
  //   }
  //
  //   const fetchStatusDisplay = async () => {
  //     try {
  //       const response = await api.getStatusDisplay(workflowRunId);
  //       if (response.display_fields) {
  //         setStatusDisplayFields(response.display_fields);
  //       }
  //     } catch (e) {
  //       // Silently ignore - status display is optional
  //       console.debug("Failed to fetch status display", e);
  //     }
  //   };
  //
  //   // Fetch immediately and then every 5 seconds
  //   fetchStatusDisplay();
  //   const interval = setInterval(fetchStatusDisplay, 5000);
  //
  //   return () => clearInterval(interval);
  // }, [workflowRunId, status]);

  // Handle interaction response
  const handleInteractionSubmit = useCallback(
    async (response: InteractionResponseData) => {
      try {
        await respond(response);
      } catch (e) {
        console.error("Failed to submit response", e);
      }
    },
    [respond]
  );

  // Handle exit - disconnect streams and go back to home
  const handleExit = useCallback(() => {
    disconnect();
    reset();
    onRestart?.();
  }, [disconnect, reset, onRestart]);

  // Handle restart
  const handleRestart = useCallback(() => {
    reset();
    setStatusDisplayFields([]);
    onRestart?.();
  }, [reset, onRestart]);

  // Handle version confirmation
  const handleConfirmVersion = useCallback(async () => {
    setIsConfirmingVersion(true);
    try {
      await confirmVersionAndStart();
    } catch (e) {
      console.error("Failed to confirm version", e);
    } finally {
      setIsConfirmingVersion(false);
    }
  }, [confirmVersionAndStart]);

  // Handle version confirmation cancel
  const handleCancelVersion = useCallback(() => {
    cancelVersionConfirmation();
  }, [cancelVersionConfirmation]);

  return (
    <div className="container mx-auto px-4 pt-2 pb-4">
      <WorkflowStateProvider workflowRunId={workflowRunId}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left sidebar - Status */}
          <div className="lg:col-span-1 space-y-4">
            <WorkflowSidebar
              pageState={pageState}
              status={status}
              progress={progress}
              isProcessing={isProcessing}
              elapsedMs={elapsedMs}
              lastMessage={lastMessage ?? ""}
              error={error}
              statusDisplayFields={statusDisplayFields}
              projectName={projectName ?? "Unknown"}
              workflowRunId={workflowRunId ?? ""}
              onCancel={handleExit}
              onRestart={handleRestart}
            />

            {/* Live State Tree - always visible for debugging */}
            <StateTreeView />

            {/* Workflow Files Tree - always visible for debugging */}
            <FilesTreeView />
          </div>

          {/* Main content - Magnetic scroll-snap interaction cards */}
          <div className="lg:col-span-2">
            <MagneticScrollContainer
              cardCount={totalCards}
              scrollToCardRef={scrollToCardRef}
              height="calc(100vh - 5rem)"
            >
              {/* Completed interactions */}
              {interactionsWithSteps.map((interaction, index) => (
                <MagneticScrollCard
                  key={interaction.interaction_id}
                  index={index}
                  height="calc(100vh - 5rem)"
                >
                  <CompletedInteractionCard
                    interaction={interaction}
                    stepName={interaction.isFirstInStep ? (interaction.step_id || "unknown") : undefined}
                    defaultExpanded={true}
                  />
                </MagneticScrollCard>
              ))}

              {/* Current interaction */}
              {pageState === "running" && currentInteraction && workflowRunId && (
                <MagneticScrollCard
                  key={`current-${currentInteraction.interaction_id}`}
                  index={interactionsWithSteps.length}
                  height="calc(100vh - 5rem)"
                >
                  <InteractionPanel
                    request={currentInteraction}
                    onSubmit={handleInteractionSubmit}
                    disabled={isProcessing}
                  />
                </MagneticScrollCard>
              )}

              {/* Processing/waiting state */}
              {pageState === "running" && !currentInteraction && (
                <MagneticScrollCard
                  index={interactionsWithSteps.length}
                  height="calc(100vh - 5rem)"
                >
                  <Card className="h-full">
                    <CardContent className="pt-6 h-full flex items-center justify-center">
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin mb-4" />
                        <p>{isProcessing ? "Processing..." : "Waiting for workflow..."}</p>
                        {lastMessage && (
                          <p className="text-sm mt-2">{lastMessage}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </MagneticScrollCard>
              )}

              {/* Completion/error states */}
              {(pageState === "completed" || pageState === "error") && (
                <MagneticScrollCard
                  index={interactionsWithSteps.length}
                  height="calc(100vh - 5rem)"
                >
                  <WorkflowCompletion status={pageState} error={error} />
                </MagneticScrollCard>
              )}
            </MagneticScrollContainer>
          </div>
        </div>
      </WorkflowStateProvider>

      {/* Version Confirmation Dialog */}
      {versionConfirmation.pending && versionConfirmation.diff && (
        <VersionDiffDialog
          open={versionConfirmation.pending}
          onOpenChange={(open) => !open && handleCancelVersion()}
          diff={versionConfirmation.diff}
          oldHash={versionConfirmation.oldHash}
          newHash={versionConfirmation.newHash}
          onConfirm={handleConfirmVersion}
          onCancel={handleCancelVersion}
          isLoading={isConfirmingVersion}
        />
      )}
    </div>
  );
}
