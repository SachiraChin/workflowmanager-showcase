/**
 * Color swatch nudge.
 * Shows a small colored square representing a hex color.
 */

import { cn } from "../../utils/cn";

interface ColorSwatchProps {
  /** Hex color value (e.g., "#FF0000") */
  color: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses = {
  sm: "w-3 h-3",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

export function ColorSwatch({ color, size = "sm", className }: ColorSwatchProps) {
  // Validate color format (basic hex check)
  const isValidColor = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);

  if (!isValidColor) {
    return (
      <span
        className={cn(
          "inline-block rounded-sm border border-dashed border-muted-foreground",
          sizeClasses[size],
          className
        )}
        title={`Invalid color: ${color}`}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-block rounded-sm border border-border/50 flex-shrink-0",
        sizeClasses[size],
        className
      )}
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}
