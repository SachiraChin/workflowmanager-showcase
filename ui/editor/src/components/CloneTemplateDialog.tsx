/**
 * Clone Template Dialog Component.
 *
 * Shown when a non-admin user tries to edit a global template.
 * Prompts the user to clone the template to their own account.
 */

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@wfm/shared";

export type CloneInfo = {
  templateId: string;
  versionId: string;
  templateName: string;
};

export type CloneTemplateDialogProps = {
  open: boolean;
  cloneInfo: CloneInfo | null;
  isCloning: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function CloneTemplateDialog({
  open,
  cloneInfo,
  isCloning,
  onConfirm,
  onCancel,
}: CloneTemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Clone Global Template?</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            This is a global template that you cannot edit directly.
            Would you like to create a personal copy that you can modify?
          </p>
          {cloneInfo && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p><strong>Template:</strong> {cloneInfo.templateName}</p>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={isCloning}
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={isCloning}
          >
            {isCloning ? "Cloning..." : "Clone & Edit"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
