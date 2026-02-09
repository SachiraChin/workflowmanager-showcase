import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLocation, useParams } from "react-router-dom";
import {
  Alert,
  AlertDescription,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type StepDefinition,
} from "@wfm/shared";
import { editorApi } from "@/api";
import {
  UserSelectNode,
  type UserSelectNodeData,
  MODULE_HEIGHT_COLLAPSED,
  MODULE_HEIGHT_EXPANDED,
  MODULE_WIDTH_EXPANDED,
} from "@/components/nodes/UserSelectNode";
import {
  WeightedKeywordsNode,
  type WeightedKeywordsNodeData,
  MODULE_HEIGHT_COLLAPSED as WK_MODULE_HEIGHT_COLLAPSED,
  MODULE_HEIGHT_EXPANDED_LOAD,
  MODULE_HEIGHT_EXPANDED_SAVE,
} from "@/components/nodes/WeightedKeywordsNode";
import {
  StepNode,
  type StepNodeData,
} from "@/components/nodes/StepNode";
import {
  WorkflowNode,
  type WorkflowNodeData,
  type WorkflowInfo,
} from "@/components/nodes/WorkflowNode";
import {
  PlaceholderNode,
  type PlaceholderNodeData,
  PLACEHOLDER_HEIGHT,
} from "@/components/nodes/PlaceholderNode";
import { type UserSelectModule } from "@/modules/user-select/types";
import { type WeightedKeywordsModule } from "@/modules/weighted-keywords/types";

// =============================================================================
// Types
// =============================================================================

type EditorLocationState = {
  workflowVersionId?: string;
  workflowName?: string;
  workflowId?: string;
};

// =============================================================================
// Node Types Registration
// =============================================================================

const nodeTypes = {
  workflow: WorkflowNode,
  step: StepNode,
  userSelect: UserSelectNode,
  weightedKeywords: WeightedKeywordsNode,
  placeholder: PlaceholderNode,
};

// Supported module types with their node type mappings
const SUPPORTED_MODULES: Record<string, string> = {
  "user.select": "userSelect",
  "io.weighted_keywords": "weightedKeywords",
};

/**
 * Get the node type for a module based on its module_id.
 * Returns "placeholder" for unsupported module types.
 */
function getNodeTypeForModule(moduleId: string): string {
  return SUPPORTED_MODULES[moduleId] || "placeholder";
}

// =============================================================================
// Module Library
// =============================================================================

const MODULE_LIBRARY = [
  {
    moduleId: "user.select",
    title: "User Select",
    description: "Collects user choices from structured options.",
    status: "available",
  },
  {
    moduleId: "io.weighted_keywords",
    title: "Weighted Keywords",
    description: "Load or save weighted keywords for deduplication.",
    status: "available",
  },
] as const;

// =============================================================================
// Main Component
// =============================================================================

