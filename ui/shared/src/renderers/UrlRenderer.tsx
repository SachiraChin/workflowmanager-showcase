/**
 * URL terminal renderer.
 * Renders clickable URLs with optional nudges.
 */

import { cn } from "../utils/cn";
import { CopyButton, ExternalLink } from "./nudges";
import type { Nudge } from "../types/schema";

interface UrlRendererProps {
  /** The URL value */
  value: string;
  /** Field label */
  label?: string;
  /** Nudges to apply */
  nudges?: Nudge[];
  /** Additional CSS classes */
  className?: string;
}

export function UrlRenderer({ value, label, nudges = [], className }: UrlRendererProps) {
  const showExternalLink = nudges.includes("external-link");
  const showCopy = nudges.includes("copy");

  // Truncate long URLs for display
  const displayValue = value.length > 50 ? `${value.slice(0, 47)}...` : value;

  return (
    <div className={cn("text-sm flex items-center gap-2", className)}>
      {label && (
        <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      )}
      <a
        href={value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:no-underline truncate min-w-0"
        title={value}
        onClick={(e) => e.stopPropagation()}
      >
        {displayValue}
      </a>
      {showExternalLink && <ExternalLink url={value} className="shrink-0" />}
      {showCopy && <CopyButton value={value} className="shrink-0" />}
    </div>
  );
}
