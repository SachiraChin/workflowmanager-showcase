/**
 * Image terminal renderer.
 * Renders image URLs with thumbnail preview.
 */

import { useState } from "react";
import { Image as ImageIcon, Download, Eye } from "lucide-react";
import { cn } from "../utils/cn";
import { CopyButton } from "./nudges";
import type { Nudge } from "../types/schema";

interface ImageRendererProps {
  /** The image URL */
  value: string;
  /** Field label */
  label?: string;
  /** Nudges to apply */
  nudges?: Nudge[];
  /** Additional CSS classes */
  className?: string;
}

export function ImageRenderer({ value, label, nudges = [], className }: ImageRendererProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [imageError, setImageError] = useState(false);

  const showPreviewNudge = nudges.includes("preview");
  const showDownload = nudges.includes("download");
  const showCopy = nudges.includes("copy");

  // Extract filename from URL for display
  const filename = value.split("/").pop()?.split("?")[0] || value;
  const displayName = filename.length > 30 ? `${filename.slice(0, 27)}...` : filename;

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowPreview(!showPreview);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = document.createElement("a");
    link.href = value;
    link.download = filename;
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={cn("text-sm", className)}>
      <div className="flex items-center gap-2">
        {label && (
          <span className="font-medium text-muted-foreground shrink-0">{label}:</span>
        )}
        <ImageIcon className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-foreground truncate min-w-0" title={value}>
          {displayName}
        </span>
        {showPreviewNudge && (
          <button
            onClick={handlePreview}
            className={cn(
              "inline-flex items-center justify-center",
              "w-5 h-5 rounded",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-muted/50 transition-colors",
              showPreview && "bg-muted text-foreground"
            )}
            title={showPreview ? "Hide preview" : "Show preview"}
            type="button"
          >
            <Eye className="w-3 h-3" />
          </button>
        )}
        {showDownload && (
          <button
            onClick={handleDownload}
            className={cn(
              "inline-flex items-center justify-center",
              "w-5 h-5 rounded",
              "text-muted-foreground hover:text-foreground",
              "hover:bg-muted/50 transition-colors"
            )}
            title="Download"
            type="button"
          >
            <Download className="w-3 h-3" />
          </button>
        )}
        {showCopy && <CopyButton value={value} className="shrink-0" />}
      </div>

      {showPreview && showPreviewNudge && !imageError && (
        <div className="mt-2 rounded-md overflow-hidden border border-border bg-muted/20">
          <img
            src={value}
            alt={filename}
            className="max-w-full max-h-48 object-contain"
            onError={() => setImageError(true)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {showPreview && imageError && (
        <div className="mt-2 p-3 rounded-md border border-destructive/50 bg-destructive/10 text-destructive text-xs">
          Failed to load image preview
        </div>
      )}
    </div>
  );
}
