/**
 * InputSchemaComposer - Context provider for input_schema handling.
 *
 * This component is invoked by SchemaRenderer's bracket syntax parsing when
 * "input_schema" is a sibling (e.g., "media[input_schema,image_generation]").
 * It:
 * 1. Provides InputSchemaContext for value/error management
 * 2. Renders InputSchemaRenderer for the input fields
 * 3. Renders children (other siblings like ImageGeneration)
 *
 * The context is shared between:
 * - Input renderers (read/write values, display error styling)
 * - Generation components (validate, submit values via getMappedValues)
 */

import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { SchemaProperty, UxConfig } from "../../types/schema";
import { useRenderContext } from "../../contexts/RenderContext";
import {
  InputSchemaContext,
  type InputSchemaContextValue,
  type InputSchema,
  type DynamicOption,
} from "./InputSchemaContext";
import { InputSchemaRenderer } from "./InputSchemaRenderer";
import { renderTemplate } from "../../utils/template-service";

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
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
  /** Children from bracket syntax (other siblings like ImageGeneration) */
  children?: ReactNode;
}

// =============================================================================
// Component
// =============================================================================

export function InputSchemaComposer({
  data,
  schema: _schema,
  path,
  ux,
  disabled = false,
  readonly = false,
  children,
}: InputSchemaComposerProps) {
  void _schema; // Schema is available but we use ux.input_schema
  const inputSchema = ux.input_schema as InputSchema;

  // Get template state and debug mode from RenderContext
  const { templateState, debugMode } = useRenderContext();

  // Helper: Get nested value by dot-notated path (e.g., "nested.field.path")
  const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };

  // Initialize values from data, handling source_data/source_field
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    const properties = inputSchema?.properties || {};
    const dataRecord = (data || {}) as Record<string, unknown>;

    for (const [key, fieldSchema] of Object.entries(properties)) {
      const schemaRecord = fieldSchema as Record<string, unknown>;
      const fieldUx = (schemaRecord._ux || {}) as Record<string, unknown>;
      const sourceField = fieldUx.source_field as string | undefined;
      const sourceData = fieldUx.source_data as string | undefined;

      // Value priority: source_data > source_field > data[key] > schema.default
      if (sourceData) {
        // Check if it's a Jinja2-style template ({{ }}) or simple placeholder ({})
        if (sourceData.includes("{{")) {
          // Use renderTemplate for Jinja2-style expressions with state access
          const rendered = renderTemplate(sourceData, dataRecord, templateState);
          // Try to parse as number if the schema type is integer/number
          const schemaType = schemaRecord.type as string;
          if ((schemaType === "integer" || schemaType === "number") && rendered) {
            const parsed = Number(rendered);
            initial[key] = isNaN(parsed) ? schemaRecord.default : parsed;
          } else {
            initial[key] = rendered || schemaRecord.default;
          }
        } else {
          // Resolve {field} placeholders in the template (legacy format)
          initial[key] = sourceData.replace(/\{(\w+)\}/g, (_, field) => {
            const value = dataRecord[field];
            return value !== undefined ? String(value) : "";
          });
        }
      } else if (sourceField) {
        // Support dot-notated paths (e.g., "nested.field.path")
        const nestedValue = getNestedValue(dataRecord, sourceField);
        if (nestedValue !== undefined) {
          initial[key] = nestedValue;
        } else {
          initial[key] = dataRecord[key] ?? schemaRecord.default;
        }
      } else {
        initial[key] = dataRecord[key] ?? schemaRecord.default;
      }
    }
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Track previous data for debug mode sync
  const prevDataRef = useRef(data);

  // Debug mode: sync external data changes to internal values state
  // This allows editing display_data from debug tools to update input fields
  useEffect(() => {
    if (!debugMode) return;

    // Check if data actually changed (reference comparison)
    if (data === prevDataRef.current) return;
    prevDataRef.current = data;

    // Re-compute values from new data (same logic as initialization)
    const properties = inputSchema?.properties || {};
    const dataRecord = (data || {}) as Record<string, unknown>;
    const newValues: Record<string, unknown> = {};

    for (const [key, fieldSchema] of Object.entries(properties)) {
      const schemaRecord = fieldSchema as Record<string, unknown>;
      const fieldUx = (schemaRecord._ux || {}) as Record<string, unknown>;
      const sourceField = fieldUx.source_field as string | undefined;
      const sourceData = fieldUx.source_data as string | undefined;

      if (sourceData) {
        newValues[key] = sourceData.replace(/\{(\w+)\}/g, (_, field) => {
          const value = dataRecord[field];
          return value !== undefined ? String(value) : "";
        });
      } else if (sourceField) {
        // Support dot-notated paths (e.g., "nested.field.path")
        const nestedValue = getNestedValue(dataRecord, sourceField);
        if (nestedValue !== undefined) {
          newValues[key] = nestedValue;
        } else {
          newValues[key] = dataRecord[key] ?? schemaRecord.default;
        }
      } else {
        newValues[key] = dataRecord[key] ?? schemaRecord.default;
      }
    }

    setValues(newValues);
  }, [data, inputSchema]);

  // Dynamic options for controlled select fields
  const [dynamicOptions, setDynamicOptionsState] = useState<Record<string, DynamicOption[]>>({});

  const getDynamicOptions = useCallback(
    (key: string): DynamicOption[] | undefined => dynamicOptions[key],
    [dynamicOptions]
  );

  const setDynamicOptions = useCallback(
    (key: string, options: DynamicOption[]) => {
      setDynamicOptionsState(prev => ({ ...prev, [key]: options }));
    },
    []
  );

  // Alternative input mode tracking
  const [alternativeMode, setAlternativeModeState] = useState<Record<string, boolean>>({});

  const isAlternativeMode = useCallback(
    (key: string): boolean => alternativeMode[key] ?? false,
    [alternativeMode]
  );

  const setAlternativeMode = useCallback(
    (key: string, active: boolean) => {
      setAlternativeModeState(prev => ({ ...prev, [key]: active }));
    },
    []
  );

  // Visibility control for conditional field display
  const [visibility, setVisibilityState] = useState<Record<string, boolean>>({});

  const isVisible = useCallback(
    (key: string): boolean => visibility[key] ?? true, // Default to visible
    [visibility]
  );

  const setVisibility = useCallback(
    (key: string, visible: boolean) => {
      setVisibilityState(prev => ({ ...prev, [key]: visible }));
    },
    []
  );

  // Create context value
  const sourceData = (data || {}) as Record<string, unknown>;
  const contextValue = useMemo<InputSchemaContextValue>(() => ({
    sourceData,
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

    // Get values with destination_field mapping applied
    getMappedValues: () => {
      const result: Record<string, unknown> = {};
      const properties = inputSchema?.properties || {};
      for (const [key, fieldSchema] of Object.entries(properties)) {
        const schemaRecord = fieldSchema as Record<string, unknown>;
        const destKey = (schemaRecord.destination_field as string) || key;
        if (values[key] !== undefined) {
          result[destKey] = values[key];
        }
      }
      return result;
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

    // Dynamic options for controlled select fields
    getDynamicOptions,
    setDynamicOptions,

    // Alternative input mode tracking
    alternativeMode,
    isAlternativeMode,
    setAlternativeMode,

    // Visibility control for conditional field display
    visibility,
    isVisible,
    setVisibility,

    // State
    isValid: Object.keys(errors).length === 0,
    disabled,
    readonly,

    inputSchema,
  }), [sourceData, values, errors, getDynamicOptions, setDynamicOptions, alternativeMode, isAlternativeMode, setAlternativeMode, visibility, isVisible, setVisibility, disabled, readonly, inputSchema]);

  // Render input fields + children (other siblings from bracket syntax)
  return (
    <InputSchemaContext.Provider value={contextValue}>
      <div className="space-y-4">
        {/* Render input fields */}
        <InputSchemaRenderer
          schema={inputSchema}
          data={(data || {}) as Record<string, unknown>}
          path={[...path, "_inputs"]}
          disabled={disabled}
          readonly={readonly}
        />
        {/* Render other siblings (e.g., ImageGeneration) */}
        {children}
      </div>
    </InputSchemaContext.Provider>
  );
}