export function WorkflowEditorPage() {
  const { workflowTemplateId } = useParams<{ workflowTemplateId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as EditorLocationState;
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);

  const isCreateMode = !workflowTemplateId;
  const requestedVersionFromQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("workflow_version_id");
  }, [location.search]);
  const requestedVersionId = state.workflowVersionId || requestedVersionFromQuery;

  const [templateLoading, setTemplateLoading] = useState(!isCreateMode);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [resolvedVersionId, setResolvedVersionId] = useState<string | null>(
    requestedVersionId || null
  );

  // =============================================================================
  // Workflow State
  // =============================================================================

  const [workflowInfo, setWorkflowInfo] = useState<WorkflowInfo>({
    workflow_id: state.workflowId || "new_workflow",
    name: state.workflowName || "Untitled Workflow",
    description: undefined,
  });

  // Track which modules are expanded (key = moduleNodeId, value = expanded state)
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  // Steps from loaded workflow (empty until loaded in edit mode)
  const [steps, setSteps] = useState<StepDefinition[]>([]);

  // =============================================================================
  // Handlers
  // =============================================================================

  const handleWorkflowChange = useCallback((workflow: WorkflowInfo) => {
    setWorkflowInfo(workflow);
  }, []);

  const handleStepChange = useCallback((stepId: string, updatedStep: StepDefinition) => {
    setSteps((prev) =>
      prev.map((step) => (step.step_id === stepId ? updatedStep : step))
    );
  }, []);

  const handleModuleChange = useCallback(
    (stepId: string, moduleName: string, updatedModule: UserSelectModule) => {
      setSteps((prev) =>
        prev.map((step) => {
          if (step.step_id !== stepId) return step;
          return {
            ...step,
            modules: step.modules.map((mod) =>
              mod.name === moduleName ? updatedModule : mod
            ),
          };
        })
      );
    },
    []
  );

  const handleWeightedKeywordsModuleChange = useCallback(
    (stepId: string, moduleName: string, updatedModule: WeightedKeywordsModule) => {
      setSteps((prev) =>
        prev.map((step) => {
          if (step.step_id !== stepId) return step;
          return {
            ...step,
            modules: step.modules.map((mod) =>
              mod.name === moduleName ? updatedModule : mod
            ),
          };
        })
      );
    },
    []
  );

  const handleModuleExpandedChange = useCallback(
    (moduleId: string, expanded: boolean) => {
      setExpandedModules((prev) => ({
        ...prev,
        [moduleId]: expanded,
      }));
    },
    []
  );

  // =============================================================================
  // Build Nodes and Edges
  // =============================================================================

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Layout constants - horizontal step layout
    const workflowNodeWidth = 200; // Approximate width of workflow node
    const workflowNodeX = 20;
    const stepStartX = workflowNodeX + workflowNodeWidth + 200; // Space after workflow node
    const stepStartY = 50;
    const stepSpacingX = 80; // Horizontal spacing between steps

    // Workflow node - positioned to the left of steps
    nodes.push({
      id: "workflow",
      type: "workflow",
      position: { x: workflowNodeX, y: stepStartY + 50 },
      data: {
        workflow: workflowInfo,
        onWorkflowChange: handleWorkflowChange,
      } satisfies WorkflowNodeData,
    });
    const stepPadding = 40; // Padding inside step container (space around modules)
    const stepHeaderHeight = 32; // Height of step header bar
    const moduleSpacingY = 20; // Vertical spacing between modules
    // Step width sized for expanded modules so padding stays ~40px on expand
    const stepWidth = MODULE_WIDTH_EXPANDED + stepPadding * 2;

    // Helper to get module height based on module type and expanded state
    const getModuleHeight = (
      moduleNodeId: string,
      moduleId: string,
      moduleConfig?: { inputs?: { mode?: string } }
    ) => {
      const nodeType = getNodeTypeForModule(moduleId);
      if (nodeType === "placeholder") {
        return PLACEHOLDER_HEIGHT;
      }
      const isExpanded = expandedModules[moduleNodeId] ?? false;
      if (nodeType === "weightedKeywords") {
        if (!isExpanded) return WK_MODULE_HEIGHT_COLLAPSED;
        // Height depends on mode
        const mode = moduleConfig?.inputs?.mode;
        return mode === "save" ? MODULE_HEIGHT_EXPANDED_SAVE : MODULE_HEIGHT_EXPANDED_LOAD;
      }
      // For userSelect, use standard heights
      return isExpanded ? MODULE_HEIGHT_EXPANDED : MODULE_HEIGHT_COLLAPSED;
    };

    let currentStepX = stepStartX;

    // Build step and module nodes
    // IMPORTANT: Step nodes must come before their child module nodes
    steps.forEach((step, stepIndex) => {
      const stepNodeId = `step_${step.step_id}`;

      // Calculate step height to contain all modules with padding
      // Sum up actual module heights (accounting for which are expanded)
      const modulesHeight = step.modules.length > 0
        ? step.modules.reduce((sum, mod) => {
            const moduleNodeId = `module_${step.step_id}_${mod.name}`;
            return sum + getModuleHeight(moduleNodeId, mod.module_id, mod);
          }, 0) + (step.modules.length - 1) * moduleSpacingY
        : 60; // Minimum height when empty
      const stepHeight = stepHeaderHeight + stepPadding + modulesHeight + stepPadding;

      // Step node (parent container) - positioned horizontally
      nodes.push({
        id: stepNodeId,
        type: "step",
        position: { x: currentStepX, y: stepStartY },
        data: {
          step,
          onStepChange: (updated: StepDefinition) => handleStepChange(step.step_id, updated),
          width: stepWidth,
          height: stepHeight,
        } satisfies StepNodeData,
        style: { width: stepWidth, height: stepHeight },
      });

      // Module nodes within this step - positioned relative to parent step
      let currentModuleY = stepHeaderHeight + stepPadding;
      step.modules.forEach((module, moduleIndex) => {
        const moduleNodeId = `module_${step.step_id}_${module.name}`;
        const nodeType = getNodeTypeForModule(module.module_id);
        const isExpanded = expandedModules[moduleNodeId] ?? false;
        const moduleHeight = getModuleHeight(moduleNodeId, module.module_id, module);
        
        // Position relative to parent step node
        const moduleX = stepPadding;
        const moduleY = currentModuleY;

        // Calculate zIndex: earlier modules (lower Y) should appear on top of later ones
        // This ensures expanded modules don't get hidden behind modules below them
        const moduleZIndex = 1000 - moduleIndex;

        // Build node data based on module type
        if (nodeType === "userSelect") {
          nodes.push({
            id: moduleNodeId,
            type: "userSelect",
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: true,
            zIndex: moduleZIndex,
            data: {
              module: module as UserSelectModule,
              onModuleChange: (updated: UserSelectModule) =>
                handleModuleChange(step.step_id, module.name!, updated),
              expanded: isExpanded,
              onExpandedChange: (exp: boolean) => handleModuleExpandedChange(moduleNodeId, exp),
            } satisfies UserSelectNodeData,
          });
        } else if (nodeType === "weightedKeywords") {
          nodes.push({
            id: moduleNodeId,
            type: "weightedKeywords",
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: true,
            zIndex: moduleZIndex,
            data: {
              module: module as WeightedKeywordsModule,
              onModuleChange: (updated: WeightedKeywordsModule) =>
                handleWeightedKeywordsModuleChange(step.step_id, module.name!, updated),
              expanded: isExpanded,
              onExpandedChange: (exp: boolean) => handleModuleExpandedChange(moduleNodeId, exp),
            } satisfies WeightedKeywordsNodeData,
          });
        } else {
          // Placeholder for unsupported module types
          nodes.push({
            id: moduleNodeId,
            type: "placeholder",
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: true,
            zIndex: moduleZIndex,
            data: {
              module,
            } satisfies PlaceholderNodeData,
          });
        }

        // Update Y position for next module
        currentModuleY += moduleHeight + moduleSpacingY;

        // Connect modules within the step
        if (moduleIndex > 0) {
          const prevModuleId = `module_${step.step_id}_${step.modules[moduleIndex - 1].name}`;
          edges.push({
            id: `${prevModuleId}_to_${moduleNodeId}`,
            type: "default",
            source: prevModuleId,
            sourceHandle: "out",
            target: moduleNodeId,
            targetHandle: "in",
            style: { stroke: "#888", strokeWidth: 4, strokeDasharray: "4 2" },
          });
        }
      });

      // Connect workflow to first step
      if (stepIndex === 0) {
        edges.push({
          id: "workflow_to_first_step",
          type: "default",
          source: "workflow",
          sourceHandle: "workflow-out",
          target: stepNodeId,
          targetHandle: "step-in",
          style: { stroke: "#3b82f6", strokeWidth: 4 },
        });
      }

      // Connect steps to each other
      if (stepIndex > 0) {
        const prevStepId = `step_${steps[stepIndex - 1].step_id}`;
        edges.push({
          id: `${prevStepId}_to_${stepNodeId}`,
          type: "default",
          source: prevStepId,
          sourceHandle: "step-out",
          target: stepNodeId,
          targetHandle: "step-in",
          style: { stroke: "#888", strokeWidth: 4 },
        });
      }

      currentStepX += stepWidth + stepSpacingX;
    });

    return { nodes, edges };
  }, [workflowInfo, steps, expandedModules, handleWorkflowChange, handleStepChange, handleModuleChange, handleWeightedKeywordsModuleChange, handleModuleExpandedChange]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  // Sync when computed values change
  useEffect(() => {
    console.log("[WorkflowEditor] Syncing nodes:", initialNodes.length);
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    console.log("[WorkflowEditor] Syncing edges:", initialEdges.length);
    // Log first few edges in detail
    initialEdges.slice(0, 3).forEach((e, i) => {
      console.log(`  Edge ${i}:`, {
        id: e.id,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
      });
    });
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // =============================================================================
  // Load Workflow Definition
  // =============================================================================

  useEffect(() => {
    if (isCreateMode) {
      setTemplateLoading(false);
      // In create mode, start with empty steps (user will add modules)
      return;
    }

    if (!workflowTemplateId) {
      setTemplateLoading(false);
      return;
    }

    let alive = true;
    const loadWorkflowDefinition = async () => {
      setTemplateLoading(true);
      setTemplateError(null);

      try {
        // Fetch the workflow definition - either specific version or latest
        const response = requestedVersionId
          ? await editorApi.getWorkflowTemplateVersion(workflowTemplateId, requestedVersionId)
          : await editorApi.getWorkflowTemplateVersionLatest(workflowTemplateId);

        if (!alive) return;

        const { definition, workflow_version_id } = response;

        // Update workflow info from the loaded definition
        setWorkflowInfo({
          workflow_id: definition.workflow_id,
          name: definition.name || response.template_name,
          description: definition.description,
        });

        // Update steps from the loaded definition
        setSteps(definition.steps);

        // Track the resolved version
        setResolvedVersionId(workflow_version_id);
      } catch (error) {
        if (!alive) return;
        setTemplateError(
          error instanceof Error ? error.message : "Failed to load workflow definition"
        );
      } finally {
        if (alive) setTemplateLoading(false);
      }
    };

    void loadWorkflowDefinition();
    return () => {
      alive = false;
    };
  }, [isCreateMode, requestedVersionId, workflowTemplateId]);

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <div className="relative h-full min-h-0 bg-background text-foreground">
      <ReactFlow
        fitView
        edges={edges}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        fitViewOptions={{ padding: 0.3 }}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      {/* Left Panel - Module Library */}
      <div className="pointer-events-none absolute inset-y-4 left-4 z-20 flex">
        {!leftPanelCollapsed ? (
          <aside className="pointer-events-auto h-full w-72 overflow-auto rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
            <div className="space-y-4">
              <section>
                <h2 className="text-sm font-semibold">Module Library</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Drag modules onto the canvas to add them.
                </p>
              </section>

              {MODULE_LIBRARY.map((module) => (
                <Card key={module.moduleId} className="cursor-grab active:cursor-grabbing">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm">{module.title}</CardTitle>
                      <Badge variant="secondary" className="text-[10px]">
                        {module.status}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">{module.moduleId}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{module.description}</p>
                  </CardContent>
                </Card>
              ))}

              {/* Workflow Info */}
              {templateError ? (
                <Alert>
                  <AlertDescription>{templateError}</AlertDescription>
                </Alert>
              ) : null}

              {templateLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : null}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs">Session Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-[11px] text-muted-foreground">
                  <p>Mode: {isCreateMode ? "create" : "edit"}</p>
                  <p>Workflow: {workflowInfo.name || "Untitled"}</p>
                  <p>Steps: {steps.length}</p>
                  {!isCreateMode && (
                    <p>Version: {resolvedVersionId || "latest"}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          </aside>
        ) : null}
        <button
          className="pointer-events-auto ml-2 mt-3 h-8 rounded-md border bg-card px-2 text-xs shadow-sm hover:bg-muted/50"
          onClick={() => setLeftPanelCollapsed((current) => !current)}
          type="button"
        >
          {leftPanelCollapsed ? "Library" : "Hide"}
        </button>
      </div>
    </div>
  );
}
