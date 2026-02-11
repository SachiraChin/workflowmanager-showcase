/**
 * Prompt Editor Component
 *
 * A dialog for editing LLM prompts with:
 * - Left panel: Available state variables for reference
 * - Right panel: System prompts (top) and User prompts (bottom)
 * - Drag-and-drop reordering within each group
 * - Support for text prompts, file references, and Jinja2 templates
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type * as Monaco from "monaco-editor";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
} from "@wfm/shared";
import Editor from "@monaco-editor/react";
import type { SystemMessageItem, InputContent, ContentRef } from "@/modules/api/llm";

// =============================================================================
// Types
// =============================================================================

export type PromptItem = {
  id: string;
  type: "system" | "user";
  content: SystemMessageItem;
};

export type StateVariable = {
  key: string;
  path: string;
  type: "string" | "number" | "boolean" | "array" | "object" | "unknown";
};

export type PromptEditorProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** System prompts */
  system: SystemMessageItem[] | string | undefined;
  /** User input prompts */
  input: InputContent;
  /** Available state variables */
  stateVariables: StateVariable[];
  /** Callback when prompts are saved */
  onSave: (system: SystemMessageItem[], input: InputContent) => void;
};

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function isContentRef(value: unknown): value is ContentRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof (value as ContentRef).$ref === "string"
  );
}

function normalizeToArray(
  value: SystemMessageItem[] | string | undefined
): SystemMessageItem[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  return value;
}

function normalizeInputToArray(value: InputContent): SystemMessageItem[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  if (isContentRef(value)) return [value];
  return [];
}

