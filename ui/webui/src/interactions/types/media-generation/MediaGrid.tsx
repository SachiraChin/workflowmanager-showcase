/**
 * MediaGrid - Grid display of generated images/videos with selection.
 *
 * Features:
 * - Displays images and videos from all generations for a prompt
 * - Single-select with visual indicator
 * - Full-screen preview on click (image viewer or video player)
 * - Selection via top-right marker
 * - Lazy loading support for readonly/history mode
 */

import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronLeft, ChevronRight, X, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import type { GenerationResult } from "./types";

// =============================================================================
// Helpers
// =============================================================================

/** Check if URL points to a video file */
function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const lowercaseUrl = url.toLowerCase();
  // Check common video extensions
  return (
    lowercaseUrl.endsWith('.mp4') ||
    lowercaseUrl.endsWith('.webm') ||
    lowercaseUrl.endsWith('.mov') ||
    lowercaseUrl.endsWith('.avi') ||
    lowercaseUrl.includes('.mp4?') ||
    lowercaseUrl.includes('.webm?')
  );
}

// =============================================================================
// Types
// =============================================================================

interface ContentItem {
  contentId: string;
  url: string;
  metadataId: string;
  generationIndex: number; // Track which generation this belongs to
  isVideo: boolean; // Whether this is a video file
}

