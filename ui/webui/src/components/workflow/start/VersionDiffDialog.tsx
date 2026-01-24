/**
 * Dialog to display workflow version changes and request confirmation.
 * Shows a diff of changes as a tree structure for easier reading.
 */

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VersionDiff, VersionDiffChange } from "@/lib/types";
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  RefreshCw,
  FileText,
} from "lucide-react";

// =============================================================================
// Types
// =============================================================================

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  change?: VersionDiffChange;
}

interface VersionDiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diff: VersionDiff;
  oldHash?: string;
  newHash?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

// =============================================================================
// Tree Building
// =============================================================================

/**
 * Parse a diff path into parts, handling both dot notation and bracket notation.
 * Examples:
 *   "steps[0].name" -> ["steps", "0", "name"]
 *   "config['key']" -> ["config", "key"]
 *   "display_components" -> ["display_components"]
 */
function parsePath(path: string): string[] {
  const parts: string[] = [];
  let current = "";
  let i = 0;

  while (i < path.length) {
    const char = path[i];

    if (char === ".") {
      if (current) {
        parts.push(current);
        current = "";
      }
      i++;
    } else if (char === "[") {
      if (current) {
        parts.push(current);
        current = "";
      }
      // Find matching ]
      i++;
      let bracket = "";
      while (i < path.length && path[i] !== "]") {
        // Skip quotes inside brackets
        if (path[i] === "'" || path[i] === '"') {
          i++;
          continue;
        }
        bracket += path[i];
        i++;
      }
      if (bracket) {
        parts.push(bracket);
      }
      i++; // Skip ]
    } else {
      current += char;
      i++;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

/**
 * Build child nodes from an array or object value for expandable preview.
 */
function buildValueChildren(
  value: unknown,
  parentPath: string,
  changeType: "added" | "removed" | "changed"
): Map<string, TreeNode> {
  const children = new Map<string, TreeNode>();

  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      const key = String(idx);
      const path = `${parentPath}[${idx}]`;
      const node: TreeNode = {
        name: `[${idx}]`,
        path,
        children: new Map(),
        change: {
          path,
          type: changeType,
          old_value: changeType === "removed" ? item : undefined,
          new_value: changeType === "added" ? item : undefined,
        },
      };
      // Recursively build children for nested objects/arrays
      if (typeof item === "object" && item !== null) {
        node.children = buildValueChildren(item, path, changeType);
      }
      children.set(key, node);
    });
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      const path = `${parentPath}.${key}`;
      const node: TreeNode = {
        name: key,
        path,
        children: new Map(),
        change: {
          path,
          type: changeType,
          old_value: changeType === "removed" ? item : undefined,
          new_value: changeType === "added" ? item : undefined,
        },
      };
      // Recursively build children for nested objects/arrays
      if (typeof item === "object" && item !== null) {
        node.children = buildValueChildren(item, path, changeType);
      }
      children.set(key, node);
    }
  }

  return children;
}

/**
 * Collect all paths in the tree for full expansion.
 */
function collectAllPaths(node: TreeNode, paths: Set<string>): void {
  if (node.path) {
    paths.add(node.path);
  }
  for (const child of node.children.values()) {
    collectAllPaths(child, paths);
  }
}

function buildTree(changes: VersionDiffChange[]): { root: TreeNode; allPaths: Set<string> } {
  const root: TreeNode = {
    name: "root",
    path: "",
    children: new Map(),
  };

  for (const change of changes) {
    const parts = parsePath(change.path);

    let current = root;
    let currentPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      // Build path with proper notation
      if (/^\d+$/.test(part)) {
        currentPath = currentPath ? `${currentPath}[${part}]` : `[${part}]`;
      } else {
        currentPath = currentPath ? `${currentPath}.${part}` : part;
      }

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: /^\d+$/.test(part) ? `[${part}]` : part,
          path: currentPath,
          children: new Map(),
        });
      }

      current = current.children.get(part)!;

      // If this is the last part, attach the change
      if (i === parts.length - 1) {
        current.change = change;

        // Build expandable children for added/removed arrays or objects
        if (change.type === "added" && typeof change.new_value === "object" && change.new_value !== null) {
          current.children = buildValueChildren(change.new_value, currentPath, "added");
        } else if (change.type === "removed" && typeof change.old_value === "object" && change.old_value !== null) {
          current.children = buildValueChildren(change.old_value, currentPath, "removed");
        }
      }
    }
  }

  // Collect all paths for full expansion
  const allPaths = new Set<string>();
  collectAllPaths(root, allPaths);

  return { root, allPaths };
}

// =============================================================================
// Main Component
// =============================================================================

