import { isJsonRef, type UserSelectModule } from "@/modules/user-select/types";

export type UserSelectPreviewCard = {
  id: string;
  title: string;
  subtitle: string;
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

export function userSelectDataSourceSummary(module: UserSelectModule): string {
  if (isJsonRef(module.inputs.data)) {
    return `ref:${module.inputs.data.$ref}`;
  }

  return `inline:${module.inputs.data.length}`;
}

export function userSelectNodeLabel(module: UserSelectModule): string {
  const prompt = truncate(module.inputs.prompt, 58);
  const optionLine = Array.isArray(module.inputs.data)
    ? `options: ${module.inputs.data
        .slice(0, 3)
        .map((item) => item.label)
        .join(" | ")}${module.inputs.data.length > 3 ? " | ..." : ""}`
    : `data_ref: ${module.inputs.data.$ref}`;
  const outputsLine = `outputs: ${module.outputs_to_state.selected_indices}, ${module.outputs_to_state.selected_data}`;

  return [
    `user.select | ${module.name}`,
    prompt,
    `mode:${module.inputs.mode} | multi:${module.inputs.multi_select ? "true" : "false"}`,
    truncate(optionLine, 90),
    truncate(outputsLine, 90),
  ].join("\n");
}

export function userSelectPreviewCards(
  module: UserSelectModule,
  limit = 3
): UserSelectPreviewCard[] {
  if (Array.isArray(module.inputs.data)) {
    return module.inputs.data.slice(0, limit).map((item) => ({
      id: item.id,
      title: item.label,
      subtitle: truncate(item.description, 78),
    }));
  }

  return [
    {
      id: "ref",
      title: "Reference Data",
      subtitle: module.inputs.data.$ref,
    },
  ];
}
