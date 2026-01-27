/**
 * DateTime terminal renderer.
 * Renders date/time values in human-readable format.
 */

import { cn } from "@/core/utils";
import { CopyButton } from "./nudges";
import type { Nudge } from "../schema/types";

interface DateTimeRendererProps {
  /** The date/time value (ISO string or timestamp) */
  value: string | number;
  /** Field label */
  label?: string;
  /** Nudges to apply */
  nudges?: Nudge[];
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format a date/time value for display.
 */
function formatDateTime(value: string | number): string {
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    // Format: "Jan 1, 2026, 2:30 PM"
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

/**
 * Format relative time ("2 hours ago", "3 days ago").
 */
function formatRelative(value: string | number): string {
  try {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return "";
    }
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return "just now";
  } catch {
    return "";
  }
}

export function DateTimeRenderer({ value, label, nudges = [], className }: DateTimeRendererProps) {
  const showCopy = nudges.includes("copy");
  const formatted = formatDateTime(value);
  const relative = formatRelative(value);
  const rawValue = String(value);

  return (
    <div className={cn("text-sm flex items-center gap-2", className)}>
      {label && (
        <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      )}
      <span className="text-foreground">{formatted}</span>
      {relative && (
        <span className="text-muted-foreground text-xs">({relative})</span>
      )}
      {showCopy && <CopyButton value={rawValue} className="shrink-0" />}
    </div>
  );
}
