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
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MagneticScrollContainer, MagneticScrollCard } from "@wfm/shared";
import { Loader2, Database, FolderTree, ChevronLeft, ChevronRight } from "lucide-react";
import { VersionDiffDialog } from "@/features/workflow-start/VersionDiffDialog";
import { WorkflowSidebar, StateTreeView, FilesTreeView } from "@/features/workflow-state";
import { InteractionPanel, WorkflowCompletion } from "@/features/workflow-runner";
import { CompletedInteractionCard } from "@/features/workflow-history";
import { AccessDeniedView } from "@/components/AccessDeniedView";
import { RunnerGuidanceOverlay } from "@/features/workflow-guidance";
import { useWorkflowExecution } from "@/state/hooks/useWorkflowExecution";
import { useWorkflowStore } from "@/state/workflow-store";
import { WorkflowStateProvider } from "@wfm/shared";
import { api } from "@/core/api";
import type { CompletedInteraction, InteractionResponseData } from "@/core/types";

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

  // Workflow template/version IDs for editor link
  const [workflowTemplateId, setWorkflowTemplateId] = useState<string | undefined>();
  const [workflowVersionId, setWorkflowVersionId] = useState<string | undefined>();

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
    refreshInteractionDisplayData,
    // Version confirmation
    versionConfirmation,
    confirmVersionAndStart,
    cancelVersionConfirmation,
  } = useWorkflowExecution();

  // Ref for programmatic scrolling to cards
  const scrollToCardRef = useRef<((index: number, smooth?: boolean) => void) | null>(null);

  // View mode state
  const viewMode = useWorkflowStore((s) => s.viewMode);
  const currentViewIndex = useWorkflowStore((s) => s.currentViewIndex);
  const setCurrentViewIndex = useWorkflowStore((s) => s.setCurrentViewIndex);
  const navigateView = useWorkflowStore((s) => s.navigateView);

  // Access denied state
  const accessDenied = useWorkflowStore((s) => s.accessDenied);

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

  // Auto-scroll to current interaction card when it changes (scroll mode)
  useEffect(() => {
    if (viewMode === "scroll" && currentInteraction && scrollToCardRef.current) {
      // Scroll to the current interaction card (last card in the list)
      const currentCardIndex = interactionsWithSteps.length;
      const timer = setTimeout(() => {
        scrollToCardRef.current?.(currentCardIndex, true);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [viewMode, currentInteraction, interactionsWithSteps.length]);

  // Auto-navigate to current card in single mode when new interaction arrives
  useEffect(() => {
    if (viewMode === "single" && currentInteraction) {
      // Navigate to the current interaction (last index)
      setCurrentViewIndex(totalCards - 1);
    }
  }, [viewMode, currentInteraction, totalCards, setCurrentViewIndex]);

  // Calculate max navigable index for single view
  const maxViewIndex = totalCards - 1;

  // Fetch workflow template/version IDs for editor link
  useEffect(() => {
    if (!workflowRunId) return;

    const fetchWorkflowInfo = async () => {
      try {
        const statusResponse = await api.getStatus(workflowRunId);
        setWorkflowTemplateId(statusResponse.workflow_template_id);
        setWorkflowVersionId(statusResponse.workflow_version_id);
      } catch (e) {
        // Silently ignore - editor link is optional
        console.debug("Failed to fetch workflow info for editor link", e);
      }
    };

    fetchWorkflowInfo();
  }, [workflowRunId]);

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

  // Handle sub-action completion - refresh display data
  const handleSubActionComplete = useCallback(() => {
    if (workflowRunId && currentInteraction?.interaction_id) {
      refreshInteractionDisplayData(workflowRunId, currentInteraction.interaction_id);
    }
  }, [workflowRunId, currentInteraction?.interaction_id, refreshInteractionDisplayData]);

  // Handle version confirmation cancel
  const handleCancelVersion = useCallback(() => {
    cancelVersionConfirmation();
  }, [cancelVersionConfirmation]);

  // Show access denied view if user doesn't have permission
  if (accessDenied) {
    return <AccessDeniedView onGoHome={handleExit} />;
  }

  return (
    <div className="container mx-auto px-4 pt-2 pb-4">
      <WorkflowStateProvider workflowRunId={workflowRunId}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left sidebar - Status */}
          <div className="lg:col-span-1 flex flex-col gap-4 h-[calc(100vh-5rem)] overflow-hidden">
            <div className="shrink-0">
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
                workflowTemplateId={workflowTemplateId}
                workflowVersionId={workflowVersionId}
                onCancel={handleExit}
                onRestart={handleRestart}
              />
            </div>

            {/* Runner guidance overlay (portal to body) */}
            <RunnerGuidanceOverlay />

            {/* State/Files tabs - fills remaining space */}
            <Tabs
              defaultValue="state"
              className="flex-1 min-h-0 overflow-hidden"
            >
              <TabsList className="w-full shrink-0">
                <TabsTrigger
                  data-guidance="state-tab"
                  value="state"
                  className="flex-1 gap-1.5"
                >
                  <Database className="h-4 w-4" />
                  State
                </TabsTrigger>
                <TabsTrigger
                  data-guidance="files-tab"
                  value="files"
                  className="flex-1 gap-1.5"
                >
                  <FolderTree className="h-4 w-4" />
                  Files
                </TabsTrigger>
              </TabsList>
              <TabsContent value="state" className="min-h-0 mt-0 flex flex-col overflow-hidden">
                <StateTreeView />
              </TabsContent>
              <TabsContent value="files" className="min-h-0 mt-0 flex flex-col overflow-hidden">
                <FilesTreeView />
              </TabsContent>
            </Tabs>
          </div>

          {/* Main content - Scroll or Single view mode */}
          <div data-guidance="interaction-panel" className="lg:col-span-2">
            {viewMode === "scroll" ? (
              /* Scroll mode - Magnetic scroll-snap interaction cards */
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
                      onSubActionComplete={handleSubActionComplete}
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
            ) : (
              /* Single view mode - One card at a time with overlay navigation */
              <div className="relative" style={{ height: "calc(100vh - 5rem)" }}>
                {/* Navigation overlay - positioned at top corners */}
                <div className="absolute inset-x-0 top-0 z-10 flex justify-between items-center px-3 py-2 pointer-events-none">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto shadow-md"
                    onClick={() => navigateView("prev", maxViewIndex)}
                    disabled={currentViewIndex === 0}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Prev
                  </Button>
                  <span className="text-sm text-muted-foreground bg-background/80 backdrop-blur px-3 py-1 rounded-full shadow-sm">
                    {currentViewIndex + 1} / {totalCards}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="pointer-events-auto shadow-md"
                    onClick={() => navigateView("next", maxViewIndex)}
                    disabled={currentViewIndex >= maxViewIndex}
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>

                {/* Card content - same height as scroll mode cards */}
                {/* Completed interaction */}
                {currentViewIndex < interactionsWithSteps.length && (
                  <div
                    key={interactionsWithSteps[currentViewIndex].interaction_id}
                    style={{ height: "calc(100vh - 5rem)" }}
                  >
                    <CompletedInteractionCard
                      interaction={interactionsWithSteps[currentViewIndex]}
                      stepName={interactionsWithSteps[currentViewIndex].isFirstInStep
                        ? (interactionsWithSteps[currentViewIndex].step_id || "unknown")
                        : undefined}
                      defaultExpanded={true}
                    />
                  </div>
                )}

                {/* Current interaction */}
                {currentViewIndex === interactionsWithSteps.length &&
                  pageState === "running" &&
                  currentInteraction &&
                  workflowRunId && (
                    <div style={{ height: "calc(100vh - 5rem)" }}>
                      <InteractionPanel
                        request={currentInteraction}
                        onSubmit={handleInteractionSubmit}
                        disabled={isProcessing}
                        onSubActionComplete={handleSubActionComplete}
                      />
                    </div>
                  )}

                {/* Processing/waiting state */}
                {currentViewIndex === interactionsWithSteps.length &&
                  pageState === "running" &&
                  !currentInteraction && (
                    <div style={{ height: "calc(100vh - 5rem)" }}>
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
                    </div>
                  )}

                {/* Completion/error states */}
                {currentViewIndex === interactionsWithSteps.length &&
                  (pageState === "completed" || pageState === "error") && (
                    <div style={{ height: "calc(100vh - 5rem)" }}>
                      <WorkflowCompletion status={pageState} error={error} />
                    </div>
                  )}
              </div>
            )}
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
