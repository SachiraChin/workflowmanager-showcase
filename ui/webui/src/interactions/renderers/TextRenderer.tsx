/**
 * Text terminal renderer.
 * Renders plain text values with optional nudges.
 */

import { cn } from "@/lib/utils";
import { CopyButton } from "./nudges";
import type { Nudge } from "../types";

interface TextRendererProps {
  /** The text value to display */
  value: string;
  /** Field label */
  label?: string;
  /** Nudges to apply */
  nudges?: Nudge[];
  /** Additional CSS classes */
  className?: string;
}

export function TextRenderer({ value, label, nudges = [], className }: TextRendererProps) {
  const showCopy = nudges.includes("copy");

  return (
    <div className={cn("text-sm flex items-start gap-2", className)}>
      {label && (
        <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      )}
      <span className="text-foreground break-words min-w-0 whitespace-pre-line">{value}</span>
      {showCopy && <CopyButton value={value} className="shrink-0 mt-0.5" />}
    </div>
  );
}
