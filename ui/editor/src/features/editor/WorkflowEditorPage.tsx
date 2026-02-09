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
  type WorkflowTemplate,
  type WorkflowTemplatesResponse,
} from "@wfm/shared";
import {
  UserSelectNode,
  type UserSelectNodeData,
} from "@/components/nodes/UserSelectNode";
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

  // Module state - in real app this would come from workflow definition
  const [modules, setModules] = useState<Record<string, UserSelectModule>>({
    select_pet_type: {
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
  });

  // Handler to update a module
  const handleModuleChange = useCallback((moduleName: string, module: UserSelectModule) => {
    setModules((prev) => ({
      ...prev,
      [moduleName]: module,
    }));
  }, []);

  // Build nodes from modules
  const initialNodes = useMemo<Node[]>(() => {
    const workflowLabel = isCreateMode
      ? state.workflowName || "Untitled Workflow"
      : resolvedTemplate?.name || resolvedTemplate?.template_name || workflowTemplateId || "Workflow";

    const moduleNodes: Node[] = Object.entries(modules).map(([name, module], index) => ({
      id: name,
      type: "userSelect",
      position: { x: 100, y: 180 + index * 300 },
      data: {
        module,
        onModuleChange: (updated: UserSelectModule) => handleModuleChange(name, updated),
      } satisfies UserSelectNodeData,
    }));

    return [
      {
        id: "workflow",
        type: "default",
        position: { x: 100, y: 40 },
        data: { label: workflowLabel },
        style: {
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "8px",
          padding: "12px 20px",
          fontSize: "14px",
          fontWeight: 600,
        },
      },
      ...moduleNodes,
    ];
  }, [isCreateMode, resolvedTemplate, state.workflowName, workflowTemplateId, modules, handleModuleChange]);

  const initialEdges = useMemo<Edge[]>(() => {
    const moduleNames = Object.keys(modules);
    const edges: Edge[] = [];

    // Connect workflow to first module
    if (moduleNames.length > 0) {
      edges.push({
        id: "workflow_to_first",
        source: "workflow",
        target: moduleNames[0],
        style: { stroke: "hsl(var(--muted-foreground))" },
      });
    }

    // Connect modules in sequence
    for (let i = 1; i < moduleNames.length; i++) {
      edges.push({
        id: `module_${i - 1}_to_${i}`,
        source: moduleNames[i - 1],
        target: moduleNames[i],
        style: { stroke: "hsl(var(--muted-foreground))" },
      });
    }

    return edges;
  }, [modules]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // Sync nodes when modules change
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  // Load template
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

  return (
    <div className="relative h-full min-h-0 bg-background text-foreground">
      <ReactFlow
        fitView
        edges={edges}
        nodes={nodes}
        nodeTypes={nodeTypes}
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
        fitViewOptions={{ padding: 0.2 }}
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
                  <p>Workflow: {state.workflowName || "Untitled"}</p>
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
