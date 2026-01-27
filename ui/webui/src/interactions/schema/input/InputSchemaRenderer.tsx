/**
 * InputSchemaRenderer - Renders input fields with schema-driven layout.
 *
 * This component:
 * - Iterates over input_schema.properties
 * - Applies layout configuration (grid/flex/stack)
 * - Renders each field via SchemaRenderer (which routes to TerminalRenderer → input renderers)
 * - Passes initial values from data to each field
 *
 * Layout is controlled via _ux on the input_schema:
 * - layout: "grid" | "flex" | "stack" (default: "grid")
 * - layout_columns: number (default: 3)
 * - layout_columns_sm: number (default: 2)
 * - layout_gap: number (default: 4)
 *
 * Individual fields can specify:
 * - col_span: number | "full" (default: 1)
 */

import type { InputSchema } from "./InputSchemaContext";
import { getUx } from "../ux-utils";

// Forward declaration to avoid circular import
// The actual SchemaRenderer will be imported at runtime
import { SchemaRenderer } from "../../SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface InputSchemaRendererProps {
  /** The input schema defining the fields */
  schema: InputSchema;
  /** Data object for initial values (1:1 map with schema.properties) */
  data: Record<string, unknown>;
  /** Path for tracking in the component tree */
  path: string[];
}

// =============================================================================
// Component
// =============================================================================

export function InputSchemaRenderer({ schema, data, path }: InputSchemaRendererProps) {
  const properties = schema.properties || {};
  const ux = schema._ux || {};

  // Layout configuration with defaults
  const layout = ux.layout || "grid";
  const columns = ux.layout_columns || 3;
  const columnsSm = ux.layout_columns_sm || 2;
  const gap = ux.layout_gap || 4;

  // Build layout classes based on mode
  // Note: Using inline styles for dynamic values since Tailwind can't handle dynamic class names
  const layoutStyle: React.CSSProperties = layout === "grid"
    ? {
        display: "grid",
        gap: `${gap * 0.25}rem`,
        gridTemplateColumns: `repeat(${columnsSm}, minmax(0, 1fr))`,
      }
    : layout === "stack"
    ? {
        display: "flex",
        flexDirection: "column",
        gap: `${gap * 0.25}rem`,
      }
    : {
        display: "flex",
        flexWrap: "wrap",
        gap: `${gap * 0.25}rem`,
      };

  // Media query for larger screens (grid layout only)
  const gridClassName = layout === "grid" ? "input-schema-grid" : "";

  return (
    <>
      {/* Inject media query styles for responsive grid */}
      {layout === "grid" && (
        <style>{`
          @media (min-width: 640px) {
            .input-schema-grid {
              grid-template-columns: repeat(${columns}, minmax(0, 1fr)) !important;
            }
          }
        `}</style>
      )}
      <div className={gridClassName} style={layoutStyle}>
        {Object.entries(properties).map(([key, fieldSchema]) => {
          const fieldUx = getUx(fieldSchema as Record<string, unknown>);
          const colSpan = fieldUx.col_span;

          // Initial value from data (source_data/source_field handled by InputSchemaComposer)
          const initialValue = data?.[key] ?? (fieldSchema as Record<string, unknown>).default;

          // Build item styles for col_span
          const itemStyle: React.CSSProperties = {};
          if (layout === "grid") {
            if (colSpan === "full") {
              itemStyle.gridColumn = "1 / -1";
            } else if (typeof colSpan === "number" && colSpan > 1) {
              itemStyle.gridColumn = `span ${colSpan}`;
            }
          }

          return (
            <div key={key} style={itemStyle}>
              <SchemaRenderer
                schema={fieldSchema}
                data={initialValue}
                path={[...path, key]}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}
