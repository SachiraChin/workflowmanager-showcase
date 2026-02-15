/**
 * TableSchemaRenderer - Renders data as a table with schema-defined columns.
 *
 * This is a special renderer handled BEFORE type routing in SchemaRenderer.
 * Tables need direct access to data and schema structure for coordinated rendering.
 *
 * Column Discovery:
 * - Scans items.properties for render_as: "column" fields
 * - Scans items.computed for render_as: "column" computed fields
 * - Columns MUST have display: true/visible
 * - Nested columns (e.g., details.col1) get merged headers
 *
 * Cell Rendering:
 * - Each cell uses SchemaRenderer with column's schema (minus render_as: "column")
 * - Computed fields are evaluated via display_format template
 */

import { Check } from "lucide-react";
import { cn } from "../utils/cn";
import type { SchemaProperty, ComputedField, UxConfig } from "../types/schema";
import { normalizeDisplay } from "../types/schema";
import { getUx } from "../utils/ux-utils";
import { renderTemplate } from "../utils/template-service";
import { useWorkflowState } from "../contexts/WorkflowStateContext";
import { ErrorRenderer } from "../renderers";
import { useSelectionOptional } from "./selection/SelectionContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

// Forward declaration - will be imported at runtime to avoid circular dependency
import { SchemaRenderer } from "./SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

