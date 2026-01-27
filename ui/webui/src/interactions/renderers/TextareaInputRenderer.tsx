/**
 * TextareaInputRenderer - Multi-line text input renderer.
 *
 * Behavior:
 * - readonly mode: renders value as text (like TextRenderer)
 * - active mode: renders textarea with value from InputSchemaContext
 * - calls setValue on change via InputSchemaContext
 */

import { useEffect } from "react";
import { cn } from "@/core/utils";
import { Textarea } from "@/components/ui/textarea";
import { useInputSchemaOptional } from "../schema/input/InputSchemaContext";

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
  /** Direct onChange handler (used when not in InputSchemaContext or standalone mode) */
  onChange?: (value: string) => void;
  /** Direct disabled state (used when not in InputSchemaContext) */
  disabled?: boolean;
  /** Direct readonly state (used when not in InputSchemaContext) */
  readonly?: boolean;
  /** Standalone mode - use props instead of context even if context exists */
  standalone?: boolean;
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
  standalone = false,
}: TextareaInputRendererProps) {
  const inputSchemaContext = useInputSchemaOptional();

  // In standalone mode, don't use context
  const useContext = !standalone && inputSchemaContext;

  // Get field key for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Determine value source - try InputSchemaContext first (unless standalone), then prop
  const rawValue = useContext ? (inputSchemaContext?.getValue(fieldKey) as string | undefined) : undefined;
  const value = rawValue ?? propValue ?? "";

  // Initialize context with prop value on mount (if context value is undefined)
  useEffect(() => {
    if (useContext && inputSchemaContext?.getValue(fieldKey) === undefined && propValue !== undefined) {
      inputSchemaContext?.setValue(fieldKey, propValue);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine state from InputSchemaContext, fall back to props
  const disabled = (useContext ? inputSchemaContext?.disabled : undefined) ?? propDisabled ?? false;
  const readonly = (useContext ? inputSchemaContext?.readonly : undefined) ?? propReadonly ?? false;
  const error = useContext ? inputSchemaContext?.errors[fieldKey] : undefined;

  // Handle change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    // Use InputSchemaContext for value storage (unless standalone)
    if (useContext) {
      inputSchemaContext?.setValue(fieldKey, newValue);
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
