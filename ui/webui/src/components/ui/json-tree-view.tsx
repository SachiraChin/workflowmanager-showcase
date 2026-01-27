/**
 * JsonTreeView - Collapsible JSON viewer with syntax highlighting.
 *
 * Features:
 * - Expand/collapse objects and arrays
 * - Syntax highlighting for different value types
 * - Drill down into subtrees (make any node the root)
 * - Navigate back to parent nodes
 * - Truncated text with double-click to view full content
 * - Consistent node alignment regardless of expand/collapse state
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronRight, ChevronDown, ChevronUp, Focus } from "lucide-react";
import { cn } from "@/core/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// =============================================================================
// Types
// =============================================================================

interface JsonTreeViewProps {
  data: unknown;
  /** Initial expansion depth (default: 1) */
  defaultExpandDepth?: number;
  className?: string;
}

interface JsonNodeProps {
  keyName: string | null;
  value: unknown;
  path: string[];
  depth: number;
  defaultExpandDepth: number;
  isLast: boolean;
  onDrillDown: (path: string[]) => void;
  onShowText: (value: string) => void;
}

interface TextPopupState {
  open: boolean;
  value: string;
}

// =============================================================================
// Constants
// =============================================================================

/** Fixed width for the expand icon column to ensure alignment */
const ICON_COLUMN_WIDTH = 18;

/** Indent per depth level */
const INDENT_PER_LEVEL = 16;

/** Max characters before truncating string values */
const MAX_STRING_LENGTH = 60;

// =============================================================================
// Helpers
// =============================================================================

function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Get value at a given path in the data tree.
 */
