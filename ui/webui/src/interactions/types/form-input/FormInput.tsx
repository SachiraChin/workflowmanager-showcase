/**
 * FormInput - Table-style input for data items with additional fields.
 *
 * Renders a table where:
 * - First column: Data items rendered via SchemaRenderer
 * - Additional columns: Input fields for each item (from input_schema)
 *
 * Returns form_data as an array of input values, one per data item.
 */

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useInteraction } from "@/state/interaction-context";
import { SchemaRenderer } from "../../SchemaRenderer";
import type { SchemaProperty } from "@/interactions/schema/types";
import { getUx } from "@/interactions/schema/ux-utils";

// =============================================================================
// Types
// =============================================================================

// Property schema for form inputs
interface InputPropertySchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  title?: string;
  description?: string;
  display?: boolean | string;
  default?: unknown;
  enum?: string[];
  enum_labels?: Record<string, string>;
  minimum?: number;
  maximum?: number;
  multiline?: boolean;
  required?: string[];
  properties?: Record<string, InputPropertySchema>;
  // Display hint for input rendering
  input_type?: "slider" | "stepper" | "input" | "select" | "textarea" | "checkbox" | "toggle_group";
}

// =============================================================================
// Main Component
// =============================================================================

export function FormInput() {
  const { request, disabled, updateProvider, mode } = useInteraction();

  // Check if we're in readonly mode (viewing history)
  const isReadonly = mode.type === "readonly";

  // Extract data and schema from display_data (standard pattern)
  const displayData = request.display_data || {};
  const data = (displayData.data || []) as Record<string, unknown>[];
  const schema = (displayData.schema || { type: "object" }) as SchemaProperty;

  // Input schema is nested inside schema's _ux.input_schema
  const schemaUx = getUx(schema as Record<string, unknown>);
  const inputSchema = (schemaUx.input_schema || { type: "object", properties: {} }) as InputPropertySchema;
  const inputProperties = (inputSchema.properties || {}) as Record<string, InputPropertySchema>;
  const inputPropertyKeys = Object.keys(inputProperties);

  // Defaults from form_defaults (array, one per item)
  const defaults = (request.form_defaults || []) as Record<string, unknown>[];

  // In readonly mode, get form data from response; otherwise use defaults
  const readonlyFormData = isReadonly && mode.response.form_data
    ? (mode.response.form_data as Record<string, unknown>[])
    : null;

  // Initialize form data with defaults or readonly response data
  const [formData, setFormData] = useState<Record<string, unknown>[]>(() => {
    if (readonlyFormData) {
      return readonlyFormData;
    }
    return data.map((_, index) => ({
      ...(defaults[index] || {}),
    }));
  });

  // Use ref to track form data for getResponse callback
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  // Form is always valid on client side - server handles validation
  // This allows flexible submission patterns (e.g., select any subset of items)
  const isValid = true;

  // Use ref to track validity for getState callback
  const isValidRef = useRef(isValid);
  isValidRef.current = isValid;

  // Register provider for host
  useEffect(() => {
    console.log("[FormInput] Registering provider, data length:", data.length, "formData:", formData);
    updateProvider({
      getState: () => ({
        isValid: isValidRef.current,
        selectedCount: 0,
        selectedGroupIds: [],
      }),
      getResponse: () => {
        console.log("[FormInput] getResponse called, formDataRef.current:", formDataRef.current);
        return {
          form_data: formDataRef.current,
        };
      },
    });
  }, [updateProvider]);

  // Update provider state when validity changes
  useEffect(() => {
    updateProvider({
      getState: () => ({
        isValid: isValidRef.current,
        selectedCount: 0,
        selectedGroupIds: [],
      }),
      getResponse: () => {
        console.log("[FormInput] getResponse (validity effect) called, formDataRef.current:", formDataRef.current);
        return {
          form_data: formDataRef.current,
        };
      },
    });
  }, [isValid, updateProvider]);

  // Handle field changes
  const handleChange = (itemIndex: number, key: string, value: unknown) => {
    console.log("[FormInput] handleChange:", itemIndex, key, value);
    setFormData((prev) => {
      const newData = [...prev];
      newData[itemIndex] = {
        ...newData[itemIndex],
        [key]: value,
      };
      console.log("[FormInput] newData after change:", newData);
      return newData;
    });
  };

  // Build column headers from input properties
  const columns = inputPropertyKeys.map((key) => ({
    key,
    title: inputProperties[key].title || key,
  }));

  // Form type determines layout
  const formType = request.form_type || "table";

  // Render table layout
  if (formType === "table") {
    return (
      <div className="space-y-4">
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="p-3 font-medium text-left">Item</th>
                {columns.map((col) => (
                  <th key={col.key} className="p-3 font-medium text-left min-w-[120px]">
                    {col.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((item, index) => (
                <tr key={index} className="border-b last:border-b-0">
                  <td className="p-3 align-middle">
                    <SchemaRenderer data={item} schema={schema} />
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} className="p-3 min-w-[120px] align-middle">
                      <FormField
                        property={inputProperties[col.key]}
                        value={formData[index]?.[col.key]}
                        onChange={(value) => handleChange(index, col.key, value)}
                        disabled={disabled || isReadonly}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // Default/fallback: card-style layout (for future form types)
  return (
    <div className="space-y-4">
      {data.map((item, index) => (
        <div key={index} className="border rounded-lg p-4 space-y-3">
          <SchemaRenderer data={item} schema={schema} />
          <div className="grid gap-3">
            {columns.map((col) => (
              <div key={col.key} className="space-y-1">
                <label className="text-sm font-medium">{col.title}</label>
                <FormField
                  property={inputProperties[col.key]}
                  value={formData[index]?.[col.key]}
                  onChange={(value) => handleChange(index, col.key, value)}
                  disabled={disabled || isReadonly}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Form Field Component
// =============================================================================

interface FormFieldProps {
  property: InputPropertySchema;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}

function FormField({ property, value, onChange, disabled }: FormFieldProps) {
  // Determine display type
  const displayType = property.display || inferDisplayType(property);

  // Enum select
  if (property.enum) {
    return (
      <Select
        value={(value as string) || ""}
        onValueChange={onChange}
        disabled={disabled}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {property.enum.map((option: string) => (
            <SelectItem key={option} value={option}>
              {property.enum_labels?.[option] || option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Boolean checkbox
  if (property.type === "boolean") {
    return (
      <Checkbox
        checked={(value as boolean) || false}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    );
  }

  // Number with slider
  if (displayType === "slider" && property.type === "number") {
    const min = property.minimum ?? 0;
    const max = property.maximum ?? 100;
    const current = (value as number) ?? property.default ?? min;

    return (
      <div className="flex items-center gap-2">
        <Slider
          value={[current]}
          onValueChange={([v]) => onChange(v)}
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          className="flex-1"
        />
        <span className="text-sm text-muted-foreground w-8 text-right">
          {current}
        </span>
      </div>
    );
  }

  // Number input
  if (property.type === "number" || property.type === "integer") {
    return (
      <Input
        type="number"
        value={value !== undefined ? String(value) : ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            onChange(undefined);
          } else {
            onChange(
              property.type === "integer" ? parseInt(v, 10) : parseFloat(v)
            );
          }
        }}
        min={property.minimum}
        max={property.maximum}
        disabled={disabled}
        className="w-full"
      />
    );
  }

  // Multiline textarea
  if (property.multiline || displayType === "textarea") {
    return (
      <Textarea
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-h-[60px]"
      />
    );
  }

  // Default: single-line text input
  return (
    <Input
      type="text"
      value={(value as string) || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full"
    />
  );
}

// =============================================================================
// Helpers
// =============================================================================

function inferDisplayType(property: InputPropertySchema): string {
  // If has min/max and is number, suggest slider
  if (
    property.type === "number" &&
    property.minimum !== undefined &&
    property.maximum !== undefined
  ) {
    return "slider";
  }

  if (property.multiline) {
    return "textarea";
  }

  return "input";
}

export default FormInput;
