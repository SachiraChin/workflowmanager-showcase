import { isJsonRef, type UserSelectModule } from "./types";
import { userSelectDataSourceSummary } from "./presentation";
import type { ReactNode } from "react";

type UserSelectModuleCardProps = {
  module: UserSelectModule;
  active?: boolean;
  previewOpen?: boolean;
  onTogglePreview?: () => void;
  previewContent?: ReactNode;
};

export function UserSelectModuleCard({
  module,
  active = false,
  previewOpen = false,
  onTogglePreview,
  previewContent,
}: UserSelectModuleCardProps) {
  const dataSourceLabel = userSelectDataSourceSummary(module);

  return (
    <article
      className={[
        previewOpen ? "w-[380px]" : "w-[320px]",
        "rounded-lg border bg-card p-4 shadow-sm transition-all",
        active ? "ring-2 ring-ring" : "",
      ].join(" ")}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {module.module_id}
      </p>
      <h3 className="mt-1 text-base font-semibold">{module.name}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{module.inputs.prompt}</p>

      <dl className="mt-4 space-y-1 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">mode</dt>
          <dd>{module.inputs.mode}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">multi select</dt>
          <dd>{module.inputs.multi_select ? "true" : "false"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">data source</dt>
          <dd>{dataSourceLabel}</dd>
        </div>
      </dl>

      <button
        className="mt-3 rounded border bg-background px-2 py-1 text-xs"
        onClick={onTogglePreview}
        type="button"
      >
        {previewOpen ? "Hide Preview" : "Preview"}
      </button>

      {previewOpen ? (
        <div className="mt-3 rounded-md border bg-background p-2">{previewContent}</div>
      ) : null}

      {Array.isArray(module.inputs.data) && module.inputs.data.length ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {module.inputs.data.length > 3 ? (
            <li>+{module.inputs.data.length - 3} more...</li>
          ) : null}
        </ul>
      ) : null}

      {isJsonRef(module.inputs.data) ? (
        <p className="mt-3 text-xs text-muted-foreground">
          ref: {module.inputs.data.$ref}
        </p>
      ) : null}

      <p className="mt-3 text-[11px] text-muted-foreground">
        outputs: {module.outputs_to_state.selected_indices}, {" "}
        {module.outputs_to_state.selected_data}
      </p>
    </article>
  );
}
