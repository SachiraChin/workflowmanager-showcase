/**
 * WorkflowCompletion - Display component for completed/error workflow states.
 */

import { Card, CardContent } from "@/components/ui/card";

// =============================================================================
// Types
// =============================================================================

type CompletionStatus = "completed" | "error";

interface WorkflowCompletionProps {
  /** Completion status */
  status: CompletionStatus;
  /** Error message (only for error status) */
  error?: string | null;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowCompletion({ status, error }: WorkflowCompletionProps) {
  if (status === "completed") {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center py-12">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mb-4">
              <svg
                className="h-6 w-6 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold">Workflow Completed</h3>
            <p className="text-muted-foreground mt-1">
              All steps have been executed successfully
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center py-12">
          <div className="h-12 w-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mb-4">
            <svg
              className="h-6 w-6 text-red-600 dark:text-red-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold">Workflow Error</h3>
          {error && (
            <p className="text-muted-foreground mt-1 text-center max-w-md">
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
