import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import {
  Alert,
  AlertDescription,
  Button,
  type InteractionRequest,
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
  useNodeHeights,
  NodeHeightsProvider,
} from "@/hooks/useNodeHeights";
import { ZoomControls } from "@/components/ZoomControls";
import { CloneTemplateDialog, type CloneInfo } from "@/components/CloneTemplateDialog";
import { WorkflowJsonDialog } from "@/components/WorkflowJsonDialog";

// Import module system - this triggers all module registrations
import { buildNodeTypes, getModuleRegistration } from "@/modules";

// Import MODULE_WIDTH constant (used for layout calculations)
import { MODULE_WIDTH } from "@/modules/user/select";

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

// Build nodeTypes from registry + structural nodes
const nodeTypes = buildNodeTypes({
  workflow: WorkflowNode,
  step: StepNode,
  placeholder: PlaceholderNode,
});



// =============================================================================
// =============================================================================
// Main Component
// =============================================================================

export function WorkflowEditorPage() {
  const { workflowTemplateId, workflowVersionId: urlVersionId } = useParams<{
    workflowTemplateId: string;
    workflowVersionId: string;
  }>();
  const location = useLocation();
  const state = (location.state ?? {}) as EditorLocationState;
  const [isWorkflowViewOpen, setIsWorkflowViewOpen] = useState(false);

  // Track measured heights of module nodes for dynamic layout
  const nodeHeights = useNodeHeights();

  // Virtual runtime for module preview
  const runtime = useVirtualRuntime();

  const isCreateMode = !workflowTemplateId;
  // Version priority: URL path > router state > query param
  const requestedVersionFromQuery = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get("workflow_version_id");
  }, [location.search]);
  const requestedVersionId = urlVersionId || state.workflowVersionId || requestedVersionFromQuery;

  const navigate = useNavigate();
  
  const [templateLoading, setTemplateLoading] = useState(!isCreateMode);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [resolvedVersionId, setResolvedVersionId] = useState<string | null>(
    requestedVersionId || null
  );

  // Clone confirmation dialog state (for non-admin editing global templates)
  const [showCloneDialog, setShowCloneDialog] = useState(false);
  const [cloneInfo, setCloneInfo] = useState<CloneInfo | null>(null);
  const [isCloning, setIsCloning] = useState(false);

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

  /**
   * Generic module change handler - works for all module types.
   * Type safety is ensured by the module node components themselves.
   */
  const handleModuleChange = useCallback(
    (stepId: string, moduleName: string, updatedModule: unknown) => {
      setSteps((prev) =>
        prev.map((step) => {
          if (step.step_id !== stepId) return step;
          return {
            ...step,
            modules: step.modules.map((mod) =>
              mod.name === moduleName ? (updatedModule as typeof mod) : mod
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
   * Build workflow definition with one module temporarily overridden.
   * Used for runtime preview of unsaved editor drafts.
   */
  const buildWorkflowDefinitionWithOverride = useCallback(
    (
      target: ModuleLocation,
      moduleOverride: unknown
    ): WorkflowDefinition => {
      return {
        workflow_id: workflowInfo.workflow_id,
        name: workflowInfo.name,
        description: workflowInfo.description,
        steps: steps.map((step) => {
          if (step.step_id !== target.step_id) return step;
          return {
            ...step,
            modules: step.modules.map((mod) =>
              mod.name === target.module_name ? (moduleOverride as typeof mod) : mod
            ),
          };
        }),
      };
    },
    [workflowInfo, steps]
  );

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

  /**
   * Get completed interaction for current target (for backward navigation).
   * Only relevant when status is "completed" and we have a target.
   */
  const completedInteraction = useMemo(() => {
    if (runtime.status !== "completed" || !runtime.currentTarget) {
      return null;
    }
    return runtime.actions.getInteractionForModule(runtime.currentTarget);
  }, [runtime.status, runtime.currentTarget, runtime.actions]);

  const isSameModuleTarget = useCallback(
    (a: ModuleLocation | null, b: ModuleLocation) => {
      return !!a && a.step_id === b.step_id && a.module_name === b.module_name;
    },
    []
  );

  /**
   * Handle reload with different mock mode.
   * Resets and re-runs to current target with specified mock mode.
   */
  const handleReloadWithMockMode = useCallback(
    async (mockMode: boolean) => {
      const workflow = buildWorkflowDefinition();
      await runtime.actions.reloadWithMockMode(workflow, mockMode, []);
    },
    [buildWorkflowDefinition, runtime.actions]
  );

  /**
   * Handle clone confirmation - clone global template to user's template.
   */
  const handleCloneConfirm = useCallback(async () => {
    if (!cloneInfo) return;

    setIsCloning(true);
    try {
      const result = await editorApi.cloneGlobalVersionToUser(
        cloneInfo.templateId,
        cloneInfo.versionId
      );
      // Navigate to the cloned version
      setShowCloneDialog(false);
      navigate(`/workflow/${result.template_id}/${result.version_id}`);
    } catch (error) {
      setTemplateError(
        error instanceof Error ? error.message : "Failed to clone workflow"
      );
      setShowCloneDialog(false);
    } finally {
      setIsCloning(false);
    }
  }, [cloneInfo, navigate]);

  /**
   * Handle clone cancel - go back.
   */
  const handleCloneCancel = useCallback(() => {
    setShowCloneDialog(false);
    navigate(-1);
  }, [navigate]);

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
      draggable: false,
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
        draggable: false,
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
        const registration = getModuleRegistration(module.module_id);
        const isExpanded = expandedModules[moduleNodeId] ?? false;
        const moduleHeight = getModuleHeight(moduleNodeId);
        
        // Position relative to parent step node
        const moduleX = stepPadding;
        const moduleY = currentModuleY;

        // Build node using registry if module is supported
        if (registration) {
          nodes.push({
            id: moduleNodeId,
            type: registration.nodeType,
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: false,
            data: registration.createNodeData({
              module,
              onModuleChange: (updated: unknown) =>
                handleModuleChange(step.step_id, module.name!, updated),
              expanded: isExpanded,
              onExpandedChange: (exp: boolean, height: number) =>
                handleModuleExpandedChange(moduleNodeId, exp, height),
              onViewState: () =>
                handleModuleViewState({ step_id: step.step_id, module_name: module.name! }),
              onPreview: () =>
                handleModulePreview({ step_id: step.step_id, module_name: module.name! }),
              onPreviewWithOverride: async (moduleOverride: unknown) => {
                const target = { step_id: step.step_id, module_name: module.name! };
                const wf = buildWorkflowDefinitionWithOverride(target, moduleOverride);
                await runtime.actions.runToModuleSilent(wf, target, [], {
                  mockModeOverride: true,
                });
              },
              runtimePreview: {
                busy: isSameModuleTarget(runtime.currentTarget, {
                  step_id: step.step_id,
                  module_name: module.name!,
                })
                  ? runtime.busy
                  : false,
                error: isSameModuleTarget(runtime.currentTarget, {
                  step_id: step.step_id,
                  module_name: module.name!,
                })
                  ? runtime.error
                  : null,
                mockMode: true,
                getPreviewRequest: () => {
                  const target = {
                    step_id: step.step_id,
                    module_name: module.name!,
                  };

                  const isCurrentTarget = isSameModuleTarget(
                    runtime.currentTarget,
                    target
                  );

                  const isLastResponseForTarget =
                    runtime.lastResponse?.progress?.current_step === target.step_id &&
                    runtime.lastResponse?.progress?.current_module === target.module_name;

                  if (
                    isCurrentTarget &&
                    isLastResponseForTarget &&
                    runtime.lastResponse?.interaction_request
                  ) {
                    return runtime.lastResponse.interaction_request as InteractionRequest;
                  }

                  const historical = runtime.actions.getInteractionForModule(target);
                  return (historical?.request as InteractionRequest | undefined) ?? null;
                },
                getVirtualDb: runtime.getVirtualDb,
                getVirtualRunId: runtime.getVirtualRunId,
                getWorkflow: () => buildWorkflowDefinition(),
                onVirtualDbUpdate: runtime.setVirtualDb,
              },
              onLoadPreviewData: moduleIndex > 0
                ? async () => {
                    // Run the previous module silently and return its state
                    const prevModule = step.modules[moduleIndex - 1];
                    const target = { step_id: step.step_id, module_name: prevModule.name! };
                    const wf = buildWorkflowDefinition();
                    const state = await runtime.actions.runToModuleSilent(wf, target, [], {
                      mockModeOverride: true,
                    });
                    return state?.state_mapped || null;
                  }
                : undefined,
            }),
          });
        } else {
          // Placeholder for unsupported module types
          nodes.push({
            id: moduleNodeId,
            type: "placeholder",
            position: { x: moduleX, y: moduleY },
            parentId: stepNodeId,
            extent: "parent",
            draggable: false,
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
  }, [workflowInfo, steps, expandedModules, nodeHeights.heights, handleWorkflowChange, handleStepChange, handleModuleChange, handleModuleExpandedChange, handleModuleViewState, handleModulePreview, buildWorkflowDefinitionWithOverride, runtime.currentTarget, runtime.busy, runtime.error, runtime.mockMode, runtime.lastResponse, runtime.actions, runtime.getVirtualDb, runtime.getVirtualRunId, runtime.setVirtualDb, buildWorkflowDefinition, isSameModuleTarget]);

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

        const { definition, workflow_version_id, can_edit, is_global, template_name, redirect_to } = response;

        // If user can't edit (non-admin trying to edit global template)
        if (!can_edit && is_global) {
          // If user already has a clone, redirect to it
          if (redirect_to) {
            navigate(`/workflow/${redirect_to.template_id}/${redirect_to.version_id}`, { replace: true });
            return;
          }
          // No clone exists - show clone dialog
          setCloneInfo({
            templateId: workflowTemplateId,
            versionId: workflow_version_id,
            templateName: template_name,
          });
          setShowCloneDialog(true);
          setTemplateLoading(false);
          return;
        }

        // Safety check - definition should always exist if can_edit is true
        if (!definition) {
          setTemplateError("Workflow definition not available");
          return;
        }

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
      <WorkflowJsonDialog
        open={isWorkflowViewOpen}
        onOpenChange={setIsWorkflowViewOpen}
        workflowId={workflowInfo.workflow_id}
        workflowName={workflowInfo.name ?? "Untitled"}
        workflowDescription={workflowInfo.description}
        steps={steps}
        versionId={resolvedVersionId}
      />

      {/* Clone Global Template Dialog */}
      <CloneTemplateDialog
        open={showCloneDialog}
        cloneInfo={cloneInfo}
        isCloning={isCloning}
        onConfirm={handleCloneConfirm}
        onCancel={handleCloneCancel}
      />

      {/* Virtual Runtime Preview Panel */}
      <VirtualRuntimePanel
        open={runtime.panelOpen}
        onOpenChange={runtime.actions.setPanelOpen}
        status={runtime.status}
        busy={runtime.busy}
        response={runtime.lastResponse}
        error={runtime.error}
        onSubmit={handlePreviewSubmit}
        completedInteraction={completedInteraction}
        mockMode={runtime.mockMode}
        onReloadWithMockMode={handleReloadWithMockMode}
        getVirtualDb={runtime.getVirtualDb}
        getVirtualRunId={runtime.getVirtualRunId}
        getWorkflow={buildWorkflowDefinition}
        onVirtualDbUpdate={runtime.setVirtualDb}
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
