/**
 * Custom ReactFlow node for the workflow container.
 * 
 * This is the top-level node that represents the entire workflow.
 * It shows the workflow name and provides a visual anchor point.
 */

import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from "@wfm/shared";

// =============================================================================
// Types
// =============================================================================

export type WorkflowInfo = {
  workflow_id: string;
  name?: string;
  description?: string;
};

export type WorkflowNodeData = {
  workflow: WorkflowInfo;
  onWorkflowChange: (workflow: WorkflowInfo) => void;
};

// =============================================================================
// Workflow Edit Dialog
// =============================================================================

function WorkflowEditDialog({
  open,
  onOpenChange,
  workflow,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowInfo;
  onSave: (workflow: WorkflowInfo) => void;
}) {
  const [draft, setDraft] = useState<WorkflowInfo>(workflow);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setDraft(workflow);
    }
    onOpenChange(isOpen);
  };

  const handleSave = () => {
    onSave(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Workflow</DialogTitle>
          <DialogDescription>
            Configure the workflow identifier and metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="workflow-id">Workflow ID</Label>
            <Input
              id="workflow-id"
              value={draft.workflow_id}
              onChange={(e) =>
                setDraft({ ...draft, workflow_id: e.target.value })
              }
              placeholder="e.g., content_creation"
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier for this workflow.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflow-name">Name</Label>
            <Input
              id="workflow-name"
              value={draft.name ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, name: e.target.value || undefined })
              }
              placeholder="e.g., Content Creation Workflow"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="workflow-description">Description</Label>
            <Textarea
              id="workflow-description"
              value={draft.description ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  description: e.target.value || undefined,
                })
              }
              placeholder="What does this workflow do?"
              className="min-h-20"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Workflow Node Component
// =============================================================================

function WorkflowNodeComponent({ data }: NodeProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { workflow, onWorkflowChange } = data as unknown as WorkflowNodeData;

  const displayName = workflow.name || workflow.workflow_id || "Untitled Workflow";

  return (
    <>
      <div
        className="px-5 py-3 rounded-lg border-2 border-primary/50 bg-primary/5 cursor-pointer hover:border-primary transition-colors shadow-sm"
        onClick={() => setIsEditOpen(true)}
      >
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-primary" />
          <div>
            <h2 className="text-sm font-semibold">{displayName}</h2>
            {workflow.description && (
              <p className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate">
                {workflow.description}
              </p>
            )}
          </div>
        </div>

        {/* Output handle - connects to first step (right side for horizontal layout) */}
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-primary !w-3 !h-3"
          id="workflow-out"
        />
      </div>

      {/* Edit dialog */}
      <WorkflowEditDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        workflow={workflow}
        onSave={onWorkflowChange}
      />
    </>
  );
}

export const WorkflowNode = memo(WorkflowNodeComponent);
