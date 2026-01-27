/**
 * CardLayout - Renders children as a styled card with slot-based placement.
 *
 * Queries children by data-* attributes:
 * - data-render-as="card-title": Header title area
 * - data-render-as="card-subtitle": Below title, muted text
 * - Others: Body content area
 *
 * Any child can have data-highlight="true" for highlight styling.
 *
 * Selection:
 * - Uses useSelectable hook for selection state
 * - Renders selection indicator and applies selection styling
 */

import React, { type ReactElement } from "react";
import { Check } from "lucide-react";
import { cn } from "@/core/utils";
import { registerLayout } from "./registry";
import type { LayoutProps } from "./types";
import {
  filterByAttr,
  filterExcludingRenderAs,
  getAttr,
  getIndexFromPath,
} from "./utils";
import { useSelectable } from "../schema/selection/useSelectable";

/**
 * Wrap a child with highlight styling if it has data-highlight="true".
 * Otherwise return the child as-is.
 */
function maybeWrapHighlight(child: ReactElement, key: number): React.ReactNode {
  const isHighlighted = getAttr(child, "data-highlight") === "true";

  if (!isHighlighted) {
    return <div key={key}>{child}</div>;
  }

  const color = getAttr(child, "data-highlight-color");

  return (
    <span
      key={key}
      className={cn(
        "inline-block text-sm font-medium px-2 py-0.5 rounded-md border-l-2",
        !color && "bg-teal-600/10 text-teal-600 border-l-teal-600"
      )}
      style={
        color
          ? { backgroundColor: `${color}20`, color, borderLeftColor: color }
          : undefined
      }
    >
      {child}
    </span>
  );
}

export const CardLayout: React.FC<LayoutProps> = ({ schema: _schema, path, data, ux, children }) => {
  // Query children by attributes
  const titles = filterByAttr(children, "data-render-as", "card-title");
  const subtitles = filterByAttr(children, "data-render-as", "card-subtitle");
  const body = filterExcludingRenderAs(children, ["card-title", "card-subtitle"]);

  // Selection state
  const selectable = useSelectable(path, data, ux);
  const isSelectable = selectable !== null;
  const selected = selectable?.selected ?? false;
  const disabled = selectable?.disabled ?? false;
  const isReadonly = selectable?.isReadonly ?? false;
  const mode = selectable?.mode ?? "select";
  const handleClick = selectable?.handleClick;
  const borderColor = selectable?.decorators.borderColor;

  // Index from path (for numbered cards in array)
  const index = getIndexFromPath(path);
  const showIndexBadge = ux.nudges?.includes("index-badge");

  const hasTitle = titles.length > 0;

  return (
    <div
      className={cn(
        "relative rounded-lg border-2 bg-card/80 transition-all",
        // Non-selectable: default border
        !isSelectable && "border-border",
        // Selectable without decorator border
        isSelectable && !borderColor && (selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-muted-foreground/50 hover:bg-muted/30"),
        // Selectable with decorator border
        isSelectable && borderColor && (selected
          ? "bg-primary/5"
          : "hover:bg-muted/30"),
        // Interactive states
        isSelectable && "cursor-pointer",
        isSelectable && disabled && !isReadonly && "opacity-50 cursor-not-allowed",
        isSelectable && (mode === "review" || isReadonly) && "cursor-default",
        isSelectable && isReadonly && !selected && "opacity-60"
      )}
      onClick={handleClick}
      style={
        isSelectable && borderColor
          ? {
            border: `${selected ? "2px" : "1px"} solid ${selected ? borderColor : `${borderColor}40`}`,
            borderLeft: `${selected ? "5px" : "3px"} solid ${borderColor}`,
          }
          : undefined
      }
    >
      <div className="p-5">
        {/* Index badge */}
        {showIndexBadge && index !== undefined && (
          <div className="absolute -left-3 -top-3 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold shadow-sm z-10">
            {index + 1}
          </div>
        )}

        {/* Selection indicator (top-right) */}
        {isSelectable && mode === "select" && selected && (
          <div className="absolute top-2 right-2">
            <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
              <Check className="h-3 w-3 text-primary-foreground" />
            </div>
          </div>
        )}

        {/* Content with padding for selection indicator */}
        <div className={cn(isSelectable && mode === "select" && selected && "pr-8")}>
          {/* Fallback title from ux.display_label only if no title slot */}
          {!hasTitle && ux.display_label && (
            <div className="text-base font-semibold leading-snug mb-2">
              {ux.display_label}
            </div>
          )}

          {/* Titles - wrap EACH, apply highlight if present */}
          {titles.map((child, i) => {
            const isHighlighted = getAttr(child, "data-highlight") === "true";
            const color = getAttr(child, "data-highlight-color");

            return (
              <div
                key={i}
                className={cn(
                  "text-base font-semibold leading-snug",
                  isHighlighted && !color && "text-teal-600",
                  isHighlighted && color && undefined
                )}
                style={isHighlighted && color ? { color } : undefined}
              >
                {child}
              </div>
            );
          })}

          {/* Subtitles - wrap EACH, apply highlight if present */}
          {subtitles.map((child, i) => {
            const isHighlighted = getAttr(child, "data-highlight") === "true";
            const color = getAttr(child, "data-highlight-color");

            return (
              <div
                key={i}
                className={cn(
                  "mt-1 text-sm leading-relaxed",
                  !isHighlighted && "text-muted-foreground",
                  isHighlighted && !color && "text-teal-600 font-medium",
                  isHighlighted && color && "font-medium"
                )}
                style={isHighlighted && color ? { color } : undefined}
              >
                {child}
              </div>
            );
          })}

          {/* Body - wrap EACH, apply highlight wrapper if present */}
          {body.length > 0 && (
            <div className="border-t border-border mt-4 pt-4 space-y-3">
              {body.map((child, i) => maybeWrapHighlight(child, i))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

registerLayout("card", CardLayout);
