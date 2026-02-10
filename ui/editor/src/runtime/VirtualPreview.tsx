/**
 * VirtualPreview - Standalone component for rendering virtual execution results.
 *
 * This component can display:
 * - Interaction requests (when awaiting input)
 * - Current state (module outputs)
 * - Error states
 *
 * It is NOT connected to the runtime - the parent component passes in props.
 * This allows it to be used in different contexts (module editor, side panel, etc).
 */

import {
  InteractionHost,
  RenderProvider,
  type InteractionRequest,
  type InteractionResponseData,
} from "@wfm/shared";
import type { RuntimeStatus, VirtualWorkflowResponse } from "./types";

// =============================================================================
// Props
// =============================================================================

export interface VirtualPreviewProps {
  /** Current runtime status */
  status: RuntimeStatus;
  /** Whether an operation is in progress */
  busy?: boolean;
  /** Server response containing interaction request and state */
  response: VirtualWorkflowResponse | null;
  /** Error message if status is "error" */
  error?: string | null;
  /** Called when user submits interaction response */
  onSubmit?: (response: InteractionResponseData) => void;
  /** Called when user cancels interaction */
  onCancel?: () => void;
  /** Whether to show state panel */
  showState?: boolean;
  /** Whether interactions are in readonly mode */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function VirtualPreview({
  status,
  busy = false,
  response,
  error,
  onSubmit,
  onCancel: _onCancel,
  showState = false,
  readonly = false,
}: VirtualPreviewProps) {
  const interactionRequest = response?.interaction_request as
    | InteractionRequest
    | undefined;
  const state = response?.state;

  // Handle submit
  const handleSubmit = (responseData: InteractionResponseData) => {
    if (onSubmit && !busy && !readonly) {
      onSubmit(responseData);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Status indicator */}
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">Status:</span>
        <StatusBadge status={status} busy={busy} />
      </div>

      {/* Error display */}
      {status === "error" && error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">Error</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {/* Interaction display */}
      {status === "awaiting_input" && interactionRequest && (
        <div className="rounded border bg-card p-3">
          <RenderProvider value={{ debugMode: false, readonly }}>
            <InteractionHost
              disabled={busy || readonly}
              onSubmit={handleSubmit}
              request={interactionRequest}
            />
          </RenderProvider>
        </div>
      )}

      {/* Idle/completed message */}
      {status === "idle" && (
        <div className="rounded border bg-muted/50 p-4 text-center text-sm text-muted-foreground">
          Run a module to see the preview
        </div>
      )}

      {status === "completed" && !interactionRequest && (
        <div className="rounded border bg-emerald-50 p-4 text-center text-sm text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
          Module completed successfully
        </div>
      )}

      {/* State display */}
      {showState && state && Object.keys(state).length > 0 && (
        <div className="rounded border bg-card p-3">
          <p className="mb-2 text-sm font-medium">State</p>
          <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(state, null, 2)}
          </pre>
        </div>
      )}

      {/* Progress info */}
      {response?.progress && (
        <div className="text-xs text-muted-foreground">
          <span>
            Step: {response.progress.current_step ?? "-"} / Module:{" "}
            {response.progress.current_module ?? "-"}
          </span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helper Components
// =============================================================================

interface StatusBadgeProps {
  status: RuntimeStatus;
  busy: boolean;
}

function StatusBadge({ status, busy }: StatusBadgeProps) {
  if (busy) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
        Running
      </span>
    );
  }

  switch (status) {
    case "idle":
      return (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          Idle
        </span>
      );
    case "running":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
          Running
        </span>
      );
    case "awaiting_input":
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Awaiting Input
        </span>
      );
    case "completed":
      return (
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          Completed
        </span>
      );
    case "error":
      return (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
          Error
        </span>
      );
    default:
      return (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {status}
        </span>
      );
  }
}
