/**
 * StateTreeView - Live workflow state viewer as a tree.
 *
 * Shows current workflow state in a collapsible tree structure.
 * - Interior nodes are expandable/collapsible
 * - Leaf nodes show field name only
 * - Double-click leaf nodes to view value in popup
 * - Modules from execution_groups are displayed nested under their parent group
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { ChevronRight, ChevronDown, Circle, Search, Settings, Maximize2, Copy, Check, Layers, Expand, Pencil, Save, X } from "lucide-react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { JsonTreeView } from "../../components/ui/json-tree-view";
import { useWorkflowState, type ModuleConfig, type WorkflowDefinition } from "../../contexts/WorkflowStateContext";
import { useWorkflowStore } from "../../state/workflow-store";
import { useDebugMode } from "../../state/hooks/useDebugMode";
import { cn } from "../../utils/cn";

// =============================================================================
// Types
// =============================================================================

interface TreeNodeData {
  key: string;
  value: unknown;
  path: string[];
}

interface ValuePopupState {
  open: boolean;
  path: string;
  value: unknown;
  isEditing: boolean;
  editError: string | null;
}

interface ConfigPopupState {
  open: boolean;
  stepId: string;
  moduleName: string;
  isGroup: boolean;  // True if this is a group node (use raw definition)
}

/**
 * Represents a module or group in the organized tree.
 */
interface OrganizedModule {
  name: string;
  isGroup: boolean;
  stateValue: unknown;  // The state data for this module
  children: OrganizedModule[];  // Child modules (if this is a group)
  parentIndex?: number;  // For x.y numbering - the parent group's index
}

// =============================================================================
// Helper Functions
// =============================================================================

function isLeafNode(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && Object.keys(value).length === 0) return true;
  return false;
}

function getValuePreview(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return value.length > 30 ? value.slice(0, 30) + "..." : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return `{${keys.length} keys}`;
  }
  return String(value);
}

/**
 * Extract _metadata from a node value if present.
 */
function getNodeMetadata(value: unknown): { nodeType: string | null; metadata: Record<string, unknown> | null } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const metadata = obj._metadata as Record<string, unknown> | undefined;
    if (metadata && typeof metadata === "object") {
      return {
        nodeType: (metadata.node_type as string) || null,
        metadata,
      };
    }
  }
  return { nodeType: null, metadata: null };
}

/**
 * Search index containing paths that match or have matching descendants.
 * Pre-computed once at top level for O(1) lookups in child components.
 */
interface SearchIndex {
  /** Paths where the key directly matches the search term */
  matchingPaths: Set<string>;
  /** Paths that have matching descendants (for auto-expand) */
  ancestorPaths: Set<string>;
  /** The search term used to build this index */
  term: string;
}

/** Empty search index for when there's no search term */
const EMPTY_SEARCH_INDEX: SearchIndex = {
  matchingPaths: new Set(),
  ancestorPaths: new Set(),
  term: "",
};

/**
 * Check if a string looks like binary/blob data (base64, hex, or very long without spaces)
 */
function isBlobLikeString(str: string): boolean {
  if (str.length < 100) return false;
  // Base64 pattern (long string of alphanumeric + /+=)
  if (/^[A-Za-z0-9+/=]{100,}$/.test(str)) return true;
  // Hex pattern
  if (/^[0-9a-fA-F]{100,}$/.test(str)) return true;
  // Very long string without spaces (likely encoded data)
  if (str.length > 500 && !str.includes(' ')) return true;
  return false;
}

/**
 * Build search index by traversing the state tree once.
 * Returns sets of matching paths and ancestor paths for O(1) lookups.
 * 
 * Searches:
 * - Object property names (keys)
 * - String values (but not blob-like data)
 * - Array items (but not blob-like strings)
 */
function buildSearchIndex(
  state: Record<string, unknown>,
  searchTerm: string,
  maxDepth: number = 15
): SearchIndex {
  if (!searchTerm) return EMPTY_SEARCH_INDEX;
  
  const term = searchTerm.toLowerCase();
  const matchingPaths = new Set<string>();
  const ancestorPaths = new Set<string>();
  const visited = new WeakSet<object>();
  
  type StackItem = { path: string[]; value: unknown; depth: number };
  const stack: StackItem[] = [];
  
  // Initialize stack with root entries
  for (const [key, value] of Object.entries(state)) {
    stack.push({ path: [key], value, depth: 0 });
  }
  
  let iterations = 0;
  const maxIterations = 50000;
  
  /**
   * Mark a path and all its ancestors as matching
   */
  function addMatch(path: string[]) {
    const pathStr = path.join(".");
    matchingPaths.add(pathStr);
    for (let i = 1; i <= path.length; i++) {
      ancestorPaths.add(path.slice(0, i).join("."));
    }
  }
  
  while (stack.length > 0) {
    iterations++;
    if (iterations > maxIterations) break;
    
    const { path, value, depth } = stack.pop()!;
    const key = path[path.length - 1];
    const isArrayIndex = /^\d+$/.test(key);
    
    // Check if key matches (skip array indices for key matching)
    if (!isArrayIndex && key.toLowerCase().includes(term)) {
      addMatch(path);
    }
    
    // Check string values (but skip blobs)
    if (typeof value === "string" && !isBlobLikeString(value)) {
      if (value.toLowerCase().includes(term)) {
        addMatch(path);
      }
      continue; // Strings have no children
    }
    
    // Don't go deeper than maxDepth
    if (depth >= maxDepth) continue;
    
    // Process objects
    if (value && typeof value === "object") {
      if (visited.has(value as object)) continue;
      visited.add(value as object);
      
      if (Array.isArray(value)) {
        // For arrays, only process first 100 items to avoid huge arrays
        const limit = Math.min(value.length, 100);
        for (let i = 0; i < limit; i++) {
          stack.push({ path: [...path, String(i)], value: value[i], depth: depth + 1 });
        }
      } else {
        for (const [k, v] of Object.entries(value)) {
          if (k === "_metadata") continue;
          stack.push({ path: [...path, k], value: v, depth: depth + 1 });
        }
      }
    }
  }
  
  return { matchingPaths, ancestorPaths, term };
}

