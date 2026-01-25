/**
 * SelectInputRenderer - Dropdown select input renderer.
 *
 * Supports two modes:
 * 1. Simple mode: options prop with {value, label} array
 * 2. Controlled mode: enumData with objects + valueKey/labelKey + controls
 *
 * Controlled mode allows this select to update sibling fields when value changes.
 * Uses controls config to extract options from selected object and set them
 * as dynamic options for dependent fields.
 *
 * Behavior:
 * - readonly mode: renders selected label as text
 * - active mode: renders select dropdown
 * - supports enum and enum_labels from schema
 */

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useInputOptional, isIndexedValue, type DynamicOption, type IndexedValue } from "../InputContext";
import { useInputSchemaOptional } from "../InputSchemaContext";
import type { ControlConfig } from "../types";

// =============================================================================
// Types
// =============================================================================

export interface SelectOption {
  value: string;
  label: string;
}

/** Extended option that preserves the original value for object-based selections */
interface IndexedSelectOption {
  /** String index for Select component matching */
  index: string;
  /** Display label */
  label: string;
  /** Original value (may be object) to store when selected */
  originalValue: unknown;
}

interface SelectInputRendererProps {
  /** Path to this value in the input context */
  path: string[];
  /** Current value (for uncontrolled/display mode) */
  value?: string;
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
  /** Direct onChange handler (used when not in InputContext) */
  onChange?: (value: string) => void;
  /** Direct disabled state (used when not in InputContext) */
  disabled?: boolean;
  /** Direct readonly state (used when not in InputContext) */
  readonly?: boolean;

  // === Options can be provided in multiple ways ===

  /** Simple options array - {value, label}[] */
  options?: SelectOption[];

  /** Enum from schema - can be string[] or object[] */
  enumData?: unknown[];
  /** For object enum: key to use as value */
  valueKey?: string;
  /** For object enum: key to use as label */
  labelKey?: string;
  /** For object enum: format string for label with {field} placeholders */
  labelFormat?: string;
  /** Controls config for dependent fields */
  controls?: Record<string, ControlConfig>;
  /** Enum labels map (for string enums) */
  enumLabels?: Record<string, string>;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get a value from an object using a dot-separated path.
 */
function getByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Format a label string using {field} or {path.to.field} placeholders.
 * Supports dot notation for nested access.
 * Example: "{value.sampler} / {value.scheduler} ({count})"
 * Returns: "Euler / Karras (5)"
 */
function formatLabel(format: string, data: unknown): string {
  if (!data || typeof data !== "object") return String(data ?? "");

  return format.replace(/\{([\w.]+)\}/g, (_, path) => {
    const parts = path.split(".");
    let value: unknown = data;
    for (const part of parts) {
      if (value === null || value === undefined || typeof value !== "object") {
        return "";
      }
      value = (value as Record<string, unknown>)[part];
    }
    return value !== undefined ? String(value) : "";
  });
}

/**
 * Build options from an array of objects using value_key and label_key/label_format.
 * Reserved for future use with simple select options.
 */
function _buildOptionsFromEnumData(
  items: unknown[],
  valueKey: string,
  labelKey?: string,
  labelFormat?: string
): SelectOption[] {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const itemRecord = item as Record<string, unknown>;
      const rawValue = itemRecord[valueKey];

      // Convert value to string for SelectItem compatibility
      const value = typeof rawValue === "object"
        ? JSON.stringify(rawValue)
        : String(rawValue ?? "");

      let label: string;
      if (labelFormat) {
        // Always use item for formatting - supports {field} and {value.field} syntax
        label = formatLabel(labelFormat, itemRecord);
      } else if (labelKey) {
        label = String(itemRecord[labelKey] ?? value);
      } else {
        label = value;
      }

      return { value, label };
    })
    .filter((opt): opt is SelectOption => opt !== null);
}
void _buildOptionsFromEnumData;

/**
 * Build dynamic options from an array for controlled fields.
 * Stores the full source item for nested controls (when controlled field also controls others).
 */
