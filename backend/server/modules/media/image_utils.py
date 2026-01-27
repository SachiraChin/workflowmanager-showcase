"""
Image processing utilities for media modules.

Provides functions for image manipulation such as cropping,
used before passing images to media generation providers.
"""

import logging
import os
from datetime import datetime
from typing import Any, Dict

from PIL import Image

logger = logging.getLogger(__name__)


def crop_image(
    source_path: str,
    crop_region: Dict[str, Any],
    images_path: str,
    output_format: str | None = None
) -> str:
    """
    Crop an image to the specified region.

    Args:
        source_path: Path to source image file
        crop_region: Dict with x, y, width, height in pixels
        images_path: Directory to save cropped image (from get_media_images_path)
        output_format: Output format (PNG, JPEG, WEBP). If None, preserves
                      original format.

    Returns:
        Path to cropped image. File is saved as:
        {original_basename}_crop_{datetime}.{ext}

    Raises:
        FileNotFoundError: If source_path doesn't exist
        ValueError: If crop_region is invalid or images_path is not set
        PIL.UnidentifiedImageError: If source is not a valid image
    """
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"Source image not found: {source_path}")

    if not images_path:
        raise ValueError("images_path is required for saving cropped images")

    # Ensure output directory exists
    os.makedirs(images_path, exist_ok=True)

    # Extract crop coordinates
    x = int(crop_region.get("x", 0))
    y = int(crop_region.get("y", 0))
    width = int(crop_region.get("width", 0))
    height = int(crop_region.get("height", 0))

    if width <= 0 or height <= 0:
        raise ValueError(f"Invalid crop dimensions: {width}x{height}")

    with Image.open(source_path) as img:
        img_width, img_height = img.size

        # Clamp crop region to image bounds
        x = max(0, min(x, img_width - 1))
        y = max(0, min(y, img_height - 1))
        right = min(x + width, img_width)
        bottom = min(y + height, img_height)

        # Validate we have a valid crop area after clamping
        if right <= x or bottom <= y:
            raise ValueError(
                f"Crop region ({x}, {y}, {width}, {height}) results in "
                f"empty area for image size {img_width}x{img_height}"
            )

        logger.info(
            f"[image_utils] Cropping image: "
            f"({x}, {y}) to ({right}, {bottom}) from {img_width}x{img_height}"
        )

        # PIL crop uses (left, upper, right, lower) box
        cropped = img.crop((x, y, right, bottom))

        # Determine output format
        original_format = img.format or "PNG"
        save_format = output_format or original_format

        # Map format to file extension
        format_to_ext = {
            "JPEG": ".jpg",
            "JPG": ".jpg",
            "PNG": ".png",
            "WEBP": ".webp",
            "GIF": ".gif",
        }
        ext = format_to_ext.get(save_format.upper(), ".png")

        # Generate output filename: {basename}_crop_{datetime}{ext}
        source_basename = os.path.splitext(os.path.basename(source_path))[0]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        output_filename = f"{source_basename}_crop_{timestamp}{ext}"
        output_path = os.path.join(images_path, output_filename)

        # Save with appropriate settings
        save_format_normalized = save_format.upper()
        if save_format_normalized in ("JPEG", "JPG"):
            # Convert RGBA to RGB for JPEG (no alpha support)
            if cropped.mode == "RGBA":
                cropped = cropped.convert("RGB")
            cropped.save(output_path, format="JPEG", quality=95)
        elif save_format_normalized == "WEBP":
            cropped.save(output_path, format="WEBP", quality=95)
        else:
            cropped.save(output_path, format=save_format_normalized)

        logger.info(
            f"[image_utils] Cropped image saved: {output_path} "
            f"({right - x}x{bottom - y})"
        )

        return output_path