function getValueAtPath(data: unknown, path: string[]): unknown {
  let current = data;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = parseInt(key, 10);
      current = current[index];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

// =============================================================================
// JsonNode Component
// =============================================================================

function JsonNode({
  keyName,
  value,
  path,
  depth,
  defaultExpandDepth,
  isLast,
  onDrillDown,
  onShowText,
}: JsonNodeProps) {
  const [isExpanded, setIsExpanded] = useState(depth < defaultExpandDepth);
  const valueType = getValueType(value);
  const isExpandable = valueType === "object" || valueType === "array";

  const handleToggle = useCallback(() => {
    if (isExpandable) {
      setIsExpanded((prev) => !prev);
    }
  }, [isExpandable]);

  const handleDrillDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDrillDown(path);
  }, [path, onDrillDown]);

  const handleTextClick = useCallback((e: React.MouseEvent, text: string) => {
    e.stopPropagation();
    onShowText(text);
  }, [onShowText]);

  // Calculate total left padding: depth indent + icon column
  const leftPadding = depth * INDENT_PER_LEVEL;

  const renderValue = () => {
    if (valueType === "null") {
      return <span className="text-orange-500 dark:text-orange-400">null</span>;
    }
    if (valueType === "undefined") {
      return <span className="text-gray-400">undefined</span>;
    }
    if (valueType === "boolean") {
      return <span className="text-purple-600 dark:text-purple-400">{String(value)}</span>;
    }
    if (valueType === "number") {
      return <span className="text-blue-600 dark:text-blue-400">{String(value)}</span>;
    }
    if (valueType === "string") {
      const str = value as string;
      const isTruncated = str.length > MAX_STRING_LENGTH;
      const displayStr = isTruncated ? str.slice(0, MAX_STRING_LENGTH) + "…" : str;
      return (
        <span
          className={cn(
            "text-green-600 dark:text-green-400",
            isTruncated && "cursor-pointer hover:underline"
          )}
          onClick={isTruncated ? (e) => handleTextClick(e, str) : undefined}
          title={isTruncated ? "Click to view full text" : undefined}
        >
          "{displayStr}"
        </span>
      );
    }
    return null;
  };

  // For non-expandable values (leaf nodes)
  if (!isExpandable) {
    return (
      <div
        className="flex items-start py-0.5"
        style={{ paddingLeft: `${leftPadding}px` }}
      >
        {/* Empty icon column for alignment */}
        <div style={{ width: `${ICON_COLUMN_WIDTH}px` }} className="shrink-0" />

        {keyName !== null && (
          <>
            <span className="text-foreground shrink-0">{keyName}</span>
            <span className="text-muted-foreground mx-1 shrink-0">:</span>
          </>
        )}
        <span className="min-w-0 break-all">{renderValue()}</span>
        {!isLast && <span className="text-muted-foreground shrink-0">,</span>}
      </div>
    );
  }

  // For objects and arrays
  const entries = valueType === "array"
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  const openBracket = valueType === "array" ? "[" : "{";
  const closeBracket = valueType === "array" ? "]" : "}";

  return (
    <div className="select-none">
      {/* Header row with key and bracket - clickable to expand/collapse */}
      <div
        className="flex items-center py-0.5 rounded group cursor-pointer hover:bg-muted/30"
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={handleToggle}
      >
        {/* Icon column - fixed width for alignment */}
        <div
          style={{ width: `${ICON_COLUMN_WIDTH}px` }}
          className="shrink-0 flex items-center justify-center"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>

        {keyName !== null && (
          <>
            <span className="text-foreground shrink-0">{keyName}</span>
            <span className="text-muted-foreground mx-1 shrink-0">:</span>
          </>
        )}

        <span className="text-muted-foreground shrink-0">{openBracket}</span>

        {/* Collapsed preview */}
        {!isExpanded && (
          <>
            <span className="text-muted-foreground text-xs ml-1 shrink-0">
              {valueType === "array" ? `${entries.length} items` : `${entries.length} keys`}
            </span>
            <span className="text-muted-foreground ml-1 shrink-0">{closeBracket}</span>
            {!isLast && <span className="text-muted-foreground shrink-0">,</span>}
          </>
        )}

        {/* Drill down button - visible on hover */}
        <button
          onClick={handleDrillDown}
          className="ml-2 p-0.5 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-muted transition-opacity"
          title="Focus on this node"
        >
          <Focus className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>

      {/* Expanded children */}
      {isExpanded && (
        <>
          {entries.map(([key, val], index) => (
            <JsonNode
              key={key}
              keyName={valueType === "array" ? null : key}
              value={val}
              path={[...path, key]}
              depth={depth + 1}
              defaultExpandDepth={defaultExpandDepth}
              isLast={index === entries.length - 1}
              onDrillDown={onDrillDown}
              onShowText={onShowText}
            />
          ))}
          <div
            className="flex items-start py-0.5"
            style={{ paddingLeft: `${leftPadding}px` }}
          >
            {/* Empty icon column for alignment */}
            <div style={{ width: `${ICON_COLUMN_WIDTH}px` }} className="shrink-0" />
            <span className="text-muted-foreground">{closeBracket}</span>
            {!isLast && <span className="text-muted-foreground">,</span>}
          </div>
        </>
      )}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function JsonTreeView({ data, defaultExpandDepth = 1, className }: JsonTreeViewProps) {
  // Path to current "root" node being viewed
  const [rootPath, setRootPath] = useState<string[]>([]);

  // Text popup state
  const [textPopup, setTextPopup] = useState<TextPopupState>({
    open: false,
    value: "",
  });

  // Get the data at current root path
  const currentData = useMemo(() => {
    if (rootPath.length === 0) return data;
    return getValueAtPath(data, rootPath);
  }, [data, rootPath]);

  // Handle drill down into a subtree
  const handleDrillDown = useCallback((path: string[]) => {
    setRootPath(path);
  }, []);

  // Handle going back to parent
  const handleGoToParent = useCallback(() => {
    setRootPath((prev) => prev.slice(0, -1));
  }, []);

  // Handle going to root
  const handleGoToRoot = useCallback(() => {
    setRootPath([]);
  }, []);

  // Handle showing full text
  const handleShowText = useCallback((value: string) => {
    setTextPopup({ open: true, value });
  }, []);

  // Handle closing text popup
  const handleCloseTextPopup = useCallback(() => {
    setTextPopup((prev) => ({ ...prev, open: false }));
  }, []);

  // Handle clicking on a breadcrumb segment
  const handleBreadcrumbClick = useCallback((index: number) => {
    setRootPath((prev) => prev.slice(0, index + 1));
  }, []);

  return (
    <>
      <div className={cn("font-mono text-sm", className)}>
        {/* Navigation header - shown when drilled down */}
        {rootPath.length > 0 && (
          <div className="flex items-center gap-1 mb-2 pb-2 border-b border-border text-xs flex-wrap">
            {/* Back to parent button */}
            <button
              onClick={handleGoToParent}
              className="p-1 rounded hover:bg-muted transition-colors"
              title="Go to parent"
            >
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
            </button>

            {/* Breadcrumb path */}
            <button
              onClick={handleGoToRoot}
              className="text-muted-foreground hover:text-foreground hover:underline transition-colors"
            >
              root
            </button>
            {rootPath.map((segment, index) => (
              <span key={index} className="flex items-center gap-1">
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  className={cn(
                    "hover:underline transition-colors",
                    index === rootPath.length - 1
                      ? "text-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {segment}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Tree content */}
        {currentData !== undefined ? (
          <JsonNode
            keyName={null}
            value={currentData}
            path={rootPath}
            depth={0}
            defaultExpandDepth={defaultExpandDepth}
            isLast={true}
            onDrillDown={handleDrillDown}
            onShowText={handleShowText}
          />
        ) : (
          <div className="text-muted-foreground italic">
            Invalid path - data not found
          </div>
        )}
      </div>

      {/* Text popup dialog */}
      <Dialog open={textPopup.open} onOpenChange={handleCloseTextPopup}>
        <DialogContent size="medium" className="flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm">Full Text Content</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-inner">
            <pre className="text-sm bg-muted p-4 rounded whitespace-pre-wrap break-words text-green-600 dark:text-green-400">
              "{textPopup.value}"
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
