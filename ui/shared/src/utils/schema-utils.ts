/**
 * Schema utilities - workflow-agnostic helpers.
 *
 * Only contains utilities that don't access data fields by name
 * (except _metadata/_addon which are server-injected conventions).
 */

import type { AddonData, Decorator, ItemMetadata } from "../types/schema";

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format a schema key as a display label.
 * Converts snake_case to Title Case.
 */
export function formatLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get addon data from an item's _addon field (legacy) or _metadata.addons (new).
 */
export function getItemAddon(
  item: Record<string, unknown>
): AddonData | undefined {
  // Try new structure first
  const metadata = item._metadata as ItemMetadata | undefined;
  if (metadata?.addons) {
    return metadata.addons;
  }
  // Fallback to legacy _addon
  return item._addon as AddonData | undefined;
}

/**
 * Format a timestamp as "X ago" string.
 */
export function formatTimeAgo(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMonths > 0) return `${diffMonths}mo ago`;
    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return "just now";
  } catch {
    return "unknown";
  }
}

// =============================================================================
// Decorator Utilities
// =============================================================================

/**
 * Result from extracting decorators from an item.
 */
export interface DecoratorInfo {
  /** Border color (highest priority border decorator) */
  borderColor?: string;
  /** Swatch color (highest priority swatch decorator) */
  swatchColor?: string;
  /** All badge decorators, sorted by priority (highest first) */
  badges: Array<{ text: string; color?: string; source: string }>;
  /** Addon data (score, last_used, etc.) */
  addon?: AddonData;
}

/**
 * Extract decorator info from an item.
 * Picks highest priority for border/swatch, returns all badges.
 */
export function getDecorators(item: Record<string, unknown>): DecoratorInfo {
  const metadata = item._metadata as ItemMetadata | undefined;
  const decorators = metadata?.decorators || [];
  const addon = getItemAddon(item);

  // Find highest priority border
  const borders = decorators.filter((d): d is Decorator & { color: string } =>
    d.type === "border" && !!d.color
  );
  const borderDecorator = borders.length > 0
    ? borders.reduce((best, curr) => curr.priority > best.priority ? curr : best)
    : undefined;

  // Find highest priority swatch
  const swatches = decorators.filter((d): d is Decorator & { color: string } =>
    d.type === "swatch" && !!d.color
  );
  const swatchDecorator = swatches.length > 0
    ? swatches.reduce((best, curr) => curr.priority > best.priority ? curr : best)
    : undefined;

  // Get all badges, sorted by priority (highest first)
  const badges = decorators
    .filter((d): d is Decorator & { text: string } => d.type === "badge" && !!d.text)
    .sort((a, b) => b.priority - a.priority)
    .map(d => ({ text: d.text, color: d.color, source: d.source }));

  return {
    borderColor: borderDecorator?.color,
    swatchColor: swatchDecorator?.color,
    badges,
    addon,
  };
}

// Re-export types
export type { AddonData, Decorator, ItemMetadata } from "../types/schema";
