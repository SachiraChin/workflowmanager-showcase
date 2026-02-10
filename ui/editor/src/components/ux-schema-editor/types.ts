import type { SchemaProperty, DisplayMode } from "@wfm/shared";

/**
 * Simplified data schema node for describing the structure of data.
 * This is the "raw" schema without UX annotations.
 */
export type DataSchemaNode = {
  type: "string" | "number" | "boolean" | "array" | "object";
  properties?: Record<string, DataSchemaNode>;
  items?: DataSchemaNode;
  description?: string;
};

/**
 * UX configuration that can be applied to a schema node.
 * Subset of the full UxConfig focused on display-related settings.
 */
export type NodeUxConfig = {
  render_as?: string;
  display?: DisplayMode | boolean;
  nudges?: string[];
  selectable?: boolean;
  highlight?: boolean;
  display_label?: string;
  display_order?: number;
};

/**
 * Diff status for a node when comparing displaySchema vs dataSchema.
 * - "normal": Field exists in both schemas
 * - "deleted": Field exists in displaySchema but not in dataSchema (stale UX config)
 * - "addable": Field exists in dataSchema but not in displaySchema (new field, needs UX)
 */
export type NodeDiffStatus = "normal" | "deleted" | "addable";

/**
 * Internal tree node structure for the editor.
 * Combines schema structure with UX configuration.
 */
export type ConfiguredNode = {
  id: string;
  name: string;
  path: string[];
  schemaType: string;
  isLeaf: boolean;
  children?: ConfiguredNode[];
  ux: NodeUxConfig;
  /** Diff status when comparing displaySchema vs dataSchema */
  diffStatus: NodeDiffStatus;
};

/**
 * Props for the UxSchemaEditor component.
 * 
 * displaySchema is the PRIMARY source for tree structure.
 * dataSchema is OPTIONAL and used for diff comparison:
 * - Fields in displaySchema but not dataSchema are marked "deleted"
 * - Fields in dataSchema but not displaySchema are marked "addable"
 */
export interface UxSchemaEditorProps {
  /**
   * The display schema with UX annotations (PRIMARY source).
   * This defines the tree structure and UX configuration.
   */
  displaySchema?: SchemaProperty;

  /**
   * Optional data schema for diff comparison.
   * When provided, enables showing "deleted" and "addable" field indicators.
   * When data comes from state references, this will be undefined.
   */
  dataSchema?: DataSchemaNode;

  /**
   * Sample data to preview rendering.
   */
  data: unknown;

  /**
   * Called whenever the display schema changes.
   * Provides live updates for real-time preview.
   */
  onChange?: (displaySchema: SchemaProperty) => void;

  /**
   * Called when the user explicitly saves.
   * Use this for persisting the schema.
   */
  onSave?: (displaySchema: SchemaProperty) => void;

  /**
   * Optional class name for the root container.
   */
  className?: string;
}
