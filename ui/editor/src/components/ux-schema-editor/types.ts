import type { SchemaProperty } from "@wfm/shared";

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
  display?: string;
  nudges?: string[];
  selectable?: boolean;
  highlight?: boolean;
  display_label?: string;
  display_order?: number;
};

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
};

/**
 * Props for the UxSchemaEditor component.
 */
export interface UxSchemaEditorProps {
  /**
   * The data schema describing the structure of the data.
   * This is the "raw" schema without UX annotations.
   */
  dataSchema: DataSchemaNode;

  /**
   * Sample data to preview rendering.
   */
  data: unknown;

  /**
   * Optional display schema with existing UX annotations.
   * When provided, the editor will be pre-populated with these settings.
   */
  displaySchema?: SchemaProperty;

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
