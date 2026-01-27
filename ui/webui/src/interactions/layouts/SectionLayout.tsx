/**
 * SectionLayout - Renders children as a collapsible section.
 *
 * Queries children by data-* attributes:
 * - data-render-as="section-title": Header title
 * - data-render-as="section-badge": Badge next to title
 * - data-render-as="section-summary": Summary text below title
 * - Others: Expandable content area
 *
 * Any child can have data-highlight="true" for highlight styling.
 */

import React, { useState, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/core/utils";
import { registerLayout } from "./registry";
import type { LayoutProps } from "./types";
import {
  filterByAttr,
  filterExcludingRenderAs,
  getAttr,
} from "./utils";

/**
 * Wrap a child with highlight styling if it has data-highlight="true".
 * Used for body content.
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
        !color && "bg-amber-600/10 text-amber-600 border-l-amber-600"
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

export const SectionLayout: React.FC<LayoutProps> = ({ schema: _schema, ux, children }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Query children by attributes
  const titles = filterByAttr(children, "data-render-as", "section-title");
  const badges = filterByAttr(children, "data-render-as", "section-badge");
  const summaries = filterByAttr(children, "data-render-as", "section-summary");
  const body = filterExcludingRenderAs(children, [
    "section-title",
    "section-badge",
    "section-summary",
  ]);

  const hasTitle = titles.length > 0;
  const hasBody = body.length > 0;

  return (
    <div className="border-2 border-border rounded-lg overflow-hidden bg-card/50 shadow-sm border-l-4 border-l-primary/40">
      {/* Section Header - Clickable */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
      >
        {/* Toggle Icon */}
        <ChevronRight
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground mt-0.5 transition-transform duration-200",
            isExpanded && "rotate-90"
          )}
        />

        {/* Section Info */}
        <div className="flex-1 min-w-0">
          {/* Title Row - title and badges inline */}
          <div className="flex items-center gap-2 flex-wrap">
            {hasTitle ? (
              titles.map((child, i) => {
                const isHighlighted = getAttr(child, "data-highlight") === "true";
                const color = getAttr(child, "data-highlight-color");

                return (
                  <span
                    key={i}
                    className={cn(
                      "text-base font-semibold",
                      isHighlighted && !color && "text-amber-600",
                      isHighlighted && color && undefined
                    )}
                    style={isHighlighted && color ? { color } : undefined}
                  >
                    {child}
                  </span>
                );
              })
            ) : (
              ux.display_label && (
                <span className="text-base font-semibold">{ux.display_label}</span>
              )
            )}

            {/* Badges */}
            {badges.map((child, i) => (
              <span
                key={i}
                className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase tracking-wide"
              >
                {child}
              </span>
            ))}
          </div>

          {/* Summaries - below title row */}
          {summaries.map((child, i) => {
            const isHighlighted = getAttr(child, "data-highlight") === "true";
            const color = getAttr(child, "data-highlight-color");

            return (
              <div
                key={i}
                className={cn(
                  "mt-2 text-sm line-clamp-2",
                  !isHighlighted && "text-muted-foreground",
                  isHighlighted && !color && "text-amber-600 font-medium",
                  isHighlighted && color && "font-medium"
                )}
                style={isHighlighted && color ? { color } : undefined}
              >
                {child}
              </div>
            );
          })}
        </div>
      </button>

      {/* Section Content - Expandable */}
      {isExpanded && hasBody && (
        <div className="px-4 pb-4 pt-0">
          <div className="border-t border-border pt-4 space-y-4">
            {body.map((child, i) => maybeWrapHighlight(child, i))}
          </div>
        </div>
      )}
    </div>
  );
};

registerLayout("section", SectionLayout);
