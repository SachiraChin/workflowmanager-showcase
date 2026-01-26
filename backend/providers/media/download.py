"""
Media Download Utility - Download and store generated media files locally.

Handles downloading images/videos from provider URLs and storing them
in the configured local storage directories.

Supports:
- HTTP/HTTPS URLs (standard download)
- Data URIs with base64 encoding (for providers like OpenAI that return base64)
"""

import os
import re
import base64
import logging
import requests
from typing import Optional
from dataclasses import dataclass
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Content-Type to extension mapping
CONTENT_TYPE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
}

# URL extension to normalize
URL_EXTENSIONS = {
    ".png": "png",
    ".jpg": "jpg",
    ".jpeg": "jpg",
    ".webp": "webp",
    ".gif": "gif",
    ".mp4": "mp4",
    ".webm": "webm",
    ".mov": "mov",
}


@dataclass
class DownloadResult:
    """Result of a media download operation."""
    local_path: str
    extension: str


class DownloadError(Exception):
    """Error during media download."""
    pass


def get_extension_from_content_type(content_type: str) -> Optional[str]:
    """
    Get file extension from Content-Type header.

    Args:
        content_type: Content-Type header value (e.g., "image/png; charset=utf-8")

    Returns:
        File extension without dot (e.g., "png") or None if unknown
    """
    # Remove charset and other parameters
    mime_type = content_type.split(";")[0].strip().lower()
    return CONTENT_TYPE_EXTENSIONS.get(mime_type)


def get_extension_from_url(url: str) -> Optional[str]:
    """
    Get file extension from URL path.

    Args:
        url: Full URL to the file

    Returns:
        File extension without dot (e.g., "png") or None if not found
    """
    parsed = urlparse(url)
    path = parsed.path.lower()

    for ext, normalized in URL_EXTENSIONS.items():
        if path.endswith(ext):
            return normalized

    return None


def _get_storage_path(
    content_type: str,
    images_path: Optional[str],
    videos_path: Optional[str],
) -> str:
    """
    Get storage path based on content type.

    Args:
        content_type: Type of content ("image" or "video")
        images_path: Absolute path to images storage directory
        videos_path: Absolute path to videos storage directory

    Returns:
        Storage path string

    Raises:
        DownloadError: If storage path not configured
    """
    if content_type == "image":
        if not images_path:
            raise DownloadError("MEDIA_IMAGES_PATH not configured")
        return images_path
    elif content_type == "video":
        if not videos_path:
            raise DownloadError("MEDIA_VIDEOS_PATH not configured")
        return videos_path
    else:
        raise DownloadError(f"Unknown content type: {content_type}")


