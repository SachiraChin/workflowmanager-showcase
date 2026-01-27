/**
 * NumberInputRenderer - Numeric input field renderer.
 *
 * Supports:
 * - Integer and decimal numbers
 * - Min/max constraints
 * - Step increments
 * - Integration with InputSchemaContext for value management
 *
 * Behavior:
 * - readonly mode: renders value as text
 * - active mode: renders number input with validation
 */

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { useInputSchemaOptional } from "../InputSchemaContext";

// =============================================================================
// Types
// =============================================================================

interface NumberInputRendererProps {
  /** Path to this value in the input context */
  path: string[];
  /** Current value (for uncontrolled/display mode) */
  value?: number | string;
  /** Field label */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Additional CSS classes */
  className?: string;
  /** Direct onChange handler (used when not in InputSchemaContext or standalone mode) */
  onChange?: (value: number | undefined) => void;
  /** Direct disabled state */
  disabled?: boolean;
  /** Direct readonly state */
  readonly?: boolean;
  /** Standalone mode - use props instead of context even if context exists */
  standalone?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function NumberInputRenderer({
  path,
  value: propValue,
  label,
  placeholder,
  min,
  max,
  step,
  className,
  onChange: propOnChange,
  disabled: propDisabled,
  readonly: propReadonly,
  standalone = false,
}: NumberInputRendererProps) {
  const inputSchemaContext = useInputSchemaOptional();

  // In standalone mode, don't use context
  const useContext = !standalone && inputSchemaContext;

  // Get the field key (last element of path) for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Get stored value from context or use prop
  const storedValue = useContext ? inputSchemaContext?.getValue(fieldKey) : undefined;
  const value = storedValue !== undefined ? storedValue : propValue;

  // Initialize context with prop value on mount
  useEffect(() => {
    if (useContext && storedValue === undefined && propValue !== undefined) {
      const numValue = typeof propValue === "string" ? parseFloat(propValue) : propValue;
      if (!isNaN(numValue)) {
        inputSchemaContext?.setValue(fieldKey, numValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine state from context or props
  const disabled = (useContext ? inputSchemaContext?.disabled : undefined) ?? propDisabled ?? false;
  const readonly = (useContext ? inputSchemaContext?.readonly : undefined) ?? propReadonly ?? false;
  const error = useContext ? inputSchemaContext?.errors[fieldKey] : undefined;

  // Handle change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;

    // Allow empty input
    if (rawValue === "") {
      if (useContext) {
        inputSchemaContext?.setValue(fieldKey, undefined);
      } else {
        propOnChange?.(undefined);
      }
      return;
    }

    const numValue = parseFloat(rawValue);
    if (isNaN(numValue)) return;

    // Apply min/max constraints
    let constrainedValue = numValue;
    if (min !== undefined && constrainedValue < min) constrainedValue = min;
    if (max !== undefined && constrainedValue > max) constrainedValue = max;

    if (useContext) {
      inputSchemaContext?.setValue(fieldKey, constrainedValue);
    } else {
      propOnChange?.(constrainedValue);
    }
  };

  // Display value
  const displayValue = value !== undefined && value !== null ? String(value) : "";

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
          {displayValue || (
            <span className="text-muted-foreground italic">-</span>
          )}
        </div>
      </div>
    );
  }

  // Active mode - render input
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label className="text-sm font-medium text-foreground block">
          {label}
        </label>
      )}
      <Input
        type="number"
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={cn(
          "w-full",
          error && "border-destructive focus:ring-destructive"
        )}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
