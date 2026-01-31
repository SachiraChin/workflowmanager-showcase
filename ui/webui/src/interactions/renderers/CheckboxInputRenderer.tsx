/**
 * CheckboxInputRenderer - Boolean checkbox input field renderer.
 *
 * Supports:
 * - Boolean values (true/false)
 * - Default value
 * - Integration with InputSchemaContext for value management
 *
 * Behavior:
 * - readonly mode: renders value as text (Yes/No)
 * - active mode: renders checkbox with label
 */

import { useEffect } from "react";
import { cn } from "@/core/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { useInputSchemaOptional } from "../schema/input/InputSchemaContext";

// =============================================================================
// Types
// =============================================================================

interface CheckboxInputRendererProps {
  /** Path to this value in the input context */
  path: string[];
  /** Current value (for uncontrolled/display mode) */
  value?: boolean;
  /** Field label */
  label?: string;
  /** Default value */
  defaultValue?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Direct onChange handler */
  onChange?: (value: boolean) => void;
  /** Direct disabled state */
  disabled?: boolean;
  /** Direct readonly state */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function CheckboxInputRenderer({
  path,
  value: propValue,
  label,
  defaultValue = false,
  className,
  onChange: propOnChange,
  disabled: propDisabled,
  readonly: propReadonly,
}: CheckboxInputRendererProps) {
  const inputSchemaContext = useInputSchemaOptional();
  const useContext = !!inputSchemaContext;

  // Get the field key (last element of path) for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Get stored value from context or use prop
  const storedValue = useContext ? inputSchemaContext?.getValue(fieldKey) : undefined;
  const value = storedValue !== undefined ? storedValue as boolean : (propValue ?? defaultValue);

  // Initialize context with default value on mount
  useEffect(() => {
    if (useContext && storedValue === undefined) {
      inputSchemaContext?.setValue(fieldKey, propValue ?? defaultValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine state from context or props
  const disabled = (useContext ? inputSchemaContext?.disabled : undefined) ?? propDisabled ?? false;
  const readonly = (useContext ? inputSchemaContext?.readonly : undefined) ?? propReadonly ?? false;

  // Handle change
  const handleChange = (checked: boolean) => {
    if (useContext) {
      inputSchemaContext?.setValue(fieldKey, checked);
    } else {
      propOnChange?.(checked);
    }
  };

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
          {value ? "Yes" : "No"}
        </div>
      </div>
    );
  }

  // Active mode - render checkbox
  return (
    <div className={cn("flex items-center space-x-2 py-2", className)}>
      <Checkbox
        id={fieldKey}
        checked={value}
        onCheckedChange={handleChange}
        disabled={disabled}
      />
      {label && (
        <label
          htmlFor={fieldKey}
          className="text-sm font-medium leading-none cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          {label}
        </label>
      )}
    </div>
  );
}
