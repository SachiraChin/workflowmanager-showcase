/**
 * Copy to clipboard button nudge.
 * Shows a small copy icon that copies value to clipboard on click.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/core/utils";

interface CopyButtonProps {
  /** Value to copy to clipboard */
  value: string;
  /** Additional CSS classes */
  className?: string;
}

export function CopyButton({ value, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger parent click handlers
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "inline-flex items-center justify-center",
        "w-5 h-5 rounded",
        "text-muted-foreground hover:text-foreground",
        "hover:bg-muted/50 transition-colors",
        "focus:outline-none focus:ring-1 focus:ring-primary",
        className
      )}
      title={copied ? "Copied!" : "Copy to clipboard"}
      type="button"
    >
      {copied ? (
        <Check className="w-3 h-3 text-green-500" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  );
}
