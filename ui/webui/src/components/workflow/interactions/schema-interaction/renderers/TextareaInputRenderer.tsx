/**
 * TextareaInputRenderer - Multi-line text input renderer.
 *
 * Behavior:
 * - readonly mode: renders value as text (like TextRenderer)
 * - active mode: renders textarea with value from InputContext
 * - calls setValue on change via InputContext
 */

import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useInputOptional } from "../InputContext";
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
  /** Direct onChange handler (used when not in InputContext) */
  onChange?: (value: string) => void;
  /** Direct disabled state (used when not in InputContext) */
  disabled?: boolean;
  /** Direct readonly state (used when not in InputContext) */
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
  const inputContext = useInputOptional();
  const inputSchemaContext = useInputSchemaOptional();

  // Get field key for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Determine value source
  // Try InputSchemaContext first, fall back to InputContext, then prop
  const schemaContextValue = inputSchemaContext?.getValue(fieldKey) as string | undefined;
  const inputContextValue = inputContext?.getValue(path) as string | undefined;
  const value = schemaContextValue ?? inputContextValue ?? propValue ?? "";

  // Initialize context with prop value on mount (if context value is undefined)
  useEffect(() => {
    if (inputSchemaContext && schemaContextValue === undefined && propValue !== undefined) {
      inputSchemaContext.setValue(fieldKey, propValue);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine state
  const disabled = inputContext?.disabled ?? propDisabled ?? false;
  const readonly = inputContext?.readonly ?? propReadonly ?? false;
  // Try InputSchemaContext first for error
  const error = inputSchemaContext?.errors[fieldKey] ?? inputContext?.getError(path);

  // Handle change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    // Try InputSchemaContext first
    if (inputSchemaContext) {
      inputSchemaContext.setValue(fieldKey, newValue);
      return;
    }
    // Fall back to InputContext
    if (inputContext) {
      inputContext.setValue(path, newValue);
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
