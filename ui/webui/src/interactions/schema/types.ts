/**
 * TypeScript interfaces for schema-based rendering.
 *
 * Schema-driven architecture:
 * - render_as: Explicit rendering type (text, color, url, datetime, number, image)
 *              or container type (table, grid, list)
 *              or role type (column, row, cell)
 * - nudges: UI enhancements (copy, swatch, external-link, preview, download)
 * - computed: Virtual fields with display_format templates
 * - display_order: Sort position for fields
 */

// =============================================================================
// Render Type Categories
// =============================================================================

/** Container types - control layout of children (via layout registry) */
export type ContainerType = "grid" | "list" | "section-list" | "card-stack" | "tabs";

/** Role types - metadata for parent container */
export type RoleType = "column" | "row" | "cell" | "section-header" | "section-title" | "section-badge" | "section-summary" | "card-title" | "card-subtitle" | "tab";

/** Terminal types - leaf value rendering */
export type TerminalType = "text" | "color" | "url" | "datetime" | "number" | "image";

/** Layout types - single-use layout wrappers (not containers with nested children) */
export type LayoutType = "card" | "section";

/**
 * Special renderer types - handled at SchemaRenderer level BEFORE type routing.
 * These need direct data/schema access for coordinated rendering.
 * - content-panel: Header from display_label, body via SchemaRenderer
 * - table: Coordinated table rendering with column discovery from schema
 * - media: Dedicated media generation panel
 */
export type SpecialRendererType = "content-panel" | "table" | "media";

// =============================================================================
// Display Mode
// =============================================================================

/**
 * Display mode for schema nodes.
 * - "visible": Render this node (MUST appear in output)
 * - "hidden": Skip this node entirely (default)
 * - "passthrough": Don't render self, but render children
 */
export type DisplayMode = "visible" | "hidden" | "passthrough";

/**
 * Normalize display value to DisplayMode.
 * Handles backwards compatibility with boolean values.
 *
 * @param display - The display value from schema (boolean or DisplayMode)
 * @returns Normalized DisplayMode
 */
export function normalizeDisplay(display: DisplayMode | boolean | undefined): DisplayMode {
  if (display === true || display === "visible") return "visible";
  if (display === "passthrough") return "passthrough";
  return "hidden"; // false, undefined, or "hidden"
}

/** All render_as values */
export type RenderAs = ContainerType | RoleType | TerminalType | LayoutType | SpecialRendererType;

/** Array of container types for runtime checking */
export const CONTAINER_TYPES: ContainerType[] = ["grid", "list", "section-list", "card-stack", "tabs"];

/** Array of role types for runtime checking */
export const ROLE_TYPES: RoleType[] = ["column", "row", "cell", "section-header", "section-title", "section-badge", "section-summary", "card-title", "card-subtitle", "tab"];

/** Array of special renderer types for runtime checking */
export const SPECIAL_RENDERER_TYPES: SpecialRendererType[] = ["content-panel", "table", "media"];

/** Check if a render_as value is a special renderer type */
export function isSpecialRendererType(value: string | undefined): value is SpecialRendererType {
  return SPECIAL_RENDERER_TYPES.includes(value as SpecialRendererType);
}

/** Check if a render_as value is a container type */
export function isContainerType(value: string | undefined): value is ContainerType {
  return CONTAINER_TYPES.includes(value as ContainerType);
}

/** Check if a render_as value is a role type */
export function isRoleType(value: string | undefined): value is RoleType {
  return ROLE_TYPES.includes(value as RoleType);
}

/** UI enhancement nudges applied to rendered values */
export type Nudge = "copy" | "swatch" | "external-link" | "preview" | "download" | "index-badge";

/**
 * Computed field definition - virtual fields derived from other properties.
 * Lives in schema.computed alongside schema.properties.
 */
export interface ComputedField {
  /** Display mode: "visible", "hidden", "passthrough", or boolean for backwards compat */
  display?: DisplayMode | boolean;
  /** Sort position (works across properties + computed) */
  display_order?: number;
  /** Human-readable label */
  display_label?: string;
  /** Jinja2 template - REQUIRED for computed fields */
  display_format: string;
  /** How to render the computed value */
  render_as?: RenderAs;
  /** UI enhancements to apply */
  nudges?: Nudge[];
}

/**
 * UX configuration for schema rendering.
 * Groups all rendering/display properties separate from JSON Schema validation.
 *
 * Can be accessed via:
 * - schema._ux.display (object namespace)
 * - schema["_ux.display"] (flat notation)
 * - schema.display (legacy root-level)
 *
 * Use getUx(schema) to normalize access across all formats.
 */
export interface UxConfig {
  display?: DisplayMode | boolean;
  display_label?: string;
  display_format?: string;
  display_order?: number;
  display_mode?: string;
  render_as?: RenderAs;
  nudges?: Nudge[];
  computed?: Record<string, ComputedField>;
  highlight?: boolean;
  highlight_color?: string;
  selectable?: boolean;

  // Input schema for editable fields
  input_schema?: InputSchemaConfig;
  input_type?: InputType;
  form_type?: string;
  enum_labels?: Record<string, string>;
  source_field?: string;  // Field name in data to get initial value from
  source_data?: string;   // Template string with {field} placeholders

