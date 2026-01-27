/**
 * ArraySchemaRenderer - Handles array data.
 *
 * - Checks display mode (visible/hidden/passthrough)
 * - Gets layout from render_as (registration-based)
 * - Iterates items, calls SchemaRenderer for each
 * - Layout handles selection internally
 */

import type { SchemaProperty, UxConfig } from "./types";
import { normalizeDisplay } from "./types";
import { getUx } from "./ux-utils";
import { getLayout } from "../layouts";
import { ErrorRenderer } from "../renderers";

// Forward declaration to avoid circular import
// The actual SchemaRenderer will be imported at runtime
import { SchemaRenderer } from "../SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface ArraySchemaRendererProps {
  /** The array data to render */
  data: unknown;
  /** The schema describing how to render */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
}

// =============================================================================
// Component
// =============================================================================

export function ArraySchemaRenderer({
  data,
  schema,
  path,
  ux,
}: ArraySchemaRendererProps) {
  const displayMode = normalizeDisplay(ux.display);

  // Hidden: skip entirely
  if (displayMode === "hidden") {
    return null;
  }

  // Validate data is array
  if (!Array.isArray(data)) {
    return (
      <ErrorRenderer
        fieldKey={path.join(".") || "array"}
        renderAs="type_error"
        value={`Expected array, got ${typeof data}`}
      />
    );
  }

  // Get items schema (default to visible object)
  const itemsSchema = schema.items ?? { type: "object", display: "visible" };
  const itemsUx = getUx(itemsSchema as Record<string, unknown>);

  // Render children
  const children = data.map((item, index) => (
    <SchemaRenderer
      key={index}
      data={item}
      schema={itemsSchema}
      path={[...path, String(index)]}
      ux={itemsUx}
    />
  ));

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
