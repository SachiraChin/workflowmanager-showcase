/**
 * Number terminal renderer.
 * Renders numeric values with formatting.
 */

import { cn } from "@/core/utils";
import { CopyButton } from "./nudges";
import type { Nudge } from "../schema/types";

interface NumberRendererProps {
  /** The numeric value */
  value: number | string;
  /** Field label */
  label?: string;
  /** Nudges to apply */
  nudges?: Nudge[];
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format a number for display.
 */
function formatNumber(value: number | string): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) {
    return String(value);
  }
  // Use locale formatting with reasonable precision
  return num.toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

export function NumberRenderer({ value, label, nudges = [], className }: NumberRendererProps) {
  const showCopy = nudges.includes("copy");
  const formatted = formatNumber(value);
  const rawValue = String(value);

  return (
    <div className={cn("text-sm flex items-center gap-2", className)}>
      {label && (
        <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      )}
      <span className="text-foreground font-mono">{formatted}</span>
      {showCopy && <CopyButton value={rawValue} className="shrink-0" />}
    </div>
  );
}
