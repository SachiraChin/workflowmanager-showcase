/**
 * Color terminal renderer.
 * Renders hex color values with swatch and optional nudges.
 */

import { cn } from "../utils/cn";
import { CopyButton, ColorSwatch } from "./nudges";
import type { Nudge } from "../types/schema";

interface ColorRendererProps {
  /** The hex color value (e.g., "#FF0000") */
  value: string;
  /** Field label */
  label?: string;
  /** Nudges to apply */
  nudges?: Nudge[];
  /** Additional CSS classes */
  className?: string;
}

export function ColorRenderer({ value, label, nudges = [], className }: ColorRendererProps) {
  const showSwatch = nudges.includes("swatch");
  const showCopy = nudges.includes("copy");

  return (
    <div className={cn("text-sm flex items-center gap-2", className)}>
      {label && (
        <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
      )}
      {showSwatch && <ColorSwatch color={value} size="md" />}
      <span className="text-foreground font-mono text-xs">{value}</span>
      {showCopy && <CopyButton value={value} className="shrink-0" />}
    </div>
  );
}
