/**
 * TemplateSelector - Select workflow template and version.
 *
 * Fetches templates with versions on mount and provides two-step selection:
 * 1. Select a template
 * 2. Select a version within that template
 *
 * Returns the workflow_version_id for the selected version.
 */

import { useState, useEffect } from "react";
import { Download, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/core/api";
import type {
  WorkflowTemplate,
  WorkflowTemplatesResponse,
} from "@/core/types";

// =============================================================================
// Types
// =============================================================================

interface TemplateSelectorProps {
  /** Currently selected version ID */
  value: string;
  /** Called when version selection changes */
  onChange: (versionId: string) => void;
  /** Whether the selector is disabled */
  disabled?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Format date for display in user's timezone.
 * Format: yyyy-MM-dd hh:mm:ss AM/PM
 */
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

// =============================================================================
// Component
// =============================================================================

export function TemplateSelector({
  value,
  onChange,
  disabled,
}: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isGuideExpanded, setIsGuideExpanded] = useState(false);

  const sortedTemplates = [...templates].sort((a, b) => {
    const aScope = a.scope === "global" ? 0 : 1;
    const bScope = b.scope === "global" ? 0 : 1;
    if (aScope !== bScope) return aScope - bScope;
    return (a.template_name || "").localeCompare(b.template_name || "");
  });

  // Get currently selected template
  const selectedTemplate = templates.find(
    (t) => t.template_id === selectedTemplateId
  );

  // Fetch templates on mount
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const response: WorkflowTemplatesResponse =
          await api.listWorkflowTemplates();
        setTemplates(response.templates);

        if (value) {
          const matchedTemplate = response.templates.find((template) =>
            template.versions.some((version) => version.workflow_version_id === value)
          );
          if (matchedTemplate) {
            setSelectedTemplateId(matchedTemplate.template_id);
            return;
          }
        }

        // Auto-select first template and its first version if none selected
        if (!value) {
          const firstTemplate = response.templates[0];
          setSelectedTemplateId(firstTemplate.template_id);
          if (firstTemplate.versions.length > 0) {
            onChange(firstTemplate.versions[0].workflow_version_id);
          }
        }
      } catch (e) {
        console.error("Failed to fetch templates", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchTemplates();
  }, [onChange, value]);

  useEffect(() => {
    setIsGuideExpanded(false);
  }, [selectedTemplateId]);

  // When template changes, select its first version
  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((t) => t.template_id === templateId);
    if (template && template.versions.length > 0) {
      onChange(template.versions[0].workflow_version_id);
    }
  };

  // When version changes
  const handleVersionChange = (versionId: string) => {
    onChange(versionId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading templates...</span>
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          No workflow templates found. Upload a workflow first, or run one via
          TUI to create a template.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Template Selection */}
      <div className="space-y-2">
        <Label htmlFor="template">Workflow Template</Label>
        <Select
          value={selectedTemplateId}
          onValueChange={handleTemplateChange}
          disabled={disabled}
        >
          <SelectTrigger>
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

        {selectedTemplate?.download_url && (
          <div className="pt-1">
            <Button asChild variant="outline" size="sm" disabled={disabled}>
              <a
                href={selectedTemplate.download_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download className="mr-2 h-4 w-4" />
                Download Workflow ZIP
              </a>
            </Button>
          </div>
        )}
      </div>

      {selectedTemplate?.download_url && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-medium">How to edit this workflow</p>
          <div
            className={`relative space-y-3 text-sm leading-6 text-muted-foreground ${
              isGuideExpanded ? "" : "max-h-[4.5rem] overflow-hidden"
            }`}
          >
            <p>
              Download the ZIP file, extract it, and open the extracted files in your
              preferred editor.
            </p>
            <p>
              Take time to review each step, module, and module type to understand
              behavior. Navigate through the workflow configuration in your editor
              while navigating through the workflow in the UI.
            </p>
            <p>
              Use the state panel in the runner to inspect data from each step and
              module, and to verify how values are written to workflow state.
            </p>
            <p>
              Once you understand the flow, either update the workflow manually or
              use an AI tool to update steps (one by one or all at once).
            </p>
            <p>
              After editing, go to the Upload tab on Start Workflow, upload your
              updated workflow, and run it. If something fails, use Debug Mode in
              Workflow Runner to inspect what went wrong or what is missing.
            </p>
            <p>Rinse and repeat until your ideal workflow comes to fruition.</p>

            {!isGuideExpanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted/30 to-transparent" />
            )}
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto cursor-pointer px-0 text-xs"
            onClick={() => setIsGuideExpanded((prev) => !prev)}
          >
            {isGuideExpanded ? "Show less" : "Read full guide"}
          </Button>
        </div>
      )}

      {/* Version Selection */}
      {selectedTemplate && selectedTemplate.versions.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="version">Version</Label>
          <Select
            value={value}
            onValueChange={handleVersionChange}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a version" />
            </SelectTrigger>
            <SelectContent>
              {selectedTemplate.versions.map((version, index) => (
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
          <p className="text-xs text-muted-foreground">
            Select a specific workflow version to run
          </p>
        </div>
      )}
    </div>
  );
}
