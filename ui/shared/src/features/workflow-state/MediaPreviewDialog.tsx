/**
 * MediaPreviewDialog - Preview dialog for media files (images, videos, audio).
 *
 * Supports:
 * - Images: fullscreen display with download
 * - Videos: fullscreen display with native controls
 * - Audio: WaveSurfer.js waveform visualization with playback controls
 */

import { useState, useRef, useEffect, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Download, Play, Pause, X, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "../../components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "../../components/ui/button";
import { toMediaUrl } from "../../core/config";
import type { WorkflowFile } from "../../types/index";

// =============================================================================
// Types
// =============================================================================

interface MediaPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: WorkflowFile | null;
  /** Current index in the media list */
  currentIndex: number;
  /** Total number of media files */
  totalCount: number;
  /** Navigate to previous media */
  onPrevious: () => void;
  /** Navigate to next media */
  onNext: () => void;
}

// =============================================================================
// Image Preview Component
// =============================================================================

interface ImagePreviewProps {
  url: string;
  filename: string;
  onClose: () => void;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

function ImagePreview({
  url,
  filename,
  onClose,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
}: ImagePreviewProps) {
  const fullUrl = toMediaUrl(url);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  return (
    <div className="relative flex items-center justify-center min-h-[50vh]">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Previous button */}
      {hasPrevious && (
        <button
          onClick={onPrevious}
          className="absolute left-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}

      {/* Image */}
      <img
        src={fullUrl}
        alt={filename}
        className="max-w-full max-h-[85vh] object-contain"
      />

      {/* Next button */}
      {hasNext && (
        <button
          onClick={onNext}
          className="absolute right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Download button */}
      <a
        href={`${fullUrl}?download=true`}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        title="Download"
      >
        <Download className="w-5 h-5" />
      </a>

      {/* Counter */}
      <div className="absolute bottom-4 left-4 text-white/70 text-sm">
        {currentIndex + 1} / {totalCount}
      </div>
    </div>
  );
}

// =============================================================================
// Video Preview Component
// =============================================================================

interface VideoPreviewProps {
  url: string;
  filename: string;
  previewUrl?: string;
  onClose: () => void;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

function VideoPreview({
  url,
  filename,
  previewUrl,
  onClose,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
}: VideoPreviewProps) {
  const fullUrl = toMediaUrl(url);
  const posterUrl = previewUrl ? toMediaUrl(previewUrl) : undefined;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  return (
    <div className="relative flex items-center justify-center min-h-[50vh]">
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
      >
        <X className="w-6 h-6" />
      </button>

      {/* Previous button */}
      {hasPrevious && (
        <button
          onClick={onPrevious}
          className="absolute left-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}

      {/* Video */}
      <video
        src={fullUrl}
        poster={posterUrl}
        controls
        autoPlay
        loop
        className="max-w-full max-h-[85vh] object-contain"
      />

      {/* Next button */}
      {hasNext && (
        <button
          onClick={onNext}
          className="absolute right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Download button */}
      <a
        href={`${fullUrl}?download=true`}
        download={filename}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 right-4 z-10 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        title="Download"
      >
        <Download className="w-5 h-5" />
      </a>

      {/* Counter */}
      <div className="absolute bottom-4 left-4 text-white/70 text-sm">
        {currentIndex + 1} / {totalCount}
      </div>
    </div>
  );
}

// =============================================================================
// Audio Preview Component
// =============================================================================

interface AudioPreviewProps {
  url: string;
  filename: string;
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
}

function AudioPreview({
  url,
  filename,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
}: AudioPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const fullUrl = toMediaUrl(url);
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;

    const wavesurfer = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "rgb(148, 163, 184)",
      progressColor: "rgb(59, 130, 246)",
      cursorColor: "rgb(59, 130, 246)",
      barWidth: 3,
      barGap: 1,
      barRadius: 3,
      height: 80,
      normalize: true,
    });

    // Manually fetch audio with credentials and load as blob
    fetch(fullUrl, { credentials: "include", mode: "cors" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        wavesurfer.loadBlob(blob);
      })
      .catch((err) => {
        console.error("[AudioPreview] Failed to load audio:", err);
      });

    wavesurfer.on("ready", () => {
      setDuration(wavesurfer.getDuration());
      setIsReady(true);
    });

    wavesurfer.on("timeupdate", (time) => {
      setCurrentTime(time);
    });

    wavesurfer.on("finish", () => {
      setIsPlaying(false);
    });

    wavesurferRef.current = wavesurfer;

    return () => {
      cancelled = true;
      wavesurfer.destroy();
      wavesurferRef.current = null;
    };
  }, [fullUrl]);

  const togglePlay = useCallback(() => {
    if (!wavesurferRef.current || !isReady) return;

    if (isPlaying) {
      wavesurferRef.current.pause();
    } else {
      wavesurferRef.current.play().catch((err: Error) => {
        console.error("[AudioPreview] Play failed:", err);
      });
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, isReady]);

  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    link.href = `${fullUrl}?download=true`;
    link.download = filename;
    link.target = "_blank";
    link.click();
  }, [fullUrl, filename]);

  // Format time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header with navigation */}
      <div className="flex items-center gap-3">
        {/* Previous button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={!hasPrevious}
          className="shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Filename and counter */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono text-foreground truncate">
            {filename}
          </div>
          <div className="text-xs text-muted-foreground">
            {currentIndex + 1} / {totalCount}
          </div>
        </div>

        {/* Next button */}
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!hasNext}
          className="shrink-0"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Waveform container */}
      <div className="bg-muted/30 rounded-lg p-4">
        <div ref={containerRef} className="w-full h-20" />
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="sm"
          onClick={togglePlay}
          disabled={!isReady}
          className="w-24"
        >
          {isPlaying ? (
            <>
              <Pause className="h-4 w-4 mr-1" />
              Pause
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-1" />
              Play
            </>
          )}
        </Button>

        <span className="text-sm text-muted-foreground font-mono">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="h-4 w-4 mr-1" />
          Download
        </Button>
      </div>
    </div>
  );
}

// =============================================================================
// Main Dialog Component
// =============================================================================

export function MediaPreviewDialog({
  open,
  onOpenChange,
  file,
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
}: MediaPreviewDialogProps) {
  if (!file || !file.url) return null;

  const contentType = file.content_type;
  const isImage = contentType === "image";
  const isVideo = contentType === "video";

  const handleClose = () => onOpenChange(false);

  // For images and videos, use fullscreen dark dialog (like MediaGrid)
  if (isImage || isVideo) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-[90vw] max-h-[90vh] p-0 bg-black/95 border-none"
          showCloseButton={false}
        >
          <VisuallyHidden>
            <DialogTitle>
              {isVideo ? "Video Preview" : "Image Preview"}
            </DialogTitle>
          </VisuallyHidden>

          {isImage && (
            <ImagePreview
              url={file.url}
              filename={file.filename}
              onClose={handleClose}
              currentIndex={currentIndex}
              totalCount={totalCount}
              onPrevious={onPrevious}
              onNext={onNext}
            />
          )}
          {isVideo && (
            <VideoPreview
              url={file.url}
              filename={file.filename}
              previewUrl={file.preview_url}
              onClose={handleClose}
              currentIndex={currentIndex}
              totalCount={totalCount}
              onPrevious={onPrevious}
              onNext={onNext}
            />
          )}
        </DialogContent>
      </Dialog>
    );
  }

  // For audio, use a wider dialog with controls and navigation
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <VisuallyHidden>
          <DialogTitle>Audio Preview</DialogTitle>
        </VisuallyHidden>
        <AudioPreview
          url={file.url}
          filename={file.filename}
          currentIndex={currentIndex}
          totalCount={totalCount}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      </DialogContent>
    </Dialog>
  );
}