/**
 * Organize modules into groups based on workflow definition.
 *
 * Takes the raw state module names and organizes them based on:
 * - Raw definition: which modules are execution_groups
 * - Flattened definition: which modules were expanded_from which groups
 */
function organizeModulesIntoGroups(
  stateModules: Record<string, unknown>,
  _stepId: string,
  rawModules: ModuleConfig[] | undefined,
  flattenedModules: ModuleConfig[] | undefined
): OrganizedModule[] {
  // If no definitions, just return flat list
  if (!rawModules || !flattenedModules) {
    return Object.entries(stateModules)
      .filter(([key]) => key !== "_metadata")
      .map(([name, value]) => ({
        name,
        isGroup: false,
        stateValue: value,
        children: [],
      }));
  }

  // Build a map of module name -> expanded_from (group name)
  const expandedFromMap = new Map<string, string>();
  for (const mod of flattenedModules) {
    const expandedFrom = mod._metadata?.expanded_from;
    if (expandedFrom && mod.name) {
      expandedFromMap.set(mod.name, expandedFrom);
    }
  }

  // Build organized list from raw definition order
  const result: OrganizedModule[] = [];
  const processedModules = new Set<string>();

  for (const rawModule of rawModules) {
    const rawModuleName = rawModule.name;
    if (!rawModuleName) continue;

    // Find all flattened modules that came from this raw module
    const childModuleNames: string[] = [];
    for (const [moduleName, groupName] of expandedFromMap) {
      if (groupName === rawModuleName) {
        childModuleNames.push(moduleName);
      }
    }

    if (childModuleNames.length > 0) {
      // This is a group - collect children
      const children: OrganizedModule[] = [];

      // Use the order from flattenedModules (the run's active version)
      // This preserves the actual execution order
      const childNamesSet = new Set(childModuleNames);
      for (const flatMod of flattenedModules) {
        if (flatMod.name && childNamesSet.has(flatMod.name)) {
          const stateValue = stateModules[flatMod.name];
          if (stateValue !== undefined) {
            children.push({
              name: flatMod.name,
              isGroup: false,
              stateValue,
              children: [],
              parentIndex: result.length,
            });
            processedModules.add(flatMod.name);
          }
        }
      }

      // Only add group if it has children with state
      if (children.length > 0) {
        result.push({
          name: rawModuleName,
          isGroup: true,
          stateValue: null,  // Groups don't have state directly
          children,
        });
      }
    } else {
      // Regular module - check if it has state
      const stateValue = stateModules[rawModuleName];
      if (stateValue !== undefined && !processedModules.has(rawModuleName)) {
        result.push({
          name: rawModuleName,
          isGroup: false,
          stateValue,
          children: [],
        });
        processedModules.add(rawModuleName);
      }
    }
  }

  // Add any modules from state that weren't in definitions
  for (const [name, value] of Object.entries(stateModules)) {
    if (name !== "_metadata" && !processedModules.has(name)) {
      result.push({
        name,
        isGroup: false,
        stateValue: value,
        children: [],
      });
    }
  }

  return result;
}

// =============================================================================
// Tree Node Component
// =============================================================================

interface TreeNodeProps {
  node: TreeNodeData;
  level: number;
  searchIndex: SearchIndex;
  indexInParent?: number;
  stepIndex?: number;
  stepId?: string;
  /** For x.y numbering: the parent group's display number */
  parentNumber?: string;
  /** Whether this node is a child of a group */
  isGroupChild?: boolean;
  /** If true, don't filter children by search - show all children */
  skipChildFiltering?: boolean;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig?: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function TreeNode({
  node,
  level,
  searchIndex,
  indexInParent,
  stepIndex,
  stepId,
  parentNumber,
  isGroupChild: _isGroupChild,
  skipChildFiltering = false,
  onLeafDoubleClick,
  onShowModuleConfig
}: TreeNodeProps) {
  const pathStr = node.path.join(".");
  // O(1) lookup - no traversal needed
  const hasMatchingDescendant = searchIndex.ancestorPaths.has(pathStr);
  const isDirectMatch = searchIndex.matchingPaths.has(pathStr);

  // Track both open state and whether user has explicitly collapsed
  const [isOpen, setIsOpen] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);
  
