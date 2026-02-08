/**
 * UX Schema Editor PoC Page
 *
 * Demonstrates the UxSchemaEditor component with sample datasets.
 * Allows switching between different data samples and testing the
 * display schema generation workflow.
 */

import { useState } from "react";
import { type SchemaProperty } from "@wfm/shared";
import { UxSchemaEditor, type DataSchemaNode } from "../../components/ux-schema-editor";
import {
  petTypeDataSchema,
  scenesDataSchema,
  samplePetTypeData,
  sampleScenesData,
} from "./sample-data";

// =============================================================================
// Sample Datasets
// =============================================================================

type DatasetOption = "petTypes" | "scenes";

const datasets: Record<
  DatasetOption,
  {
    data: unknown;
    schema: DataSchemaNode;
    label: string;
    // Optional pre-configured display schema to test decoration
    displaySchema?: SchemaProperty;
  }
> = {
  petTypes: {
    data: samplePetTypeData,
    schema: petTypeDataSchema as DataSchemaNode,
    label: "Pet Types (flat array)",
    // Example: pre-configured with card-stack and some roles
    displaySchema: {
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
  scenes: {
    data: sampleScenesData.scenes,
    schema: scenesDataSchema.properties!.scenes as DataSchemaNode,
    label: "Scenes (nested)",
  },
};

// =============================================================================
// PoC Page Component
// =============================================================================

export function UxPalettePocPage() {
  const [selectedDataset, setSelectedDataset] = useState<DatasetOption>("petTypes");
  const [usePreset, setUsePreset] = useState(true);

  const { data, schema, displaySchema } = datasets[selectedDataset];

  const handleChange = (newSchema: SchemaProperty) => {
    console.log("Schema changed:", newSchema);
  };

  const handleSave = (savedSchema: SchemaProperty) => {
    console.log("Schema saved:", savedSchema);
    alert("Schema saved! Check console for details.");
  };

  return (
    <div className="h-full min-h-0 flex flex-col bg-background">
      {/* Header */}
      <header className="border-b p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">UX Schema Editor PoC</h1>
            <p className="text-sm text-muted-foreground">
              Drag UX identifiers from the palette to schema nodes
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={usePreset}
                onChange={(e) => setUsePreset(e.target.checked)}
                className="rounded"
              />
              Use preset display schema (if available)
            </label>
            <select
              value={selectedDataset}
              onChange={(e) => setSelectedDataset(e.target.value as DatasetOption)}
              className="rounded border bg-background px-3 py-1.5 text-sm"
            >
              {Object.entries(datasets).map(([key, { label: datasetLabel }]) => (
                <option key={key} value={key}>
                  {datasetLabel}
                </option>
              ))}
            </select>
          </div>
        </div>
        {displaySchema && usePreset && (
          <p className="text-xs text-muted-foreground mt-2">
            This dataset has a preset display schema. The editor will start with these
            settings pre-applied.
          </p>
        )}
      </header>

      {/* Editor */}
      <div className="flex-1 min-h-0">
        <UxSchemaEditor
          key={`${selectedDataset}-${usePreset}`}
          dataSchema={schema}
          data={data}
          displaySchema={usePreset ? displaySchema : undefined}
          onChange={handleChange}
          onSave={handleSave}
        />
      </div>
    </div>
  );
}
