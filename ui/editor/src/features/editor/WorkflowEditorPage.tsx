import { useEffect, useMemo, useState } from "react";
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
  UserSelectCardEditor,
  type UserSelectCardConfig,
} from "@/components/UserSelectCardEditor";

type EditorLocationState = {
  workflowVersionId?: string;
  workflowName?: string;
  workflowId?: string;
};

const MODULE_LIBRARY = [
  {
    moduleId: "user.select",
    title: "User Select",
    description: "Collects user choices from structured options.",
    status: "available",
  },
] as const;

export function WorkflowEditorPage() {
  const { workflowTemplateId } = useParams<{ workflowTemplateId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as EditorLocationState;
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

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
  const [userSelectConfig, setUserSelectConfig] = useState<UserSelectCardConfig>({
    prompt: "What type of pet is this video for?",
    multiSelect: false,
    fields: [
      { id: "field_id", key: "id", label: "ID", type: "string" },
      { id: "field_label", key: "label", label: "Label", type: "string" },
      {
        id: "field_description",
        key: "description",
        label: "Description",
        type: "string",
      },
    ],
  });

  const initialNodes = useMemo<Node[]>(() => {
    const workflowLabel = isCreateMode
      ? state.workflowName || "Untitled Workflow"
      : resolvedTemplate?.name || resolvedTemplate?.template_name || workflowTemplateId || "Workflow";

    return [
      {
        id: "workflow",
        type: "default",
        position: { x: 250, y: 80 },
        data: { label: workflowLabel },
      },
      {
        id: "user_select",
        type: "default",
        position: { x: 250, y: 200 },
        data: { label: "user.select" },
      },
    ];
  }, [isCreateMode, resolvedTemplate, state.workflowName, workflowTemplateId]);

  const initialEdges = useMemo<Edge[]>(
    () => [
      {
        id: "workflow_to_user_select",
        source: "workflow",
        target: "user_select",
        label: "step flow",
      },
    ],
    []
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

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
        onEdgesChange={onEdgesChange}
        onNodesChange={onNodesChange}
      >
        <Background gap={20} />
        <Controls />
        <MiniMap />
      </ReactFlow>

      <div className="pointer-events-none absolute inset-y-4 left-4 z-20 flex">
        {!leftPanelCollapsed ? (
          <aside className="pointer-events-auto h-full w-80 overflow-auto rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
            <div className="space-y-4">
              <section>
                <h2 className="text-sm font-semibold">Module Library</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Modules available to add to this workflow.
                </p>
              </section>

              {MODULE_LIBRARY.map((module) => (
                <Card key={module.moduleId}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="text-sm">{module.title}</CardTitle>
                      <Badge variant="secondary">{module.status}</Badge>
                    </div>
                    <CardDescription className="text-xs">{module.moduleId}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">{module.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </aside>
        ) : null}
        <button
          className="pointer-events-auto ml-2 mt-3 h-8 rounded-md border bg-card px-2 text-xs shadow-sm"
          onClick={() => setLeftPanelCollapsed((current) => !current)}
          type="button"
        >
          {leftPanelCollapsed ? "Open" : "Close"}
        </button>
      </div>

      <div className="pointer-events-none absolute inset-y-4 right-4 z-20 flex flex-row-reverse">
        {!rightPanelCollapsed ? (
          <aside className="pointer-events-auto h-full w-96 overflow-auto rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur-sm">
            <div className="space-y-4">
              <section>
                <h2 className="text-sm font-semibold">Workflow Context</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {isCreateMode
                    ? "New workflow metadata and canvas state."
                    : "Loaded template/version context for editing."}
                </p>
              </section>

              {templateError ? (
                <Alert>
                  <AlertDescription>{templateError}</AlertDescription>
                </Alert>
              ) : null}

              {templateLoading ? (
                <p className="text-sm text-muted-foreground">Loading editor context...</p>
              ) : null}

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Current Session</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <p>
                    mode: <span className="font-medium">{isCreateMode ? "create" : "edit"}</span>
                  </p>
                  <p>
                    workflow: <span className="font-medium">{state.workflowName || "Untitled Workflow"}</span>
                  </p>
                  <p>
                    workflow id: <span className="font-medium">{state.workflowId || "(n/a)"}</span>
                  </p>
                  {!isCreateMode ? (
                    <>
                      <p>
                        template id: <span className="font-medium">{workflowTemplateId}</span>
                      </p>
                      <p>
                        version id: <span className="font-medium">{resolvedVersionId || "latest"}</span>
                      </p>
                      <p className="text-muted-foreground">
                        {requestedVersionId
                          ? "Loaded with explicit version id from start flow."
                          : "No version id provided, using latest version."}
                      </p>
                    </>
                  ) : null}
                </CardContent>
              </Card>

              <UserSelectCardEditor
                value={userSelectConfig}
                onChange={setUserSelectConfig}
              />

              {!isCreateMode && resolvedTemplate ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Selected Template</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-xs">
                    <p>
                      name: <span className="font-medium">{resolvedTemplate.name || resolvedTemplate.template_name}</span>
                    </p>
                    <p>
                      versions: <span className="font-medium">{resolvedTemplate.versions.length}</span>
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </aside>
        ) : null}

        <button
          className="pointer-events-auto mr-2 mt-3 h-8 rounded-md border bg-card px-2 text-xs shadow-sm"
          onClick={() => setRightPanelCollapsed((current) => !current)}
          type="button"
        >
          {rightPanelCollapsed ? "Open" : "Close"}
        </button>
      </div>
    </div>
  );
}
