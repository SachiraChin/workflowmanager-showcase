/**
 * JsonEditorDialog - Reusable Monaco-based JSON editor in a dialog.
 *
 * Used for debug mode editing of display_data and other JSON values.
 */

import { useState, useCallback, useRef } from "react";
import { Save, X, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./dialog";

// =============================================================================
// Types
// =============================================================================

interface JsonEditorDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void;
  /** The value to edit */
  value: unknown;
  /** Dialog title */
  title: string;
  /** Callback when save is clicked with valid JSON */
  onSave: (newValue: unknown) => void;
}

// =============================================================================
// Component
// =============================================================================

export function JsonEditorDialog({
  open,
  onOpenChange,
  value,
  title,
  onSave,
}: JsonEditorDialogProps) {
  const [editError, setEditError] = useState<string | null>(null);
  const [isFolded, setIsFolded] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // Monaco editor mount handler
  const handleEditorMount: OnMount = useCallback((editorInstance) => {
    editorRef.current = editorInstance;
    // Format document on mount
    setTimeout(() => {
      editorInstance.getAction("editor.action.formatDocument")?.run();
    }, 100);
  }, []);

  // Toggle fold/unfold all
  const handleToggleFold = useCallback(() => {
    if (!editorRef.current) return;

    if (isFolded) {
      editorRef.current.getAction("editor.unfoldAll")?.run();
    } else {
      editorRef.current.getAction("editor.foldAll")?.run();
    }
    setIsFolded(!isFolded);
  }, [isFolded]);

  // Handle close - reset state
  const handleClose = useCallback(() => {
    setEditError(null);
    setIsFolded(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Save edited value
  const handleSave = useCallback(() => {
    if (!editorRef.current) return;

    const editorValue = editorRef.current.getValue();
    try {
      const parsed = JSON.parse(editorValue);
      onSave(parsed);
      setEditError(null);
      onOpenChange(false);
    } catch (e) {
      setEditError(`Invalid JSON: ${(e as Error).message}`);
    }
  }, [onSave, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="medium" className="flex flex-col overflow-hidden">
        {/* Action buttons - top right */}
        <div className="absolute top-4 right-12 z-50 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClose}
            className="h-8 px-2"
            title="Cancel"
          >
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            className="h-8 px-2"
            title="Save changes"
          >
            <Save className="h-4 w-4 mr-1" />
            Save
          </Button>
        </div>
        <DialogHeader className="shrink-0">
          <DialogTitle className="font-mono text-sm pr-32">{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center gap-1 mb-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleFold}
              className="h-7 px-2 text-xs"
              title={isFolded ? "Expand all" : "Collapse all"}
            >
              {isFolded ? (
                <ChevronsUpDown className="h-3.5 w-3.5 mr-1" />
              ) : (
                <ChevronsDownUp className="h-3.5 w-3.5 mr-1" />
              )}
              {isFolded ? "Expand" : "Collapse"}
            </Button>
          </div>
          <div className="border rounded overflow-hidden" style={{ height: "50vh", minHeight: "300px" }}>
            <Editor
              height="100%"
              defaultLanguage="json"
              defaultValue={JSON.stringify(value, null, 2)}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                folding: true,
                foldingStrategy: "indentation",
                automaticLayout: true,
                formatOnPaste: true,
                formatOnType: true,
                tabSize: 2,
              }}
              theme="vs-dark"
            />
          </div>
          {editError && (
            <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-destructive text-sm">
              {editError}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