function getPromptSummary(content: SystemMessageItem): string {
  if (typeof content === "string") {
    if (content.includes("{{")) {
      const match = content.match(/\{\{\s*state\.(\w+)/);
      return match ? `{{ state.${match[1]} }}` : "Jinja2 template";
    }
    return content.length > 50 ? `${content.slice(0, 50)}...` : content;
  }
  if (isContentRef(content)) {
    const parts = content.$ref.split("/");
    return parts[parts.length - 1];
  }
  if (typeof content === "object" && content !== null) {
    const c = content as { content?: string };
    if (c.content) {
      return c.content.length > 50 ? `${c.content.slice(0, 50)}...` : c.content;
    }
  }
  return "Unknown prompt";
}



// =============================================================================
// Sortable Prompt Item (collapsed view only)
// =============================================================================

function SortablePromptItem({
  item,
  onEdit,
  onRemove,
}: {
  item: PromptItem;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const typeColor = item.type === "system" ? "bg-blue-500" : "bg-green-500";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-card overflow-hidden"
    >
      <div className="flex items-center gap-2 p-2 bg-muted/30">
        {/* Drag handle */}
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </button>

        {/* Type badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${typeColor}`}
        >
          {item.type === "system" ? "System" : "User"}
        </span>

        {/* Summary */}
        <span className="flex-1 text-xs text-muted-foreground truncate">
          {getPromptSummary(item.content)}
        </span>

        {/* Edit button */}
        <button
          type="button"
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          onClick={() => onEdit(item.id)}
          title="Edit"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </svg>
        </button>

        {/* Remove button */}
        <button
          type="button"
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(item.id)}
          title="Remove"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M18 6L6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Full-height Prompt Editor (when editing)
// =============================================================================

function FullHeightPromptEditor({
  item,
  onSave,
}: {
  item: PromptItem;
  onSave: (item: PromptItem) => void;
}) {
  const [content, setContent] = useState(() => {
    if (typeof item.content === "string") return item.content;
    if (isContentRef(item.content)) return item.content.$ref;
    if (typeof item.content === "object" && item.content !== null) {
      const c = item.content as { content?: string };
      return c.content ?? "";
    }
    return "";
  });

  const [promptType, setPromptType] = useState<"text" | "file">(() => {
    if (isContentRef(item.content)) return "file";
    return "text";
  });

  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  const typeColor = item.type === "system" ? "bg-blue-500" : "bg-green-500";

  const handleSave = () => {
    let newContent: SystemMessageItem;
    if (promptType === "file") {
      newContent = { $ref: content, type: "text" };
    } else {
      newContent = content;
    }
    onSave({ ...item, content: newContent });
  };

  // Update decorations when content changes
  const updateDecorations = useCallback((editor: Monaco.editor.IStandaloneCodeEditor) => {
    const model = editor.getModel();
    if (!model) return;

    const text = model.getValue();
    const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

    // Find all Jinja expressions: {{ ... }} (variable output)
    const expressionRegex = /\{\{[\s\S]*?\}\}/g;
    let match;
    while ((match = expressionRegex.exec(text)) !== null) {
      const startPos = model.getPositionAt(match.index);
      const endPos = model.getPositionAt(match.index + match[0].length);

      decorations.push({
        range: {
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
        },
        options: {
          inlineClassName: "jinja-expression-decoration",
          hoverMessage: { value: "**Jinja2 Variable**\n\nThis will be replaced with the value at runtime." },
        },
      });
    }

    // Find all Jinja control blocks: {% ... %} (if, for, endif, endfor, etc.)
    const controlRegex = /\{%[\s\S]*?%\}/g;
    while ((match = controlRegex.exec(text)) !== null) {
      const startPos = model.getPositionAt(match.index);
      const endPos = model.getPositionAt(match.index + match[0].length);
      
      // Determine if it's a conditional or loop
      const content = match[0].toLowerCase();
      const isConditional = content.includes("if") || content.includes("else") || content.includes("elif") || content.includes("endif");
      const isLoop = content.includes("for") || content.includes("endfor");

      let className = "jinja-control-decoration";
      let hoverMessage = "**Jinja2 Control Block**";
      
      if (isConditional) {
        className = "jinja-conditional-decoration";
        hoverMessage = "**Jinja2 Conditional**\n\nControls which content is rendered based on conditions.";
      } else if (isLoop) {
        className = "jinja-loop-decoration";
        hoverMessage = "**Jinja2 Loop**\n\nRepeats content for each item in a collection.";
      }

      decorations.push({
        range: {
          startLineNumber: startPos.lineNumber,
          startColumn: startPos.column,
          endLineNumber: endPos.lineNumber,
          endColumn: endPos.column,
        },
        options: {
          inlineClassName: className,
          hoverMessage: { value: hoverMessage },
        },
      });
    }

    // Apply decorations
    if (decorationsRef.current) {
      decorationsRef.current.set(decorations);
    } else {
      decorationsRef.current = editor.createDecorationsCollection(decorations);
    }
  }, []);

  // Handle editor mount
  const handleEditorMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor) => {
      editorRef.current = editor;

      // Define custom CSS for Jinja decorations
      // NOTE: Avoid padding/margin as they break cursor positioning in Monaco
      const styleId = "jinja-decoration-styles";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          /* Variable expressions: {{ ... }} - Purple */
          .jinja-expression-decoration {
            background-color: rgba(139, 92, 246, 0.35);
            border-radius: 3px;
            box-shadow: 0 0 0 1px rgba(139, 92, 246, 0.6);
          }

          /* Conditional blocks: {% if %}, {% else %}, {% endif %} - Amber/Orange */
          .jinja-conditional-decoration {
            background-color: rgba(245, 158, 11, 0.35);
            border-radius: 3px;
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.6);
          }

          /* Loop blocks: {% for %}, {% endfor %} - Cyan/Teal */
          .jinja-loop-decoration {
            background-color: rgba(6, 182, 212, 0.35);
            border-radius: 3px;
            box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.6);
          }

          /* Other control blocks: {% ... %} - Gray */
          .jinja-control-decoration {
            background-color: rgba(156, 163, 175, 0.35);
            border-radius: 3px;
            box-shadow: 0 0 0 1px rgba(156, 163, 175, 0.6);
          }
        `;
        document.head.appendChild(style);
      }

      // Initial decorations
      updateDecorations(editor);

      // Update decorations on content change
      editor.onDidChangeModelContent(() => {
        updateDecorations(editor);
      });
    },
    [updateDecorations]
  );

  // Update decorations when content changes externally
  useEffect(() => {
    if (editorRef.current) {
      updateDecorations(editorRef.current);
    }
  }, [content, updateDecorations]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b bg-muted/30">
        {/* Type badge */}
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${typeColor}`}
        >
          {item.type === "system" ? "System" : "User"}
        </span>

        {/* Type selector */}
        <select
          className="text-xs rounded border bg-background px-2 py-1"
          value={promptType}
          onChange={(e) => setPromptType(e.target.value as typeof promptType)}
        >
          <option value="text">Text / Jinja2</option>
          <option value="file">File Reference</option>
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Done button - prominent and clear */}
        <Button
          size="sm"
          variant="default"
          className="h-7 px-3 text-xs"
          onClick={handleSave}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="mr-1"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Done
        </Button>
      </div>

      {/* Editor - takes remaining space */}
      {promptType === "file" ? (
        <div className="p-4">
          <Label className="text-xs mb-2 block">File Path</Label>
          <input
            className="w-full rounded border bg-background px-3 py-2 text-sm font-mono"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="prompts/system_prompt.txt"
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <Editor
            height="100%"
            language="plaintext"
            theme="vs-dark"
            value={content}
            onChange={(value) => setContent(value ?? "")}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: true, scale: 1 },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "on",
              padding: { top: 16, bottom: 16 },
              folding: true,
              glyphMargin: true,
              lineDecorationsWidth: 10,
              lineNumbersMinChars: 3,
              renderLineHighlight: "all",
              cursorBlinking: "smooth",
              smoothScrolling: true,
            }}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// State Variables Panel
