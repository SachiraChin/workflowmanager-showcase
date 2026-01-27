/**
 * SliderInputRenderer - Numeric slider input renderer.
 *
 * Behavior:
 * - readonly mode: renders value as number
 * - active mode: renders slider with current value display
 * - supports minimum/maximum from schema
 * - value display is clickable to enter value manually
 */

import { useState, useRef, useEffect } from "react";
import { cn } from "@/core/utils";
import { Slider } from "@/components/ui/slider";
import { useInputSchemaOptional } from "../schema/input/InputSchemaContext";

// =============================================================================
// Types
// =============================================================================

interface SliderInputRendererProps {
  /** Path to this value in the input context */
  path: string[];
  /** Current value (for uncontrolled/display mode) */
  value?: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Step increment */
  step?: number;
  /** Field label */
  label?: string;
  /** Additional CSS classes */
  className?: string;
  /** Show value display */
  showValue?: boolean;
  /** Direct onChange handler (used when not in InputSchemaContext) */
  onChange?: (value: number) => void;
  /** Direct disabled state (used when not in InputSchemaContext) */
  disabled?: boolean;
  /** Direct readonly state (used when not in InputSchemaContext) */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function SliderInputRenderer({
  path,
  value: propValue,
  min,
  max,
  step = 1,
  label,
  className,
  showValue = true,
  onChange: propOnChange,
  disabled: propDisabled,
  readonly: propReadonly,
}: SliderInputRendererProps) {
  const inputSchemaContext = useInputSchemaOptional();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Get field key for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Determine value source - try InputSchemaContext first, then prop
  const rawValue = inputSchemaContext?.getValue(fieldKey) ?? propValue;
  const value = typeof rawValue === "number" ? rawValue : min;

  // Initialize context with prop value on mount (if context value is undefined)
  useEffect(() => {
    if (inputSchemaContext && inputSchemaContext.getValue(fieldKey) === undefined && propValue !== undefined) {
      inputSchemaContext.setValue(fieldKey, propValue);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine state from InputSchemaContext, fall back to props
  const disabled = inputSchemaContext?.disabled ?? propDisabled ?? false;
  const readonly = inputSchemaContext?.readonly ?? propReadonly ?? false;
  const error = inputSchemaContext?.errors[fieldKey];

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  // Handle slider change
  const handleChange = (values: number[]) => {
    const newValue = values[0];
    // Use InputSchemaContext for value storage
    if (inputSchemaContext) {
      inputSchemaContext.setValue(fieldKey, newValue);
      return;
    }
    // Fall back to prop onChange
    propOnChange?.(newValue);
  };

  // Handle clicking on value to edit
  const handleValueClick = () => {
    if (disabled) return;
    setEditValue(String(value));
    setIsEditing(true);
  };

  // Handle submitting the edited value
  const handleSubmit = () => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      // Clamp to min/max and round to step
      const clamped = Math.min(max, Math.max(min, parsed));
      const stepped = Math.round(clamped / step) * step;
      handleChange([stepped]);
    }
    setIsEditing(false);
  };

  // Handle key press in edit input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  // Readonly mode - render as number
  if (readonly) {
    return (
      <div className={cn("text-sm", className)}>
        {label && (
          <span className="font-medium text-muted-foreground block mb-1">
            {label}
          </span>
        )}
        <div className="text-foreground">{value}</div>
      </div>
    );
  }

  // Active mode - render slider
  return (
    <div className={cn("space-y-2", className)}>
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <label className="text-sm font-medium text-foreground">
              {label}
            </label>
          )}
          {showValue && (
            isEditing ? (
              <input
                ref={inputRef}
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSubmit}
                onKeyDown={handleKeyDown}
                min={min}
                max={max}
                step={step}
                className="w-16 px-1 py-0.5 text-sm text-right tabular-nums bg-background border border-input rounded focus:outline-none focus:ring-1 focus:ring-ring"
              />
            ) : (
              <button
                type="button"
                onClick={handleValueClick}
                disabled={disabled}
                className={cn(
                  "text-sm tabular-nums px-1 py-0.5 rounded hover:bg-muted transition-colors",
                  disabled ? "text-muted-foreground cursor-not-allowed" : "text-foreground cursor-text"
                )}
                title="Click to edit value"
              >
                {value}
              </button>
            )
          )}
        </div>
      )}
      <Slider
        value={[value]}
        onValueChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        className={cn(
          "w-full",
          error && "[&_[role=slider]]:border-destructive"
        )}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
