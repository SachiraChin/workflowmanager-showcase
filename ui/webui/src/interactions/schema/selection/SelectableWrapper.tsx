/**
 * SelectableWrapper - Shared selection UI wrapper for renderers.
 *
 * Renders a selectable container with:
 * - Border styling (selected/hover states)
 * - Selection indicator (checkbox/radio)
 * - Decorator support (border color, swatch, badges)
 *
 * Used by TerminalRenderer, DefaultObjectRenderer, and other renderers
 * that need selection support.
 */

import { Check } from "lucide-react";
import { cn } from "@/core/utils";
import type { SelectableState } from "./useSelectable";
import { ColorSwatch, DecoratorBadges } from "../../renderers";

interface SelectableWrapperProps {
  /** Selection state from useSelectable hook */
  selectable: SelectableState;
  /** Content to render inside the selectable container */
  children: React.ReactNode;
  /** Additional CSS classes for the container */
  className?: string;
}

export function SelectableWrapper({ selectable, children, className }: SelectableWrapperProps) {
  const { selected, disabled, isReadonly, mode, handleClick, decorators } = selectable;
  const { borderColor, swatchColor, badges } = decorators;

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 p-3 rounded-lg transition-all",
        // Border and background
        !borderColor && "border",
        !borderColor && (selected
          ? "border-primary bg-primary/5"
          : "hover:border-muted-foreground/50 hover:bg-muted/30"),
        borderColor && (selected
          ? "bg-primary/5"
          : "hover:bg-muted/30"),
        // Interactive states
        "cursor-pointer",
        disabled && !isReadonly && "opacity-50 cursor-not-allowed",
        (mode === "review" || isReadonly) && "cursor-default",
        isReadonly && !selected && "opacity-60",
        className
      )}
      onClick={handleClick}
      style={
        borderColor
          ? {
              border: `${selected ? "2px" : "1px"} solid ${selected ? borderColor : `${borderColor}40`}`,
              borderLeft: `${selected ? "5px" : "3px"} solid ${borderColor}`,
            }
          : undefined
      }
    >
      {/* Selection indicator (left side) */}
      {mode === "select" && (
        <div
          className={cn(
            "flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5",
            selected ? "border-primary bg-primary" : "border-muted-foreground/30"
          )}
          style={swatchColor && !selected ? { borderColor: swatchColor } : undefined}
        >
          {selected && <Check className="h-3 w-3 text-primary-foreground" />}
        </div>
      )}

      {/* Content row: swatch, content, badges */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {swatchColor && <ColorSwatch color={swatchColor} size="sm" />}
        <div className="flex-1 min-w-0">{children}</div>
        {badges.length > 0 && (
          <DecoratorBadges badges={badges} className="flex gap-1 shrink-0" />
        )}
      </div>
    </div>
  );
}