function buildDynamicOptions(
  items: unknown[],
  valueKey: string,
  labelKey?: string,
  labelFormat?: string
): DynamicOption[] {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const itemRecord = item as Record<string, unknown>;
      const value = itemRecord[valueKey];

      let label: string;
      if (labelFormat) {
        // Always use item for formatting - supports {field} and {value.field} syntax
        label = formatLabel(labelFormat, itemRecord);
      } else if (labelKey) {
        label = String(itemRecord[labelKey] ?? "");
      } else if (Array.isArray(value)) {
        // For array values (like vae), join elements as plain text
        label = value.join(", ");
      } else {
        label = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
      }

      // Store full source item for nested controls
      return { value, label, sourceItem: item } as DynamicOption;
    })
    .filter((opt): opt is DynamicOption => opt !== null);
}

// =============================================================================
// Component
// =============================================================================

export function SelectInputRenderer({
  path,
  value: propValue,
  options: propOptions,
  enumData,
  valueKey,
  labelKey,
  labelFormat,
  controls,
  enumLabels,
  label,
  placeholder = "Select...",
  className,
  onChange: propOnChange,
  disabled: propDisabled,
  readonly: propReadonly,
}: SelectInputRendererProps) {
  const inputContext = useInputOptional();
  const inputSchemaContext = useInputSchemaOptional();

  // Get the field key (last element of path) for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Check for dynamic options from context (this field is controlled by another)
  const dynamicOptions = inputContext?.getDynamicOptions(path);

  // Determine mode based on what's provided
  const isObjectEnumMode = enumData !== undefined && valueKey !== undefined &&
    Array.isArray(enumData) && enumData.length > 0 && typeof enumData[0] === "object";
  const isPrimitiveEnumMode = Array.isArray(enumData) && enumData.length > 0 &&
    (typeof enumData[0] === "string" || typeof enumData[0] === "number");
  const hasDynamicOptions = dynamicOptions && dynamicOptions.length > 0;

  // For object values: use index-based selection
  const useIndexSelection = hasDynamicOptions || isObjectEnumMode;

  // Build indexed options array (maps index -> {label, originalValue})
  const indexedOptions = useMemo((): IndexedSelectOption[] => {
    if (hasDynamicOptions) {
      return dynamicOptions!.map((opt, i) => ({
        index: String(i),
        label: opt.label,
        originalValue: opt.value,
      }));
    }

    if (isObjectEnumMode) {
      return enumData!.map((item, i) => {
        if (!item || typeof item !== "object") {
          return { index: String(i), label: "", originalValue: undefined };
        }
        const rec = item as Record<string, unknown>;
        const val = rec[valueKey!];
        let lbl: string;
        if (labelFormat) {
          lbl = formatLabel(labelFormat, typeof val === "object" ? val : rec);
        } else if (labelKey) {
          lbl = String(rec[labelKey] ?? "");
        } else {
          lbl = typeof val === "object" ? String(i) : String(val ?? "");
        }
        return { index: String(i), label: lbl, originalValue: val };
      });
    }

    return [];
  }, [hasDynamicOptions, dynamicOptions, isObjectEnumMode, enumData, valueKey, labelKey, labelFormat]);

  // Build simple options for primitive values (string/number)
  const simpleOptions = useMemo((): SelectOption[] => {
    if (useIndexSelection) return [];

    if (isPrimitiveEnumMode) {
      return (enumData as (string | number)[]).map((val) => {
        const strVal = String(val);
        return { value: strVal, label: enumLabels?.[strVal] ?? strVal };
      });
    }

    return propOptions ?? [];
  }, [useIndexSelection, isPrimitiveEnumMode, enumData, enumLabels, propOptions]);

  // Unified options for Select rendering
  const options: SelectOption[] = useMemo(() => {
    if (useIndexSelection) {
      return indexedOptions.map((o) => ({ value: o.index, label: o.label }));
    }
    return simpleOptions;
  }, [useIndexSelection, indexedOptions, simpleOptions]);

  // Get stored value - try InputSchemaContext first, fall back to InputContext
  // InputSchemaContext stores simple values, InputContext may store IndexedValue
  const schemaContextValue = inputSchemaContext?.getValue(fieldKey);
  const rawStored = schemaContextValue !== undefined ? schemaContextValue : inputContext?.getRawValue(path);

  // Initialize context with prop value on mount (if context value is undefined)
  useEffect(() => {
    if (inputSchemaContext && schemaContextValue === undefined && propValue !== undefined) {
      inputSchemaContext.setValue(fieldKey, propValue);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine display value for Select
  // If stored as IndexedValue, use _idx directly (no comparison needed)
  // Otherwise fall back to string comparison for primitive values
  const value = useMemo(() => {
    if (rawStored === undefined || rawStored === null) {
      if (!propValue) return "";

      // For index-based selection, find matching index from default value
      if (useIndexSelection && valueKey) {
        const idx = indexedOptions.findIndex((opt) => {
          // Match by valueKey in the original source data
          if (isObjectEnumMode && Array.isArray(enumData)) {
            const item = enumData[parseInt(opt.index, 10)] as Record<string, unknown> | undefined;
            return item?.[valueKey] === propValue;
          }
          return false;
        });
        return idx >= 0 ? String(idx) : "";
      }

      return String(propValue);
    }

    // IndexedValue: use _idx directly
    if (isIndexedValue(rawStored)) {
      return String(rawStored._idx);
    }

    // Primitive value: use as-is for simple enums
    if (!useIndexSelection) {
      return String(rawStored);
    }

    // Index-based selection with primitive stored value (from InputSchemaContext)
    // Find matching index by comparing to originalValue (which is rec[valueKey])
    const matchIdx = indexedOptions.findIndex((opt) => opt.originalValue === rawStored);
    return matchIdx >= 0 ? String(matchIdx) : "";
  }, [rawStored, propValue, useIndexSelection, valueKey, indexedOptions, isObjectEnumMode, enumData]);

  // Determine state
  const disabled = inputContext?.disabled ?? propDisabled ?? false;
  const readonly = inputContext?.readonly ?? propReadonly ?? false;
  // Try InputSchemaContext first (uses fieldKey), fall back to InputContext (uses path)
  const error = inputSchemaContext?.errors[fieldKey] ?? inputContext?.getError(path);

  // Get path prefix for sibling fields (remove last element which is this field's key)
  const siblingPathPrefix = useMemo(() => path.slice(0, -1), [path]);

  // Find the currently selected object (for fields with controls)
  // Uses stored IndexedValue or falls back to computed value index
  const selectedObject = useMemo(() => {
    if (!controls) return undefined;

    // Get index: prefer stored IndexedValue, fall back to value (which handles default)
    let idx = isIndexedValue(rawStored) ? rawStored._idx : -1;
    if (idx < 0 && value) {
      idx = parseInt(value, 10);
      if (isNaN(idx)) idx = -1;
    }
    if (idx < 0) return undefined;

    // Case 1: Prop-based enum (isObjectEnumMode)
    if (isObjectEnumMode && Array.isArray(enumData)) {
      return enumData[idx];
    }

    // Case 2: Dynamic options (controlled field with nested controls)
    if (hasDynamicOptions && dynamicOptions) {
      return dynamicOptions[idx]?.sourceItem;
    }

    return undefined;
  }, [controls, rawStored, value, isObjectEnumMode, enumData, hasDynamicOptions, dynamicOptions]);

  // Ref to track last updated value to prevent infinite loops
  const lastUpdatedValueRef = useRef<string | undefined>(undefined);

  // Effect to update controlled fields when selection changes
  // Runs for both prop-based enum and controlled fields with nested controls
  useEffect(() => {
    if (!controls || !inputContext) return;

    // Prevent infinite loop - only update if value actually changed
    if (lastUpdatedValueRef.current === value) return;
    lastUpdatedValueRef.current = value;

    // Handle case when value is cleared (undefined/empty)
    // We still need to reset controlled fields even if selectedObject is undefined
    const valueIsCleared = !value || value === "";

    for (const [fieldName, config] of Object.entries(controls)) {
      const fieldPath = [...siblingPathPrefix, fieldName];

      // Handle type="value" - set target field value directly
      if (config.type === "value") {
        // If value is cleared, optionally reset the target field
        if (valueIsCleared) {
          if (config.reset) {
            inputContext.setValue(fieldPath, undefined);
          }
          continue;
        }

        // Value is set but no selectedObject found
        if (!selectedObject) continue;

        // Extract value using value_path (strip leading "." if present)
        if (config.value_path) {
          const pathStr = config.value_path.startsWith(".")
            ? config.value_path.slice(1)
            : config.value_path;
          const extractedValue = getByPath(selectedObject, pathStr);
          if (extractedValue !== undefined) {
            inputContext.setValue(fieldPath, extractedValue);
          }
        }
        continue;
      }

      // Handle type="enum" - set dynamic options for select fields
      if (config.type !== "enum") continue;

      // If value is cleared, clear all controlled fields
      if (valueIsCleared) {
        inputContext.setDynamicOptions(fieldPath, []);
        if (config.reset) {
          inputContext.setValue(fieldPath, undefined);
        }
        continue;
      }

      // Value is set but no selectedObject found (shouldn't happen normally)
      if (!selectedObject) continue;

      // Get the array from the selected object
      const items = getByPath(selectedObject, config.enum_path!);
      if (!Array.isArray(items) || items.length === 0) {
        // Clear options and reset value if no items found
        inputContext.setDynamicOptions(fieldPath, []);
        if (config.reset) {
          inputContext.setValue(fieldPath, undefined);
        }
        continue;
      }

      // Build options for this controlled field
      const fieldOptions = buildDynamicOptions(
        items,
        config.value_key!,
        config.label_key,
        config.label_format
      );

      // Set dynamic options
      inputContext.setDynamicOptions(fieldPath, fieldOptions);

      // Reset field value if reset is enabled
      if (config.reset) {
        inputContext.setValue(fieldPath, undefined);
      }

      // Auto-select default index if field has no value (or was just reset)
      // Skip auto-selection if default_index is negative (explicitly optional)
      const defaultIndex = config.default_index ?? 0;
      if (defaultIndex >= 0 && fieldOptions.length > 0 && fieldOptions[defaultIndex]) {
        const currentFieldValue = config.reset ? undefined : inputContext.getValue(fieldPath);
        if (currentFieldValue === undefined) {
          // Store as IndexedValue for consistent handling
          const indexedValue: IndexedValue = {
            _idx: defaultIndex,
            _value: fieldOptions[defaultIndex].value,
          };
          inputContext.setValue(fieldPath, indexedValue);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]); // Only re-run when value changes

  // Handle change - store IndexedValue for object selections, plain value for primitives
  const handleChange = (newValue: string) => {
    // Try InputSchemaContext first (simple value storage)
    if (inputSchemaContext) {
      if (useIndexSelection) {
        // For indexed selection, store the original value (not IndexedValue)
        const idx = parseInt(newValue, 10);
        const opt = indexedOptions[idx];
        if (opt) {
          inputSchemaContext.setValue(fieldKey, opt.originalValue);
        }
      } else {
        inputSchemaContext.setValue(fieldKey, newValue);
      }
      return;
    }

    // Fall back to InputContext (supports complex IndexedValue)
    if (inputContext) {
      if (useIndexSelection) {
        // Look up original value by index and store as IndexedValue
        const idx = parseInt(newValue, 10);
        const opt = indexedOptions[idx];
        if (opt) {
          const indexedValue: IndexedValue = { _idx: idx, _value: opt.originalValue };
          inputContext.setValue(path, indexedValue);
        }
      } else {
        inputContext.setValue(path, newValue);
      }
      return;
    }

    // Fall back to prop onChange
    propOnChange?.(newValue);
  };

  // Find label for current value
  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label ?? value;

  // Readonly mode - render as text
  if (readonly) {
    return (
      <div className={cn("text-sm", className)}>
        {label && (
          <span className="font-medium text-muted-foreground block mb-1">
            {label}
          </span>
        )}
        <div className="text-foreground">
          {displayLabel || (
            <span className="text-muted-foreground italic">Not selected</span>
          )}
        </div>
      </div>
    );
  }

  // Active mode - render select
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label className="text-sm font-medium text-foreground block">
          {label}
        </label>
      )}
      <Select
        value={value}
        onValueChange={handleChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={cn(
            "w-full",
            error && "border-destructive focus:ring-destructive"
          )}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option, index) => (
            <SelectItem key={`${option.value}-${index}`} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

// =============================================================================
// Helper
// =============================================================================

/**
 * Build options array from schema enum and enum_labels.
 */
export function buildOptionsFromSchema(
  enumValues?: string[],
  enumLabels?: Record<string, string>
): SelectOption[] {
  if (!enumValues) return [];
  return enumValues.map((value) => ({
    value,
    label: enumLabels?.[value] ?? value,
  }));
}
