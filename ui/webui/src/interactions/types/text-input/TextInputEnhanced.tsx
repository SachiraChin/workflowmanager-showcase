/**
 * TextInputEnhanced - Text input component using InteractionContext.
 *
 * Features:
 * - Character count display
 * - Clear button
 * - Multiline support
 *
 * Registers itself with InteractionContext via updateProvider().
 * Title, prompt, and submit button are handled by InteractionHost.
 */

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/core/utils";
import { useInteraction } from "@/state/interaction-context";

export function TextInputEnhanced() {
  const { request, disabled, updateProvider, mode } = useInteraction();

  // Readonly if in readonly mode OR if this is a pause interaction (preview only)
  const isPause = request.context?.pause === true;
  const isReadonly = mode.type === "readonly" || isPause;
  // In readonly mode, show the response value; otherwise use local state
  const readonlyValue = mode.type === "readonly" ? String(mode.response.value ?? "") : "";

  // Local state - initialize with default value if provided (only used in active mode)
  const [value, setValue] = useState(request.default_value || "");
  const [isDirty, setIsDirty] = useState(false);

  // Effective value for display
  // For history readonly: show response value; for pause/active: show local value
  const displayValue = mode.type === "readonly" ? readonlyValue : value;

  // Keep ref in sync for getResponse closure
  const valueRef = useRef(value);
  valueRef.current = value;

  // Derived values
  const allowEmpty = request.allow_empty ?? false;
  const isValid = isReadonly || allowEmpty || value.trim().length > 0;
  const charCount = displayValue.length;
  const hasContent = charCount > 0;

  // Register provider with InteractionHost
  useEffect(() => {
    updateProvider({
      getResponse: () => ({
        value: valueRef.current,
      }),
      getState: () => ({
        isValid,
        selectedCount: 0,
        selectedGroupIds: [],
      }),
    });
  }, [isValid, updateProvider]);

  const handleChange = (newValue: string) => {
    setValue(newValue);
    setIsDirty(true);
  };

  const handleClear = () => {
    setValue("");
    setIsDirty(true);
  };

  return (
    <div className={cn(
      "flex flex-col",
      request.multiline ? "h-full" : "space-y-2"
    )}>
      <div className={cn(
        "relative",
        request.multiline && "flex-1 min-h-0 flex flex-col"
      )}>
        {request.multiline ? (
          <Textarea
            id="text-input-enhanced"
            value={displayValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={isReadonly ? undefined : request.placeholder || "Enter text..."}
            disabled={disabled}
            readOnly={isReadonly}
            className={cn(
              "flex-1 min-h-0 resize-none pr-10",
              !isValid && isDirty && "border-destructive",
              isReadonly && "bg-muted/50 cursor-text select-text"
            )}
          />
        ) : (
          <Input
            id="text-input-enhanced"
            type="text"
            value={displayValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={isReadonly ? undefined : request.placeholder || "Enter text..."}
            disabled={disabled}
            readOnly={isReadonly}
            className={cn(
              "pr-10",
              !isValid && isDirty && "border-destructive",
              isReadonly && "bg-muted/50 cursor-text select-text"
            )}
          />
        )}

        {hasContent && !disabled && !isReadonly && (
          <button
            type="button"
            onClick={handleClear}
            className={cn(
              "absolute right-2 text-muted-foreground hover:text-foreground",
              request.multiline ? "top-2" : "top-1/2 -translate-y-1/2"
            )}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Status row - hidden in readonly mode */}
      {!isReadonly && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            {!isValid && isDirty && (
              <span className="text-destructive">Input is required</span>
            )}
          </div>
          <span>{charCount} characters</span>
        </div>
      )}
    </div>
  );
}