  // Reset userCollapsed when search term changes
  const prevSearchTerm = useRef(searchIndex.term);
  if (prevSearchTerm.current !== searchIndex.term) {
    prevSearchTerm.current = searchIndex.term;
    if (userCollapsed) setUserCollapsed(false);
  }

  // Auto-expand for search results, but respect user's explicit collapse
  const effectiveIsOpen = userCollapsed 
    ? false 
    : (isOpen || (searchIndex.term && hasMatchingDescendant));
  const isLeaf = isLeafNode(node.value);

  const { nodeType } = getNodeMetadata(node.value);
  const isModuleNode = nodeType === "module";
  const isStepNode = nodeType === "step";

  const handleDoubleClick = useCallback(() => {
    if (isLeaf) {
      onLeafDoubleClick(node.path.join("."), node.value);
    }
  }, [isLeaf, node.path, node.value, onLeafDoubleClick]);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onLeafDoubleClick(node.path.join("."), node.value);
  }, [node.path, node.value, onLeafDoubleClick]);

  const handleToggle = useCallback(() => {
    if (!isLeaf) {
      if (effectiveIsOpen) {
        // User is collapsing - mark as explicitly collapsed
        setUserCollapsed(true);
        setIsOpen(false);
      } else {
        // User is expanding - clear the collapsed flag
        setUserCollapsed(false);
        setIsOpen(true);
      }
    }
  }, [isLeaf, effectiveIsOpen]);

  const handleShowConfig = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isModuleNode && stepId && onShowModuleConfig) {
      onShowModuleConfig(stepId, node.key, false);
    }
  }, [isModuleNode, stepId, node.key, onShowModuleConfig]);

  // Get children for non-leaf nodes
  const children: TreeNodeData[] = [];
  if (!isLeaf && node.value !== null && node.value !== undefined) {
    if (Array.isArray(node.value)) {
      node.value.forEach((item, index) => {
        children.push({
          key: String(index),
          value: item,
          path: [...node.path, String(index)],
        });
      });
    } else if (typeof node.value === "object") {
      Object.entries(node.value as Record<string, unknown>).forEach(([key, value]) => {
        children.push({
          key,
          value,
          path: [...node.path, key],
        });
      });
    }
  }

  const childCount = children.filter((c) => c.key !== "_metadata").length;
  // O(1) lookup for key match
  const keyMatches = searchIndex.matchingPaths.has(pathStr);

  // Calculate display number
  let displayNumber = "";
  if (isStepNode && stepIndex !== undefined) {
    displayNumber = `${stepIndex + 1}.`;
  } else if (isModuleNode && indexInParent !== undefined) {
    if (parentNumber) {
      // Child of a group: x.y format
      displayNumber = `${parentNumber}${indexInParent + 1}.`;
    } else {
      // Regular module or group: x. format
      displayNumber = `${indexInParent + 1}.`;
    }
  }

  return (
    <div className="select-none">
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50",
          !isLeaf && "cursor-pointer",
          isLeaf && "cursor-default",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30",
          isModuleNode && "pr-4"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleToggle}
        onDoubleClick={handleDoubleClick}
      >
        {/* Icon */}
        {isLeaf ? (
          <Circle className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
        ) : effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        {/* Key name with number */}
        <span className={cn(
          "font-mono text-sm",
          isLeaf ? "text-foreground" : "text-primary font-medium",
          keyMatches && "font-bold"
        )}>
          {displayNumber && (
            <span className="text-muted-foreground mr-1">{displayNumber}</span>
          )}
          {node.key}
        </span>

        {/* Child count */}
        {!isLeaf && (
          <span className="text-muted-foreground text-xs">
            ({childCount})
          </span>
        )}

        {/* Expand button - show value in popup */}
        <button
          onClick={handleExpandClick}
          className="ml-1 p-1 hover:bg-muted rounded opacity-40 hover:opacity-100 transition-opacity"
          title="View value"
        >
          <Expand className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {/* Settings button for modules */}
        {isModuleNode && onShowModuleConfig && (
          <button
            onClick={handleShowConfig}
            className="ml-auto mr-2 p-1 hover:bg-muted rounded opacity-60 hover:opacity-100 transition-opacity"
            title="Show module configuration"
          >
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}

        {/* Preview for leaf nodes */}
        {isLeaf && (
          <span className="text-muted-foreground text-xs ml-1 truncate max-w-[150px]">
            {getValuePreview(node.value)}
          </span>
        )}
      </div>

      {/* Children */}
      {!isLeaf && effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {(() => {
            let moduleIndex = 0;
            let stepIdx = 0;

            // Filter children: exclude _metadata
            // When searching: if this node is a direct match OR skipChildFiltering is true,
            // show all children. Otherwise, only show children in ancestorPaths.
            const shouldFilterChildren = searchIndex.term && !skipChildFiltering && !isDirectMatch;
            
            const filteredChildren = children.filter((child) => {
              if (child.key === "_metadata") return false;
              if (shouldFilterChildren) {
                const childPath = child.path.join(".");
                return searchIndex.ancestorPaths.has(childPath);
              }
              return true;
            });

            return filteredChildren.map((child) => {
                const childMetadata = getNodeMetadata(child.value);
                const childIsModule = childMetadata.nodeType === "module";
                const childIsStep = childMetadata.nodeType === "step";

                let childStepId = stepId;
                if (childIsStep) {
                  childStepId = child.key;
                }

                const currentModuleIndex = childIsModule ? moduleIndex++ : undefined;
                const currentStepIndex = childIsStep ? stepIdx++ : undefined;

                // If this node is a direct match, its children should skip filtering
                const childSkipFiltering = isDirectMatch || skipChildFiltering;

                return (
                  <TreeNode
                    key={child.key}
                    node={child}
                    level={level + 1}
                    searchIndex={searchIndex}
                    indexInParent={currentModuleIndex}
                    stepIndex={currentStepIndex}
                    stepId={childStepId}
                    skipChildFiltering={childSkipFiltering}
                    onLeafDoubleClick={onLeafDoubleClick}
                    onShowModuleConfig={onShowModuleConfig}
                  />
                );
              });
          })()}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Group Node Component - For rendering execution groups with nested modules
// =============================================================================

interface GroupNodeProps {
  organizedModule: OrganizedModule;
  level: number;
  searchIndex: SearchIndex;
  stepId: string;
  groupIndex: number;
  /** If true, don't filter children by search - show all children */
  skipChildFiltering?: boolean;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function GroupNode({
  organizedModule,
  level,
  searchIndex,
  stepId,
  groupIndex,
  skipChildFiltering = false,
  onLeafDoubleClick,
  onShowModuleConfig,
}: GroupNodeProps) {
  const [isOpen, setIsOpen] = useState(true);  // Groups start expanded

  const pathStr = `steps.${stepId}.${organizedModule.name}`;
  // O(1) lookup
  const isDirectMatch = searchIndex.matchingPaths.has(pathStr);
  const keyMatches = isDirectMatch;

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleShowGroupConfig = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onShowModuleConfig(stepId, organizedModule.name, true);
  }, [stepId, organizedModule.name, onShowModuleConfig]);

  // Build the aggregated state value for all children in this group
  const groupStateValue = useMemo(() => {
    const result: Record<string, unknown> = {};
    for (const child of organizedModule.children) {
      result[child.name] = child.stateValue;
    }
    return result;
  }, [organizedModule.children]);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onLeafDoubleClick(`steps.${stepId}.${organizedModule.name}`, groupStateValue);
  }, [stepId, organizedModule.name, groupStateValue, onLeafDoubleClick]);

  const displayNumber = `${groupIndex + 1}.`;

  return (
    <div className="select-none">
      {/* Group header */}
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer pr-4",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleToggle}
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className={cn(
          "font-mono text-sm text-primary font-medium",
          keyMatches && "font-bold"
        )}>
          <span className="text-muted-foreground mr-1">{displayNumber}</span>
          {organizedModule.name}
        </span>

        {/* Group badge */}
        <span className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
          <Layers className="h-3 w-3" />
          group
        </span>

        <span className="text-muted-foreground text-xs">
          ({organizedModule.children.length})
        </span>

        {/* Expand button - show value in popup */}
        <button
          onClick={handleExpandClick}
          className="p-1 hover:bg-muted rounded opacity-40 hover:opacity-100 transition-opacity"
          title="View value"
        >
          <Expand className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {/* Settings button for group */}
        <button
          onClick={handleShowGroupConfig}
          className="ml-auto mr-2 p-1 hover:bg-muted rounded opacity-60 hover:opacity-100 transition-opacity"
          title="Show group configuration"
        >
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Group children */}
      {isOpen && (
        <div className="border-l border-border/50 ml-4">
          {organizedModule.children
            .filter((child) => {
              // If this group is a direct match or skipChildFiltering, show all children
              const shouldFilter = searchIndex.term && !skipChildFiltering && !isDirectMatch;
              if (shouldFilter) {
                const childPath = `steps.${stepId}.${child.name}`;
                return searchIndex.ancestorPaths.has(childPath);
              }
              return true;
            })
            .map((child, childIndex) => {
              const childNode: TreeNodeData = {
                key: child.name,
                value: child.stateValue,
                path: ["steps", stepId, child.name],
              };

              // If this group is a direct match, children should skip filtering
              const childSkipFiltering = isDirectMatch || skipChildFiltering;

              return (
                <TreeNode
                  key={child.name}
                  node={childNode}
                  level={level + 1}
                  searchIndex={searchIndex}
                  indexInParent={childIndex}
                  stepId={stepId}
                  parentNumber={displayNumber}
                  isGroupChild={true}
                  skipChildFiltering={childSkipFiltering}
                  onLeafDoubleClick={onLeafDoubleClick}
                  onShowModuleConfig={onShowModuleConfig}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Organized Step Node - Renders a step with grouped modules
// =============================================================================

interface OrganizedStepNodeProps {
  stepId: string;
  stepValue: unknown;
  stepIndex: number;
  level: number;
  searchIndex: SearchIndex;
  rawModules: ModuleConfig[] | undefined;
  flattenedModules: ModuleConfig[] | undefined;
  /** If true, don't filter children by search - show all children */
  skipChildFiltering?: boolean;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function OrganizedStepNode({
  stepId,
  stepValue,
  stepIndex,
  level,
  searchIndex,
  rawModules,
  flattenedModules,
  skipChildFiltering = false,
  onLeafDoubleClick,
  onShowModuleConfig,
}: OrganizedStepNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);

  const pathStr = `steps.${stepId}`;
  // O(1) lookups
  const hasMatchingDescendant = searchIndex.ancestorPaths.has(pathStr);
  const isDirectMatch = searchIndex.matchingPaths.has(pathStr);
  const keyMatches = isDirectMatch;

  // Reset userCollapsed when search term changes
  const prevSearchTerm = useRef(searchIndex.term);
  if (prevSearchTerm.current !== searchIndex.term) {
    prevSearchTerm.current = searchIndex.term;
    if (userCollapsed) setUserCollapsed(false);
  }

  // Auto-expand for search results, but respect user's explicit collapse
  const effectiveIsOpen = userCollapsed 
    ? false 
    : (isOpen || (searchIndex.term && hasMatchingDescendant));

  const handleToggle = useCallback(() => {
    if (effectiveIsOpen) {
      setUserCollapsed(true);
      setIsOpen(false);
    } else {
      setUserCollapsed(false);
      setIsOpen(true);
    }
  }, [effectiveIsOpen]);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onLeafDoubleClick(`steps.${stepId}`, stepValue);
  }, [stepId, stepValue, onLeafDoubleClick]);

  // Get modules from step state (excluding _metadata)
  const stateModules = useMemo(() => {
    if (!stepValue || typeof stepValue !== "object") return {};
    const obj = stepValue as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key !== "_metadata") {
        result[key] = value;
      }
    }
    return result;
  }, [stepValue]);

  // Organize modules into groups
  const organizedModules = useMemo(() => {
    return organizeModulesIntoGroups(stateModules, stepId, rawModules, flattenedModules);
  }, [stateModules, stepId, rawModules, flattenedModules]);

  const moduleCount = organizedModules.length;

  return (
    <div className="select-none">
      {/* Step header */}
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleToggle}
      >
        {effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className={cn(
          "font-mono text-sm text-primary font-medium",
          keyMatches && "font-bold"
        )}>
          <span className="text-muted-foreground mr-1">{stepIndex + 1}.</span>
          {stepId}
        </span>

        <span className="text-muted-foreground text-xs">
          ({moduleCount})
        </span>

        {/* Expand button - show value in popup */}
        <button
          onClick={handleExpandClick}
          className="ml-1 p-1 hover:bg-muted rounded opacity-40 hover:opacity-100 transition-opacity"
          title="View value"
        >
          <Expand className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Step children - organized modules */}
      {effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {organizedModules
            .filter((orgMod) => {
              // If this step is a direct match or skipChildFiltering, show all modules
              const shouldFilter = searchIndex.term && !skipChildFiltering && !isDirectMatch;
              if (shouldFilter) {
                const modPath = `steps.${stepId}.${orgMod.name}`;
                return searchIndex.ancestorPaths.has(modPath);
              }
              return true;
            })
            .map((orgMod, index) => {
              // If this step is a direct match, children should skip filtering
              const childSkipFiltering = isDirectMatch || skipChildFiltering;

              if (orgMod.isGroup) {
                return (
                  <GroupNode
                    key={orgMod.name}
                    organizedModule={orgMod}
                    level={level + 1}
                    searchIndex={searchIndex}
                    stepId={stepId}
                    groupIndex={index}
                    skipChildFiltering={childSkipFiltering}
                    onLeafDoubleClick={onLeafDoubleClick}
                    onShowModuleConfig={onShowModuleConfig}
                  />
                );
              } else {
                const childNode: TreeNodeData = {
                  key: orgMod.name,
                  value: orgMod.stateValue,
                  path: ["steps", stepId, orgMod.name],
                };

                return (
                  <TreeNode
                    key={orgMod.name}
                    node={childNode}
                    level={level + 1}
                    searchIndex={searchIndex}
                    indexInParent={index}
                    stepId={stepId}
                    skipChildFiltering={childSkipFiltering}
                    onLeafDoubleClick={onLeafDoubleClick}
                    onShowModuleConfig={onShowModuleConfig}
                  />
                );
              }
            })}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Steps Node Component - Renders the "steps" container with proper expansion
// =============================================================================

interface StepsNodeProps {
  stepsValue: Record<string, unknown>;
  searchIndex: SearchIndex;
  rawWorkflowDefinition: WorkflowDefinition | null;
  workflowDefinition: WorkflowDefinition | null;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function StepsNode({
  stepsValue,
  searchIndex,
  rawWorkflowDefinition,
  workflowDefinition,
  onLeafDoubleClick,
  onShowModuleConfig,
}: StepsNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState(false);

  const stepEntries = useMemo(() =>
    Object.entries(stepsValue).filter(([k]) => k !== "_metadata"),
    [stepsValue]
  );

  // O(1) lookups
  const hasMatchingDescendant = searchIndex.ancestorPaths.has("steps");
  const isDirectMatch = searchIndex.matchingPaths.has("steps");
  const keyMatches = isDirectMatch;

  // Reset userCollapsed when search term changes
  const prevSearchTerm = useRef(searchIndex.term);
  if (prevSearchTerm.current !== searchIndex.term) {
    prevSearchTerm.current = searchIndex.term;
    if (userCollapsed) setUserCollapsed(false);
  }

  // Auto-expand for search results, but respect user's explicit collapse
  const effectiveIsOpen = userCollapsed 
    ? false 
    : (isOpen || (searchIndex.term && hasMatchingDescendant));

  const handleToggle = useCallback(() => {
    if (effectiveIsOpen) {
      setUserCollapsed(true);
      setIsOpen(false);
    } else {
      setUserCollapsed(false);
      setIsOpen(true);
    }
  }, [effectiveIsOpen]);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onLeafDoubleClick("steps", stepsValue);
  }, [stepsValue, onLeafDoubleClick]);

  const getStepModules = useCallback((stepId: string, definition: WorkflowDefinition | null) => {
    if (!definition) return undefined;
    const step = definition.steps.find((s) => s.step_id === stepId);
    return step?.modules;
  }, []);

  return (
    <div className="select-none">
      {/* Steps header */}
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer",
          keyMatches && "bg-yellow-100 dark:bg-yellow-900/30"
        )}
        style={{ paddingLeft: "8px" }}
        onClick={handleToggle}
      >
        {effectiveIsOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className={cn(
          "font-mono text-sm text-primary font-medium",
          keyMatches && "font-bold"
        )}>
          steps
        </span>

        <span className="text-muted-foreground text-xs">
          ({stepEntries.length})
        </span>

        {/* Expand button - show value in popup */}
        <button
          onClick={handleExpandClick}
          className="ml-1 p-1 hover:bg-muted rounded opacity-40 hover:opacity-100 transition-opacity"
          title="View value"
        >
          <Expand className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Step children */}
      {effectiveIsOpen && (
        <div className="border-l border-border/50 ml-4">
          {stepEntries
            .filter(([stepId]) => {
              // If "steps" is a direct match, show all steps
              const shouldFilter = searchIndex.term && !isDirectMatch;
              if (shouldFilter) {
                const stepPath = `steps.${stepId}`;
                return searchIndex.ancestorPaths.has(stepPath);
              }
              return true;
            })
            .map(([stepId, stepValue], stepIndex) => (
              <OrganizedStepNode
                key={stepId}
                stepId={stepId}
                stepValue={stepValue}
                stepIndex={stepIndex}
                level={1}
                searchIndex={searchIndex}
                rawModules={getStepModules(stepId, rawWorkflowDefinition)}
                flattenedModules={getStepModules(stepId, workflowDefinition)}
                skipChildFiltering={isDirectMatch}
                onLeafDoubleClick={onLeafDoubleClick}
                onShowModuleConfig={onShowModuleConfig}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Copy Button Component
// =============================================================================

interface CopyButtonProps {
  value: unknown;
  className?: string;
}

function CopyButton({ value, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const text = ((value !== null && typeof value === "object")
      ? JSON.stringify(value, null, 2)
      : String(value))
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");

    // Try modern clipboard API first, fallback to execCommand
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch((err) => {
        console.error("Clipboard API failed:", err);
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }

    function fallbackCopy(str: string) {
      const textarea = document.createElement("textarea");
      textarea.value = str;
      textarea.style.cssText = "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, str.length);
      try {
        const success = document.execCommand("copy");
        if (success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } else {
          console.error("execCommand returned false");
        }
      } catch (err) {
        console.error("Fallback copy failed:", err);
      }
      document.body.removeChild(textarea);
    }
  }, [value]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "p-1.5 hover:bg-muted rounded opacity-70 hover:opacity-100 transition-opacity",
        className
      )}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function StateTreeView() {
  const {
    state,
    isConnected,
    workflowDefinition,
    rawWorkflowDefinition,
    getModuleConfig,
    getRawModuleConfig,
    updateStateAtPath,
  } = useWorkflowState();

  const currentInteraction = useWorkflowStore((s) => s.currentInteraction);
  const updateCurrentInteractionDisplayData = useWorkflowStore((s) => s.updateCurrentInteractionDisplayData);

  // Debug mode - only show edit functionality when enabled
  const { isDebugMode } = useDebugMode();

  // Debounced search: inputValue updates immediately, searchTerm after delay
  const [inputValue, setInputValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  
  // Minimum characters required to trigger search
  const MIN_SEARCH_LENGTH = 3;
  
  // Debounce search with 300ms delay, require minimum 3 characters
  useEffect(() => {
    const effectiveValue = inputValue.length >= MIN_SEARCH_LENGTH ? inputValue : "";
    
    if (effectiveValue === searchTerm) {
      return;
    }
    
    const timer = setTimeout(() => {
      setSearchTerm(effectiveValue);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [inputValue, searchTerm]);
  const [isMaximized, setIsMaximized] = useState(false);
  const [popup, setPopup] = useState<ValuePopupState>({
    open: false,
    path: "",
    value: null,
    isEditing: false,
    editError: null,
  });
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [configPopup, setConfigPopup] = useState<ConfigPopupState>({
    open: false,
    stepId: "",
    moduleName: "",
    isGroup: false,
  });

  const handleLeafDoubleClick = useCallback((path: string, value: unknown) => {
    setPopup({ open: true, path, value, isEditing: false, editError: null });
  }, []);

  const handleClosePopup = useCallback(() => {
    setPopup((prev) => ({ ...prev, open: false, isEditing: false, editError: null }));
  }, []);

  // Check if path is editable (contains "display_data")
  const isPathEditable = useCallback((path: string) => {
    return path.includes("display_data");
  }, []);

  // Enter edit mode
  const handleStartEdit = useCallback(() => {
    setPopup((prev) => ({ ...prev, isEditing: true, editError: null }));
  }, []);

  // Cancel edit mode
  const handleCancelEdit = useCallback(() => {
    setPopup((prev) => ({ ...prev, isEditing: false, editError: null }));
  }, []);

  // Monaco editor mount handler
  const handleEditorMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;
    // Format document on mount
    setTimeout(() => {
      editor.getAction("editor.action.formatDocument")?.run();
    }, 100);
  }, []);

  // Save edited value
  const handleSaveEdit = useCallback(() => {
    if (!editorRef.current) return;

    const editorValue = editorRef.current.getValue();
    try {
      const parsed = JSON.parse(editorValue);

      // Update workflow state context
      updateStateAtPath(popup.path, parsed);

      // Also update Zustand store if this is display_data related
      // This ensures the interaction UI re-renders
      if (popup.path.includes("display_data") && currentInteraction) {
        const pathParts = popup.path.split(".");
        const displayDataIndex = pathParts.indexOf("display_data");

        if (displayDataIndex !== -1) {
          // Get sub-path within display_data (if any)
          const subPath = pathParts.slice(displayDataIndex + 1);

          if (subPath.length === 0) {
            // Editing the entire display_data object
            updateCurrentInteractionDisplayData(parsed as Record<string, unknown>);
          } else {
            // Editing a nested path within display_data
            // Clone current display_data and update the nested path
            const newDisplayData = JSON.parse(
              JSON.stringify(currentInteraction.display_data || {})
            );

            let current: Record<string, unknown> = newDisplayData;
            for (let i = 0; i < subPath.length - 1; i++) {
              const key = subPath[i];
              if (!(key in current)) {
                current[key] = {};
              }
              current = current[key] as Record<string, unknown>;
            }
            current[subPath[subPath.length - 1]] = parsed;

            updateCurrentInteractionDisplayData(newDisplayData);
          }
        }
      }

      setPopup((prev) => ({
        ...prev,
        value: parsed,
        isEditing: false,
        editError: null,
      }));
    } catch (e) {
      setPopup((prev) => ({
        ...prev,
        editError: `Invalid JSON: ${(e as Error).message}`,
      }));
    }
  }, [popup.path, updateStateAtPath, currentInteraction, updateCurrentInteractionDisplayData]);

  const handleShowModuleConfig = useCallback((stepId: string, moduleName: string, isGroup: boolean) => {
    setConfigPopup({ open: true, stepId, moduleName, isGroup });
  }, []);

  const handleCloseConfigPopup = useCallback(() => {
    setConfigPopup((prev) => ({ ...prev, open: false }));
  }, []);

  // Get config based on whether it's a group or regular/child module
  const currentModuleConfig = useMemo(() => {
    if (!configPopup.open) return null;

    if (configPopup.isGroup) {
      // Group - look up in raw definition
      return getRawModuleConfig(configPopup.stepId, configPopup.moduleName);
    } else {
      // Regular module or group child - try flattened first, fall back to raw
      const flattenedConfig = getModuleConfig(configPopup.stepId, configPopup.moduleName);
      if (flattenedConfig) return flattenedConfig;
      return getRawModuleConfig(configPopup.stepId, configPopup.moduleName);
    }
  }, [configPopup, getModuleConfig, getRawModuleConfig]);

  // Build root nodes from state - only show steps and state_mapped
  const disallowedKeys = ["files"];
  const rootNodes: TreeNodeData[] = useMemo(() => 
    Object.entries(state)
      .filter(([key]) => !disallowedKeys.includes(key))
      .map(([key, value]) => ({
        key,
        value,
        path: [key],
      })),
    [state]
  );

  // Build search index ONCE when searchTerm changes
  // This is the key optimization - traverse the tree only once
  const searchIndex = useMemo(() => {
    if (!searchTerm) return EMPTY_SEARCH_INDEX;
    return buildSearchIndex(state, searchTerm);
  }, [state, searchTerm]);

  // Filter root nodes based on search index
  const filteredNodes = useMemo(() => {
    if (!searchTerm) return rootNodes;
    return rootNodes.filter((node) => searchIndex.ancestorPaths.has(node.key));
  }, [rootNodes, searchTerm, searchIndex]);

  // Render tree content (shared between card and maximized views)
  const renderTreeContent = () => {
    if (filteredNodes.length === 0) {
      return (
        <div className="text-sm text-muted-foreground italic py-2">
          {rootNodes.length === 0 ? "No state data yet" : "No matches found"}
        </div>
      );
    }

    return (
      <div>
        {filteredNodes.map((node) => {
          // Special handling for "steps" node - use StepsNode for proper expand/collapse
          if (node.key === "steps" && node.value && typeof node.value === "object") {
            return (
              <StepsNode
                key="steps"
                stepsValue={node.value as Record<string, unknown>}
                searchIndex={searchIndex}
                rawWorkflowDefinition={rawWorkflowDefinition}
                workflowDefinition={workflowDefinition}
                onLeafDoubleClick={handleLeafDoubleClick}
                onShowModuleConfig={handleShowModuleConfig}
              />
            );
          }

          // Regular nodes
          return (
            <TreeNode
              key={node.key}
              node={node}
              level={0}
              searchIndex={searchIndex}
              onLeafDoubleClick={handleLeafDoubleClick}
              onShowModuleConfig={handleShowModuleConfig}
            />
          );
        })}
      </div>
    );
  };

  return (
    <>
      <Card className="flex flex-col flex-1 min-h-0 gap-0 pb-0 overflow-hidden">
        <CardHeader className="pb-2 shrink-0">
          <CardTitle className="text-sm flex items-center gap-2">
            Workflow State
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isConnected ? "bg-green-500" : "bg-muted"
              )}
              title={isConnected ? "Connected" : "Disconnected"}
            />
            <button
              onClick={() => setIsMaximized(true)}
              className="ml-auto p-1 hover:bg-muted rounded opacity-60 hover:opacity-100 transition-opacity"
              title="Maximize"
            >
              <Maximize2 className="h-4 w-4 text-muted-foreground" />
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 pb-3 flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search state (min 3 chars)..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-inner">
            {renderTreeContent()}
          </div>
        </CardContent>
      </Card>

      {/* Value Popup Dialog - Uses Monaco for both viewing (readonly) and editing */}
      <Dialog open={popup.open} onOpenChange={handleClosePopup}>
        <DialogContent size="medium" className="flex flex-col overflow-hidden">
          {/* Action buttons - top right */}
          <div className="absolute top-4 right-12 z-50 flex items-center gap-1">
            {popup.isEditing ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelEdit}
                  className="h-8 px-2"
                  title="Cancel"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSaveEdit}
                  className="h-8 px-2"
                  title="Save changes"
                >
                  <Save className="h-4 w-4 mr-1" />
                  Save
                </Button>
              </>
            ) : (
              <>
                {isDebugMode && isPathEditable(popup.path) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleStartEdit}
                    className="h-8 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900/30"
                    title="Edit value (Debug Mode)"
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                )}
                <CopyButton value={popup.value} />
              </>
            )}
          </div>
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-sm pr-32">{popup.path}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="border rounded overflow-hidden" style={{ height: "50vh", minHeight: "300px" }}>
              <Editor
                key={popup.isEditing ? "edit" : "view"}
                height="100%"
                defaultLanguage="json"
                defaultValue={JSON.stringify(popup.value, null, 2)}
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
                  readOnly: !popup.isEditing,
                }}
                theme="vs-dark"
              />
            </div>
            {popup.editError && (
              <div className="mt-2 p-2 bg-destructive/10 border border-destructive/30 rounded text-destructive text-sm">
                {popup.editError}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Module/Group Config Popup Dialog */}
      <Dialog open={configPopup.open} onOpenChange={handleCloseConfigPopup}>
        <DialogContent size="medium" className="flex flex-col overflow-hidden">
          {currentModuleConfig && <CopyButton value={currentModuleConfig} className="absolute top-4 right-12 z-50" />}
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-sm pr-16">
              {configPopup.isGroup ? "Group" : "Module"}: {configPopup.moduleName}
              <span className="text-muted-foreground ml-2 font-normal">
                (Step: {configPopup.stepId})
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-inner">
            {currentModuleConfig ? (
              <div className="bg-muted p-4 rounded">
                <JsonTreeView data={currentModuleConfig} defaultExpandDepth={2} />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic py-4">
                {configPopup.isGroup
                  ? "Group configuration not found. This may be because the raw workflow definition hasn't loaded yet."
                  : "Module configuration not found. This may be because the workflow definition hasn't loaded yet."
                }
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Maximized State Tree Dialog */}
      <Dialog open={isMaximized} onOpenChange={setIsMaximized}>
        <DialogContent size="full" className="h-[80vh] max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-sm flex items-center gap-2">
              Workflow State
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  isConnected ? "bg-green-500" : "bg-muted"
                )}
                title={isConnected ? "Connected" : "Disconnected"}
              />
            </DialogTitle>
          </DialogHeader>
          <div className="relative shrink-0">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search state (min 3 chars)..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-inner pr-2">
            {renderTreeContent()}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