export function VersionDiffDialog({
  open,
  onOpenChange,
  diff,
  oldHash,
  newHash,
  onConfirm,
  onCancel,
  isLoading = false,
}: VersionDiffDialogProps) {
  // Build tree from changes
  const { root: tree, allPaths } = useMemo(() => buildTree(diff.changes), [diff.changes]);

  // Expand all paths by default
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(allPaths));

  // Update expanded paths when diff changes
  useMemo(() => {
    setExpandedPaths(new Set(allPaths));
  }, [allPaths]);

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  // Group changes by type for summary
  const changesByType = {
    added: diff.changes.filter((c) => c.type === "added"),
    removed: diff.changes.filter((c) => c.type === "removed"),
    changed: diff.changes.filter((c) => c.type === "changed"),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Workflow Version Changed
          </DialogTitle>
          <DialogDescription>
            The workflow has been updated. Review the changes below before
            continuing.
          </DialogDescription>
        </DialogHeader>

        {/* Hash comparison */}
        {(oldHash || newHash) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <span className="truncate max-w-[150px]" title={oldHash}>
              {oldHash?.slice(0, 12)}...
            </span>
            <span>→</span>
            <span className="truncate max-w-[150px]" title={newHash}>
              {newHash?.slice(0, 12)}...
            </span>
          </div>
        )}

        {/* Summary badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {changesByType.added.length > 0 && (
            <Badge variant="default" className="bg-green-600">
              <Plus className="h-3 w-3 mr-1" />
              {changesByType.added.length} added
            </Badge>
          )}
          {changesByType.removed.length > 0 && (
            <Badge variant="destructive">
              <Minus className="h-3 w-3 mr-1" />
              {changesByType.removed.length} removed
            </Badge>
          )}
          {changesByType.changed.length > 0 && (
            <Badge variant="secondary">
              <RefreshCw className="h-3 w-3 mr-1" />
              {changesByType.changed.length} changed
            </Badge>
          )}
        </div>

        {/* Changes tree */}
        <div className="flex-1 min-h-0 max-h-[300px] border rounded-md overflow-auto">
          <div className="p-3 font-mono text-sm">
            {diff.changes.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No changes detected
              </p>
            ) : (
              <TreeNodeList
                nodes={Array.from(tree.children.values())}
                expandedPaths={expandedPaths}
                onToggle={togglePath}
                depth={0}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? "Starting..." : "Confirm & Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================================================
// Tree Node Components
// =============================================================================

interface TreeNodeListProps {
  nodes: TreeNode[];
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}

function TreeNodeList({ nodes, expandedPaths, onToggle, depth }: TreeNodeListProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          depth={depth}
        />
      ))}
    </div>
  );
}

interface TreeNodeItemProps {
  node: TreeNode;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth: number;
}

function TreeNodeItem({ node, expandedPaths, onToggle, depth }: TreeNodeItemProps) {
  const hasChildren = node.children.size > 0;
  const isExpanded = expandedPaths.has(node.path);
  const hasChange = !!node.change;

  const changeTypeStyles = {
    added: "text-green-600",
    removed: "text-red-600",
    changed: "text-yellow-600",
  };

  const changeTypeIcons = {
    added: <Plus className="h-3 w-3" />,
    removed: <Minus className="h-3 w-3" />,
    changed: <RefreshCw className="h-3 w-3" />,
  };

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-0.5 hover:bg-muted/50 rounded px-1 -mx-1",
          hasChildren && "cursor-pointer"
        )}
        style={{ paddingLeft: depth * 16 }}
        onClick={hasChildren ? () => onToggle(node.path) : undefined}
      >
        {/* Tree lines / expand icon */}
        <span className="w-4 flex-shrink-0 text-muted-foreground">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          ) : (
            <span className="inline-block w-3 text-center">•</span>
          )}
        </span>

        {/* Change type indicator */}
        {hasChange && (
          <span className={cn("flex-shrink-0", changeTypeStyles[node.change!.type])}>
            {changeTypeIcons[node.change!.type]}
          </span>
        )}

        {/* Node name */}
        <span
          className={cn(
            "text-xs",
            hasChange ? changeTypeStyles[node.change!.type] : "text-foreground"
          )}
        >
          {node.name}
        </span>

        {/* Inline value preview for leaf nodes (no children) */}
        {!hasChildren && hasChange && (
          <LeafValuePreview change={node.change!} />
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <TreeNodeList
          nodes={Array.from(node.children.values())}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

// =============================================================================
// Value Display
// =============================================================================

function LeafValuePreview({ change }: { change: VersionDiffChange }) {
  const formatValue = (value: unknown): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") {
      return value.length > 30 ? `"${value.slice(0, 30)}..."` : `"${value}"`;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return `[${value.length} items]`;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value);
      return `{${keys.length} keys}`;
    }
    return String(value);
  };

  if (change.type === "changed") {
    const oldStr = formatValue(change.old_value);
    const newStr = formatValue(change.new_value);
    return (
      <span className="text-xs text-muted-foreground ml-2">
        <span className="text-red-500">{oldStr}</span>
        <span className="mx-1">→</span>
        <span className="text-green-500">{newStr}</span>
      </span>
    );
  }

  if (change.type === "added") {
    return (
      <span className="text-xs text-green-600 ml-2">
        {formatValue(change.new_value)}
      </span>
    );
  }

  if (change.type === "removed") {
    return (
      <span className="text-xs text-red-600 ml-2">
        {formatValue(change.old_value)}
      </span>
    );
  }

  return null;
}
