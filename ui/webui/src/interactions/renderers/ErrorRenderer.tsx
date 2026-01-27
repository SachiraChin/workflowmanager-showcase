/**
 * Error terminal renderer.
 * Shows error state for missing or invalid render_as configuration.
 */

import { AlertTriangle } from "lucide-react";
import { cn } from "@/core/utils";

interface ErrorRendererProps {
  /** Field key that has the error */
  fieldKey: string;
  /** The render_as value that was invalid (or undefined) */
  renderAs?: string;
  /** The raw value (for debugging) */
  value?: unknown;
  /** Additional CSS classes */
  className?: string;
}

export function ErrorRenderer({ fieldKey, renderAs, value, className }: ErrorRendererProps) {
  const message = renderAs
    ? `Unknown render_as: "${renderAs}"`
    : `Missing render_as for field "${fieldKey}"`;

  return (
    <div
      className={cn(
        "text-sm flex items-start gap-2 p-2 rounded-md",
        "border border-yellow-500/50 bg-yellow-500/10",
        className
      )}
    >
      <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-yellow-600 dark:text-yellow-400 font-medium">
          {message}
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Add <code className="bg-muted px-1 rounded">render_as: "text"</code> (or color, url, datetime, number, image) to the schema.
        </div>
        {value !== undefined && (
          <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
            Value: {JSON.stringify(value)}
          </div>
        )}
      </div>
    </div>
  );
}
