/**
 * Schema Interaction Module
 *
 * Unified schema-driven rendering for both select and review modes.
 * Replaces the old StructuredSelect and ReviewGrouped implementations.
 */

// Types
export type { SchemaProperty, AddonData, RenderAs, Nudge, ComputedField, DisplayMode, SpecialRendererType, UxConfig } from "./types";
export { normalizeDisplay, isSpecialRendererType, SPECIAL_RENDERER_TYPES } from "./types";

// UX utilities
export { getUx, hasUx } from "./ux-utils";

// Input schema context
export {
  useInputSchema,
  useInputSchemaOptional,
  pathToKey,
  type InputSchemaContextValue,
  type InputSchema,
  type DynamicOption,
} from "./InputSchemaContext";

// Utilities
export { getItemAddon, formatTimeAgo, formatLabel } from "./schema-utils";

// Main host component
export {
  SchemaInteractionHost,
  type SchemaInteractionResult,
  type SchemaInteractionState,
} from "./SchemaInteractionHost";

// Context
export {
  SelectionProvider,
  useSelection,
  useSelectionOptional,
  type InteractionMode,
  type VariantStyle,
  type SelectionContextValue,
} from "./SelectionContext";

// Schema rendering
export { SchemaRenderer } from "../SchemaRenderer";
export { useSelectable, isSelectable, type SelectableState } from "./useSelectable";

// Terminal renderers
export { TerminalRenderer, ErrorRenderer, ColorSwatch } from "../renderers";

// Controlled variants for InteractionHost lazy loading
export const schemaInteractionControlledVariants = {
  cards: {
    Component: async () => {
      const { SchemaInteractionHost } = await import("./SchemaInteractionHost");
      return { default: SchemaInteractionHost };
    },
    defaultProps: { variant: "cards" as const },
  },
  list: {
    Component: async () => {
      const { SchemaInteractionHost } = await import("./SchemaInteractionHost");
      return { default: SchemaInteractionHost };
    },
    defaultProps: { variant: "list" as const },
  },
};
