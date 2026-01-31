/**
 * TagInputRenderer - Tag-based array input renderer.
 *
 * Supports:
 * - Array of strings displayed as removable tags/badges
 * - Adding new tags via text input + Enter key
 * - Removing tags via X button or Backspace when input is empty
 * - Integration with InputSchemaContext for value management
 *
 * Behavior:
 * - readonly mode: renders tags as non-removable badges
 * - active mode: renders editable tag input with add/remove
 */

import { useState, useRef, useEffect, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { cn } from "@/core/utils";
import { Badge } from "@/components/ui/badge";
import { useInputSchemaOptional } from "../schema/input/InputSchemaContext";

// =============================================================================
// Types
// =============================================================================

interface TagInputRendererProps {
  /** Path to this value in the input context */
  path: string[];
  /** Current value (array of strings) */
  value?: string[];
  /** Field label */
  label?: string;
  /** Placeholder text for input */
  placeholder?: string;
  /** Additional CSS classes */
  className?: string;
  /** Direct onChange handler */
  onChange?: (value: string[]) => void;
  /** Direct disabled state */
  disabled?: boolean;
  /** Direct readonly state */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function TagInputRenderer({
  path,
  value: propValue,
  label,
  placeholder = "Type and press Enter to add...",
  className,
  onChange: propOnChange,
  disabled: propDisabled,
  readonly: propReadonly,
}: TagInputRendererProps) {
  const inputSchemaContext = useInputSchemaOptional();
  const useContext = !!inputSchemaContext;
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState("");

  // Get the field key (last element of path) for InputSchemaContext
  const fieldKey = path[path.length - 1];

  // Get stored value from context or use prop
  const storedValue = useContext ? inputSchemaContext?.getValue(fieldKey) : undefined;

  // Normalize value: handle both arrays and comma-separated strings
  const normalizeValue = (val: unknown): string[] => {
    if (Array.isArray(val)) {
      return val.filter((v): v is string => typeof v === "string" && v.trim() !== "");
    }
    if (typeof val === "string" && val.trim()) {
      // Handle comma-separated string
      return val.split(",").map(s => s.trim()).filter(s => s !== "");
    }
    return [];
  };

  const tags = normalizeValue(storedValue !== undefined ? storedValue : propValue);

  // Initialize context with prop value on mount
  useEffect(() => {
    if (useContext && storedValue === undefined && propValue !== undefined) {
      inputSchemaContext?.setValue(fieldKey, normalizeValue(propValue));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine state from context or props
  const disabled = (useContext ? inputSchemaContext?.disabled : undefined) ?? propDisabled ?? false;
  const readonly = (useContext ? inputSchemaContext?.readonly : undefined) ?? propReadonly ?? false;

  // Update tags
  const updateTags = (newTags: string[]) => {
    if (useContext) {
      inputSchemaContext?.setValue(fieldKey, newTags);
    } else {
      propOnChange?.(newTags);
    }
  };

  // Add a tag
  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      updateTags([...tags, trimmed]);
    }
    setInputValue("");
  };

  // Remove a tag
  const removeTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index);
    updateTags(newTags);
  };

  // Handle key press
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
      // Remove last tag when backspace is pressed with empty input
      removeTag(tags.length - 1);
    } else if (e.key === ",") {
      // Also add tag on comma
      e.preventDefault();
      if (inputValue.trim()) {
        addTag(inputValue);
      }
    }
  };

  // Handle blur - add tag if there's input
  const handleBlur = () => {
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  };

  // Focus input when clicking container
  const handleContainerClick = () => {
    if (!disabled && !readonly) {
      inputRef.current?.focus();
    }
  };

  // Readonly mode - render tags as non-editable badges
  if (readonly) {
    return (
      <div className={cn("text-sm", className)}>
        {label && (
          <span className="font-medium text-muted-foreground block mb-1">
            {label}
          </span>
        )}
        <div className="flex flex-wrap gap-1.5">
          {tags.length > 0 ? (
            tags.map((tag, index) => (
              <Badge key={index} variant="secondary">
                {tag}
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground italic">-</span>
          )}
        </div>
      </div>
    );
  }

  // Active mode - render editable tag input
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label className="text-sm font-medium text-foreground block">
          {label}
        </label>
      )}
      <div
        onClick={handleContainerClick}
        className={cn(
          "flex flex-wrap gap-1.5 min-h-9 w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm shadow-xs transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "cursor-text"
        )}
      >
        {tags.map((tag, index) => (
          <Badge
            key={index}
            variant="secondary"
            className="gap-1 pr-1"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(index);
                }}
                className="rounded-full hover:bg-muted-foreground/20 p-0.5 transition-colors"
                aria-label={`Remove ${tag}`}
              >
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={tags.length === 0 ? placeholder : ""}
          disabled={disabled}
          className={cn(
            "flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground",
            disabled && "cursor-not-allowed"
          )}
        />
      </div>
    </div>
  );
}
