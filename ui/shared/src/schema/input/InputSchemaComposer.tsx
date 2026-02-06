/**
 * InputSchemaComposer - Context provider for input_schema handling.
 *
 * This component is invoked by SchemaRenderer's bracket syntax parsing when
 * "input_schema" is a sibling (e.g., "media[input_schema,image_generation]").
 * It:
 * 1. Provides InputSchemaActionsContext for stable functions
 * 2. Provides InputSchemaStateContext for reactive values
 * 3. Renders InputSchemaRenderer for the input fields
 * 4. Renders children (other siblings like ImageGeneration)
 *
 * The contexts are split for performance:
 * - Actions context: stable functions (setValue, getMappedValues, etc.)
 * - State context: reactive values (values, errors)
 *
 * Components can choose which context they need to avoid unnecessary re-renders.
 */

import { useState, useMemo, useCallback, useEffect, useRef, type ReactNode } from "react";
import type { SchemaProperty, UxConfig } from "../../types/schema";
import { useRenderContext } from "../../contexts/RenderContext";
import { useWorkflowState } from "../../contexts/WorkflowStateContext";
import {
  InputSchemaActionsContext,
  InputSchemaStateContext,
  type InputSchemaActions,
  type InputSchemaState,
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

  // Get debug mode from RenderContext
  const { debugMode } = useRenderContext();
  // Get template state from WorkflowStateContext (reactive to state changes)
  const { state: workflowState } = useWorkflowState();
  const templateState = (workflowState?.state_mapped || {}) as Record<string, unknown>;

  // Helper: Get nested value by dot-notated path (e.g., "nested.field.path")
  const getNestedValue = useCallback((obj: Record<string, unknown>, path: string): unknown => {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== "object") {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }, []);

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
  }, [data, inputSchema, debugMode, getNestedValue]);

  // Dynamic options for controlled select fields
  const [dynamicOptions, setDynamicOptionsState] = useState<Record<string, DynamicOption[]>>({});

  // Alternative input mode tracking
  const [alternativeMode, setAlternativeModeState] = useState<Record<string, boolean>>({});

  // Visibility control for conditional field display
  const [visibility, setVisibilityState] = useState<Record<string, boolean>>({});

  // =============================================================================
  // Stable refs for actions (to ensure getValue reads latest values)
  // =============================================================================

  // Use refs to access latest state in stable callbacks
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const errorsRef = useRef(errors);
  errorsRef.current = errors;

  const dynamicOptionsRef = useRef(dynamicOptions);
  dynamicOptionsRef.current = dynamicOptions;

  const alternativeModeRef = useRef(alternativeMode);
  alternativeModeRef.current = alternativeMode;

  const visibilityRef = useRef(visibility);
  visibilityRef.current = visibility;

  // =============================================================================
  // Stable action callbacks (these never change)
  // =============================================================================

  const getValue = useCallback((key: string): unknown => {
    return valuesRef.current[key];
  }, []);

  const setValue = useCallback((key: string, value: unknown): void => {
    setValues(prev => ({ ...prev, [key]: value }));
    // Clear error when value changes
    setErrors(prev => {
      if (prev[key]) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  }, []);

  const getMappedValues = useCallback((): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const properties = inputSchema?.properties || {};
    const currentValues = valuesRef.current;
    for (const [key, fieldSchema] of Object.entries(properties)) {
      const schemaRecord = fieldSchema as Record<string, unknown>;
      const destKey = (schemaRecord.destination_field as string) || key;
      if (currentValues[key] !== undefined) {
        result[destKey] = currentValues[key];
      }
    }
    return result;
  }, [inputSchema]);

  const setError = useCallback((key: string, error: string): void => {
    setErrors(prev => ({ ...prev, [key]: error }));
  }, []);

  const clearError = useCallback((key: string): void => {
    setErrors(prev => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const clearAllErrors = useCallback((): void => {
    setErrors({});
  }, []);

  const getDynamicOptions = useCallback((key: string): DynamicOption[] | undefined => {
    return dynamicOptionsRef.current[key];
  }, []);

  const setDynamicOptions = useCallback((key: string, options: DynamicOption[]): void => {
    setDynamicOptionsState(prev => ({ ...prev, [key]: options }));
  }, []);

  const isAlternativeMode = useCallback((key: string): boolean => {
    return alternativeModeRef.current[key] ?? false;
  }, []);

  const setAlternativeMode = useCallback((key: string, active: boolean): void => {
    setAlternativeModeState(prev => ({ ...prev, [key]: active }));
  }, []);

  const isVisible = useCallback((key: string): boolean => {
    return visibilityRef.current[key] ?? true; // Default to visible
  }, []);

  const setVisibility = useCallback((key: string, visible: boolean): void => {
    setVisibilityState(prev => ({ ...prev, [key]: visible }));
  }, []);

  // =============================================================================
  // Context values
  // =============================================================================

  const sourceData = (data || {}) as Record<string, unknown>;

  // Actions context - STABLE, never changes after mount
  // Uses useCallback functions that read from refs
  const actionsValue = useMemo<InputSchemaActions>(() => ({
    sourceData,
    getValue,
    setValue,
    getMappedValues,
    setError,
    clearError,
    clearAllErrors,
    getDynamicOptions,
    setDynamicOptions,
    isAlternativeMode,
    setAlternativeMode,
    isVisible,
    setVisibility,
    inputSchema,
    disabled,
    readonly,
  }), [
    sourceData,
    getValue,
    setValue,
    getMappedValues,
    setError,
    clearError,
    clearAllErrors,
    getDynamicOptions,
    setDynamicOptions,
    isAlternativeMode,
    setAlternativeMode,
    isVisible,
    setVisibility,
    inputSchema,
    disabled,
    readonly,
  ]);

  // State context - REACTIVE, changes when values/errors change
  const stateValue = useMemo<InputSchemaState>(() => ({
    values,
    errors,
    alternativeMode,
    visibility,
    isValid: Object.keys(errors).length === 0,
  }), [values, errors, alternativeMode, visibility]);

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <InputSchemaActionsContext.Provider value={actionsValue}>
      <InputSchemaStateContext.Provider value={stateValue}>
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
      </InputSchemaStateContext.Provider>
    </InputSchemaActionsContext.Provider>
  );
}
