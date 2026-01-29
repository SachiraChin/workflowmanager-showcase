/**
 * SchemaRenderer - Pure type-based router.
 *
 * Routes to:
 * - Special renderers (before type routing):
 *   - ContentPanelSchemaRenderer for render_as: "content-panel"
 *   - TableSchemaRenderer for render_as: "table"
 * - Input routing (when input_type present):
 *   - InputRenderer for editable inputs (select, textarea, slider, number, text)
 * - Type-based routing:
 *   - ArraySchemaRenderer for arrays
 *   - ObjectSchemaRenderer for objects
 *   - TerminalRenderer for display primitives
 *
 * This is the new simplified architecture (R5) that:
 * - Has no strictMode
 * - Has no innerData extraction (delegated to Array/ObjectSchemaRenderer)
 * - Has no Field pattern
 * - Uses explicit display modes: visible, hidden, passthrough
 *
 * Special Renderer Convention:
 * - Some render_as values need direct data/schema access for coordinated rendering
 * - These are handled specially at this level BEFORE type routing
 * - Currently: content-panel, table
 */

import type { ReactNode } from "react";
import type { SchemaProperty, RenderAs } from "./schema/types";
import { normalizeDisplay } from "./schema/types";
import { getUx } from "./schema/ux-utils";
import { TerminalRenderer } from "./renderers";
import { InputRenderer } from "./InputRenderer";
import { renderTemplate } from "@/lib/template-service";
import { useWorkflowStateContext } from "@/state/WorkflowStateContext";

// Import the type-specific renderers
import { ArraySchemaRenderer } from "./schema/ArraySchemaRenderer";
import { ObjectSchemaRenderer } from "./schema/ObjectSchemaRenderer";

// Import special renderers (handled before type routing)
import { ContentPanelSchemaRenderer } from "./schema/ContentPanelSchemaRenderer";
import { TableSchemaRenderer } from "./schema/TableSchemaRenderer";
import { Media, ImageGeneration, VideoGeneration } from "./types/media-generation";
import { TabLayout } from "./schema/tabs/TabLayout";
import { TabsLayout } from "./layouts/TabsLayout";
import { InputSchemaComposer } from "./schema/input/InputSchemaComposer";

// Import layouts to trigger registration
import "./layouts";

// =============================================================================
// Types
// =============================================================================

import type { UxConfig } from "./schema/types";

