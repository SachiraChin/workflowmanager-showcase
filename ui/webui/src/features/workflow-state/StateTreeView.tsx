/**
 * StateTreeView - Live workflow state viewer as a tree.
 *
 * Shows current workflow state in a collapsible tree structure.
 * - Interior nodes are expandable/collapsible
 * - Leaf nodes show field name only
 * - Double-click leaf nodes to view value in popup
 * - Modules from execution_groups are displayed nested under their parent group
 */

import { useState, useCallback, useMemo } from "react";
import { ChevronRight, ChevronDown, Circle, Search, Settings, Maximize2, Copy, Check, Layers, Expand } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { JsonTreeView } from "@/components/ui/json-tree-view";
import { useWorkflowStateContext } from "@/state/WorkflowStateContext";
import { cn } from "@/core/utils";
import type { ModuleConfig, WorkflowDefinition } from "@/core/types";

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

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/**
 * Try to parse a value as JSON if it's a string.
 */
function tryParseJson(value: unknown): { isJson: true; parsed: object } | { isJson: false; original: unknown } {
  if (value !== null && typeof value === "object") {
    return { isJson: true, parsed: value as object };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null) {
          return { isJson: true, parsed };
        }
      } catch {
        // Not valid JSON
      }
    }
  }
  return { isJson: false, original: value };
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
 * Check if a node or any of its descendants match the search term
 */
