/**
 * WorkflowSidebar - Sidebar for workflow execution status display.
 *
 * Shows:
 * - Execution status (progress, elapsed time, messages)
 * - Action buttons (cancel, start new)
 * - Project info (project name, run ID)
 */

import { LogOut, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExecutionStatus } from "./ExecutionStatus";
import type { WorkflowProgress, WorkflowStatus } from "@/core/types";

// =============================================================================
// Types
// =============================================================================

interface StatusDisplayField {
  id: string;
  label: string;
  value: string;
}

type PageState = "running" | "completed" | "error";

interface WorkflowSidebarProps {
  /** Current page state */
  pageState: PageState;
  /** Workflow status */
  status: WorkflowStatus | null;
  /** Workflow progress info */
  progress: WorkflowProgress | null;
  /** Whether workflow is currently processing */
  isProcessing: boolean;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** Last status message */
  lastMessage: string;
  /** Error message if any */
  error: string | null;
  /** Dynamic status display fields */
  statusDisplayFields: StatusDisplayField[];
  /** Project name */
  projectName: string;
  /** Workflow run ID */
  workflowRunId: string;
  /** Called when cancel button is clicked */
  onCancel: () => void;
  /** Called when start new button is clicked */
  onRestart: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowSidebar({
  pageState,
  status,
  progress,
  isProcessing,
  elapsedMs,
  lastMessage,
  error,
  statusDisplayFields,
  projectName,
  workflowRunId,
  onCancel,
  onRestart,
}: WorkflowSidebarProps) {
  return (
    <div className="space-y-4">
      {/* Execution Status */}
      <ExecutionStatus
        status={status}
        progress={progress}
        isProcessing={isProcessing}
        elapsedMs={elapsedMs}
        lastMessage={lastMessage}
        error={error}
        statusDisplayFields={statusDisplayFields}
      />

      {/* Action buttons */}
      <div className="flex gap-2">
        {/* Exit button - always available */}
        <Button variant="outline" onClick={onCancel} size="sm">
          <LogOut className="mr-2 h-4 w-4" />
          Exit
        </Button>
        {/* Start New button - only when workflow finished */}
        {(pageState === "completed" || pageState === "error") && (
          <Button variant="outline" onClick={onRestart} size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Start New
          </Button>
        )}
      </div>

      {/* Project info */}
      <Card className="gap-0 pb-0">
        <CardContent className="pb-3">
          <div className="text-sm space-y-1">
            <div>
              <span className="text-muted-foreground">Project: </span>
              <span className="font-mono">{projectName}</span>
            </div>
            {workflowRunId && (
              <div>
                <span className="text-muted-foreground">Run ID: </span>
                <span className="font-mono text-xs">{workflowRunId}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