interface SchemaRendererProps {
  /** The data to render */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree (for selection tracking) */
  path?: string[];
  /** Pre-extracted UX config (optional - will be extracted if not provided) */
  ux?: UxConfig;
  /** Children from compound render_as parsing (e.g., tab.media passes inner renderer) */
  children?: ReactNode;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function SchemaRenderer({
  data,
  schema,
  path = [],
  ux: uxProp,
  children,
  disabled = false,
  readonly = false,
}: SchemaRendererProps) {
  const { state: workflowState } = useWorkflowStateContext();
  const templateState = (workflowState.state_mapped || {}) as Record<string, unknown>;

  // Extract UX config if not provided (supports _ux namespace, _ux.* flat, and legacy root)
  const ux = uxProp ?? getUx(schema as Record<string, unknown>);

  // ==========================================================================
  // 1. Handle null/undefined data
  // ==========================================================================
  // Input types can render without data (they manage values via context)
  if (data == null && !ux.input_type) {
    return null;
  }

  // ==========================================================================
  // 2. Compound render_as parsing (e.g., "tab.media" or "tab.media[...]")
  // ==========================================================================
  // Step 1: Handle dots - split hierarchy using reduceRight.
  // Each part may have brackets which are handled when that part renders.
  // This allows "tab.media[input_schema,image_generation]" to become:
  // <TabLayout><SchemaRenderer render_as="media[input_schema,image_generation]"/></TabLayout>
  if (ux.render_as && typeof ux.render_as === "string" && ux.render_as.includes(".")) {
    const parts = ux.render_as.split(".");

    // reduceRight: innermost part renders first, each outer part wraps it
    return parts.reduceRight<ReactNode>(
      (innerChildren, part) => (
        <SchemaRenderer
          schema={schema}
          data={data}
          path={path}
          ux={{ ...ux, render_as: part as RenderAs, }}
        >
          {innerChildren}
        </SchemaRenderer>
      ),
      null // Initial value: innermost part has no children
    );
  }

  // ==========================================================================
  // 2.5. Bracket syntax parsing (e.g., "media[input_schema,image_generation]")
  // ==========================================================================
  // Step 2: Handle brackets per-node - extract siblings and render inside cleaned node.
  // If "input_schema" is a sibling, wrap other siblings in InputSchemaComposer.
  if (ux.render_as && typeof ux.render_as === "string" && ux.render_as.includes("[")) {
    const bracketStart = ux.render_as.indexOf("[");
    const bracketEnd = ux.render_as.indexOf("]");

    const cleanedNode = ux.render_as.slice(0, bracketStart) as RenderAs; // "media"
    const siblings = ux.render_as
      .slice(bracketStart + 1, bracketEnd)
      .split(",")
      .map((s) => s.trim()); // ["input_schema", "image_generation"]

    // Build sibling elements (excluding input_schema which is handled specially)
    const otherSiblings = siblings
      .filter((sib) => sib !== "input_schema")
      .map((sib) => (
        <SchemaRenderer
          key={sib}
          data={data}
          schema={schema}
          path={path}
          ux={{ ...ux, render_as: sib as RenderAs, input_schema: undefined }}
        />
      ));

    // If input_schema is a sibling, wrap others in InputSchemaComposer
    if (siblings.includes("input_schema")) {
      return (
        <SchemaRenderer
          data={data}
          schema={schema}
          path={path}
          ux={{ ...ux, render_as: cleanedNode, input_schema: undefined }}
        >
          <InputSchemaComposer
            ux={ux}
            data={data as Record<string, unknown>}
            schema={schema}
            path={path}
            disabled={disabled}
            readonly={readonly}
          >
            {otherSiblings}
          </InputSchemaComposer>
        </SchemaRenderer>
      );
    }

    // No input_schema - just render siblings inside cleaned node
    return (
      <SchemaRenderer
        data={data}
        schema={schema}
        path={path}
        ux={{ ...ux, render_as: cleanedNode }}
      >
        {otherSiblings}
      </SchemaRenderer>
    );
  }

  // ==========================================================================
  // 3. Tab role - wraps content and registers with parent TabsLayout
  // ==========================================================================
  if (ux.render_as === "tab") {
    return (
      <TabLayout schema={schema} data={data} path={path} ux={ux}>
        {children}
      </TabLayout>
    );
  }

  // ==========================================================================
  // 4. Tabs container - provides context for tab children
  // ==========================================================================
  if (ux.render_as === "tabs") {
    return (
      <TabsLayout schema={schema} data={data} path={path} ux={ux}>
        {children}
      </TabsLayout>
    );
  }

  // ==========================================================================
  // 5. Special renderers (before type routing)
  // ==========================================================================
  // Some render_as values need direct data/schema access for coordinated rendering.
  // These are handled specially BEFORE type routing.

  // content-panel: Header from display_label, body via SchemaRenderer
  if (ux.render_as === "content-panel") {
    return (
      <ContentPanelSchemaRenderer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  // media: Card chrome wrapper for media generation (children from bracket syntax)
  if (ux.render_as === "media") {
    return (
      <Media
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      >
        {children}
      </Media>
    );
  }

  // image_generation: Self-contained image generation component
  if (ux.render_as === "image_generation") {
    return (
      <ImageGeneration
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  // video_generation: Self-contained video generation component with crop
  if (ux.render_as === "video_generation") {
    return (
      <VideoGeneration
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  // table: Coordinated table rendering with column discovery
  if (ux.render_as === "table") {
    return (
      <TableSchemaRenderer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  // ==========================================================================
  // 6. Handle display_format (without render_as) - collapses content via template
  // ==========================================================================
  // This applies to ANY type (array, object, primitive) - the template collapses
  // the underlying content into a single rendered string.
  if (ux.display_format && !ux.render_as) {
    const formatted = renderTemplate(ux.display_format, data, templateState);
    return (
      <TerminalRenderer
        fieldKey={path.join(".") || "value"}
        value={formatted}
        path={path}
        data={data}
        schema={schema}
        ux={ux}
      />
    );
  }

  // ==========================================================================
  // 7. Route by schema type
  // ==========================================================================
  if (schema.type === "array") {
    return (
      <ArraySchemaRenderer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  if (schema.type === "object") {
    return (
      <ObjectSchemaRenderer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  // ==========================================================================
  // 8. Input types - route to InputRenderer
  // ==========================================================================
  // Input types manage their own state via context and can render without data.
  // They are handled separately from display types.
  if (ux.input_type) {
    return (
      <InputRenderer
        value={data}
        path={path}
        schema={schema}
        ux={ux}
      />
    );
  }

  // ==========================================================================
  // 2.6. Input schema handling (after compound parsing)
  // ==========================================================================
  // When input_schema is present without bracket syntax, delegate to InputSchemaComposer.
  // Note: If render_as had brackets with input_schema (e.g., "media[input_schema,...]"),
  // that was already handled in section 2.5 above.
  if (ux.input_schema) {
    return (
      <InputSchemaComposer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
        disabled={disabled}
        readonly={readonly}
      />
    );
  }

  // ==========================================================================
  // 9. Display primitives - check display mode and use TerminalRenderer
  // ==========================================================================
  const displayMode = normalizeDisplay(ux.display);
  if (displayMode === "hidden") {
    return null;
  }

  return (
    <TerminalRenderer
      fieldKey={path.join(".") || "value"}
      value={data}
      path={path}
      data={data}
      schema={schema}
      ux={ux}
    />
  );
}
