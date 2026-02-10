import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Panel,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLocation, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  type StepDefinition,
  type WorkflowDefinition,
} from "@wfm/shared";
import { editorApi } from "@/api";
import {
  useVirtualRuntime,
  VirtualRuntimePanel,
  StatePanel,
  type ModuleLocation,
} from "@/runtime";
import {
  UserSelectNode,
  type UserSelectNodeData,
  MODULE_WIDTH,
} from "@/components/nodes/UserSelectNode";
import {
  WeightedKeywordsNode,
  type WeightedKeywordsNodeData,
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
} from "@/components/nodes/PlaceholderNode";
import {
  LLMNode,
  type LLMNodeData,
} from "@/components/nodes/LLMNode";
import { type UserSelectModule } from "@/modules/user-select/types";
import { type WeightedKeywordsModule } from "@/modules/weighted-keywords/types";
import { type LLMModule } from "@/modules/llm/types";
import {
  useNodeHeights,
  NodeHeightsProvider,
} from "@/hooks/useNodeHeights";

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
  llm: LLMNode,
  placeholder: PlaceholderNode,
};

// Supported module types with their node type mappings
const SUPPORTED_MODULES: Record<string, string> = {
  "user.select": "userSelect",
  "io.weighted_keywords": "weightedKeywords",
  "api.llm": "llm",
};

/**
 * Get the node type for a module based on its module_id.
 * Returns "placeholder" for unsupported module types.
 */
function getNodeTypeForModule(moduleId: string): string {
  return SUPPORTED_MODULES[moduleId] || "placeholder";
}



// =============================================================================
// Zoom Controls Component
// =============================================================================