  // Layout configuration (for input_schema container)
  layout?: LayoutMode;
  layout_columns?: number;
  layout_columns_sm?: number;
  layout_gap?: number;

  // Item layout (for individual input fields)
  col_span?: number | "full";
  row_span?: number;
  order?: number;

  // Validation hints
  required?: boolean;
  minimum?: number;
  maximum?: number;

  // Media generation metadata
  provider?: string;
  prompt_id?: string;

  // Tab metadata
  tab_label?: string;
  tab_label_field?: string;
}

// =============================================================================
// Input Schema Types
// =============================================================================

/** Layout mode for input schema container */
export type LayoutMode = "grid" | "flex" | "stack";

/** Input type for editable fields */
export type InputType = "textarea" | "select" | "slider" | "checkbox" | "text" | "number";

/** Config for a controlled field - used by select and other input components */
export interface ControlConfig {
  /** Type of control - "enum" sets options, "value" sets value directly */
  type: "enum" | "value";
  /** Path to extract options from in the selected object (e.g., "params.sampler_combo") - for type="enum" */
  enum_path?: string;
  /** Path to extract value from in the selected object (e.g., ".value") - for type="value" */
  value_path?: string;
  /** Key in each option object to use as value */
  value_key?: string;
  /** Key in each option object to use as label (simple case) */
  label_key?: string;
  /** Format string for label using {field} placeholders (complex case) */
  label_format?: string;
  /** Index of option to auto-select (default: 0, use -1 for no auto-select) */
  default_index?: number;
  /** Reset field value when parent changes (default: false) */
  reset?: boolean;
}

/** Input schema configuration - object schema with properties for input fields */
export interface InputSchemaConfig {
  type: "object";
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  _ux?: {
    layout?: LayoutMode;
    layout_columns?: number;
    layout_columns_sm?: number;
    layout_gap?: number;
  };
}

// =============================================================================
// Alternative Input Types
// =============================================================================

/**
 * Alternative field definition - an input field within an alternative config.
 *
 * Fields with `key` are inputs that read/write to the stored value object.
 * Fields without `key` (but with `content`) are static display elements.
 */
export interface AlternativeField {
  /** Path into stored value object (e.g., "width" → value.width). Required for inputs. */
  key?: string;
  /** Static text to display (for non-input elements) */
  content?: string;
  /** Field type: integer, number, string */
  type?: "integer" | "number" | "string";
  /** Label for the input */
  title?: string;
  /** Default value when no prior value exists */
  default?: unknown;
  /** Minimum value constraint for numbers */
  minimum?: number;
  /** Maximum value constraint for numbers */
  maximum?: number;
  /** Step increment for numbers */
  step?: number;
  /** UX config for rendering */
  _ux?: {
    input_type?: InputType;
    render_as?: string;
  };
}

/**
 * Alternative input configuration - allows a field to have multiple input modes.
 *
 * Example: A resolution dropdown can have an alternative mode with separate
 * width/height number inputs.
 */
export interface AlternativeConfig {
  /**
   * Compose template - map of field paths to template strings.
   * Templates use {key} syntax to reference alternative field values.
   * Example: { "text": "{width}x{height}" }
   */
  compose: Record<string, string>;
  /** Layout mode: "inline" (horizontal) or "stack" (vertical). Default: "inline" */
  layout?: "inline" | "stack";
  /** Ordered list of alternative field definitions */
  fields: AlternativeField[];
}

/**
 * JSON Schema property definition with display hints.
 * Used throughout the schema rendering system.
 *
 * Supports three UX property formats:
 * 1. _ux object: { "_ux": { "display": "visible" } }
 * 2. _ux.* flat: { "_ux.display": "visible" }
 * 3. Legacy root: { "display": "visible" } - backwards compat via getUx()
 *
 * Use getUx(schema) from ux-utils.ts to normalize access.
 */
export interface SchemaProperty {
  type?: "string" | "number" | "boolean" | "array" | "object";

  // UX namespace (new format)
  _ux?: UxConfig;

  // JSON Schema properties
  description?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  additionalProperties?: SchemaProperty;
  enum?: string[];

  // Input field destination mapping (for submission)
  destination_field?: string;

  // Index signature for legacy root-level UX + _ux.* flat notation
  [key: string]: unknown;
}

/**
 * Addon data embedded in items by the server.
 * Provides styling hints and usage metadata.
 * Lives in item._metadata.addons (flat merged from all addons).
 */
export interface AddonData {
  color?: string;      // Hex color for styling
  score?: number;      // Compatibility score (0-100)
  last_used?: string;  // ISO timestamp of last usage
}

/**
 * Decorator instruction from server addon.
 * Describes a visual enhancement to apply to an item.
 * Lives in item._metadata.decorators array.
 *
 * Client picks highest priority for single-instance types (border, swatch),
 * renders all badges sorted by priority.
 */
export interface Decorator {
  type: "border" | "swatch" | "badge";
  color?: string;      // Hex color for border/swatch
  text?: string;       // Text for badge
  priority: number;    // Higher wins for border/swatch conflicts
  source: string;      // Addon that produced this decorator
}

/**
 * Item metadata structure injected by server.
 */
export interface ItemMetadata {
  addons: AddonData;
  decorators: Decorator[];
}
