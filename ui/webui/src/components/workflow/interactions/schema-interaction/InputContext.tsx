/**
 * InputContext - React context for input values and validation.
 *
 * Provides controlled input state management for schema-driven forms:
 * - Value storage keyed by path (e.g., "prompts.midjourney.prompt_a")
 * - Validation with required fields and min/max constraints
 * - Error tracking per field
 * - Integration with input renderers (TextareaInputRenderer, etc.)
 *
 * Separate from SelectionContext which handles item selection.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import type { SchemaProperty, UxConfig } from "./types";
import { getUx } from "./ux-utils";

// =============================================================================
// Types
// =============================================================================

export interface ValidationError {
  path: string[];
  message: string;
}

/**
 * Indexed value wrapper for select fields with object values.
 * Stores both the index (for display) and the actual value (for API).
 */
export interface IndexedValue {
  _idx: number;
  _value: unknown;
}

/**
 * Check if a value is an IndexedValue wrapper.
 */
export function isIndexedValue(value: unknown): value is IndexedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "_idx" in value &&
    "_value" in value
  );
}

/** Option for dynamic dropdowns */
export interface DynamicOption {
  value: unknown;
  label: string;
  /** Full source item for nested controls (when controlled field also controls others) */
  sourceItem?: unknown;
}

export interface InputContextValue {
  // Value access
  values: Record<string, unknown>;
  getValue: (path: string[]) => unknown;
  getRawValue: (path: string[]) => unknown;
  setValue: (path: string[], value: unknown) => void;

  // State
  disabled: boolean;
  readonly: boolean;

  // Validation
  errors: ValidationError[];
  isValid: boolean;
  getError: (path: string[]) => string | undefined;
  validate: () => boolean;

  // Schema access
  getFieldSchema: (path: string[]) => UxConfig | undefined;

  // Dynamic options for controlled fields
  getDynamicOptions: (path: string[]) => DynamicOption[] | undefined;
  setDynamicOptions: (path: string[], options: DynamicOption[]) => void;
}

export interface InputProviderProps {
  children: ReactNode;
  initialValues?: Record<string, unknown>;
  disabled?: boolean;
  readonly?: boolean;
  schema?: SchemaProperty;
  onChange?: (values: Record<string, unknown>) => void;
  onValidationChange?: (isValid: boolean, errors: ValidationError[]) => void;
}

// =============================================================================
// Context
// =============================================================================

const InputContext = createContext<InputContextValue | null>(null);

// =============================================================================
// Hooks
// =============================================================================

/**
 * Hook for input components to access input context.
 * Throws if used outside InputProvider.
 */
export function useInput(): InputContextValue {
  const context = useContext(InputContext);
  if (!context) {
    throw new Error("useInput must be used within an InputProvider");
  }
  return context;
}

/**
 * Optional hook that returns null if not in an input context.
 * Useful for components that may render with or without InputProvider.
 */
export function useInputOptional(): InputContextValue | null {
  return useContext(InputContext);
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert path array to dot-separated key string.
 */
export function pathToKey(path: string[]): string {
  return path.join(".");
}

/**
 * Convert dot-separated key string to path array.
 */
export function keyToPath(key: string): string[] {
  return key.split(".");
}

/**
 * Get schema for a field by traversing the schema tree.
 */
function getSchemaForPath(
  schema: SchemaProperty | undefined,
  path: string[]
): SchemaProperty | undefined {
  if (!schema || path.length === 0) return schema;

  let current: SchemaProperty | undefined = schema;

  for (const key of path) {
    if (!current) return undefined;

    // Check properties
    if (current.properties && current.properties[key]) {
      current = current.properties[key];
      continue;
    }

    // Check additionalProperties (for dynamic keys)
    if (current.additionalProperties) {
      current = current.additionalProperties;
      continue;
    }

    // Check items (for arrays, key would be numeric index)
    if (current.items && !isNaN(Number(key))) {
      current = current.items;
      continue;
    }

    return undefined;
  }

  return current;
}

/**
 * Validate a single field value against its schema.
 */
function validateField(
  path: string[],
  value: unknown,
  ux: UxConfig
): ValidationError | null {
  // Required check
  if (ux.required) {
    if (value === undefined || value === null || value === "") {
      return {
        path,
        message: `${ux.display_label || path[path.length - 1] || "Field"} is required`,
      };
    }
  }

  // Min/max for numbers
  if (typeof value === "number") {
    if (ux.minimum !== undefined && value < ux.minimum) {
      return {
        path,
        message: `${ux.display_label || path[path.length - 1] || "Value"} must be at least ${ux.minimum}`,
      };
    }
    if (ux.maximum !== undefined && value > ux.maximum) {
      return {
        path,
        message: `${ux.display_label || path[path.length - 1] || "Value"} must be at most ${ux.maximum}`,
      };
    }
  }

  return null;
}

/**
 * Collect all fields with validation rules from schema.
 */
function collectValidatableFields(
  schema: SchemaProperty | undefined,
  basePath: string[] = []
): Array<{ path: string[]; ux: UxConfig }> {
  if (!schema) return [];

  const fields: Array<{ path: string[]; ux: UxConfig }> = [];
  const ux = getUx(schema as Record<string, unknown>);

  // Check if this field has validation rules
  if (ux.required || ux.minimum !== undefined || ux.maximum !== undefined) {
    fields.push({ path: basePath, ux });
  }

  // Check input_schema for nested validation rules
  if (ux.input_schema && typeof ux.input_schema === "object") {
    const inputSchema = ux.input_schema as SchemaProperty;
    if (inputSchema.properties) {
      for (const [key, propSchema] of Object.entries(inputSchema.properties)) {
        const propUx = getUx(propSchema as Record<string, unknown>);
        const propPath = [...basePath, key];
        if (propUx.required || propUx.minimum !== undefined || propUx.maximum !== undefined) {
          fields.push({ path: propPath, ux: propUx });
        }
      }
    }
  }

  // Recurse into properties
  if (schema.properties) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      fields.push(...collectValidatableFields(propSchema, [...basePath, key]));
    }
  }

  return fields;
}