function ZoomControls() {
  const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
  const [zoom, setZoom] = useState(1);

  // Update zoom display when zoom changes
  useEffect(() => {
    const updateZoom = () => setZoom(getZoom());
    updateZoom();
    // Poll for zoom changes (ReactFlow doesn't have a zoom change event)
    const interval = setInterval(updateZoom, 100);
    return () => clearInterval(interval);
  }, [getZoom]);

  const zoomPercentage = Math.round(zoom * 100);

  return (
    <Panel position="bottom-right">
      <div className="flex items-center gap-1 rounded-lg border bg-card/95 p-1 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={() => zoomOut()}
          title="Zoom out"
        >
          <span className="text-lg font-medium">−</span>
        </button>
        <span className="min-w-[4rem] text-center text-xs font-medium tabular-nums">
          {zoomPercentage}%
        </span>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
          onClick={() => zoomIn()}
          title="Zoom in"
        >
          <span className="text-lg font-medium">+</span>
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          type="button"
          className="flex h-8 items-center justify-center rounded-md px-2 text-xs hover:bg-muted transition-colors"
          onClick={() => fitView({ padding: 0.3 })}
          title="Fit to view"
        >
          Fit
        </button>
      </div>
    </Panel>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function WorkflowEditorPage() {
  const { workflowTemplateId } = useParams<{ workflowTemplateId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as EditorLocationState;
  const [isWorkflowViewOpen, setIsWorkflowViewOpen] = useState(false);

  // Track measured heights of module nodes for dynamic layout
  const nodeHeights = useNodeHeights();

  // Virtual runtime for module preview
  const runtime = useVirtualRuntime();

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

  const handleLLMModuleChange = useCallback(
    (stepId: string, moduleName: string, updatedModule: LLMModule) => {
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
    (moduleId: string, expanded: boolean, estimatedHeight: number) => {
      // Set estimated height synchronously with expanded state change
      // This ensures the step container resizes in the same render cycle
      nodeHeights.setEstimatedHeight(moduleId, estimatedHeight);
      setExpandedModules((prev) => ({
        ...prev,
        [moduleId]: expanded,
      }));
    },
    [nodeHeights]
  );

  /**
   * Build the current workflow definition from editor state.
   * Used for virtual runtime preview.
   */
  const buildWorkflowDefinition = useCallback((): WorkflowDefinition => {
    return {
      workflow_id: workflowInfo.workflow_id,
      name: workflowInfo.name,
      description: workflowInfo.description,
      steps,
    };
  }, [workflowInfo, steps]);

  /**
   * Handle module preview request.
   * Runs the virtual runtime to the target module.
   */
  const handleModulePreview = useCallback(
    async (target: ModuleLocation) => {
      const workflow = buildWorkflowDefinition();
      await runtime.actions.runToModule(workflow, target, []);
    },
    [buildWorkflowDefinition, runtime.actions]
  );

  /**
   * Handle module view state request.
   * Runs the virtual runtime to the target module and opens state panel.
   */
  const handleModuleViewState = useCallback(
    async (target: ModuleLocation) => {
      const workflow = buildWorkflowDefinition();
      await runtime.actions.runToModuleForState(workflow, target, []);
    },
    [buildWorkflowDefinition, runtime.actions]
  );

  /**
   * Handle interaction response in preview panel.
   */
  const handlePreviewSubmit = useCallback(
    async (response: Parameters<typeof runtime.actions.submitResponse>[2]) => {
      const workflow = buildWorkflowDefinition();
      const target = runtime.currentTarget;
      if (target) {
        await runtime.actions.submitResponse(workflow, target, response);
      }
    },
    [buildWorkflowDefinition, runtime.actions, runtime.currentTarget]
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
    const stepWidth = MODULE_WIDTH + stepPadding * 2;

    // Default height used before actual measurement is available
    const DEFAULT_MODULE_HEIGHT = 100;

    // Helper to get module height - uses measured height if available, falls back to default
    const getModuleHeight = (moduleNodeId: string) => {
      return nodeHeights.heights[moduleNodeId] ?? DEFAULT_MODULE_HEIGHT;
    };

    let currentStepX = stepStartX;

    // Build step and module nodes
    // IMPORTANT: Step nodes must come before their child module nodes
    steps.forEach((step, stepIndex) => {
      const stepNodeId = `step_${step.step_id}`;

      // Calculate step height to contain all modules with padding
      // Sum up actual module heights (using measured heights)
      const modulesHeight = step.modules.length > 0
        ? step.modules.reduce((sum, mod) => {
            const moduleNodeId = `module_${step.step_id}_${mod.name}`;
            return sum + getModuleHeight(moduleNodeId);
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
        const moduleHeight = getModuleHeight(moduleNodeId);
        
        // Position relative to parent step node
        const moduleX = stepPadding;
        const moduleY = currentModuleY;

        // Build node data based on module type
        if (nodeType === "userSelect") {
          nodes.push({
            id: moduleNodeId,
            type: "userSelect",
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: true,
            data: {
              module: module as UserSelectModule,
              onModuleChange: (updated: UserSelectModule) =>
                handleModuleChange(step.step_id, module.name!, updated),
              expanded: isExpanded,
              onExpandedChange: (exp: boolean, height: number) =>
                handleModuleExpandedChange(moduleNodeId, exp, height),
              onViewState: () =>
                handleModuleViewState({ step_id: step.step_id, module_name: module.name! }),
              onPreview: () =>
                handleModulePreview({ step_id: step.step_id, module_name: module.name! }),
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
            data: {
              module: module as WeightedKeywordsModule,
              onModuleChange: (updated: WeightedKeywordsModule) =>
                handleWeightedKeywordsModuleChange(step.step_id, module.name!, updated),
              expanded: isExpanded,
              onExpandedChange: (exp: boolean, height: number) =>
                handleModuleExpandedChange(moduleNodeId, exp, height),
              onViewState: () =>
                handleModuleViewState({ step_id: step.step_id, module_name: module.name! }),
            } satisfies WeightedKeywordsNodeData,
          });
        } else if (nodeType === "llm") {
          nodes.push({
            id: moduleNodeId,
            type: "llm",
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: true,
            data: {
              module: module as LLMModule,
              onModuleChange: (updated: LLMModule) =>
                handleLLMModuleChange(step.step_id, module.name!, updated),
              expanded: isExpanded,
              onExpandedChange: (exp: boolean, height: number) =>
                handleModuleExpandedChange(moduleNodeId, exp, height),
              onViewState: () =>
                handleModuleViewState({ step_id: step.step_id, module_name: module.name! }),
            } satisfies LLMNodeData,
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
            data: {
              module,
              onViewState: () =>
                handleModuleViewState({ step_id: step.step_id, module_name: module.name! }),
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
  }, [workflowInfo, steps, expandedModules, nodeHeights.heights, handleWorkflowChange, handleStepChange, handleModuleChange, handleWeightedKeywordsModuleChange, handleLLMModuleChange, handleModuleExpandedChange, handleModuleViewState, handleModulePreview]);

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
    <NodeHeightsProvider value={nodeHeights}>
      <div className="relative h-full min-h-0 bg-background text-foreground">
        <ReactFlow
          edges={edges}
          nodes={nodes}
          nodeTypes={nodeTypes}
          onEdgesChange={onEdgesChange}
          onNodesChange={onNodesChange}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          minZoom={0.25}
          maxZoom={2}
        >
          <Background gap={20} />
          <ZoomControls />
        </ReactFlow>

      {/* Top Left - View Workflow & State Buttons */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="shadow-sm"
          onClick={() => setIsWorkflowViewOpen(true)}
        >
          View Full Workflow
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="shadow-sm"
          onClick={() => runtime.actions.openFullStatePanel()}
          disabled={!runtime.state}
        >
          View Full State
        </Button>

        {/* Loading/Error indicators */}
        {templateLoading && (
          <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
        )}
        {templateError && (
          <Alert className="mt-2 max-w-xs">
            <AlertDescription>{templateError}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Full Workflow JSON Dialog */}
      <Dialog open={isWorkflowViewOpen} onOpenChange={setIsWorkflowViewOpen}>
        <DialogContent
          className="flex flex-col p-0"
          style={{ width: "80vw", height: "80vh", maxWidth: "80vw", maxHeight: "80vh" }}
        >
          <DialogHeader className="px-6 pt-6 pb-2">
            <DialogTitle>
              Full Workflow Definition
              {resolvedVersionId && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  (v: {resolvedVersionId.slice(0, 8)}...)
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 px-2 pb-2">
            <Editor
              height="100%"
              defaultLanguage="json"
              value={JSON.stringify(
                {
                  workflow_id: workflowInfo.workflow_id,
                  name: workflowInfo.name,
                  description: workflowInfo.description,
                  steps,
                },
                null,
                2
              )}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                folding: true,
                wordWrap: "on",
                automaticLayout: true,
              }}
              theme="vs-dark"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Virtual Runtime Preview Panel */}
      <VirtualRuntimePanel
        open={runtime.panelOpen}
        onOpenChange={runtime.actions.setPanelOpen}
        status={runtime.status}
        busy={runtime.busy}
        response={runtime.lastResponse}
        error={runtime.error}
        onSubmit={handlePreviewSubmit}
      />

      {/* State Panel (left drawer) */}
      <StatePanel
        open={runtime.statePanelOpen}
        onOpenChange={runtime.actions.setStatePanelOpen}
        workflow={buildWorkflowDefinition()}
        state={runtime.state}
        loading={runtime.busy}
        upToModule={runtime.stateUpToModule}
      />
      </div>
    </NodeHeightsProvider>
  );
}
