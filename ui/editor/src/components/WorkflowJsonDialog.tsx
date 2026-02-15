/**
 * Workflow JSON Dialog Component.
 *
 * Displays the full workflow definition as read-only JSON.
 */

import Editor from "@monaco-editor/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  type StepDefinition,
} from "@wfm/shared";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

export type WorkflowJsonDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  workflowName: string;
  workflowDescription?: string;
  steps: StepDefinition[];
  versionId?: string | null;
};

export function WorkflowJsonDialog({
  open,
  onOpenChange,
  workflowId,
  workflowName,
  workflowDescription,
  steps,
  versionId,
}: WorkflowJsonDialogProps) {
  const monacoTheme = useMonacoTheme();
  const workflowJson = JSON.stringify(
    {
      workflow_id: workflowId,
      name: workflowName,
      description: workflowDescription,
      steps,
    },
    null,
    2
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col p-0"
        style={{ width: "80vw", height: "80vh", maxWidth: "80vw", maxHeight: "80vh" }}
      >
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>
            Full Workflow Definition
            {versionId && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (v: {versionId.slice(0, 8)}...)
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 px-2 pb-2">
          <Editor
            height="100%"
            defaultLanguage="json"
            value={workflowJson}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              folding: true,
              wordWrap: "on",
              automaticLayout: true,
            }}
            theme={monacoTheme}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
