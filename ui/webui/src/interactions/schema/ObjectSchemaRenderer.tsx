/**
 * ObjectSchemaRenderer - Handles object data.
 *
 * - Checks display mode (visible/hidden/passthrough)
 * - Gets layout from render_as (registration-based)
 * - Iterates properties (including additionalProperties and computed)
 * - Wraps each child with data-* attributes for ALL meta fields
 * - Layout queries attributes and decides placement
 */

import type { SchemaProperty, UxConfig } from "./types";
import { normalizeDisplay } from "./types";
import { getUx } from "./ux-utils";
import { getLayout } from "./layouts";
import { renderTemplate } from "@/lib/template-service";
import { useWorkflowStateContext } from "@/contexts/WorkflowStateContext";
import { ErrorRenderer } from "./renderers";

// Forward declaration to avoid circular import
import { SchemaRenderer } from "./SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface ObjectSchemaRendererProps {
  /** The object data to render */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
}

interface RenderableItem {
  key: string;
  value: unknown;
  schema: SchemaProperty;
  ux: UxConfig;
}

// =============================================================================
// Component
// =============================================================================

export function ObjectSchemaRenderer({
  data,
  schema,
  path,
  ux,
}: ObjectSchemaRendererProps) {
  const { state: workflowState } = useWorkflowStateContext();
  const templateState = (workflowState.state_mapped || {}) as Record<string, unknown>;

  const displayMode = normalizeDisplay(ux.display);

  // Hidden: skip entirely
  if (displayMode === "hidden") {
    return null;
  }

  // Validate data is object
  if (typeof data !== "object" || data === null) {
    return (
      <ErrorRenderer
        fieldKey={path.join(".") || "object"}
        renderAs="type_error"
        value={`Expected object, got ${typeof data}`}
      />
    );
  }

  const dataObj = data as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const additionalProps = schema.additionalProperties;
  const computed = ux.computed ?? {};

  // Collect renderable items
  const items: RenderableItem[] = [];

  // 1. Regular properties
  for (const [key, propSchema] of Object.entries(properties)) {
    const propUx = getUx(propSchema as Record<string, unknown>);
    const propDisplay = normalizeDisplay(propUx.display);
    if (propDisplay !== "hidden" && key in dataObj) {
      items.push({
        key,
        value: dataObj[key],
        schema: propSchema,
        ux: propUx,
      });
    }
  }

  // 2. Additional properties (dynamic keys)
  if (additionalProps && typeof additionalProps === "object") {
    const addSchema = additionalProps as SchemaProperty;
    const addUx = getUx(addSchema as Record<string, unknown>);
    const addDisplay = normalizeDisplay(addUx.display);
    if (addDisplay !== "hidden") {
      for (const key of Object.keys(dataObj)) {
        if (!(key in properties)) {
          items.push({
            key,
            value: dataObj[key],
            schema: addSchema,
            ux: addUx,
          });
        }
      }
    }
  }

  // 3. Computed fields (virtual)
  for (const [key, compSchema] of Object.entries(computed)) {
    const compDisplay = normalizeDisplay(compSchema.display);
    if (compDisplay !== "hidden" && compSchema.display_format) {
      // Render the template to get computed value
      const computedValue = renderTemplate(compSchema.display_format, dataObj, templateState);

      // Convert ComputedField to SchemaProperty for rendering
      const propSchema: SchemaProperty = {
        type: "string",
      };

      // Computed fields already have UX properties at root level
      const compUx: UxConfig = {
        display: compSchema.display,
        display_label: compSchema.display_label,
        display_order: compSchema.display_order,
        render_as: compSchema.render_as,
        nudges: compSchema.nudges,
      };

      items.push({
        key,
        value: computedValue,
        schema: propSchema,
        ux: compUx,
      });
    }
  }

  // Sort by display_order
  items.sort((a, b) => (a.ux.display_order ?? 999) - (b.ux.display_order ?? 999));

  // Render children with ALL meta fields as data-* attributes
  const children = items.map(({ key, value, schema: itemSchema, ux: itemUx }) => {
    const childPath = [...path, key];

    return (
      <div
        key={key}
        data-render-as={itemUx.render_as}
        data-highlight={itemUx.highlight ? "true" : undefined}
        data-highlight-color={itemUx.highlight_color}
        data-display-label={itemUx.display_label}
        data-description={itemSchema.description}
        data-display-order={itemUx.display_order}
        data-selectable={itemUx.selectable ? "true" : undefined}
        data-nudges={itemUx.nudges?.length ? itemUx.nudges.join(",") : undefined}
      >
        <SchemaRenderer
          data={value}
          schema={itemSchema}
          path={childPath}
          ux={itemUx}
        />
      </div>
    );
  });

  // Passthrough: children without layout wrapper
  if (displayMode === "passthrough") {
    return <>{children}</>;
  }

  // Visible: wrap in layout
  const Layout = getLayout(ux.render_as);
  return (
    <Layout schema={schema} path={path} data={data} ux={ux}>
      {children}
    </Layout>
  );
}
