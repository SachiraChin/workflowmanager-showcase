import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  api,
  type WorkflowTemplate,
  type WorkflowTemplatesResponse,
} from "@wfm/shared";
import { buildDefaultWorkflowId } from "@/features/start/workflow-id";

type StartAction = "create" | "edit";

function formatVersionDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function WorkflowStartPage() {
  const navigate = useNavigate();
  const [action, setAction] = useState<StartAction>("create");

  const [workflowName, setWorkflowName] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflowIdTouched, setWorkflowIdTouched] = useState(false);

  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");

  const sortedTemplates = useMemo(
    () =>
      [...templates].sort((a, b) => {
        const aScope = a.scope === "global" ? 0 : 1;
        const bScope = b.scope === "global" ? 0 : 1;
        if (aScope !== bScope) return aScope - bScope;
        return (a.template_name || "").localeCompare(b.template_name || "");
      }),
    [templates]
  );

  const selectedTemplate = templates.find(
    (template) => template.template_id === selectedTemplateId
  );

  useEffect(() => {
    if (workflowIdTouched) return;
    setWorkflowId(buildDefaultWorkflowId(workflowName));
  }, [workflowName, workflowIdTouched]);

  useEffect(() => {
    if (action !== "edit") return;

    let alive = true;
    const loadTemplates = async () => {
      setTemplateLoading(true);
      setTemplateError(null);
      try {
        const response: WorkflowTemplatesResponse = await api.listWorkflowTemplates();
        if (!alive) return;
        setTemplates(response.templates);

        if (response.templates.length === 0) {
          setSelectedTemplateId("");
          setSelectedVersionId("");
          return;
        }

        const firstTemplate = response.templates[0];
        setSelectedTemplateId(firstTemplate.template_id);
        setSelectedVersionId(firstTemplate.versions[0]?.workflow_version_id || "");
      } catch (error) {
        if (!alive) return;
        setTemplateError(
          error instanceof Error ? error.message : "Failed to load workflow templates"
        );
      } finally {
        if (alive) setTemplateLoading(false);
      }
    };

    void loadTemplates();
    return () => {
      alive = false;
    };
  }, [action]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.template_id === templateId);
    setSelectedVersionId(template?.versions[0]?.workflow_version_id || "");
  };

  const canCreate = workflowName.trim().length > 0;
  const canEdit =
    !templateLoading &&
    templates.length > 0 &&
    selectedTemplateId.length > 0 &&
    selectedVersionId.length > 0;

  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">Workflow Editor</h1>
          <p className="text-sm text-muted-foreground">
            Start by creating a new workflow or loading an existing workflow version.
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>What do you want to do?</CardTitle>
            <CardDescription>Choose a starting path for this editor session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-2 md:grid-cols-2">
              <button
                className={[
                  "cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors",
                  action === "create" ? "bg-muted" : "bg-background hover:bg-muted/50",
                ].join(" ")}
                onClick={() => setAction("create")}
                type="button"
              >
                <p className="text-sm font-semibold">Create New Workflow</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Set workflow name and optional id, then open `/editor/new`.
                </p>
              </button>

              <button
                className={[
                  "cursor-pointer rounded-lg border px-4 py-3 text-left transition-colors",
                  action === "edit" ? "bg-muted" : "bg-background hover:bg-muted/50",
                ].join(" ")}
                onClick={() => setAction("edit")}
                type="button"
              >
                <p className="text-sm font-semibold">Edit Existing Workflow</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Select template and version, then open `/editor/:workflow_template_id`.
                </p>
              </button>
            </div>

            {action === "create" ? (
              <div className="space-y-4 rounded-lg border p-4">
                <div className="space-y-2">
                  <Label htmlFor="workflow-name">Workflow Name</Label>
                  <Input
                    id="workflow-name"
                    placeholder="My Workflow"
                    value={workflowName}
                    onChange={(event) => setWorkflowName(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="workflow-id">Workflow ID (optional)</Label>
                  <Input
                    id="workflow-id"
                    placeholder="my_workflow"
                    value={workflowId}
                    onChange={(event) => {
                      setWorkflowIdTouched(true);
                      setWorkflowId(event.target.value);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Default id is generated from name using lowercase letters and `_`.
                  </p>
                </div>

                <div className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">Route preview</span>
                  <span className="font-medium">/editor/new</span>
                </div>

                <Button
                  className="w-full"
                  disabled={!canCreate}
                  onClick={() => {
                    const nextWorkflowId = workflowId.trim() || buildDefaultWorkflowId(workflowName);
                    navigate("/editor/new", {
                      state: {
                        workflowName: workflowName.trim(),
                        workflowId: nextWorkflowId,
                      },
                    });
                  }}
                  type="button"
                >
                  Continue to Editor
                </Button>
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border p-4">
                {templateError ? (
                  <Alert>
                    <AlertDescription>{templateError}</AlertDescription>
                  </Alert>
                ) : null}

                {templateLoading ? (
                  <p className="text-sm text-muted-foreground">Loading templates...</p>
                ) : null}

                {!templateLoading && templates.length === 0 ? (
                  <Alert>
                    <AlertDescription>
                      No workflow templates found for this account.
                    </AlertDescription>
                  </Alert>
                ) : null}

                {!templateLoading && templates.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="template">Workflow Template</Label>
                      <Select value={selectedTemplateId} onValueChange={handleTemplateChange}>
                        <SelectTrigger id="template">
                          <SelectValue placeholder="Select a workflow template" />
                        </SelectTrigger>
                        <SelectContent>
                          {sortedTemplates.map((template) => (
                            <SelectItem key={template.template_id} value={template.template_id}>
                              {template.name || template.template_name}
                              {template.scope === "global" ? " (Global)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="version">Version</Label>
                      <Select value={selectedVersionId} onValueChange={setSelectedVersionId}>
                        <SelectTrigger id="version">
                          <SelectValue placeholder="Select a workflow version" />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedTemplate?.versions || []).map((version, index) => (
                            <SelectItem
                              key={version.workflow_version_id}
                              value={version.workflow_version_id}
                            >
                              {index === 0 ? "(Latest) " : ""}
                              {formatVersionDate(version.created_at)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between rounded border bg-muted/30 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Route preview</span>
                      <span className="font-medium">/editor/{selectedTemplateId || "..."}</span>
                    </div>

                    <Button
                      className="w-full"
                      disabled={!canEdit}
                      onClick={() => {
                        if (!selectedTemplateId || !selectedVersionId) return;
                        navigate(`/editor/${selectedTemplateId}`, {
                          state: { workflowVersionId: selectedVersionId },
                        });
                      }}
                      type="button"
                    >
                      Edit Workflow
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
