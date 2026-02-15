/**
 * VirtualRuntimePanel - Slide-out panel for virtual execution results.
 *
 * This component:
 * - Opens automatically when execution starts (controlled by runtime)
 * - Shows loading state while request is in flight
 * - For UX requests: renders InteractionHost with virtual API client
 * - For non-UX requests: shows API response (excluding virtual_db and state)
 * - Has a close button but state is managed by the runtime
 */

import { useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  InteractionHost,
  RenderProvider,
  ApiClientProvider,
  Button,
  Badge,
  type InteractionRequest,
  type InteractionResponseData,
  type WorkflowDefinition,
} from "@wfm/shared";
import { Loader2, RefreshCw } from "lucide-react";
import type { RuntimeStatus, VirtualWorkflowResponse, CompletedInteraction } from "./types";
import { createVirtualApiClient } from "./virtualApiClient";

// =============================================================================
// Props
// =============================================================================

export interface VirtualRuntimePanelProps {
  /** Whether the panel is open */
  open: boolean;
  /** Called when panel should close */
  onOpenChange: (open: boolean) => void;
  /** Current runtime status */
  status: RuntimeStatus;
  /** Whether an operation is in progress */
  busy?: boolean;
  /** Server response */
  response: VirtualWorkflowResponse | null;
  /** Error message if status is "error" */
  error?: string | null;
  /** Called when user submits interaction response */
  onSubmit?: (response: InteractionResponseData) => void;
  /** Completed interaction data (for showing historical interactions in readonly mode) */
  completedInteraction?: CompletedInteraction | null;
  /** Whether mock mode is enabled (default: true) */
  mockMode?: boolean;
  /** Called when user wants to reload with different mock mode */
  onReloadWithMockMode?: (mockMode: boolean) => void;
  /** Get current virtualDb state (for virtual API client) */
  getVirtualDb?: () => string | null;
  /** Get current virtual run ID (for virtual API client) */
  getVirtualRunId?: () => string | null;
  /** Get current workflow definition (for virtual API client) */
  getWorkflow?: () => WorkflowDefinition | null;
  /** Called when virtualDb is updated by a sub-action */
  onVirtualDbUpdate?: (newVirtualDb: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function VirtualRuntimePanel({
  open,
  onOpenChange,
  status,
  busy = false,
  response,
  error,
  onSubmit,
  completedInteraction,
  mockMode = true,
  onReloadWithMockMode,
  getVirtualDb,
  getVirtualRunId,
  getWorkflow,
  onVirtualDbUpdate,
}: VirtualRuntimePanelProps) {
  const interactionRequest = response?.interaction_request as
    | InteractionRequest
    | undefined;
  const historicalInteractionRequest = completedInteraction?.request as
    | InteractionRequest
    | undefined;

  // Create virtual API client for this panel
  // Memoized to avoid recreating on every render
  const virtualApiClient = useMemo(() => {
    if (!getVirtualDb || !getVirtualRunId || !getWorkflow) {
      return null;
    }
    return createVirtualApiClient({
      getVirtualDb,
      getVirtualRunId,
      getWorkflow,
      onVirtualDbUpdate,
      getMockMode: () => mockMode,
    });
  }, [getVirtualDb, getVirtualRunId, getWorkflow, onVirtualDbUpdate, mockMode]);

  // Determine what type of content to show
  const previewRequest = interactionRequest ?? historicalInteractionRequest;
  const hasUxContent = status !== "error" && !!previewRequest;
  const isLiveInteraction = status === "awaiting_input" && !!interactionRequest;
  const hasNonUxResponse =
    (status === "completed" || status === "error") && response && !previewRequest;

  // Handle submit
  const handleSubmit = (responseData: InteractionResponseData) => {
    if (onSubmit && !busy) {
      onSubmit(responseData);
    }
  };

  // Build title based on status
  const getTitle = () => {
    if (busy || status === "running") return "Executing...";
    if (status === "awaiting_input") return "Interaction Required";
    if (status === "completed") return "Execution Complete";
    if (status === "error") return "Execution Error";
    return "Runtime Preview";
  };

  // Handle reload with different mode
  const handleReloadClick = () => {
    if (onReloadWithMockMode && !busy && status !== "running") {
      onReloadWithMockMode(!mockMode);
    }
  };

  // Show reload button only when we have completed and can toggle
  const canReload = onReloadWithMockMode && 
    (status === "completed" || status === "awaiting_input") && 
    !busy;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[60vw]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {(busy || status === "running") && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {getTitle()}
            {/* Mock/Real mode badge */}
            {(status === "completed" || status === "awaiting_input") && (
              <Badge 
                variant={mockMode ? "secondary" : "default"}
                className="ml-2 text-xs"
              >
                {mockMode ? "Mock Data" : "Real Data"}
              </Badge>
            )}
            {/* Reload button to toggle mode */}
            {canReload && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 text-xs"
                onClick={handleReloadClick}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                {mockMode ? "Use Real Data" : "Use Mock Data"}
              </Button>
            )}
          </SheetTitle>
        </SheetHeader>

        <SheetBody>
          {/* Loading state */}
          {(busy || status === "running") && !hasUxContent && (
            <LoadingContent />
          )}

          {/* Error display */}
          {status === "error" && error && <ErrorContent error={error} />}

          {/* UX Interaction display (live, awaiting input) */}
          {hasUxContent && (
            <UxContent
              request={previewRequest}
              busy={busy || !isLiveInteraction}
              onSubmit={handleSubmit}
              mockMode={mockMode}
              virtualApiClient={virtualApiClient}
            />
          )}

          {/* Non-UX Response display */}
          {hasNonUxResponse && !hasUxContent && status !== "error" && (
            <NonUxContent response={response} />
          )}

          {/* Idle state */}
          {status === "idle" && <IdleContent />}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

// =============================================================================
// Content Components
// =============================================================================

function LoadingContent() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="h-8 w-8 animate-spin mb-4" />
      <p className="text-sm">Running module...</p>
    </div>
  );
}

function ErrorContent({ error }: { error: string }) {
  return (
    <div className="rounded border border-destructive/50 bg-destructive/10 p-4">
      <p className="font-medium text-destructive mb-2">Error</p>
      <p className="text-sm text-destructive/80">{error}</p>
    </div>
  );
}

interface UxContentProps {
  request: InteractionRequest;
  busy: boolean;
  onSubmit: (response: InteractionResponseData) => void;
  mockMode?: boolean;
  virtualApiClient?: import("@wfm/shared").ApiClientInterface | null;
}

function UxContent({ request, busy, onSubmit, mockMode = true, virtualApiClient }: UxContentProps) {
  const content = (
    <RenderProvider value={{ debugMode: false, readonly: false, mockMode }}>
      <InteractionHost disabled={busy} onSubmit={onSubmit} request={request} mockMode={mockMode} />
    </RenderProvider>
  );

  // Wrap with ApiClientProvider if virtual client is available
  if (virtualApiClient) {
    return (
      <ApiClientProvider client={virtualApiClient}>
        {content}
      </ApiClientProvider>
    );
  }

  return content;
}
function NonUxContent({ response }: { response: VirtualWorkflowResponse }) {
  // Filter out virtual_db and state from the response
  const displayResponse = filterResponse(response);

  return (
    <div className="space-y-4">
      <div className="rounded border bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
        Module completed successfully
      </div>

      {Object.keys(displayResponse).length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Response</p>
          <pre className="rounded bg-muted p-3 text-xs overflow-auto max-h-[400px]">
            {JSON.stringify(displayResponse, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function IdleContent() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <p className="text-sm">Run a module to see the preview</p>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Filter out virtual_db and state from response for display.
 */
function filterResponse(
  response: VirtualWorkflowResponse
): Record<string, unknown> {
  const rest = { ...response } as Record<string, unknown>;
  delete rest.virtual_db;
  delete rest.state;
  return rest;
}
