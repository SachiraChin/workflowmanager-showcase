/**
 * useSelectable - Hook for selection state in renderers.
 *
 * Extracts selection logic from SelectableItem so renderers can handle
 * their own selection UI. This allows CardRenderer, SectionRenderer, etc.
 * to integrate selection styling directly without double-wrapping.
 *
 * Usage:
 * ```tsx
 * const selectable = useSelectable(path, data, ux);
 * if (selectable) {
 *   // Render with selection UI
 *   const { selected, disabled, handleClick, decorators } = selectable;
 * }
 * ```
 */

import { useCallback } from "react";
import type { UxConfig } from "../../types/schema";
import { useSelectionOptional } from "./SelectionContext";
import { useRenderContext } from "../../contexts/RenderContext";
import { getDecorators, type DecoratorInfo } from "../../utils/schema-utils";

// =============================================================================
// Types
// =============================================================================

export interface SelectableState {
  /** Whether this item is currently selected */
  selected: boolean;
  /** Whether selection is disabled for this item */
  disabled: boolean;
  /** Whether the interaction is readonly (history view) */
  isReadonly: boolean;
  /** Current selection mode: "select" or "review" */
  mode: "select" | "review";
  /** Display variant: "cards" or "list" */
  variant: "cards" | "list";
  /** Click handler for toggling selection */
  handleClick: () => void;
  /** Decorator info (border color, swatch, badges) */
  decorators: DecoratorInfo;
  /** Display label */
  label?: string;
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook for selection state in renderers.
 *
 * @param path - Path to this item for selection tracking
 * @param data - The item data
 * @param ux - UX config for the item
 * @returns SelectableState if in a selection context and ux.selectable is true, null otherwise
 */
export function useSelectable(
  path: string[],
  data: unknown,
  ux: UxConfig
): SelectableState | null {
  const selection = useSelectionOptional();
  const { readonly: isReadonly } = useRenderContext();

  const handleClick = useCallback(() => {
    if (!selection || !ux.selectable) return;
    if (selection.mode === "review") return;
    if (isReadonly) return;
    if (!selection.canSelect(path) && !selection.isSelected(path)) return;
    selection.toggleSelection(path, data);
  }, [selection, ux.selectable, isReadonly, path, data]);

  // Not in a selection context or not selectable
  if (!selection || !ux.selectable) {
    return null;
  }

  const { variant, isSelected, canSelect, mode } = selection;

  const selected = isSelected(path);
  const canSelectThis = canSelect(path);
  const disabled = isReadonly || (!canSelectThis && !selected);

  // Get decorator info from item data
  const itemData = typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : { value: data };
  const decorators = getDecorators(itemData);

  return {
    selected,
    disabled,
    isReadonly,
    mode,
    variant,
    handleClick,
    decorators,
    label: ux.display_label,
  };
}

/**
 * Check if a UX config indicates selectable.
 * Useful for conditional rendering without calling the full hook.
 */
export function isSelectable(ux: UxConfig): boolean {
  return ux.selectable === true;
}
