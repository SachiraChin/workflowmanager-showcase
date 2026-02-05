/**
 * AlternativeInputWrapper - Provides toggle between primary and alternative input modes.
 *
 * This component wraps a primary input (e.g., select dropdown) and provides
 * an alternative input mode (e.g., separate width/height number inputs).
 *
 * Features:
 * - Toggle button to switch between primary and alternative modes
 * - Renders alternative fields in inline or stack layout
 * - Runs compose template to update primary value when alternative fields change
 * - Supports static text elements between input fields
 */

import { useCallback, useEffect, useRef } from "react";
import { ArrowLeftRight } from "lucide-react";
import { cn } from "../utils/cn";
import { Button } from "../components/ui/button";
import { useInputSchemaOptional } from "../schema/input/InputSchemaContext";
import type { AlternativeConfig, AlternativeField } from "../types/schema";
import { NumberInputRenderer } from "./NumberInputRenderer";
import { TextareaInputRenderer } from "./TextareaInputRenderer";

// =============================================================================
// Types
// =============================================================================

interface AlternativeInputWrapperProps {
  /** Field key in the context */
  fieldKey: string;
  /** Path for the field */
  path: string[];
  /** Alternative configuration from schema */
  alternative: AlternativeConfig;
  /** The primary input component to render in primary mode */
  primaryInput: React.ReactNode;
  /** Field label */
  label?: string;
  /** Additional CSS classes */
  className?: string;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Run compose template to build value from alternative field values.
 * Template format: "{fieldKey}" references alternative field values.
 */
function runCompose(
  compose: Record<string, string>,
  altValues: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [targetKey, template] of Object.entries(compose)) {
    result[targetKey] = template.replace(/\{(\w+)\}/g, (_, key) => {
      const value = altValues[key];
      return value !== undefined ? String(value) : "";
    });
  }

  return result;
}

/**
 * Extract alternative field values from the stored value object.
 */
function extractAltValues(
  storedValue: unknown,
  fields: AlternativeField[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (!storedValue || typeof storedValue !== "object") {
    // Use defaults from field definitions
    for (const field of fields) {
      if (field.key) {
        result[field.key] = field.default;
      }
    }
    return result;
  }

  const valueRecord = storedValue as Record<string, unknown>;
  for (const field of fields) {
    if (field.key) {
      result[field.key] = valueRecord[field.key] ?? field.default;
    }
  }

  return result;
}

// =============================================================================
// Component
// =============================================================================

export function AlternativeInputWrapper({
  fieldKey,
  path,
  alternative,
  primaryInput,
  label,
  className,
  disabled = false,
  readonly = false,
}: AlternativeInputWrapperProps) {
  const ctx = useInputSchemaOptional();

  // Get mode from context
  const isAltMode = ctx?.isAlternativeMode(fieldKey) ?? false;

  // Get current stored value
  const storedValue = ctx?.getValue(fieldKey);

  // Track if we've initialized alternative values
  const initializedRef = useRef(false);

  // Extract alternative field values from stored value
  const altValues = extractAltValues(storedValue, alternative.fields);

  // Initialize alternative values when switching to alt mode
  useEffect(() => {
    if (isAltMode && !initializedRef.current && ctx) {
      initializedRef.current = true;
      // Values are already part of the stored object, no separate initialization needed
    }
    if (!isAltMode) {
      initializedRef.current = false;
    }
  }, [isAltMode, ctx]);

  // Handle toggle
  const handleToggle = useCallback(() => {
    if (!ctx) return;
    ctx.setAlternativeMode(fieldKey, !isAltMode);
  }, [ctx, fieldKey, isAltMode]);

  // Handle alternative field change
  const handleAltFieldChange = useCallback(
    (altFieldKey: string, newValue: unknown) => {
      if (!ctx) return;

      // Build updated alternative values
      const updatedAltValues = { ...altValues, [altFieldKey]: newValue };

      // Run compose to get updated composed fields
      const composedFields = runCompose(alternative.compose, updatedAltValues);

      // Merge into stored value
      const currentValue = (storedValue || {}) as Record<string, unknown>;
      const updatedValue = {
        ...currentValue,
        ...updatedAltValues,
        ...composedFields,
      };

      ctx.setValue(fieldKey, updatedValue);
    },
    [ctx, fieldKey, storedValue, altValues, alternative.compose]
  );

  // Render alternative field
  const renderAltField = (field: AlternativeField, index: number) => {
    // Static text element
    if (!field.key && field.content) {
      return (
        <span
          key={`static-${index}`}
          className="text-sm text-muted-foreground flex items-center px-1"
        >
          {field.content}
        </span>
      );
    }

    // Input field
    if (!field.key) return null;

    const fieldValue = altValues[field.key];
    const inputType = field._ux?.input_type || "number";

    // Create a pseudo-path for the alternative field
    const altPath = [...path, `_alt_${field.key}`];

    switch (inputType) {
      case "number":
        return (
          <div key={field.key} className="flex-1 min-w-[60px]">
            <NumberInputRenderer
              path={altPath}
              value={fieldValue as number | undefined}
              label={field.title}
              min={field.minimum}
              max={field.maximum}
              step={field.step}
              onChange={(value) => handleAltFieldChange(field.key!, value)}
              standalone
            />
          </div>
        );

      case "text":
      case "textarea":
        return (
          <div key={field.key} className="flex-1">
            <TextareaInputRenderer
              path={altPath}
              value={fieldValue as string | undefined}
              label={field.title}
              minRows={1}
              onChange={(value) => handleAltFieldChange(field.key!, value)}
              standalone
            />
          </div>
        );

      default:
        return null;
    }
  };

  // Layout classes
  const layoutClasses =
    alternative.layout === "stack"
      ? "flex flex-col gap-2"
      : "flex items-end gap-2";

  // Get display value for readonly mode
  const getReadonlyDisplayValue = (): string => {
    if (!storedValue || typeof storedValue !== "object") {
      return "";
    }
    const valueRecord = storedValue as Record<string, unknown>;

    // If alternative mode was used, show the composed value
    // Check if 'text' key exists (from compose template)
    if (valueRecord.text !== undefined) {
      return String(valueRecord.text);
    }

    // Otherwise, try to compose from field values
    if (alternative.compose) {
      const composed = runCompose(alternative.compose, altValues);
      if (composed.text) {
        return String(composed.text);
      }
    }

    // Fallback: stringify the value
    return JSON.stringify(storedValue);
  };

  // Readonly mode: show simple text display
  if (readonly) {
    return (
      <div className={cn("space-y-1", className)}>
        {label && (
          <label className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <div className="text-sm text-muted-foreground py-1.5">
          {getReadonlyDisplayValue()}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {/* Label row with toggle */}
      <div className="flex items-center justify-between">
        {label && (
          <label className="text-sm font-medium text-foreground">
            {label}
          </label>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={handleToggle}
          disabled={disabled}
          title={isAltMode ? "Switch to preset" : "Switch to custom"}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Primary or Alternative input */}
      {isAltMode ? (
        <div className={layoutClasses}>
          {alternative.fields.map((field, index) => renderAltField(field, index))}
        </div>
      ) : (
        primaryInput
      )}
    </div>
  );
}
