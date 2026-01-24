/**
 * SchemaRenderer - Pure type-based router.
 *
 * Routes to:
 * - Special renderers (before type routing):
 *   - ContentPanelSchemaRenderer for render_as: "content-panel"
 *   - TableSchemaRenderer for render_as: "table"
 * - Type-based routing:
 *   - ArraySchemaRenderer for arrays
 *   - ObjectSchemaRenderer for objects
 *   - TerminalRenderer for primitives
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
import type { SchemaProperty, RenderAs } from "./types";
import { normalizeDisplay } from "./types";
import { getUx } from "./ux-utils";
import { TerminalRenderer } from "./renderers";
import { renderTemplate } from "@/lib/template-service";
import { useWorkflowStateContext } from "@/contexts/WorkflowStateContext";

// Import the type-specific renderers
import { ArraySchemaRenderer } from "./ArraySchemaRenderer";
import { ObjectSchemaRenderer } from "./ObjectSchemaRenderer";

// Import special renderers (handled before type routing)
import { ContentPanelSchemaRenderer } from "./ContentPanelSchemaRenderer";
import { TableSchemaRenderer } from "./TableSchemaRenderer";
import { MediaPanel } from "../media-generation/MediaPanel";
import { TabLayout } from "./TabLayout";
import { TabsLayout } from "./layouts/TabsLayout";
import { InputSchemaComposer } from "./InputSchemaComposer";

// Import layouts to trigger registration
import "./layouts";

// =============================================================================
// Types
// =============================================================================

import type { UxConfig } from "./types";

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
}: SchemaRendererProps) {
  const { state: workflowState } = useWorkflowStateContext();
  const templateState = (workflowState.state_mapped || {}) as Record<string, unknown>;

  // Extract UX config if not provided (supports _ux namespace, _ux.* flat, and legacy root)
  const ux = uxProp ?? getUx(schema as Record<string, unknown>);

  // ==========================================================================
  // 1. Handle null/undefined data
  // ==========================================================================
  if (data == null) {
    return null;
  }

  // ==========================================================================
  // 1.5. Input schema handling - delegate to InputSchemaComposer
  // ==========================================================================
  // When input_schema is present, InputSchemaComposer handles:
  // - Providing InputSchemaContext for value/error management
  // - Rendering InputSchemaRenderer for input fields
  // - Rendering remaining schema (handles compound render_as internally)
  if (ux.input_schema) {
    return (
      <InputSchemaComposer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
      />
    );
  }

  // ==========================================================================
  // 2. Compound render_as parsing (e.g., "tab.media")
  // ==========================================================================
  // Split compound render_as into outer and inner, wrap recursively.
  // This allows "tab.media" to become <TabLayout><MediaPanel /></TabLayout>
  if (ux.render_as && typeof ux.render_as === "string" && ux.render_as.includes(".")) {
    const dotIndex = ux.render_as.indexOf(".");
    const outerRenderAs = ux.render_as.slice(0, dotIndex) as RenderAs;
    const innerRenderAs = ux.render_as.slice(dotIndex + 1) as RenderAs;

    return (
      <SchemaRenderer
        schema={schema}
        data={data}
        path={path}
        ux={{ ...ux, render_as: outerRenderAs }}
      >
        <SchemaRenderer
          schema={schema}
          data={data}
          path={path}
          ux={{ ...ux, render_as: innerRenderAs }}
        />
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

  // media: Dedicated media generation panel with inputs and generation grid
  if (ux.render_as === "media") {
    return (
      <MediaPanel
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
  // 8. Primitive - check display mode and use TerminalRenderer
  // ==========================================================================
  // Input types should always render (they manage their own visibility)
  // Only apply display mode check for non-input primitives
  if (!ux.input_type) {
    const displayMode = normalizeDisplay(ux.display);
    if (displayMode === "hidden") {
      return null;
    }
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
