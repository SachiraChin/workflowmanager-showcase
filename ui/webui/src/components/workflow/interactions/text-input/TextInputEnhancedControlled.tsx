/**
 * Controlled enhanced text input variant.
 * Features character count, clear button, and better styling.
 */

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ControlledTextInputProps } from "../types";
import { validateTextInputState } from "@/lib/interaction-state";

export function TextInputEnhancedControlled({
  request,
  state,
  onStateChange,
  disabled,
  showSubmitButton = true,
  onSubmit,
}: ControlledTextInputProps) {
  const allowEmpty = request.allow_empty ?? false;
  const validatedState = validateTextInputState(state, allowEmpty);
  const charCount = state.value.length;
  const hasContent = charCount > 0;

  const handleChange = (value: string) => {
    onStateChange({
      ...state,
      value,
      isDirty: true,
      isValid: allowEmpty || value.trim().length > 0,
    });
  };

  const handleClear = () => {
    onStateChange({
      ...state,
      value: "",
      isDirty: true,
      isValid: allowEmpty,
    });
  };

  const handleUseDefault = () => {
    if (request.default_value) {
      onStateChange({
        ...state,
        value: request.default_value,
        isDirty: true,
        isValid: true,
      });
    }
  };

  return (
    <div className="space-y-4">
      {request.title && (
        <h3 className="text-lg font-semibold">{request.title}</h3>
      )}

      <div className="space-y-2">
        <div className="relative">
          {request.multiline ? (
            <Textarea
              id="text-input-enhanced"
              value={state.value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={request.placeholder || "Enter text..."}
              disabled={disabled}
              rows={5}
              className={cn(
                "resize-y min-h-[120px] pr-10",
                !validatedState.isValid && state.isDirty && "border-destructive"
              )}
            />
          ) : (
            <Input
              id="text-input-enhanced"
              type="text"
              value={state.value}
              onChange={(e) => handleChange(e.target.value)}
              placeholder={request.placeholder || "Enter text..."}
              disabled={disabled}
              className={cn(
                "pr-10",
                !validatedState.isValid && state.isDirty && "border-destructive"
              )}
            />
          )}

          {hasContent && !disabled && (
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

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {!validatedState.isValid && state.isDirty && (
              <span className="text-destructive">Input is required</span>
            )}
            {request.default_value && !hasContent && (
              <button
                type="button"
                onClick={handleUseDefault}
                className="text-primary hover:underline"
                disabled={disabled}
              >
                Use default: "{request.default_value}"
              </button>
            )}
          </div>
          <span>{charCount} characters</span>
        </div>
      </div>

      {showSubmitButton && onSubmit && (
        <div className="flex justify-end">
          <Button
            onClick={onSubmit}
            disabled={disabled || !validatedState.isValid}
          >
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}
