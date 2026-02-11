import {
  isJsonRefObject,
  isJsonRef,
  type JsonRef,
  type UserSelectModule,
  type UserSelectOption,
} from "./types";

type UserSelectModuleEditorProps = {
  value: UserSelectModule;
  onChange: (next: UserSelectModule) => void;
};

function updateInlineOption(
  module: UserSelectModule,
  index: number,
  patch: Partial<UserSelectOption>
): UserSelectModule {
  if (!Array.isArray(module.inputs.data)) return module;

  const nextData = [...module.inputs.data];
  nextData[index] = { ...nextData[index], ...patch };

  return {
    ...module,
    inputs: {
      ...module.inputs,
      data: nextData,
    },
  };
}

export function UserSelectModuleEditor({
  value,
  onChange,
}: UserSelectModuleEditorProps) {
  const isInline = Array.isArray(value.inputs.data);
  const schemaRef = isJsonRefObject(value.inputs.schema)
    ? value.inputs.schema.$ref
    : "(inline schema object)";

  const switchDataSource = (next: "inline" | "ref") => {
    if (next === "inline") {
      onChange({
        ...value,
        inputs: {
          ...value.inputs,
          data: [
            {
              id: "new-option",
              label: "New Option",
              description: "Describe this option",
            },
          ],
        },
      });
      return;
    }

    onChange({
      ...value,
      inputs: {
        ...value.inputs,
        data: {
          $ref: "core_aesthetics.json",
          type: "json",
        },
      },
    });
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">Basic</h3>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">name</span>
          <input
            className="w-full rounded border bg-background px-2 py-1.5"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">prompt</span>
          <textarea
            className="min-h-20 w-full rounded border bg-background px-2 py-1.5"
            value={value.inputs.prompt}
            onChange={(e) =>
              onChange({
                ...value,
                inputs: { ...value.inputs, prompt: e.target.value },
              })
            }
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">mode</span>
            <select
              className="w-full rounded border bg-background px-2 py-1.5"
              value={value.inputs.mode}
              onChange={(e) =>
                onChange({
                  ...value,
                  inputs: { ...value.inputs, mode: e.target.value },
                })
              }
            >
              <option value="select">select</option>
            </select>
          </label>
          <label className="flex items-end gap-2 rounded border bg-background px-2 py-1.5 text-xs">
            <input
              checked={value.inputs.multi_select}
              type="checkbox"
              onChange={(e) =>
                onChange({
                  ...value,
                  inputs: { ...value.inputs, multi_select: e.target.checked },
                })
              }
            />
            multi_select
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Data Source</h3>
          <div className="flex rounded border bg-background p-0.5 text-xs">
            <button
              className={[
                "rounded px-2 py-1",
                isInline ? "bg-muted" : "",
              ].join(" ")}
              onClick={() => switchDataSource("inline")}
              type="button"
            >
              inline
            </button>
            <button
              className={[
                "rounded px-2 py-1",
                !isInline ? "bg-muted" : "",
              ].join(" ")}
              onClick={() => switchDataSource("ref")}
              type="button"
            >
              ref
            </button>
          </div>
        </div>

        {Array.isArray(value.inputs.data) ? (
          <div className="space-y-2">
            {value.inputs.data.map((option, index) => (
              <div className="space-y-1 rounded border p-2" key={`${option.id}-${index}`}>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="rounded border bg-background px-2 py-1 text-xs"
                    placeholder="id"
                    value={option.id}
                    onChange={(e) =>
                      onChange(updateInlineOption(value, index, { id: e.target.value }))
                    }
                  />
                  <input
                    className="rounded border bg-background px-2 py-1 text-xs"
                    placeholder="label"
                    value={option.label}
                    onChange={(e) =>
                      onChange(
                        updateInlineOption(value, index, { label: e.target.value })
                      )
                    }
                  />
                </div>
                <textarea
                  className="min-h-14 w-full rounded border bg-background px-2 py-1 text-xs"
                  placeholder="description"
                  value={option.description}
                  onChange={(e) =>
                    onChange(
                      updateInlineOption(value, index, {
                        description: e.target.value,
                      })
                    )
                  }
                />
                <button
                  className="text-xs text-destructive"
                  onClick={() => {
                    if (!Array.isArray(value.inputs.data)) return;
                    const nextData = value.inputs.data.filter((_, i) => i !== index);
                    onChange({
                      ...value,
                      inputs: {
                        ...value.inputs,
                        data: nextData,
                      },
                    });
                  }}
                  type="button"
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="rounded border bg-background px-2 py-1 text-xs"
              onClick={() => {
                if (!Array.isArray(value.inputs.data)) return;
                const nextData = [
                  ...value.inputs.data,
                  {
                    id: `option_${value.inputs.data.length + 1}`,
                    label: "New Option",
                    description: "",
                  },
                ];
                onChange({
                  ...value,
                  inputs: {
                    ...value.inputs,
                    data: nextData,
                  },
                });
              }}
              type="button"
            >
              + Add option
            </button>
          </div>
        ) : (
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">data.$ref</span>
            <input
              className="w-full rounded border bg-background px-2 py-1.5"
              value={value.inputs.data.$ref}
              onChange={(e) =>
                onChange({
                  ...value,
                  inputs: {
                    ...value.inputs,
                    data: {
                      ...(value.inputs.data as JsonRef),
                      $ref: e.target.value,
                    },
                  },
                })
              }
            />
          </label>
        )}
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h3 className="text-sm font-semibold">Schema + Outputs</h3>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">schema.$ref</span>
          <input
            className="w-full rounded border bg-background px-2 py-1.5"
            disabled={!isJsonRefObject(value.inputs.schema)}
            value={schemaRef}
            onChange={(e) =>
              isJsonRefObject(value.inputs.schema)
                ? onChange({
                    ...value,
                    inputs: {
                      ...value.inputs,
                      schema: {
                        ...value.inputs.schema,
                        $ref: e.target.value,
                      },
                    },
                  })
                : undefined
            }
          />
        </label>
        <div className="grid grid-cols-1 gap-2">
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">selected_indices key</span>
            <input
              className="w-full rounded border bg-background px-2 py-1.5"
              value={value.outputs_to_state.selected_indices}
              onChange={(e) =>
                onChange({
                  ...value,
                  outputs_to_state: {
                    ...value.outputs_to_state,
                    selected_indices: e.target.value,
                  },
                })
              }
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">selected_data key</span>
            <input
              className="w-full rounded border bg-background px-2 py-1.5"
              value={value.outputs_to_state.selected_data}
              onChange={(e) =>
                onChange({
                  ...value,
                  outputs_to_state: {
                    ...value.outputs_to_state,
                    selected_data: e.target.value,
                  },
                })
              }
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4 text-xs text-muted-foreground">
        <p>
          data schema mode: {isJsonRef(value.inputs.data) ? "reference" : "inline"}
        </p>
        <p>schema ref: {schemaRef}</p>
      </section>
    </div>
  );
}
