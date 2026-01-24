/**
 * WorkflowRunsList - List of past workflow runs with resume functionality.
 *
 * Features:
 * - Display workflow runs with status icons
 * - Resume workflow button
 * - Resume with updated template (expandable upload panel)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2,
  Play,
  Upload,
  Archive,
  FileJson,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Pause,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";
import JSZip from "jszip";

// =============================================================================
// Types
// =============================================================================

export interface WorkflowRun {
  workflow_run_id: string;
  project_name: string;
  workflow_template_name: string;
  status: string;
  current_step: string | null;
  current_step_name: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

type UploadedFileType = "json" | "zip" | null;

interface WorkflowRunsListProps {
  /** Called when user clicks resume on a run */
  onResume: (run: WorkflowRun) => void;
  /** Called when user wants to resume with an updated template */
  onResumeWithUpdate: (
    run: WorkflowRun,
    content: string,
    entryPoint?: string
  ) => Promise<void>;
  /** Whether actions are disabled */
  disabled?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "awaiting_input":
      return <Pause className="h-4 w-4 text-yellow-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  }
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMins > 0) return `${diffMins}m ago`;
  return "just now";
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowRunsList({
  onResume,
  onResumeWithUpdate,
  disabled,
}: WorkflowRunsListProps) {
  // Workflow runs state
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Expanded run state (for resume with update)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  // Upload state for expanded panel
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedFileType, setUploadedFileType] = useState<UploadedFileType>(null);
  const [uploadedContent, setUploadedContent] = useState<string | null>(null);
  const [zipJsonFiles, setZipJsonFiles] = useState<string[]>([]);
  const [entryPoint, setEntryPoint] = useState("");
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch workflow runs on mount
  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const response = await api.listWorkflowRuns(50);
        setRuns(response.workflows);
      } catch (e) {
        console.error("Failed to fetch workflow runs", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchRuns();
  }, []);

  // Clear upload state
  const clearUpload = useCallback(() => {
    setUploadedFile(null);
    setUploadedFileType(null);
    setUploadedContent(null);
    setZipJsonFiles([]);
    setEntryPoint("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  // Toggle run expansion
  const toggleExpand = useCallback(
    (runId: string) => {
      if (expandedRunId === runId) {
        setExpandedRunId(null);
        clearUpload();
      } else {
        setExpandedRunId(runId);
        clearUpload();
      }
    },
    [expandedRunId, clearUpload]
  );

  // Process uploaded file
  const processFile = useCallback(async (file: File) => {
    setIsProcessingFile(true);
    setUploadedFile(file);
    setZipJsonFiles([]);
    setEntryPoint("");

    try {
      if (file.name.endsWith(".json")) {
        const text = await file.text();
        JSON.parse(text); // Validate
        setUploadedFileType("json");
        setUploadedContent(text);
      } else if (file.name.endsWith(".zip")) {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);

        const allFiles: string[] = [];
        zip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir) {
            allFiles.push(relativePath.replace(/\\/g, "/"));
          }
        });

        let rootJsonFiles = allFiles.filter(
          (path) => path.endsWith(".json") && !path.includes("/")
        );

        if (rootJsonFiles.length === 0 && allFiles.length > 0) {
          const firstFile = allFiles[0];
          const firstSlashIndex = firstFile.indexOf("/");
          if (firstSlashIndex > 0) {
            const possiblePrefix = firstFile.substring(0, firstSlashIndex + 1);
            const allSharePrefix = allFiles.every((f) =>
              f.startsWith(possiblePrefix)
            );
            if (allSharePrefix) {
              rootJsonFiles = allFiles.filter((path) => {
                const relPath = path.substring(possiblePrefix.length);
                return relPath.endsWith(".json") && !relPath.includes("/");
              });
            }
          }
        }

        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ""
          )
        );

        setUploadedFileType("zip");
        setUploadedContent(base64);
        setZipJsonFiles(rootJsonFiles);

        if (rootJsonFiles.length === 1) {
          setEntryPoint(rootJsonFiles[0]);
        }
      } else {
        throw new Error("Please upload a .json or .zip file");
      }
    } catch (err) {
      console.error("Failed to process file", err);
      setUploadedFile(null);
      setUploadedFileType(null);
      setUploadedContent(null);
    } finally {
      setIsProcessingFile(false);
    }
  }, []);

  // Handle file input change
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  // Drag handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  // Handle resume with update
  const handleResumeWithUpdate = useCallback(
    async (run: WorkflowRun) => {
      if (!uploadedContent) return;
      if (uploadedFileType === "zip" && !entryPoint.trim()) return;

      setIsResuming(true);
      try {
        await onResumeWithUpdate(
          run,
          uploadedFileType === "json"
            ? uploadedContent
            : uploadedContent,
          uploadedFileType === "zip" ? entryPoint.trim() : undefined
        );
        setExpandedRunId(null);
        clearUpload();
      } catch (err) {
        console.error("Failed to resume with update", err);
      } finally {
        setIsResuming(false);
      }
    },
    [uploadedContent, uploadedFileType, entryPoint, onResumeWithUpdate, clearUpload]
  );

  // Check if resume button should be disabled
  const isResumeDisabled =
    isResuming ||
    isProcessingFile ||
    !uploadedContent ||
    (uploadedFileType === "zip" && !entryPoint.trim());

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">
          Loading workflow runs...
        </span>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No workflow runs found. Start a new workflow to see it here.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-2 max-h-[400px] overflow-y-auto">
      {runs.map((run) => {
        const isExpanded = expandedRunId === run.workflow_run_id;

        return (
          <div key={run.workflow_run_id} className="rounded-lg border">
            {/* Run info row */}
            <div className="flex items-center gap-3 p-3">
              {getStatusIcon(run.status)}
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{run.project_name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {run.workflow_template_name}
                  {run.current_step_name && ` • ${run.current_step_name}`}
                </p>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mr-2">
                <Clock className="h-3 w-3" />
                {getTimeAgo(run.updated_at)}
              </div>
              {/* Action buttons */}
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Resume workflow"
                  onClick={() => onResume(run)}
                  disabled={disabled}
                >
                  <Play className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Resume with updated template"
                  onClick={() => toggleExpand(run.workflow_run_id)}
                  disabled={disabled}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* Expandable upload panel */}
            {isExpanded && (
              <div className="border-t p-3 bg-muted/30 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Upload a new template to resume this workflow with updated
                  steps
                </p>

                {/* File upload zone */}
                {!uploadedFile ? (
                  <div
                    className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-muted-foreground/50"
                    }`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,.zip"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Upload
                      className={`h-6 w-6 mx-auto mb-1 ${
                        isDragging ? "text-primary" : "text-muted-foreground"
                      }`}
                    />
                    <p className="text-sm">
                      {isDragging ? "Drop file here" : "Drop or click to upload"}
                    </p>
                    <p className="text-xs text-muted-foreground">.json or .zip</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Uploaded file info */}
                    <div className="flex items-center gap-2 p-2 rounded border bg-background">
                      {uploadedFileType === "zip" ? (
                        <Archive className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <FileJson className="h-5 w-5 text-muted-foreground" />
                      )}
                      <span className="flex-1 text-sm truncate">
                        {uploadedFile.name}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearUpload}
                        disabled={isResuming}
                      >
                        Change
                      </Button>
                    </div>

                    {/* Entry point for zip */}
                    {uploadedFileType === "zip" && (
                      <div className="space-y-1">
                        <Label className="text-xs">Entry Point</Label>
                        <Input
                          list="run-json-files-list"
                          placeholder="e.g., workflow.json"
                          value={entryPoint}
                          onChange={(e) => setEntryPoint(e.target.value)}
                          disabled={isResuming}
                          className="h-8 text-sm"
                        />
                        {zipJsonFiles.length > 0 && (
                          <datalist id="run-json-files-list">
                            {zipJsonFiles.map((file) => (
                              <option key={file} value={file} />
                            ))}
                          </datalist>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {isProcessingFile && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    <span className="ml-2 text-sm text-muted-foreground">
                      Processing...
                    </span>
                  </div>
                )}

                {/* Resume button */}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setExpandedRunId(null);
                      clearUpload();
                    }}
                    disabled={isResuming}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleResumeWithUpdate(run)}
                    disabled={isResumeDisabled}
                  >
                    {isResuming ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Resuming...
                      </>
                    ) : (
                      <>
                        <Play className="mr-1 h-3 w-3" />
                        Resume with Update
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
