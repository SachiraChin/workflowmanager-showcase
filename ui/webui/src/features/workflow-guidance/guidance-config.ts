export type GuidanceContext =
  | "start-template"
  | "start-upload"
  | "start-runs"
  | "start-admin"
  | "runner";

const GUIDANCE_BY_CONTEXT: Record<GuidanceContext, string[]> = {
  "start-template": [
    "Template start mode is for repeatable runs from stored versions.",
    "Pick the version first, then set a clear project name before starting.",
  ],
  "start-upload": [
    "Upload mode is for creating new workflows and updating existing workflows.",
    "Uploaded workflows become reusable templates in template mode after start.",
    "When uploading ZIP files, verify the entry point path before starting.",
  ],
  "start-runs": [
    "History mode resumes existing runs with their current state.",
    "Use resume with updated template only when workflow logic intentionally changed.",
  ],
  "start-admin": [
    "Global publish creates a public template from the selected user version.",
    "Confirm both template and version before publishing to avoid exposing draft logic.",
  ],
  runner: [
    "Scroll mode is best for reviewing the full run timeline; single mode is best for focused input.",
    "Use model override only when you need an explicit one-run quality or speed adjustment.",
  ],
};

export function getGuidanceTips(context: GuidanceContext): string[] {
  return GUIDANCE_BY_CONTEXT[context] || [];
}