function nodeMatchesSearch(node: TreeNodeData, searchTerm: string): boolean {
  if (!searchTerm) return true;
  const term = searchTerm.toLowerCase();

  if (node.key.toLowerCase().includes(term)) return true;

  if (node.value && typeof node.value === "object") {
    const entries = Array.isArray(node.value)
      ? node.value.map((v, i) => [String(i), v])
      : Object.entries(node.value);

    for (const [key, value] of entries) {
      const childNode: TreeNodeData = {
        key: String(key),
        value,
        path: [...node.path, String(key)],
      };
      if (nodeMatchesSearch(childNode, searchTerm)) return true;
    }
  }

  return false;
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
  searchTerm: string;
  indexInParent?: number;
  stepIndex?: number;
  stepId?: string;
  /** For x.y numbering: the parent group's display number */
  parentNumber?: string;
  /** Whether this node is a child of a group */
  isGroupChild?: boolean;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig?: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function TreeNode({
  node,
  level,
  searchTerm,
  indexInParent,
  stepIndex,
  stepId,
  parentNumber,
  isGroupChild: _isGroupChild,
  onLeafDoubleClick,
  onShowModuleConfig
}: TreeNodeProps) {
  const hasMatchingDescendant = useMemo(() => {
    if (!searchTerm) return false;
    return nodeMatchesSearch(node, searchTerm);
  }, [node, searchTerm]);

  const [isOpen, setIsOpen] = useState(false);

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);
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
      setIsOpen((prev) => !prev);
    }
  }, [isLeaf]);

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
  const keyMatches = searchTerm && node.key.toLowerCase().includes(searchTerm.toLowerCase());

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

            return children
              .filter((child) => child.key !== "_metadata")
              .map((child) => {
                const childMetadata = getNodeMetadata(child.value);
                const childIsModule = childMetadata.nodeType === "module";
                const childIsStep = childMetadata.nodeType === "step";

                let childStepId = stepId;
                if (childIsStep) {
                  childStepId = child.key;
                }

                const currentModuleIndex = childIsModule ? moduleIndex++ : undefined;
                const currentStepIndex = childIsStep ? stepIdx++ : undefined;

                return (
                  <TreeNode
                    key={child.key}
                    node={child}
                    level={level + 1}
                    searchTerm={searchTerm}
                    indexInParent={currentModuleIndex}
                    stepIndex={currentStepIndex}
                    stepId={childStepId}
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
  searchTerm: string;
  stepId: string;
  groupIndex: number;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function GroupNode({
  organizedModule,
  level,
  searchTerm,
  stepId,
  groupIndex,
  onLeafDoubleClick,
  onShowModuleConfig,
}: GroupNodeProps) {
  const [isOpen, setIsOpen] = useState(true);  // Groups start expanded

  const keyMatches = searchTerm && organizedModule.name.toLowerCase().includes(searchTerm.toLowerCase());

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
          {organizedModule.children.map((child, childIndex) => {
            const childNode: TreeNodeData = {
              key: child.name,
              value: child.stateValue,
              path: ["steps", stepId, child.name],
            };

            return (
              <TreeNode
                key={child.name}
                node={childNode}
                level={level + 1}
                searchTerm={searchTerm}
                indexInParent={childIndex}
                stepId={stepId}
                parentNumber={displayNumber}
                isGroupChild={true}
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
  searchTerm: string;
  rawModules: ModuleConfig[] | undefined;
  flattenedModules: ModuleConfig[] | undefined;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function OrganizedStepNode({
  stepId,
  stepValue,
  stepIndex,
  level,
  searchTerm,
  rawModules,
  flattenedModules,
  onLeafDoubleClick,
  onShowModuleConfig,
}: OrganizedStepNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const hasMatchingDescendant = useMemo(() => {
    if (!searchTerm) return false;
    const node: TreeNodeData = { key: stepId, value: stepValue, path: ["steps", stepId] };
    return nodeMatchesSearch(node, searchTerm);
  }, [stepId, stepValue, searchTerm]);

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);
  const keyMatches = searchTerm && stepId.toLowerCase().includes(searchTerm.toLowerCase());

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

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
          {organizedModules.map((orgMod, index) => {
            if (orgMod.isGroup) {
              return (
                <GroupNode
                  key={orgMod.name}
                  organizedModule={orgMod}
                  level={level + 1}
                  searchTerm={searchTerm}
                  stepId={stepId}
                  groupIndex={index}
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
                  searchTerm={searchTerm}
                  indexInParent={index}
                  stepId={stepId}
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
  searchTerm: string;
  rawWorkflowDefinition: WorkflowDefinition | null;
  workflowDefinition: WorkflowDefinition | null;
  onLeafDoubleClick: (path: string, value: unknown) => void;
  onShowModuleConfig: (stepId: string, moduleName: string, isGroup: boolean) => void;
}

function StepsNode({
  stepsValue,
  searchTerm,
  rawWorkflowDefinition,
  workflowDefinition,
  onLeafDoubleClick,
  onShowModuleConfig,
}: StepsNodeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const stepEntries = useMemo(() =>
    Object.entries(stepsValue).filter(([k]) => k !== "_metadata"),
    [stepsValue]
  );

  const hasMatchingDescendant = useMemo(() => {
    if (!searchTerm) return false;
    const node: TreeNodeData = { key: "steps", value: stepsValue, path: ["steps"] };
    return nodeMatchesSearch(node, searchTerm);
  }, [stepsValue, searchTerm]);

  const effectiveIsOpen = isOpen || (searchTerm && hasMatchingDescendant);
  const keyMatches = searchTerm && "steps".toLowerCase().includes(searchTerm.toLowerCase());

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

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
          {stepEntries.map(([stepId, stepValue], stepIndex) => (
            <OrganizedStepNode
              key={stepId}
              stepId={stepId}
              stepValue={stepValue}
              stepIndex={stepIndex}
              level={1}
              searchTerm={searchTerm}
              rawModules={getStepModules(stepId, rawWorkflowDefinition)}
              flattenedModules={getStepModules(stepId, workflowDefinition)}
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

  const handleCopy = useCallback(async () => {
    try {
      const text = ((value !== null && typeof value === "object")
        ? JSON.stringify(value, null, 2)
        : String(value))
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [value]);

  return (
    <button
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
    getRawModuleConfig
  } = useWorkflowStateContext();

  const [searchTerm, setSearchTerm] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [popup, setPopup] = useState<ValuePopupState>({
    open: false,
    path: "",
    value: null,
  });
  const [configPopup, setConfigPopup] = useState<ConfigPopupState>({
    open: false,
    stepId: "",
    moduleName: "",
    isGroup: false,
  });

  const handleLeafDoubleClick = useCallback((path: string, value: unknown) => {
    setPopup({ open: true, path, value });
  }, []);

  const handleClosePopup = useCallback(() => {
    setPopup((prev) => ({ ...prev, open: false }));
  }, []);

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
  const allowedKeys = ["steps", "state_mapped"];
  const rootNodes: TreeNodeData[] = Object.entries(state)
    .filter(([key]) => allowedKeys.includes(key))
    .map(([key, value]) => ({
      key,
      value,
      path: [key],
    }));

  // Filter root nodes based on search
  const filteredNodes = useMemo(() => {
    if (!searchTerm) return rootNodes;
    return rootNodes.filter((node) => nodeMatchesSearch(node, searchTerm));
  }, [rootNodes, searchTerm]);

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
                searchTerm={searchTerm}
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
              searchTerm={searchTerm}
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
              placeholder="Search state..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-inner">
            {renderTreeContent()}
          </div>
        </CardContent>
      </Card>

      {/* Value Popup Dialog */}
      <Dialog open={popup.open} onOpenChange={handleClosePopup}>
        <DialogContent size="medium" className="flex flex-col overflow-hidden">
          <CopyButton value={popup.value} className="absolute top-4 right-12" />
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-sm pr-16">{popup.path}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-inner">
            {(() => {
              const result = tryParseJson(popup.value);
              if (result.isJson) {
                return (
                  <div className="bg-muted p-4 rounded">
                    <JsonTreeView data={result.parsed} defaultExpandDepth={2} />
                  </div>
                );
              }
              return (
                <pre className="text-sm bg-muted p-4 rounded whitespace-pre-wrap break-words">
                  {formatValue(result.original)}
                </pre>
              );
            })()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Module/Group Config Popup Dialog */}
      <Dialog open={configPopup.open} onOpenChange={handleCloseConfigPopup}>
        <DialogContent size="medium" className="flex flex-col overflow-hidden">
          {currentModuleConfig && <CopyButton value={currentModuleConfig} className="absolute top-4 right-12" />}
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
              placeholder="Search state..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
