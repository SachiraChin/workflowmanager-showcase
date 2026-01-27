/**
 * External link nudge.
 * Shows a small icon that opens URL in new tab.
 */

import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExternalLinkProps {
  /** URL to open */
  url: string;
  /** Additional CSS classes */
  className?: string;
}

export function ExternalLink({ url, className }: ExternalLinkProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger parent click handlers
  };

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center",
        "w-5 h-5 rounded",
        "text-muted-foreground hover:text-primary",
        "hover:bg-muted/50 transition-colors",
        "focus:outline-none focus:ring-1 focus:ring-primary",
        className
      )}
      title="Open in new tab"
    >
      <ExternalLinkIcon className="w-3 h-3" />
    </a>
  );
}
