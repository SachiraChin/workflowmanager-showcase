/**
 * Utilities for interaction display - colors, highlighting, time formatting.
 */

// =============================================================================
// Types
// =============================================================================

export interface HighlightConfig {
  highlight?: boolean;
  highlight_color?: string;
}

// =============================================================================
// Time Formatting
// =============================================================================

/**
 * Convert ISO timestamp to human-readable "X ago" format.
 */
export function formatTimeAgo(timestampStr: string): string {
  try {
    const timestamp = new Date(timestampStr);
    const now = new Date();
    const deltaMs = now.getTime() - timestamp.getTime();
    const deltaSecs = Math.floor(deltaMs / 1000);

    if (deltaSecs < 60) {
      return "just now";
    }

    const deltaMins = Math.floor(deltaSecs / 60);
    if (deltaMins < 60) {
      return `${deltaMins}m ago`;
    }

    const deltaHours = Math.floor(deltaMins / 60);
    if (deltaHours < 24) {
      return `${deltaHours}h ago`;
    }

    const deltaDays = Math.floor(deltaHours / 24);
    if (deltaDays < 30) {
      return `${deltaDays}d ago`;
    }

    const deltaMonths = Math.floor(deltaDays / 30);
    return `${deltaMonths}mo ago`;
  } catch {
    return "unknown";
  }
}

/**
 * Get time-based color (legacy mechanism).
 * Returns Tailwind color class based on recency.
 */
export function getTimeBasedColor(timestampStr: string): string {
  if (!timestampStr) return "";

  try {
    const timestamp = new Date(timestampStr);
    const now = new Date();
    const deltaMs = now.getTime() - timestamp.getTime();
    const hours = deltaMs / (1000 * 60 * 60);

    if (hours < 24) return "text-fuchsia-500";
    if (hours < 72) return "text-yellow-500";
    if (hours < 120) return "text-green-500";
    return "text-emerald-500";
  } catch {
    return "";
  }
}

// =============================================================================
// Color Utilities
// =============================================================================

/**
 * Check if a string is a valid HEX color.
 */
export function isValidHexColor(color: string): boolean {
  return /^#?[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Normalize HEX color (ensure # prefix).
 */
export function normalizeHexColor(color: string): string {
  if (!color) return "";
  return color.startsWith("#") ? color : `#${color}`;
}

/**
 * Create inline style for HEX color.
 */
export function hexToStyle(hexColor: string | null | undefined): React.CSSProperties {
  if (!hexColor || !isValidHexColor(hexColor)) {
    return {};
  }
  return { color: normalizeHexColor(hexColor) };
}

/**
 * Create background style for color swatch.
 */
export function hexToSwatchStyle(hexColor: string | null | undefined): React.CSSProperties {
  if (!hexColor || !isValidHexColor(hexColor)) {
    return { backgroundColor: "transparent" };
  }
  return { backgroundColor: normalizeHexColor(hexColor) };
}

// =============================================================================
// Highlight Utilities
// =============================================================================

/**
 * Get highlight classes based on schema config.
 */
export function getHighlightClasses(config: HighlightConfig): string {
  if (!config.highlight) return "";

  if (config.highlight_color) {
    // Custom color - will use inline style instead
    return "font-semibold";
  }

  // Default highlight
  return "text-cyan-500 font-semibold";
}

/**
 * Get highlight style for custom color.
 */
export function getHighlightStyle(config: HighlightConfig): React.CSSProperties {
  if (!config.highlight || !config.highlight_color) {
    return {};
  }
  return hexToStyle(config.highlight_color);
}

// =============================================================================
// Selection Parsing
// =============================================================================

/**
 * Parse multi-select input string to array of indices.
 * Supports: "1", "1 3 5", "1,3,5", "1-3"
 */
export function parseSelectionInput(
  input: string,
  maxIndex: number
): number[] {
  const result: number[] = [];
  const parts = input.trim().split(/[\s,]+/);

  for (const part of parts) {
    if (!part) continue;

    // Check for range (e.g., "1-3")
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10) - 1; // Convert to 0-based
      const end = parseInt(rangeMatch[2], 10) - 1;
      for (let i = start; i <= end && i < maxIndex; i++) {
        if (i >= 0 && !result.includes(i)) {
          result.push(i);
        }
      }
      continue;
    }

    // Single number
    const num = parseInt(part, 10);
    if (!isNaN(num)) {
      const index = num - 1; // Convert to 0-based
      if (index >= 0 && index < maxIndex && !result.includes(index)) {
        result.push(index);
      }
    }
  }

  return result.sort((a, b) => a - b);
}
