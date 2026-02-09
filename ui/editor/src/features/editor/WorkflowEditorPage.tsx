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
  api,
  type StepDefinition,
  type WorkflowTemplate,
  type WorkflowTemplatesResponse,
} from "@wfm/shared";
import {
  UserSelectNode,
  type UserSelectNodeData,
  MODULE_HEIGHT_COLLAPSED,
  MODULE_HEIGHT_EXPANDED,
  MODULE_WIDTH_COLLAPSED,
  MODULE_WIDTH_EXPANDED,
} from "@/components/nodes/UserSelectNode";
import {
  StepNode,
  type StepNodeData,
} from "@/components/nodes/StepNode";
import {
  WorkflowNode,
  type WorkflowNodeData,
  type WorkflowInfo,
} from "@/components/nodes/WorkflowNode";
import { type UserSelectModule } from "@/modules/user-select/types";

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
};

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
  const [resolvedTemplate, setResolvedTemplate] = useState<WorkflowTemplate | null>(null);
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

  const [steps, setSteps] = useState<StepDefinition[]>([
    {
      step_id: "1_user_input",
      name: "User Input",
      description: "Collect user preferences",
      modules: [
        {
          module_id: "user.select",
          name: "select_pet_type",
          inputs: {
            prompt: "What type of pet is this video for?",
            multi_select: false,
            mode: "select",
            data: [
              {
                id: "cat",
                label: "Cat",
                description: "Feline friends - independent, curious, and endlessly entertaining",
              },
              {
                id: "dog",
                label: "Dog",
                description: "Canine companions - loyal, playful, and always happy to see you",
              },
              {
                id: "both",
                label: "Cat & Dog",
                description: "Multi-pet household - the chaos and love of furry siblings",
              },
            ],
            schema: {
              type: "array",
              _ux: {
                display: "visible",
                render_as: "card-stack",
              },
              items: {
                type: "object",
                _ux: {
                  display: "visible",
                  render_as: "card",
                  selectable: true,
                },
                properties: {
                  id: {
                    type: "string",
                    _ux: { display: "hidden" },
                  },
                  label: {
                    type: "string",
                    _ux: { display: "visible", render_as: "card-title" },
                  },
                  description: {
                    type: "string",
                    _ux: { display: "visible", render_as: "card-subtitle" },
                  },
                },
              },
            },
          },
          outputs_to_state: {
            selected_indices: "pet_type_indices",
            selected_data: "pet_type_selection",
          },
        },
      ],
    },
  ]);

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

    // Workflow node
    nodes.push({
      id: "workflow",
      type: "workflow",
      position: { x: 250, y: 20 },
      data: {
        workflow: workflowInfo,
        onWorkflowChange: handleWorkflowChange,
      } satisfies WorkflowNodeData,
    });

    // Layout constants
    const stepStartY = 120;
    const stepSpacing = 60;
    const stepPadding = 40; // Padding inside step container (space around modules)
    const stepHeaderHeight = 32; // Height of step header bar
    const moduleSpacingY = 20; // Vertical spacing between modules
    // Step width sized for expanded modules so padding stays ~40px on expand
    const stepWidth = MODULE_WIDTH_EXPANDED + stepPadding * 2;

    // Helper to get module height based on expanded state
    const getModuleHeight = (moduleId: string) =>
      expandedModules[moduleId] ? MODULE_HEIGHT_EXPANDED : MODULE_HEIGHT_COLLAPSED;

    let currentStepY = stepStartY;

    // Build step and module nodes
    // IMPORTANT: Step nodes must come before their child module nodes
    steps.forEach((step, stepIndex) => {
      const stepNodeId = `step_${step.step_id}`;

      // Calculate step height to contain all modules with padding
      // Sum up actual module heights (accounting for which are expanded)
      const modulesHeight = step.modules.length > 0
        ? step.modules.reduce((sum, mod) => {
            const moduleId = `module_${step.step_id}_${mod.name}`;
            return sum + getModuleHeight(moduleId);
          }, 0) + (step.modules.length - 1) * moduleSpacingY
        : 60; // Minimum height when empty
      const stepHeight = stepHeaderHeight + stepPadding + modulesHeight + stepPadding;

      // Step node (parent container)
      nodes.push({
        id: stepNodeId,
        type: "step",
        position: { x: 150, y: currentStepY },
        data: {
          step,
          onStepChange: (updated: StepDefinition) => handleStepChange(step.step_id, updated),
          width: stepWidth,
          height: stepHeight,
        } satisfies StepNodeData,
        // Mark as a group/parent node
        style: { width: stepWidth, height: stepHeight },
      });

      // Module nodes within this step - positioned relative to step
      let currentModuleY = stepHeaderHeight + stepPadding;
      step.modules.forEach((module, moduleIndex) => {
        const moduleNodeId = `module_${step.step_id}_${module.name}`;
        const isExpanded = expandedModules[moduleNodeId] ?? false;
        const moduleHeight = getModuleHeight(moduleNodeId);
        
        // Position relative to parent step node (centered horizontally with padding)
        const moduleX = stepPadding;
        const moduleY = currentModuleY;

        nodes.push({
          id: moduleNodeId,
          type: "userSelect",
          position: { x: moduleX, y: moduleY },
          // Parent-child relationship
          parentId: stepNodeId,
          // Constrain to parent bounds
          extent: "parent",
          // Allow parent to expand when this node grows
          expandParent: true,
          draggable: true,
          data: {
            module: module as UserSelectModule,
            onModuleChange: (updated: UserSelectModule) =>
              handleModuleChange(step.step_id, module.name!, updated),
            expanded: isExpanded,
            onExpandedChange: (exp: boolean) => handleModuleExpandedChange(moduleNodeId, exp),
          } satisfies UserSelectNodeData,
        });

        // Update Y position for next module
        currentModuleY += moduleHeight + moduleSpacingY;

        // Connect modules within the step
        if (moduleIndex > 0) {
          const prevModuleId = `module_${step.step_id}_${step.modules[moduleIndex - 1].name}`;
          edges.push({
            id: `${prevModuleId}_to_${moduleNodeId}`,
            source: prevModuleId,
            target: moduleNodeId,
            style: { stroke: "hsl(var(--muted-foreground))", strokeDasharray: "4 2" },
          });
        }
      });

      // Connect workflow to first step
      if (stepIndex === 0) {
        edges.push({
          id: "workflow_to_first_step",
          source: "workflow",
          sourceHandle: "workflow-out",
          target: stepNodeId,
          targetHandle: "step-in",
          style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
        });
      }

      // Connect steps to each other
      if (stepIndex > 0) {
        const prevStepId = `step_${steps[stepIndex - 1].step_id}`;
        edges.push({
          id: `${prevStepId}_to_${stepNodeId}`,
          source: prevStepId,
          sourceHandle: "step-out",
          target: stepNodeId,
          targetHandle: "step-in",
          style: { stroke: "hsl(var(--muted-foreground))", strokeWidth: 2 },
        });
      }

      currentStepY += stepHeight + stepSpacing;
    });

    return { nodes, edges };
  }, [workflowInfo, steps, expandedModules, handleWorkflowChange, handleStepChange, handleModuleChange, handleModuleExpandedChange]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes when state changes
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // =============================================================================
  // Load Template
  // =============================================================================

  useEffect(() => {
    if (isCreateMode) {
      setTemplateLoading(false);
      return;
    }

    let alive = true;
    const loadTemplate = async () => {
      setTemplateLoading(true);
      setTemplateError(null);

      try {
        const response: WorkflowTemplatesResponse = await api.listWorkflowTemplates();
        if (!alive) return;

        const template = response.templates.find(
          (item) => item.template_id === workflowTemplateId
        );
        if (!template) {
          setTemplateError("Workflow template not found.");
          setResolvedTemplate(null);
          setResolvedVersionId(null);
          return;
        }

        setResolvedTemplate(template);
        setResolvedVersionId(requestedVersionId || template.versions[0]?.workflow_version_id || null);
      } catch (error) {
        if (!alive) return;
        setTemplateError(
          error instanceof Error ? error.message : "Failed to load workflow template"
        );
      } finally {
        if (alive) setTemplateLoading(false);
      }
    };

    void loadTemplate();
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
