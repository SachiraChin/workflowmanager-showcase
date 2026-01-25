/**
 * TextareaInputRenderer - Multi-line text input renderer.
 *
 * Behavior:
 * - readonly mode: renders value as text (like TextRenderer)
 * - active mode: renders textarea with value from InputSchemaContext
 * - calls setValue on change via InputSchemaContext
 */

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useInputSchemaOptional } from "../InputSchemaContext";

// =============================================================================
// Types
// =============================================================================

interface TextareaInputRendererProps {
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
  /** Minimum rows to display */
  minRows?: number;
  /** Direct onChange handler (used when not in InputSchemaContext) */
  onChange?: (value: string) => void;
  /** Direct disabled state (used when not in InputSchemaContext) */
  disabled?: boolean;
  /** Direct readonly state (used when not in InputSchemaContext) */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function TextareaInputRenderer({
  path,
  value: propValue,
  label,
  placeholder,
  className,
  minRows = 3,
  onChange: propOnChange,
  disabled: propDisabled,
  readonly: propReadonly,
}: TextareaInputRendererProps) {
  const inputSchemaContext = useInputSchemaOptional();

  // Get field key for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Determine value source - try InputSchemaContext first, then prop
  const rawValue = inputSchemaContext?.getValue(fieldKey) as string | undefined;
  const value = rawValue ?? propValue ?? "";

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

  // Handle change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    // Use InputSchemaContext for value storage
    if (inputSchemaContext) {
      inputSchemaContext.setValue(fieldKey, newValue);
      return;
    }
    // Fall back to prop onChange
    propOnChange?.(newValue);
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
        <div className="text-foreground whitespace-pre-wrap break-words">
          {value || <span className="text-muted-foreground italic">Empty</span>}
        </div>
      </div>
    );
  }

  // Active mode - render textarea
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label className="text-sm font-medium text-foreground block">
          {label}
        </label>
      )}
      <Textarea
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "font-mono text-sm",
          error && "border-destructive focus-visible:ring-destructive"
        )}
        style={{ minHeight: `${minRows * 1.5}rem` }}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