interface TableSchemaRendererProps {
  /** The data to render (array or object) */
  data: unknown;
  /** Schema with render_as: "table" */
  schema: SchemaProperty;
  /** Path to this data in the tree */
  path: string[];
  /** Pre-extracted UX config */
  ux: UxConfig;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

/** Column definition extracted from schema */
interface ColumnDef {
  /** Key path to this column data (e.g., ["details", "col1"]) */
  keyPath: string[];
  /** Display label for column header */
  label: string;
  /** Schema for the column (used for cell rendering) */
  schema: SchemaProperty;
  /** UX config for the column */
  ux: UxConfig;
  /** Display order for sorting */
  displayOrder: number;
  /** Parent key for merged headers (first level parent if nested) */
  parentKey?: string;
  /** Whether this is a computed field */
  isComputed?: boolean;
  /** Display format template (for computed fields) */
  displayFormat?: string;
}

/** Result of column discovery */
interface ColumnDiscoveryResult {
  columns: ColumnDef[];
  error?: string;
}

// =============================================================================
// Column Discovery
// =============================================================================

/**
 * Discover columns by scanning properties for render_as: "column".
 *
 * @param properties - The properties object to scan
 * @param computed - The computed fields object to scan
 * @param parentPath - Path from items root to current level
 */
function discoverColumns(
  properties: Record<string, SchemaProperty>,
  computed: Record<string, ComputedField> = {},
  parentPath: string[] = []
): ColumnDiscoveryResult {
  const columns: ColumnDef[] = [];

  // Scan regular properties
  for (const [key, propSchema] of Object.entries(properties)) {
    const currentPath = [...parentPath, key];
    const propUx = getUx(propSchema as Record<string, unknown>);
    const display = normalizeDisplay(propUx.display);

    if (propUx.render_as === "column") {
      if (display === "hidden") {
        continue; // Skip hidden columns
      }

      columns.push({
        keyPath: currentPath,
        label: propUx.display_label || key,
        schema: propSchema,
        ux: propUx,
        displayOrder: propUx.display_order ?? 999,
        parentKey: parentPath.length > 0 ? parentPath[0] : undefined,
      });
    } else if (propSchema.properties && display !== "hidden") {
      // Recurse to find nested columns
      const result = discoverColumns(propSchema.properties, {}, currentPath);
      if (result.error) {
        return result;
      }
      columns.push(...result.columns);
    }
  }

  // Scan computed fields
  for (const [key, compSchema] of Object.entries(computed)) {
    const display = normalizeDisplay(compSchema.display);

    if (compSchema.render_as === "column" && display !== "hidden") {
      // Create UX config from computed field
      const compUx: UxConfig = {
        display: compSchema.display,
        display_label: compSchema.display_label,
        display_order: compSchema.display_order,
        render_as: compSchema.render_as,
        nudges: compSchema.nudges,
      };

      columns.push({
        keyPath: [key],
        label: compSchema.display_label || key,
        schema: { type: "string" },
        ux: compUx,
        displayOrder: compSchema.display_order ?? 999,
        isComputed: true,
        displayFormat: compSchema.display_format,
      });
    }
  }

  return { columns };
}

/**
 * Get value at a key path from an object.
 */
function getValueAtPath(
  obj: Record<string, unknown>,
  keyPath: string[]
): unknown {
  let value: unknown = obj;
  for (const key of keyPath) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Build merged header structure from columns.
 * Returns array of header groups, each with label and column span.
 */
function buildMergedHeaders(
  columns: ColumnDef[]
): Array<{ label: string; colSpan: number }> {
  const groups: Array<{ label: string; colSpan: number }> = [];
  let currentGroup: { label: string; colSpan: number } | null = null;

  for (const col of columns) {
    const groupLabel = col.parentKey || "";

    if (!currentGroup || currentGroup.label !== groupLabel) {
      if (currentGroup) {
        groups.push(currentGroup);
      }
      currentGroup = { label: groupLabel, colSpan: 1 };
    } else {
      currentGroup.colSpan++;
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return groups;
}

// =============================================================================
// Component
// =============================================================================

export function TableSchemaRenderer({
  data,
  schema,
  path,
  ux,
  disabled = false,
  readonly = false,
}: TableSchemaRendererProps) {
  const selection = useSelectionOptional();
  const { state: workflowState } = useWorkflowState();
  const templateState = (workflowState?.state_mapped || {}) as Record<string, unknown>;

  // Determine if data is array or object
  const isArray = Array.isArray(data);
  const isObject = typeof data === "object" && data !== null && !isArray;

  if (!isArray && !isObject) {
    return (
      <ErrorRenderer
        fieldKey={path.join(".") || "table"}
        renderAs="text"
        value="Table requires array or object data"
      />
    );
  }

  // Get the schema for row items
  const itemSchema = isArray
    ? schema.items || { type: "object" as const }
    : schema;
  const itemUx = isArray
    ? getUx(itemSchema as Record<string, unknown>)
    : ux;

  // Check if rows are selectable
  const isSelectable = itemUx.selectable === true && selection !== null;

  // Get properties and computed to scan for columns
  const properties = itemSchema.properties || {};
  const computed = itemUx.computed || {};

  // Discover columns from schema
  const discoveryResult = discoverColumns(properties, computed);

  if (discoveryResult.error) {
    return (
      <ErrorRenderer
        fieldKey={path.join(".") || "table"}
        renderAs="text"
        value={discoveryResult.error}
      />
    );
  }

  // Sort columns by display_order
  const columns = [...discoveryResult.columns].sort(
    (a, b) => a.displayOrder - b.displayOrder
  );

  if (columns.length === 0) {
    return (
      <ErrorRenderer
        fieldKey={path.join(".") || "table"}
        renderAs="text"
        value="No columns found. Add render_as: 'column' and display: true to fields."
      />
    );
  }

  // Build rows from data
  const rows: Array<{ key: string; data: Record<string, unknown> }> = [];

  if (isArray) {
    (data as unknown[]).forEach((item, idx) => {
      if (typeof item === "object" && item !== null) {
        rows.push({ key: String(idx), data: item as Record<string, unknown> });
      }
    });
  } else {
    // Object: treat as single row
    rows.push({ key: "0", data: data as Record<string, unknown> });
  }

  // Check if we need merged headers (any column has parentKey)
  const hasMergedHeaders = columns.some((col) => col.parentKey !== undefined);
  const mergedHeaders = hasMergedHeaders ? buildMergedHeaders(columns) : null;

  return (
    <div className="rounded-md border overflow-auto">
      <Table>
        <TableHeader>
          {/* Merged header row (if applicable) */}
          {mergedHeaders && (
            <TableRow>
              {isSelectable && <TableHead className="w-10" />}
              {mergedHeaders.map((group, idx) => (
                <TableHead
                  key={idx}
                  colSpan={group.colSpan}
                  className={group.label ? "text-center border-b font-semibold" : "border-b"}
                >
                  {group.label}
                </TableHead>
              ))}
            </TableRow>
          )}

          {/* Column headers */}
          <TableRow>
            {isSelectable && <TableHead className="w-10" />}
            {columns.map((col, idx) => (
              <TableHead key={idx}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => {
            const rowPath = [...path, row.key];
            const isSelected = isSelectable && selection?.isSelected(rowPath);
            const canSelectRow = isSelectable && selection?.canSelect(rowPath);
            const rowDisabled = isSelectable && !canSelectRow && !isSelected;

            const handleRowClick = () => {
              if (!isSelectable || selection?.mode === "review") return;
              if (rowDisabled) return;
              selection?.toggleSelection(rowPath, row.data);
            };

            return (
              <TableRow
                key={row.key}
                className={cn(
                  isSelectable && "cursor-pointer",
                  isSelected && "bg-primary/10",
                  isSelectable && !isSelected && "hover:bg-muted/50",
                  rowDisabled && "opacity-50 cursor-not-allowed"
                )}
                onClick={handleRowClick}
              >
                {/* Selection indicator column */}
                {isSelectable && (
                  <TableCell className="w-10 align-middle">
                    <div
                      className={cn(
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                        isSelected ? "border-primary bg-primary" : "border-muted-foreground/30"
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                    </div>
                  </TableCell>
                )}

                {/* Data cells */}
                {columns.map((col, colIdx) => {
                  let cellValue: unknown;

                  if (col.isComputed && col.displayFormat) {
                    // Computed field: evaluate template
                    cellValue = renderTemplate(col.displayFormat, row.data, templateState);
                  } else {
                    cellValue = getValueAtPath(row.data, col.keyPath);
                  }

                  const cellPath = [...path, row.key, ...col.keyPath];

                  // Create cell UX - strip render_as: "column" so cell content
                  // renders normally (not as another column)
                  const cellUx: UxConfig = {
                    ...col.ux,
                    display_label: undefined,
                    render_as: undefined,
                  };

                  return (
                    <TableCell key={colIdx} className="align-top">
                      <SchemaRenderer
                        data={cellValue}
                        schema={col.schema}
                        path={cellPath}
                        ux={cellUx}
                        disabled={disabled}
                        readonly={readonly}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}

          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length + (isSelectable ? 1 : 0)}
                className="text-center text-muted-foreground py-4"
              >
                No data
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