interface MediaGridProps {
  /** Generation results to display */
  generations: GenerationResult[];
  /** Currently selected content ID (global across all prompts) */
  selectedContentId: string | null;
  /** Callback when content is selected */
  onSelect: (contentId: string) => void;
  /** Enable lazy loading (for readonly mode) */
  lazyLoad?: boolean;
  /** Disable selection (readonly mode) */
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function MediaGrid({
  generations,
  selectedContentId,
  onSelect,
  lazyLoad = false,
  disabled = false,
}: MediaGridProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Reverse generations so latest is first, keep grouped structure
  const reversedGenerations = [...generations].reverse();

  // Flatten all generations into content items for preview navigation
  const allContent: ContentItem[] = reversedGenerations.flatMap((gen, genIdx) =>
    gen.content_ids.map((contentId, idx) => {
      const url = gen.urls[idx];
      return {
        contentId,
        url,
        metadataId: gen.metadata_id,
        generationIndex: genIdx,
        isVideo: isVideoUrl(url),
      };
    })
  );

  if (allContent.length === 0) {
    return null;
  }

  const handlePreview = (index: number) => {
    setPreviewIndex(index);
  };

  const handlePrevious = () => {
    if (previewIndex !== null && previewIndex > 0) {
      setPreviewIndex(previewIndex - 1);
    }
  };

  const handleNext = () => {
    if (previewIndex !== null && previewIndex < allContent.length - 1) {
      setPreviewIndex(previewIndex + 1);
    }
  };

  const previewItem = previewIndex !== null ? allContent[previewIndex] : null;

  // Build a map of contentId to flat index for preview navigation
  const contentIndexMap = new Map<string, number>();
  allContent.forEach((item, index) => {
    contentIndexMap.set(item.contentId, index);
  });

  return (
    <>
      <div className="space-y-2">
        {reversedGenerations.map((gen, genIdx) => (
          <div key={gen.metadata_id} className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {gen.content_ids.map((contentId, idx) => {
              const flatIndex = contentIndexMap.get(contentId) ?? 0;
              const url = gen.urls[idx];
              return (
                <MediaGridItem
                  key={contentId}
                  item={{
                    contentId,
                    url,
                    metadataId: gen.metadata_id,
                    generationIndex: genIdx,
                    isVideo: isVideoUrl(url),
                  }}
                  isSelected={selectedContentId === contentId}
                  onSelect={onSelect}
                  onPreview={() => handlePreview(flatIndex)}
                  lazyLoad={lazyLoad}
                  disabled={disabled}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Preview Dialog */}
      <Dialog open={previewIndex !== null} onOpenChange={(open) => !open && setPreviewIndex(null)}>
        <DialogContent
          className="max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-none"
          showCloseButton={false}
        >
          <VisuallyHidden>
            <DialogTitle>{previewItem?.isVideo ? "Video Preview" : "Image Preview"}</DialogTitle>
          </VisuallyHidden>

          {previewItem && (
            <div className="relative flex items-center justify-center min-h-[50vh]">
              {/* Close button */}
              <button
                onClick={() => setPreviewIndex(null)}
                className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>

              {/* Previous button */}
              {previewIndex !== null && previewIndex > 0 && (
                <button
                  onClick={handlePrevious}
                  className="absolute left-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
              )}

              {/* Video or Image */}
              {previewItem.isVideo ? (
                <video
                  key={previewItem.url}
                  src={previewItem.url}
                  controls
                  autoPlay
                  loop
                  className="max-w-full max-h-[85vh] object-contain"
                />
              ) : (
                <img
                  src={previewItem.url}
                  alt=""
                  className="max-w-full max-h-[85vh] object-contain"
                />
              )}

              {/* Next button */}
              {previewIndex !== null && previewIndex < allContent.length - 1 && (
                <button
                  onClick={handleNext}
                  className="absolute right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              )}

              {/* Selection button in preview */}
              {!disabled && (
                <button
                  onClick={() => onSelect(previewItem.contentId)}
                  className={cn(
                    "absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-full transition-colors flex items-center gap-2",
                    selectedContentId === previewItem.contentId
                      ? "bg-primary text-primary-foreground"
                      : "bg-black/50 text-white hover:bg-black/70"
                  )}
                >
                  <Check className="w-5 h-5" />
                  {selectedContentId === previewItem.contentId ? "Selected" : previewItem.isVideo ? "Select this video" : "Select this image"}
                </button>
              )}

              {/* Content counter */}
              <div className="absolute bottom-4 right-4 text-white/70 text-sm">
                {(previewIndex ?? 0) + 1} / {allContent.length}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// =============================================================================
// Grid Item Component
// =============================================================================

interface MediaGridItemProps {
  item: ContentItem;
  isSelected: boolean;
  onSelect: (contentId: string) => void;
  onPreview: () => void;
  lazyLoad: boolean;
  disabled: boolean;
}

function MediaGridItem({
  item,
  isSelected,
  onSelect,
  onPreview,
  lazyLoad,
  disabled,
}: MediaGridItemProps) {
  const [loaded, setLoaded] = useState(!lazyLoad);
  const [error, setError] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<number>(1);
  const [isHovering, setIsHovering] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleClick = () => {
    onPreview();
  };

  const handleSelectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onSelect(item.contentId);
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setAspectRatio(img.naturalWidth / img.naturalHeight);
    setLoaded(true);
  };

  const handleVideoLoad = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    setAspectRatio(video.videoWidth / video.videoHeight);
    setLoaded(true);
  };

  // Handle hover play for videos
  const handleMouseEnter = () => {
    setIsHovering(true);
    if (item.isVideo && videoRef.current) {
      videoRef.current.play().catch(() => {
        // Ignore autoplay errors (browser restrictions)
      });
    }
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    if (item.isVideo && videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-lg overflow-hidden border-2 transition-all bg-muted/30 cursor-pointer group",
        isSelected
          ? "border-primary ring-2 ring-primary ring-offset-2"
          : "border-transparent hover:border-muted-foreground/50"
      )}
      style={{ aspectRatio: loaded ? aspectRatio : 1 }}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Content - Video or Image */}
      {error ? (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <span className="text-xs text-muted-foreground">Failed to load</span>
        </div>
      ) : item.isVideo ? (
        <>
          <video
            ref={videoRef}
            src={item.url}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={handleVideoLoad}
            onError={() => setError(true)}
            className={cn(
              "w-full h-full object-contain transition-opacity",
              loaded ? "opacity-100" : "opacity-0"
            )}
          />
          {/* Play icon overlay for videos (hidden on hover) */}
          {loaded && !isHovering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 rounded-full p-3">
                <Play className="w-6 h-6 text-white fill-white" />
              </div>
            </div>
          )}
        </>
      ) : (
        <img
          src={item.url}
          alt=""
          loading={lazyLoad ? "lazy" : "eager"}
          onLoad={handleImageLoad}
          onError={() => setError(true)}
          className={cn(
            "w-full h-full object-contain transition-opacity",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}

      {/* Loading placeholder */}
      {!loaded && !error && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}

      {/* Selection marker - always visible in top-right */}
      {!disabled && (
        <button
          onClick={handleSelectClick}
          className={cn(
            "absolute top-2 right-2 rounded-full p-1 shadow-lg transition-all z-10",
            isSelected
              ? "bg-primary text-primary-foreground"
              : "bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70"
          )}
          title={isSelected ? "Selected" : "Click to select"}
        >
          <Check className="w-4 h-4" />
        </button>
      )}

      {/* Show selection indicator even when disabled (readonly) */}
      {disabled && isSelected && (
        <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1 shadow-lg z-10">
          <Check className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
