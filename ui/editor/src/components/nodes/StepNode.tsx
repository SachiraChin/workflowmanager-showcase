/**
 * Custom ReactFlow node for workflow steps.
 * 
 * A step is a container that holds one or more modules.
 * It has a subtle border and a small header bar with the step name.
 * Clicking the header opens a dialog to edit step info.
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
import type { StepDefinition } from "@wfm/shared";

// =============================================================================
// Types
// =============================================================================

export type StepNodeData = {
  step: StepDefinition;
  onStepChange: (step: StepDefinition) => void;
  /** Width of the step container */
  width: number;
  /** Height of the step container */
  height: number;
};

// =============================================================================
// Step Info Edit Dialog
// =============================================================================

function StepEditDialog({
  open,
  onOpenChange,
  step,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: StepDefinition;
  onSave: (step: StepDefinition) => void;
}) {
  const [draftStep, setDraftStep] = useState<StepDefinition>(step);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setDraftStep(step);
    }
    onOpenChange(isOpen);
  };

  const handleSave = () => {
    onSave(draftStep);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Step</DialogTitle>
          <DialogDescription>
            Configure the step identifier and metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="step-id">Step ID</Label>
            <Input
              id="step-id"
              value={draftStep.step_id}
              onChange={(e) =>
                setDraftStep({ ...draftStep, step_id: e.target.value })
              }
              placeholder="e.g., 1_user_input"
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier for this step in the workflow.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="step-name">Name</Label>
            <Input
              id="step-name"
              value={draftStep.name ?? ""}
              onChange={(e) =>
                setDraftStep({ ...draftStep, name: e.target.value || undefined })
              }
              placeholder="e.g., User Input"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="step-description">Description</Label>
            <Textarea
              id="step-description"
              value={draftStep.description ?? ""}
              onChange={(e) =>
                setDraftStep({
                  ...draftStep,
                  description: e.target.value || undefined,
                })
              }
              placeholder="What does this step do?"
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
// Step Node Component
// =============================================================================

function StepNodeComponent({ data }: NodeProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const { step, onStepChange, width, height } = data as unknown as StepNodeData;

  const displayName = step.name || step.step_id;
  const moduleCount = step.modules.length;

  return (
    <>
      {/* Step container - sized to contain all modules */}
      <div
        className="relative rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/5"
        style={{ width, height }}
      >
        {/* Input handle - connects from previous step (left side) */}
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-muted-foreground !w-3 !h-3"
          id="step-in"
        />

        {/* Header bar */}
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-muted-foreground/20 cursor-pointer hover:bg-muted/20 transition-colors rounded-t-md"
          onClick={() => setIsEditOpen(true)}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {displayName}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              ({moduleCount} module{moduleCount !== 1 ? "s" : ""})
            </span>
          </div>
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditOpen(true);
            }}
          >
            Edit
          </button>
        </div>

        {/* Module area - child nodes will be positioned here via parentId */}
        {moduleCount === 0 && (
          <div className="absolute inset-0 top-8 flex items-center justify-center">
            <p className="text-xs text-muted-foreground/50">No modules in this step</p>
          </div>
        )}

        {/* Output handle - connects to next step (right side) */}
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-muted-foreground !w-3 !h-3"
          id="step-out"
        />
      </div>

      {/* Edit dialog */}
      <StepEditDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        step={step}
        onSave={onStepChange}
      />
    </>
  );
}

export const StepNode = memo(StepNodeComponent);
