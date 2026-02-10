/**
 * ExecutionStatus - Displays workflow execution progress and status.
 *
 * Shows:
 * - Current step/module being executed
 * - Processing indicator
 * - Elapsed time
 * - Dynamic status fields from workflow config
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import { Badge } from "../../components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, Zap } from "lucide-react";
import type { WorkflowStatus, WorkflowProgress } from "../../types/index";

interface StatusDisplayField {
  id: string;
  label: string;
  value: string;
}

interface ExecutionStatusProps {
  status: WorkflowStatus | null;
  progress: WorkflowProgress | null;
  isProcessing: boolean;
  elapsedMs: number;
  lastMessage: string | null;
  error: string | null;
  statusDisplayFields?: StatusDisplayField[];
}

function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `0:${remainingSeconds.toString().padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: WorkflowStatus | null }) {
  if (!status) return null;

  const variants: Record<WorkflowStatus, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode; label: string }> = {
    created: { variant: "secondary", icon: <Clock className="w-3 h-3" />, label: "Created" },
    processing: { variant: "default", icon: <Loader2 className="w-3 h-3 animate-spin" />, label: "Processing" },
    awaiting_input: { variant: "outline", icon: <Zap className="w-3 h-3" />, label: "Awaiting Input" },
    completed: { variant: "secondary", icon: <CheckCircle2 className="w-3 h-3 text-green-500" />, label: "Completed" },
    target_reached: { variant: "secondary", icon: <CheckCircle2 className="w-3 h-3 text-green-500" />, label: "Target Reached" },
    error: { variant: "destructive", icon: <XCircle className="w-3 h-3" />, label: "Error" },
    validation_failed: { variant: "destructive", icon: <XCircle className="w-3 h-3" />, label: "Validation Failed" },
  };

  const config = variants[status];

  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function ExecutionStatus({
  status,
  progress,
  isProcessing,
  elapsedMs,
  lastMessage,
  error,
  statusDisplayFields = [],
}: ExecutionStatusProps) {
  // Local elapsed time that updates every second when processing
  const [displayElapsed, setDisplayElapsed] = useState(elapsedMs);

  useEffect(() => {
    setDisplayElapsed(elapsedMs);
  }, [elapsedMs]);

  useEffect(() => {
    if (!isProcessing) return;

    const interval = setInterval(() => {
      setDisplayElapsed((prev) => prev + 1000);
    }, 1000);

    return () => clearInterval(interval);
  }, [isProcessing]);

  const progressPercent = progress
    ? Math.round((progress.step_index / progress.total_steps) * 100)
    : 0;

  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Execution Status</CardTitle>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress section */}
        {progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Step {progress.step_index + 1} of {progress.total_steps}
              </span>
              <span className="font-medium">{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
            {progress.current_step && (
              <p className="text-sm text-muted-foreground truncate">
                {progress.current_step}
              </p>
            )}
          </div>
        )}

        {/* Elapsed time and message */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>{formatElapsedTime(displayElapsed)}</span>
          </div>
          {isProcessing && lastMessage && (
            <span className="text-muted-foreground truncate max-w-[200px]">
              {lastMessage}
            </span>
          )}
        </div>

        {/* Dynamic status fields */}
        {statusDisplayFields.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-2 border-t">
            {statusDisplayFields.map((field) => (
              <div key={field.id} className="text-sm">
                <span className="text-muted-foreground">{field.label}: </span>
                <span className="font-medium">{field.value || "-"}</span>
              </div>
            ))}
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
