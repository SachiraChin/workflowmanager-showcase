/**
 * WorkflowStartPage - Landing page for starting workflows.
 *
 * Provides three ways to start a workflow:
 * 1. Upload - Drag and drop JSON/ZIP file
 * 2. Template - Select from stored templates
 * 3. History - Resume from previous runs
 */

import { useState, useCallback, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Play, Upload, FileJson, History } from "lucide-react";
import {
  WorkflowUploader,
  type UploadedWorkflow,
} from "@/features/workflow-start/WorkflowUploader";
import { TemplateSelector } from "@/features/workflow-start/TemplateSelector";
import {
  WorkflowRunsList,
  type WorkflowRun,
} from "@/features/workflow-start/WorkflowRunsList";
import { VersionDiffDialog } from "@/features/workflow-start/VersionDiffDialog";
import { useWorkflowExecution } from "@/state/hooks/useWorkflowExecution";
import { api } from "@/core/api";

// =============================================================================
// Types
// =============================================================================

type WorkflowSource = "upload" | "template" | "runs";

interface WorkflowStartPageProps {
  /** Called when a workflow has been started */
  onWorkflowStarted?: (workflowRunId: string) => void;
}

// =============================================================================
// Component
// =============================================================================

export function WorkflowStartPage({ onWorkflowStarted }: WorkflowStartPageProps) {
  // Form state
  const [projectName, setProjectName] = useState("");
  const [workflowSource, setWorkflowSource] = useState<WorkflowSource>("upload");

  // Upload state
  const [uploadedWorkflow, setUploadedWorkflow] = useState<UploadedWorkflow | null>(null);

  // Template state - stores the selected workflow_version_id
  const [selectedVersionId, setSelectedVersionId] = useState("");

  // UI state
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [isConfirmingVersion, setIsConfirmingVersion] = useState(false);
  const [lastProjectName, setLastProjectName] = useState<string | null>(null);

  // Fetch last project name on mount
  useEffect(() => {
    const fetchLastProjectName = async () => {
      try {
        const response = await api.listWorkflowRuns(1, 0);
        if (response.workflows.length > 0) {
          setLastProjectName(response.workflows[0].project_name);
        }
      } catch (e) {
        // Silently ignore - this is just a hint
      }
    };
    fetchLastProjectName();
  }, []);

  // Workflow execution hook
  const {
    startWorkflow,
    startWorkflowByVersion,
    resumeWorkflow,
    resumeWithUpdate,
    versionConfirmation,
    confirmVersionAndResume,
    cancelVersionConfirmation,
  } = useWorkflowExecution();

  // Handle workflow start
  const handleStart = useCallback(async () => {
    if (!projectName.trim()) {
      setStartError("Project name is required");
      return;
    }

    if (workflowSource === "template") {
      if (!selectedVersionId) {
        setStartError("Please select a workflow version");
        return;
      }
    } else if (workflowSource === "upload") {
      if (!uploadedWorkflow) {
        setStartError("Please upload a workflow file");
        return;
      }
      if (uploadedWorkflow.fileType === "zip" && !uploadedWorkflow.entryPoint.trim()) {
        setStartError("Please select or enter an entry point for the zip file");
        return;
      }
    }

    setIsStarting(true);
    setStartError(null);

    try {
      let result: unknown;

      if (workflowSource === "template") {
        result = await startWorkflowByVersion(selectedVersionId, {
          project_name: projectName.trim(),
          force_new: false,
        });
      } else if (workflowSource === "upload" && uploadedWorkflow) {
        if (uploadedWorkflow.fileType === "json") {
          const jsonContent = JSON.parse(uploadedWorkflow.content);
          result = await startWorkflow({
            project_name: projectName.trim(),
            workflow_content: jsonContent,
            force_new: false,
          });
        } else {
          result = await startWorkflow({
            project_name: projectName.trim(),
            workflow_content: uploadedWorkflow.content,
            workflow_entry_point: uploadedWorkflow.entryPoint.trim(),
            force_new: false,
          });
        }
      }

      // If we got a result with a valid workflow_run_id (and no confirmation required), notify parent
      if (result && typeof result === "object") {
        const r = result as { workflow_run_id?: string; result?: { requires_confirmation?: boolean } };
        // Only navigate if we have a workflow_run_id AND no confirmation is required
        if (r.workflow_run_id && !r.result?.requires_confirmation) {
          onWorkflowStarted?.(r.workflow_run_id);
        }
      }
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setIsStarting(false);
    }
  }, [
    projectName,
    workflowSource,
    selectedVersionId,
    uploadedWorkflow,
    startWorkflow,
    onWorkflowStarted,
  ]);

  // Handle resume from history
  const handleResume = useCallback(
    async (run: WorkflowRun) => {
      try {
        await resumeWorkflow(run.workflow_run_id, run.project_name);
        onWorkflowStarted?.(run.workflow_run_id);
      } catch (e) {
        setStartError((e as Error).message);
      }
    },
    [resumeWorkflow, onWorkflowStarted]
  );

  // Handle resume with updated template
  const handleResumeWithUpdate = useCallback(
    async (run: WorkflowRun, content: string, entryPoint?: string) => {
      setIsStarting(true);
      setStartError(null);

      try {
        let result: unknown;

        if (entryPoint) {
          // ZIP file - content is base64 encoded
          result = await resumeWithUpdate(run.workflow_run_id, content, entryPoint);
        } else {
          // JSON file - parse and send as object
          const jsonContent = JSON.parse(content);
          result = await resumeWithUpdate(run.workflow_run_id, jsonContent);
        }

        // Only navigate if we got a valid workflow_run_id and no confirmation required
        if (result && typeof result === "object") {
          const r = result as { workflow_run_id?: string; result?: { requires_confirmation?: boolean } };
          if (r.workflow_run_id && !r.result?.requires_confirmation) {
            onWorkflowStarted?.(r.workflow_run_id);
          }
        }
      } catch (e) {
        setStartError((e as Error).message);
        throw e; // Re-throw so WorkflowRunsList knows it failed
      } finally {
        setIsStarting(false);
      }
    },
    [resumeWithUpdate, onWorkflowStarted]
  );

  // Handle upload error
  const handleUploadError = useCallback((error: string) => {
    setStartError(error);
  }, []);

  // Handle version confirmation (works for both /start and /resume flows)
  const handleConfirmVersion = useCallback(async () => {
    setIsConfirmingVersion(true);
    try {
      const result = await confirmVersionAndResume();
      if (result && typeof result === "object" && "workflow_run_id" in result) {
        onWorkflowStarted?.((result as { workflow_run_id: string }).workflow_run_id);
      }
    } catch (e) {
      setStartError((e as Error).message);
    } finally {
      setIsConfirmingVersion(false);
    }
  }, [confirmVersionAndResume, onWorkflowStarted]);

  // Check if start button should be disabled
  const isStartDisabled = (() => {
    if (isStarting) return true;
    if (!projectName.trim()) return true;
    if (workflowSource === "template") {
      return !selectedVersionId;
    } else if (workflowSource === "upload") {
      if (!uploadedWorkflow) return true;
      if (uploadedWorkflow.fileType === "zip" && !uploadedWorkflow.entryPoint.trim()) {
        return true;
      }
      return false;
    }
    return false;
  })();

  return (
    <div className="container mx-auto p-4 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Start Workflow</CardTitle>
          <CardDescription>
            Upload a workflow file or select an existing template
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={workflowSource}
            onValueChange={(v) => setWorkflowSource(v as WorkflowSource)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="template" className="flex items-center gap-2">
                <FileJson className="h-4 w-4" />
                Template
              </TabsTrigger>
              <TabsTrigger value="runs" className="flex items-center gap-2">
                <History className="h-4 w-4" />
                History
              </TabsTrigger>
            </TabsList>

            {/* Upload Tab */}
            <TabsContent value="upload" className="space-y-4 mt-4">
              <WorkflowUploader
                value={uploadedWorkflow}
                onChange={setUploadedWorkflow}
                onError={handleUploadError}
                disabled={isStarting}
              />
            </TabsContent>

            {/* Template Tab */}
            <TabsContent value="template" className="space-y-4 mt-4">
              <TemplateSelector
                value={selectedVersionId}
                onChange={setSelectedVersionId}
                disabled={isStarting}
              />
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="runs" className="space-y-4 mt-4">
              <WorkflowRunsList
                onResume={handleResume}
                onResumeWithUpdate={handleResumeWithUpdate}
                disabled={isStarting}
              />
            </TabsContent>
          </Tabs>

          {/* Project name and start button - only for upload/template tabs */}
          {workflowSource !== "runs" && (
            <>
              <div className="space-y-2 pt-2 border-t">
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  placeholder="my-project-001"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isStartDisabled) {
                      handleStart();
                    }
                  }}
                  disabled={isStarting}
                />
                <p className="text-xs text-muted-foreground">
                  A unique identifier for this workflow run
                  {lastProjectName && (
                    <span className="block mt-1">
                      Last project name: <span className="font-medium">{lastProjectName}</span>
                    </span>
                  )}
                </p>
              </div>

              {startError && (
                <Alert variant="destructive">
                  <AlertDescription>{startError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2">
                <Button onClick={handleStart} disabled={isStartDisabled}>
                  {isStarting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Starting...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Start Workflow
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Version Confirmation Dialog */}
      {versionConfirmation.pending && versionConfirmation.diff && (
        <VersionDiffDialog
          open={versionConfirmation.pending}
          onOpenChange={(open) => !open && cancelVersionConfirmation()}
          diff={versionConfirmation.diff}
          oldHash={versionConfirmation.oldHash}
          newHash={versionConfirmation.newHash}
          onConfirm={handleConfirmVersion}
          onCancel={cancelVersionConfirmation}
          isLoading={isConfirmingVersion}
        />
      )}
    </div>
  );
}
