/**
 * InputSchemaComposer - Extension to SchemaRenderer for handling input_schema.
 *
 * This component is invoked by SchemaRenderer when it detects input_schema in UX config.
 * It:
 * 1. Provides InputSchemaContext for value/error management
 * 2. Renders InputSchemaRenderer for the input fields
 * 3. Renders remaining schema via SchemaRenderer (without input_schema)
 * 4. Handles compound render_as composition (e.g., tab.media)
 *
 * The context is shared between:
 * - Input renderers (read/write values, display error styling)
 * - MediaPanel or other consumers (validate, submit values, display error messages)
 */

import { useState, useMemo } from "react";
import type { SchemaProperty, UxConfig, RenderAs } from "./types";
import {
  InputSchemaContext,
  type InputSchemaContextValue,
  type InputSchema,
} from "./InputSchemaContext";
import { InputSchemaRenderer } from "./InputSchemaRenderer";

// Forward declaration to avoid circular import
// The actual SchemaRenderer will be imported at runtime
import { SchemaRenderer } from "./SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface InputSchemaComposerProps {
  /** The data to render */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config (contains input_schema) */
  ux: UxConfig;
}

// =============================================================================
// Component
// =============================================================================

export function InputSchemaComposer({ data, schema, path, ux }: InputSchemaComposerProps) {
  const inputSchema = ux.input_schema as InputSchema;

  // Initialize values from data, falling back to schema defaults
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    const properties = inputSchema?.properties || {};
    const dataRecord = (data || {}) as Record<string, unknown>;

    for (const [key, fieldSchema] of Object.entries(properties)) {
      // Value priority: data[key] → schema.default → undefined
      const schemaRecord = fieldSchema as Record<string, unknown>;
      initial[key] = dataRecord[key] ?? schemaRecord.default;
    }
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Create context value
  const contextValue = useMemo<InputSchemaContextValue>(() => ({
    values,
    getValue: (key) => values[key],
    setValue: (key, value) => {
      setValues(prev => ({ ...prev, [key]: value }));
      // Clear error when value changes
      if (errors[key]) {
        setErrors(prev => {
          const { [key]: _, ...rest } = prev;
          return rest;
        });
      }
    },

    errors,
    setError: (key, error) => {
      setErrors(prev => ({ ...prev, [key]: error }));
    },
    clearError: (key) => {
      setErrors(prev => {
        const { [key]: _, ...rest } = prev;
        return rest;
      });
    },
    clearAllErrors: () => setErrors({}),

    isValid: Object.keys(errors).length === 0,
    inputSchema,
  }), [values, errors, inputSchema]);

  // Create UX without input_schema for remaining content
  const remainingUx: UxConfig = { ...ux, input_schema: undefined };

  // Render InputSchemaRenderer - data passed directly (1:1 map)
  const inputComponent = (
    <InputSchemaRenderer
      schema={inputSchema}
      data={(data || {}) as Record<string, unknown>}
      path={[...path, "_inputs"]}
    />
  );

  // Handle compound render_as (e.g., tab.media)
  if (ux.render_as && typeof ux.render_as === "string" && ux.render_as.includes(".")) {
    const dotIndex = ux.render_as.indexOf(".");
    const outerRenderAs = ux.render_as.slice(0, dotIndex) as RenderAs;
    const innerRenderAs = ux.render_as.slice(dotIndex + 1) as RenderAs;

    // Outer wraps both input and inner content
    return (
      <InputSchemaContext.Provider value={contextValue}>
        <SchemaRenderer
          schema={schema}
          data={data}
          path={path}
          ux={{ ...remainingUx, render_as: outerRenderAs }}
        >
          <>
            {inputComponent}
            <SchemaRenderer
              schema={schema}
              data={data}
              path={path}
              ux={{ ...remainingUx, render_as: innerRenderAs }}
            />
          </>
        </SchemaRenderer>
      </InputSchemaContext.Provider>
    );
  }

  // Simple render_as - fragment composition
  return (
    <InputSchemaContext.Provider value={contextValue}>
      {inputComponent}
      <SchemaRenderer
        schema={schema}
        data={data}
        path={path}
        ux={remainingUx}
      />
    </InputSchemaContext.Provider>
  );
}
