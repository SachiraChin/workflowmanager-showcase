/**
 * CropSelectionModal - Modal for selecting a crop region on source image.
 *
 * Used before img2vid generation to allow users to select a specific
 * region of the source image, locked to a chosen aspect ratio.
 *
 * Features:
 * - Interactive crop selection with react-image-crop
 * - Aspect ratio selector (9:16, 16:9, etc.)
 * - "Save selection for this session" checkbox
 * - View-only mode for reviewing saved selection
 * - Darkened overlay on unselected area (react-image-crop default)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";

import type { CropRegion, CropState } from "./types";
import { CROP_ASPECT_RATIOS } from "./types";

// =============================================================================
// Types
// =============================================================================

interface CropSelectionModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** URL of the source image */
  imageUrl: string;
  /** Callback when user confirms selection */
  onConfirm: (cropRegion: CropRegion | null, savePreference: boolean, aspectRatio: string) => void;
  /** Initial crop state (for editing existing selection) */
  initialCrop?: CropState;
  /** View-only mode - hides action buttons, just shows the selection */
  viewOnly?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a centered crop with the given aspect ratio.
 */
function createCenteredCrop(
  imageWidth: number,
  imageHeight: number,
  aspect: number | undefined
): Crop {
  if (aspect === undefined) {
    // Free selection - default to 50% of image centered
    return centerCrop(
      {
        unit: "%",
        width: 50,
        height: 50,
      },
      imageWidth,
      imageHeight
    );
  }

  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 90, // Start with 90% width
      },
      aspect,
      imageWidth,
      imageHeight
    ),
    imageWidth,
    imageHeight
  );
}

/**
 * Convert crop to pixel region in original image coordinates.
 *
 * Handles both percentage and pixel units from react-image-crop.
 * When unit is "px", values are in displayed image coordinates and must be
 * scaled to original image coordinates.
 */
function cropToPixelRegion(
  crop: Crop,
  naturalWidth: number,
  naturalHeight: number,
  displayedWidth: number,
  displayedHeight: number
): CropRegion {
  if (crop.unit === "px") {
    // Crop is in displayed pixel coordinates - scale to natural image coordinates
    const scaleX = naturalWidth / displayedWidth;
    const scaleY = naturalHeight / displayedHeight;
    return {
      x: Math.round(crop.x * scaleX),
      y: Math.round(crop.y * scaleY),
      width: Math.round(crop.width * scaleX),
      height: Math.round(crop.height * scaleY),
    };
  }

  // Percentage-based (unit is "%" or undefined)
  return {
    x: Math.round((crop.x / 100) * naturalWidth),
    y: Math.round((crop.y / 100) * naturalHeight),
    width: Math.round((crop.width / 100) * naturalWidth),
    height: Math.round((crop.height / 100) * naturalHeight),
  };
}

/**
 * Convert pixel crop region to percentage crop.
 */
function pixelRegionToCrop(region: CropRegion, imageWidth: number, imageHeight: number): Crop {
  return {
    unit: "%",
    x: (region.x / imageWidth) * 100,
    y: (region.y / imageHeight) * 100,
    width: (region.width / imageWidth) * 100,
    height: (region.height / imageHeight) * 100,
  };
}

// =============================================================================
// Component
// =============================================================================

