/**
 * TextareaInputRenderer - Multi-line text input renderer.
 *
 * Behavior:
 * - readonly mode: renders value as text (like TextRenderer)
 * - active mode: renders textarea with value from InputContext
 * - calls setValue on change via InputContext
 */

import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useInputOptional } from "../InputContext";

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

  // Determine value source
  // Use context value if set, otherwise fall back to prop value (initial/default)
  const contextValue = inputContext?.getValue(path) as string | undefined;
  const value = contextValue !== undefined ? contextValue : (propValue ?? "");

  // Determine state
  const disabled = inputContext?.disabled ?? propDisabled ?? false;
  const readonly = inputContext?.readonly ?? propReadonly ?? false;
  const error = inputContext?.getError(path);

  // Handle change
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    if (inputContext) {
      inputContext.setValue(path, newValue);
    } else {
      propOnChange?.(newValue);
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