def _download_from_url(
    url: str,
    metadata_id: str,
    content_id: str,
    index: int,
    content_type: str,
    images_path: Optional[str],
    videos_path: Optional[str],
) -> DownloadResult:
    """
    Download media from HTTP/HTTPS URL and save to local storage.

    Args:
        url: HTTP/HTTPS URL to download from
        metadata_id: Content generation metadata ID (for filename)
        content_id: Generated content ID (for filename)
        index: Index within the generation batch (for filename)
        content_type: Type of content ("image" or "video")
        images_path: Absolute path to images storage directory
        videos_path: Absolute path to videos storage directory

    Returns:
        DownloadResult with local_path and extension

    Raises:
        DownloadError: If download fails or storage path not configured
    """
    storage_path = _get_storage_path(content_type, images_path, videos_path)
    os.makedirs(storage_path, exist_ok=True)

    # Download the file
    logger.info(f"[MediaDownload] Downloading {content_type} from {url[:100]}...")

    try:
        response = requests.get(url, timeout=60, stream=True)
        response.raise_for_status()
    except requests.RequestException as e:
        raise DownloadError(f"Failed to download: {e}")

    # Determine file extension
    # Priority: Content-Type header, then URL extension
    extension = None

    content_type_header = response.headers.get("Content-Type", "")
    if content_type_header:
        extension = get_extension_from_content_type(content_type_header)

    if not extension:
        extension = get_extension_from_url(url)

    if not extension:
        # Default based on content type
        extension = "mp4" if content_type == "video" else "png"
        logger.warning(
            f"[MediaDownload] Could not determine extension, defaulting to {extension}"
        )

    # Build filename: {metadata_id}_{content_id}_{index}.{extension}
    filename = f"{metadata_id}_{content_id}_{index}.{extension}"
    local_path = os.path.join(storage_path, filename)

    # Save file
    try:
        with open(local_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
    except IOError as e:
        raise DownloadError(f"Failed to save file: {e}")

    logger.info(f"[MediaDownload] Saved to {local_path}")

    return DownloadResult(local_path=local_path, extension=extension)


def _download_from_base64(
    data_uri: str,
    metadata_id: str,
    content_id: str,
    index: int,
    content_type: str,
    images_path: Optional[str],
    videos_path: Optional[str],
) -> DownloadResult:
    """
    Save media from a base64-encoded data URI to local storage.

    Args:
        data_uri: Data URI in format "data:{mime};base64,{encoded_data}"
        metadata_id: Content generation metadata ID (for filename)
        content_id: Generated content ID (for filename)
        index: Index within the generation batch (for filename)
        content_type: Type of content ("image" or "video")
        images_path: Absolute path to images storage directory
        videos_path: Absolute path to videos storage directory

    Returns:
        DownloadResult with local_path and extension

    Raises:
        DownloadError: If decoding fails or storage path not configured
    """
    storage_path = _get_storage_path(content_type, images_path, videos_path)
    os.makedirs(storage_path, exist_ok=True)

    logger.info(f"[MediaDownload] Decoding base64 {content_type}...")

    # Parse data URI: data:image/png;base64,{data}
    if "," not in data_uri:
        raise DownloadError("Invalid data URI format: missing comma separator")

    header, encoded = data_uri.split(",", 1)

    # Extract mime type from header (e.g., "data:image/png;base64")
    mime_match = re.match(r"data:([^;,]+)", header)
    mime_type = mime_match.group(1) if mime_match else None

    # Get extension from mime type
    extension = None
    if mime_type:
        extension = get_extension_from_content_type(mime_type)

    if not extension:
        # Default based on content type
        extension = "mp4" if content_type == "video" else "png"
        logger.warning(
            f"[MediaDownload] Could not determine extension from data URI, "
            f"defaulting to {extension}"
        )

    # Decode base64
    try:
        file_data = base64.b64decode(encoded)
    except Exception as e:
        raise DownloadError(f"Failed to decode base64: {e}")

    # Build filename: {metadata_id}_{content_id}_{index}.{extension}
    filename = f"{metadata_id}_{content_id}_{index}.{extension}"
    local_path = os.path.join(storage_path, filename)

    # Save file
    try:
        with open(local_path, "wb") as f:
            f.write(file_data)
    except IOError as e:
        raise DownloadError(f"Failed to save file: {e}")

    logger.info(f"[MediaDownload] Saved base64 to {local_path}")

    return DownloadResult(local_path=local_path, extension=extension)


def download_media(
    url: str,
    metadata_id: str,
    content_id: str,
    index: int,
    content_type: str,
    images_path: Optional[str],
    videos_path: Optional[str],
) -> DownloadResult:
    """
    Download media from URL or data URI and save to local storage.

    Supports:
    - HTTP/HTTPS URLs (standard download from providers like Leonardo, MidAPI)
    - Data URIs with base64 encoding (for providers like OpenAI)

    Args:
        url: Provider URL or data URI to download from
        metadata_id: Content generation metadata ID (for filename)
        content_id: Generated content ID (for filename)
        index: Index within the generation batch (for filename)
        content_type: Type of content ("image" or "video")
        images_path: Absolute path to images storage directory
        videos_path: Absolute path to videos storage directory

    Returns:
        DownloadResult with local_path and extension

    Raises:
        DownloadError: If download/decode fails or storage path not configured
    """
    if url.startswith("data:"):
        return _download_from_base64(
            url, metadata_id, content_id, index,
            content_type, images_path, videos_path
        )
    else:
        return _download_from_url(
            url, metadata_id, content_id, index,
            content_type, images_path, videos_path
        )