export function CropSelectionModal({
  open,
  onClose,
  imageUrl,
  onConfirm,
  initialCrop,
  viewOnly = false,
}: CropSelectionModalProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageDimensions, setImageDimensions] = useState<{
    naturalWidth: number;
    naturalHeight: number;
    displayedWidth: number;
    displayedHeight: number;
  } | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [aspectRatio, setAspectRatio] = useState<string>(initialCrop?.aspectRatio || "9:16");
  const [savePreference, setSavePreference] = useState(true);

  // Get the numeric aspect ratio value
  const aspectValue = CROP_ASPECT_RATIOS.find((r) => r.key === aspectRatio)?.value;

  // Initialize crop when image loads or aspect ratio changes
  const initializeCrop = useCallback(() => {
    if (!imageDimensions) return;

    if (initialCrop && initialCrop.aspectRatio === aspectRatio) {
      // Use initial crop if aspect ratio matches
      const percentCrop = pixelRegionToCrop(
        initialCrop.region,
        imageDimensions.naturalWidth,
        imageDimensions.naturalHeight
      );
      setCrop(percentCrop);
    } else {
      // Create new centered crop
      const newCrop = createCenteredCrop(
        imageDimensions.naturalWidth,
        imageDimensions.naturalHeight,
        aspectValue
      );
      setCrop(newCrop);
    }
  }, [imageDimensions, initialCrop, aspectRatio, aspectValue]);

  // Initialize when image loads
  useEffect(() => {
    if (imageDimensions) {
      initializeCrop();
    }
  }, [imageDimensions, initializeCrop]);

  // Re-initialize when aspect ratio changes
  useEffect(() => {
    if (imageDimensions && crop) {
      const newCrop = createCenteredCrop(
        imageDimensions.naturalWidth,
        imageDimensions.naturalHeight,
        aspectValue
      );
      setCrop(newCrop);
    }
    // Only depend on aspectValue change, not crop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aspectValue, imageDimensions]);

  // Handle image load
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight, width, height } = e.currentTarget;
    console.log("[CropSelectionModal] Image loaded:", {
      naturalWidth,
      naturalHeight,
      displayedWidth: width,
      displayedHeight: height,
    });
    setImageDimensions({
      naturalWidth,
      naturalHeight,
      displayedWidth: width,
      displayedHeight: height,
    });
  }, []);

  // Handle confirm with selection
  const handleConfirmWithSelection = () => {
    if (!crop || !imageDimensions) {
      onConfirm(null, savePreference, aspectRatio);
      return;
    }

    // Convert crop to original image pixel coordinates
    const region = cropToPixelRegion(
      crop,
      imageDimensions.naturalWidth,
      imageDimensions.naturalHeight,
      imageDimensions.displayedWidth,
      imageDimensions.displayedHeight
    );

    // Debug logging to diagnose crop issues
    console.log("[CropSelectionModal] Crop debug:", {
      crop,
      imageDimensions,
      calculatedRegion: region,
    });

    onConfirm(region, savePreference, aspectRatio);
  };

  // Handle use full image
  const handleUseFullImage = () => {
    onConfirm(null, false, aspectRatio);
  };

  // Calculate display dimensions for the crop region (in original image pixels)
  const displayCropInfo = crop && imageDimensions
    ? cropToPixelRegion(
        crop,
        imageDimensions.naturalWidth,
        imageDimensions.naturalHeight,
        imageDimensions.displayedWidth,
        imageDimensions.displayedHeight
      )
    : null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {viewOnly ? "Current Crop Selection" : "Select Crop Region"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto space-y-4">
          {/* Aspect Ratio Selector */}
          <div className="flex items-center gap-4">
            <Label htmlFor="aspect-ratio" className="text-sm font-medium">
              Aspect Ratio:
            </Label>
            <Select
              value={aspectRatio}
              onValueChange={setAspectRatio}
              disabled={viewOnly}
            >
              <SelectTrigger id="aspect-ratio" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CROP_ASPECT_RATIOS.map((ratio) => (
                  <SelectItem key={ratio.key} value={ratio.key}>
                    {ratio.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Crop dimensions display */}
            {displayCropInfo && (
              <span className="text-sm text-muted-foreground ml-auto">
                {displayCropInfo.width} × {displayCropInfo.height} px
              </span>
            )}
          </div>

          {/* Crop Area */}
          <div className="flex justify-center bg-muted/30 rounded-lg p-4">
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              aspect={aspectValue}
              disabled={viewOnly}
              className="max-h-[60vh]"
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Source"
                onLoad={onImageLoad}
                className="max-h-[60vh] object-contain"
              />
            </ReactCrop>
          </div>

          {/* Save Preference Checkbox */}
          {!viewOnly && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="save-preference"
                checked={savePreference}
                onCheckedChange={(checked) => setSavePreference(checked === true)}
              />
              <Label htmlFor="save-preference" className="text-sm cursor-pointer">
                Save selection for this session (skip this dialog for future generations)
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {viewOnly ? (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleUseFullImage}>
                Use Full Image
              </Button>
              <Button onClick={handleConfirmWithSelection}>
                Generate with Selection
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
