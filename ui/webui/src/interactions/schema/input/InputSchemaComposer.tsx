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

import { useState, useMemo, useCallback, type ReactNode } from "react";
import type { SchemaProperty, UxConfig } from "../types";
import {
  InputSchemaContext,
  type InputSchemaContextValue,
  type InputSchema,
  type DynamicOption,
} from "./InputSchemaContext";
import { InputSchemaRenderer } from "./InputSchemaRenderer";

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
        // Resolve {field} placeholders in the template
        initial[key] = sourceData.replace(/\{(\w+)\}/g, (_, field) => {
          const value = dataRecord[field];
          return value !== undefined ? String(value) : "";
        });
      } else if (sourceField && dataRecord[sourceField] !== undefined) {
        initial[key] = dataRecord[sourceField];
      } else {
        initial[key] = dataRecord[key] ?? schemaRecord.default;
      }
    }
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

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

    // State
    isValid: Object.keys(errors).length === 0,
    disabled,
    readonly,

    inputSchema,
  }), [values, errors, getDynamicOptions, setDynamicOptions, alternativeMode, isAlternativeMode, setAlternativeMode, disabled, readonly, inputSchema]);

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
