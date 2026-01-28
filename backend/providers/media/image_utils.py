"""
Image processing utilities for media providers.

Provides functions for image manipulation such as cropping and resizing,
used by providers before submitting images to generation APIs.
"""

import logging
import os
from datetime import datetime
from typing import Any, Dict, Tuple

from PIL import Image

logger = logging.getLogger(__name__)


def crop_image(
    source_path: str,
    crop_region: Dict[str, Any],
    output_dir: str,
    output_format: str | None = None
) -> str:
    """
    Crop an image to the specified region.

    Args:
        source_path: Path to source image file
        crop_region: Dict with x, y, width, height in pixels
        output_dir: Directory to save cropped image
        output_format: Output format (PNG, JPEG, WEBP). If None, preserves
                      original format.

    Returns:
        Path to cropped image. File is saved as:
        {original_basename}_crop_{datetime}.{ext}

    Raises:
        FileNotFoundError: If source_path doesn't exist
        ValueError: If crop_region is invalid or output_dir is not set
        PIL.UnidentifiedImageError: If source is not a valid image
    """
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"Source image not found: {source_path}")

    if not output_dir:
        raise ValueError("output_dir is required for saving cropped images")

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

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
        output_path = os.path.join(output_dir, output_filename)

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


def crop_and_resize(
    source_path: str,
    crop_region: Dict[str, Any],
    target_size: Tuple[int, int],
    output_dir: str,
    output_format: str | None = None
) -> str:
    """
    Crop an image and resize to target dimensions.

    Used by providers that require specific input dimensions (e.g., Sora).
    The cropped region is resized to exactly match target_size.

    Args:
        source_path: Path to source image file
        crop_region: Dict with x, y, width, height in pixels
        target_size: Tuple of (width, height) for output dimensions
        output_dir: Directory to save processed image
        output_format: Output format (PNG, JPEG, WEBP). If None, preserves
                      original format.

    Returns:
        Path to processed image. File is saved as:
        {original_basename}_crop_resized_{datetime}.{ext}

    Raises:
        FileNotFoundError: If source_path doesn't exist
        ValueError: If crop_region is invalid, target_size is invalid,
                   or output_dir is not set
        PIL.UnidentifiedImageError: If source is not a valid image
    """
    if not os.path.exists(source_path):
        raise FileNotFoundError(f"Source image not found: {source_path}")

    if not output_dir:
        raise ValueError("output_dir is required for saving processed images")

    target_width, target_height = target_size
    if target_width <= 0 or target_height <= 0:
        raise ValueError(f"Invalid target size: {target_width}x{target_height}")

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

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

        crop_width = right - x
        crop_height = bottom - y

        logger.info(
            f"[image_utils] Cropping and resizing: "
            f"crop ({x}, {y}) to ({right}, {bottom}) [{crop_width}x{crop_height}] -> "
            f"resize to {target_width}x{target_height}"
        )

        # PIL crop uses (left, upper, right, lower) box
        cropped = img.crop((x, y, right, bottom))

        # Resize to target dimensions using high-quality resampling
        resized = cropped.resize(
            (target_width, target_height),
            Image.Resampling.LANCZOS
        )

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

        # Generate output filename
        source_basename = os.path.splitext(os.path.basename(source_path))[0]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        output_filename = f"{source_basename}_crop_resized_{timestamp}{ext}"
        output_path = os.path.join(output_dir, output_filename)

        # Save with appropriate settings
        save_format_normalized = save_format.upper()
        if save_format_normalized in ("JPEG", "JPG"):
            # Convert RGBA to RGB for JPEG (no alpha support)
            if resized.mode == "RGBA":
                resized = resized.convert("RGB")
            resized.save(output_path, format="JPEG", quality=95)
        elif save_format_normalized == "WEBP":
            resized.save(output_path, format="WEBP", quality=95)
        else:
            resized.save(output_path, format=save_format_normalized)

        logger.info(
            f"[image_utils] Crop+resize saved: {output_path} "
            f"({target_width}x{target_height})"
        )

        return output_path
