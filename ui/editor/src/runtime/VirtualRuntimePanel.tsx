/**
 * VirtualRuntimePanel - Slide-out panel for virtual execution results.
 *
 * This component:
 * - Opens automatically when execution starts (controlled by runtime)
 * - Shows loading state while request is in flight
 * - For UX requests: renders InteractionHost
 * - For non-UX requests: shows API response (excluding virtual_db and state)
 * - Has a close button but state is managed by the runtime
 */

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  InteractionHost,
  RenderProvider,
  type InteractionRequest,
  type InteractionResponseData,
} from "@wfm/shared";
import { Loader2 } from "lucide-react";
import type { RuntimeStatus, VirtualWorkflowResponse } from "./types";

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
}: VirtualRuntimePanelProps) {
  const interactionRequest = response?.interaction_request as
    | InteractionRequest
    | undefined;

  // Determine what type of content to show
  const hasUxContent = status === "awaiting_input" && interactionRequest;
  const hasNonUxResponse =
    (status === "completed" || status === "error") && response;

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[60vw]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {(busy || status === "running") && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {getTitle()}
          </SheetTitle>
        </SheetHeader>

        <SheetBody>
          {/* Loading state */}
          {(busy || status === "running") && !hasUxContent && (
            <LoadingContent />
          )}

          {/* Error display */}
          {status === "error" && error && <ErrorContent error={error} />}

          {/* UX Interaction display */}
          {hasUxContent && (
            <UxContent
              request={interactionRequest}
              busy={busy}
              onSubmit={handleSubmit}
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
}

function UxContent({ request, busy, onSubmit }: UxContentProps) {
  return (
    <RenderProvider value={{ debugMode: false, readonly: false }}>
      <InteractionHost disabled={busy} onSubmit={onSubmit} request={request} />
    </RenderProvider>
  );
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
  const { virtual_db: _vdb, state: _state, ...rest } = response;
  return rest;
}