// =============================================================================

function StateVariablesPanel({
  variables,
  onInsert,
}: {
  variables: StateVariable[];
  onInsert: (path: string) => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <h3 className="text-sm font-semibold">State Variables</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Click to copy Jinja2 reference
        </p>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {variables.length === 0 ? (
          <p className="text-xs text-muted-foreground p-2">
            No state variables available
          </p>
        ) : (
          variables.map((v) => (
            <button
              key={v.path}
              type="button"
              className="w-full text-left px-2 py-1.5 rounded hover:bg-muted transition-colors"
              onClick={() => onInsert(v.path)}
              title={`Click to copy: {{ ${v.path} }}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono truncate">{v.key}</span>
                <span className="text-[10px] text-muted-foreground">
                  {v.type}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono truncate">
                {v.path}
              </p>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function PromptEditor({
  open,
  onOpenChange,
  system,
  input,
  stateVariables,
  onSave,
}: PromptEditorProps) {
  // Convert inputs to prompt items
  const [prompts, setPrompts] = useState<PromptItem[]>(() => {
    const items: PromptItem[] = [];
    
    // Add system prompts
    const systemArray = normalizeToArray(system);
    systemArray.forEach((content) => {
      items.push({ id: generateId(), type: "system", content });
    });
    
    // Add user prompts
    const inputArray = normalizeInputToArray(input);
    inputArray.forEach((content) => {
      items.push({ id: generateId(), type: "user", content });
    });
    
    return items;
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Separate system and user prompts for display
  const systemPrompts = useMemo(
    () => prompts.filter((p) => p.type === "system"),
    [prompts]
  );
  const userPrompts = useMemo(
    () => prompts.filter((p) => p.type === "user"),
    [prompts]
  );

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) return;

    const activeItem = prompts.find((p) => p.id === active.id);
    const overItem = prompts.find((p) => p.id === over.id);

    if (!activeItem || !overItem) return;

    // Only allow reordering within the same type
    if (activeItem.type !== overItem.type) return;

    setPrompts((prev) => {
      const oldIndex = prev.findIndex((p) => p.id === active.id);
      const newIndex = prev.findIndex((p) => p.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, [prompts]);

  const handleAddPrompt = useCallback((type: "system" | "user") => {
    const newItem: PromptItem = {
      id: generateId(),
      type,
      content: "",
    };
    setPrompts((prev) => {
      if (type === "system") {
        // Add at end of system prompts
        const systemEnd = prev.filter((p) => p.type === "system").length;
        return [...prev.slice(0, systemEnd), newItem, ...prev.slice(systemEnd)];
      } else {
        // Add at end
        return [...prev, newItem];
      }
    });
    setEditingId(newItem.id);
  }, []);

  const handleRemovePrompt = useCallback((id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  }, [editingId]);

  const handleUpdatePrompt = useCallback((updated: PromptItem) => {
    setPrompts((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    setEditingId(null);
  }, []);

  const handleInsertVariable = useCallback((path: string) => {
    const reference = `{{ ${path} }}`;
    navigator.clipboard.writeText(reference);
    // TODO: Could show a toast notification
  }, []);

  const handleSave = useCallback(() => {
    const systemItems = prompts
      .filter((p) => p.type === "system")
      .map((p) => p.content);
    const userItems = prompts
      .filter((p) => p.type === "user")
      .map((p) => p.content);

    // Convert back to the expected format
    // InputContent can be string | ContentRef | SystemMessageItem[]
    let newInput: InputContent;
    if (userItems.length === 0) {
      newInput = "";
    } else if (userItems.length === 1) {
      const item = userItems[0];
      // If it's a string or ContentRef, use directly
      if (typeof item === "string" || isContentRef(item)) {
        newInput = item;
      } else {
        // It's an object with content - extract the content
        newInput = (item as { content?: string }).content ?? "";
      }
    } else {
      newInput = userItems;
    }

    onSave(systemItems, newInput);
    onOpenChange(false);
  }, [prompts, onSave, onOpenChange]);

  const activeItem = activeId
    ? prompts.find((p) => p.id === activeId)
    : null;

  // Find the item being edited
  const editingItem = editingId
    ? prompts.find((p) => p.id === editingId)
    : null;

  const handleEditorSave = (updated: PromptItem) => {
    handleUpdatePrompt(updated);
    setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="full" className="h-[85vh] max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>Edit Prompts</DialogTitle>
          <DialogDescription>
            Configure system and user prompts for the LLM call.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Left Panel - State Variables */}
          <div className="w-64 border-r bg-muted/30 shrink-0">
            <StateVariablesPanel
              variables={stateVariables}
              onInsert={handleInsertVariable}
            />
          </div>

          {/* Right Panel - Either prompt list or full-height editor */}
          {editingItem ? (
            /* Full-height editor mode */
            <FullHeightPromptEditor
              item={editingItem}
              onSave={handleEditorSave}
            />
          ) : (
            /* Prompt list mode */
            <div className="flex-1 overflow-auto p-4 space-y-6">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                {/* System Prompts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">System Prompts</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleAddPrompt("system")}
                    >
                      + Add System
                    </Button>
                  </div>
                  <div className="space-y-2 min-h-[60px] rounded-md border border-dashed p-2">
                    {systemPrompts.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No system prompts. Click "+ Add System" to add one.
                      </p>
                    ) : (
                      <SortableContext
                        items={systemPrompts.map((p) => p.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {systemPrompts.map((item) => (
                          <SortablePromptItem
                            key={item.id}
                            item={item}
                            onEdit={setEditingId}
                            onRemove={handleRemovePrompt}
                          />
                        ))}
                      </SortableContext>
                    )}
                  </div>
                </div>

                {/* User Prompts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">User Prompts</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => handleAddPrompt("user")}
                    >
                      + Add User
                    </Button>
                  </div>
                  <div className="space-y-2 min-h-[60px] rounded-md border border-dashed p-2">
                    {userPrompts.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">
                        No user prompts. Click "+ Add User" to add one.
                      </p>
                    ) : (
                      <SortableContext
                        items={userPrompts.map((p) => p.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {userPrompts.map((item) => (
                          <SortablePromptItem
                            key={item.id}
                            item={item}
                            onEdit={setEditingId}
                            onRemove={handleRemovePrompt}
                          />
                        ))}
                      </SortableContext>
                    )}
                  </div>
                </div>

                <DragOverlay>
                  {activeItem ? (
                    <div className="rounded-md border bg-card p-2 shadow-lg opacity-90">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${
                            activeItem.type === "system"
                              ? "bg-blue-500"
                              : "bg-green-500"
                          }`}
                        >
                          {activeItem.type === "system" ? "System" : "User"}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">
                          {getPromptSummary(activeItem.content)}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t relative">
          {editingId && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10">
              <span className="text-sm text-muted-foreground">
                Click "Done" above to finish editing prompt
              </span>
            </div>
          )}
          <Button 
            variant="outline" 
            onClick={() => onOpenChange(false)}
            disabled={!!editingId}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!!editingId}>
            Save Prompts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
