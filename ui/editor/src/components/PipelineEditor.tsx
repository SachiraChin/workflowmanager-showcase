/**
 * Shared Pipeline Editor Component.
 *
 * Monaco-based editor for MongoDB aggregation pipelines with a
 * reference panel showing common pipeline stages.
 *
 * This component provides just the editor content - Dialog wrapping
 * is handled by the parent component.
 */

import Editor from "@monaco-editor/react";
import { useMonacoTheme } from "@/hooks/useMonacoTheme";

// =============================================================================
// Constants
// =============================================================================

/**
 * Common pipeline stages supported by mongomock.
 * This list is for reference in the UI - not exhaustive.
 */
export const COMMON_PIPELINE_STAGES = [
  "$match",
  "$project",
  "$unwind",
  "$replaceRoot",
  "$addFields",
  "$facet",
  "$sort",
  "$limit",
  "$skip",
  "$group",
  "$count",
  "$set",
  "$sample",
  "$bucket",
] as const;

// =============================================================================
// Types
// =============================================================================

export type PipelineEditorProps = {
  /** Current pipeline value as JSON string */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Pipeline editor with Monaco and stage reference panel.
 * Use inside a Dialog or any container - this component fills its parent.
 */
export function PipelineEditor({ value, onChange }: PipelineEditorProps) {
  const monacoTheme = useMonacoTheme();
  return (
    <div className="flex gap-4 flex-1 min-h-0">
      {/* Editor */}
      <div className="flex-1 border rounded overflow-hidden">
        <Editor
          height="100%"
          language="json"
          theme={monacoTheme}
          value={value}
          onChange={(v) => onChange(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>

      {/* Stage Reference */}
      <div className="w-48 border rounded p-3 overflow-auto">
        <p className="text-xs font-medium mb-2">Common Stages</p>
        <ul className="space-y-1">
          {COMMON_PIPELINE_STAGES.map((stage) => (
            <li
              key={stage}
              className="text-xs font-mono text-muted-foreground"
            >
              {stage}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