// =============================================================================
// Provider
// =============================================================================

export function InputProvider({
  children,
  initialValues = {},
  disabled = false,
  readonly = false,
  schema,
  onChange,
  onValidationChange,
}: InputProviderProps) {
  // Value state - keyed by path string
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);

  // Dynamic options state - keyed by path string
  const [dynamicOptions, setDynamicOptionsState] = useState<Record<string, DynamicOption[]>>({});

  // Validation state
  const [errors, setErrors] = useState<ValidationError[]>([]);

  // Track if we've done initial validation
  const [hasValidated, setHasValidated] = useState(false);

  // === Value Access ===

  const getValue = useCallback(
    (path: string[]): unknown => {
      const key = pathToKey(path);
      if (key in values) {
        const stored = values[key];
        // Unwrap IndexedValue to return actual value for API use
        if (isIndexedValue(stored)) {
          return stored._value;
        }
        return stored;
      }
      // Fallback: try to get default from schema
      const fieldSchema = getSchemaForPath(schema, path);
      if (fieldSchema) {
        const ux = getUx(fieldSchema as Record<string, unknown>);
        return ux.input_schema && typeof ux.input_schema === "object"
          ? (ux.input_schema as Record<string, unknown>).default
          : undefined;
      }
      return undefined;
    },
    [values, schema]
  );

  const getRawValue = useCallback(
    (path: string[]): unknown => {
      const key = pathToKey(path);
      return values[key];
    },
    [values]
  );

  const setValue = useCallback(
    (path: string[], value: unknown) => {
      const key = pathToKey(path);
      setValues((prev) => {
        const next = { ...prev, [key]: value };
        // Notify parent of change
        onChange?.(next);
        return next;
      });

      // Clear error for this field when value changes
      setErrors((prev) => prev.filter((e) => pathToKey(e.path) !== key));
    },
    [onChange]
  );

  // === Schema Access ===

  const getFieldSchema = useCallback(
    (path: string[]): UxConfig | undefined => {
      const fieldSchema = getSchemaForPath(schema, path);
      if (!fieldSchema) return undefined;
      return getUx(fieldSchema as Record<string, unknown>);
    },
    [schema]
  );

  // === Dynamic Options ===

  const getDynamicOptions = useCallback(
    (path: string[]): DynamicOption[] | undefined => {
      const key = pathToKey(path);
      return dynamicOptions[key];
    },
    [dynamicOptions]
  );

  const setDynamicOptions = useCallback(
    (path: string[], options: DynamicOption[]) => {
      const key = pathToKey(path);
      setDynamicOptionsState((prev) => ({
        ...prev,
        [key]: options,
      }));
    },
    []
  );

  // === Validation ===

  const validate = useCallback((): boolean => {
    const validatableFields = collectValidatableFields(schema);
    const newErrors: ValidationError[] = [];

    for (const { path, ux } of validatableFields) {
      const key = pathToKey(path);
      const value = values[key];
      const error = validateField(path, value, ux);
      if (error) {
        newErrors.push(error);
      }
    }

    setErrors(newErrors);
    setHasValidated(true);
    return newErrors.length === 0;
  }, [schema, values]);

  const getError = useCallback(
    (path: string[]): string | undefined => {
      const key = pathToKey(path);
      const error = errors.find((e) => pathToKey(e.path) === key);
      return error?.message;
    },
    [errors]
  );

  const isValid = useMemo(() => {
    // If we haven't validated yet, assume valid (don't block initial state)
    if (!hasValidated) return true;
    return errors.length === 0;
  }, [errors, hasValidated]);

  // Notify parent of validation changes
  useEffect(() => {
    onValidationChange?.(isValid, errors);
  }, [isValid, errors, onValidationChange]);

  // === Context Value ===

  const contextValue = useMemo<InputContextValue>(
    () => ({
      values,
      getValue,
      getRawValue,
      setValue,
      disabled,
      readonly,
      errors,
      isValid,
      getError,
      validate,
      getFieldSchema,
      getDynamicOptions,
      setDynamicOptions,
    }),
    [
      values,
      getValue,
      getRawValue,
      setValue,
      disabled,
      readonly,
      errors,
      isValid,
      getError,
      validate,
      getFieldSchema,
      getDynamicOptions,
      setDynamicOptions,
    ]
  );

  return (
    <InputContext.Provider value={contextValue}>
      {children}
    </InputContext.Provider>
  );
}
