/**
 * TerminalRenderer - Routes to specific display renderer based on render_as type.
 *
 * This component handles display-only rendering (read-only values):
 * - text, color, url, datetime, number, image
 *
 * For editable inputs (select, textarea, slider, number input), see InputRenderer.
 *
 * Selection:
 * - When path/data/schema are provided and ux.selectable is true,
 *   wraps content in SelectableWrapper with selection UI.
 */

import type { SchemaProperty, UxConfig } from "./schema/types";
import { useSelectable } from "./schema/selection/useSelectable";
import { SelectableWrapper } from "./schema/selection/SelectableWrapper";
import { TextRenderer } from "./renderers/TextRenderer";
import { ColorRenderer } from "./renderers/ColorRenderer";
import { UrlRenderer } from "./renderers/UrlRenderer";
import { DateTimeRenderer } from "./renderers/DateTimeRenderer";
import { NumberRenderer } from "./renderers/NumberRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";

// =============================================================================
// Types
// =============================================================================

interface TerminalRendererProps {
  /** Field key */
  fieldKey: string;
  /** The value to render */
  value: unknown;
  /** Additional CSS classes */
  className?: string;
  /** Path for selection tracking (optional) */
  path?: string[];
  /** Data for selection (optional) */
  data?: unknown;
  /** Schema for selection (optional) */
  schema?: SchemaProperty;
  /** Pre-extracted UX config */
  ux: UxConfig;
}

// =============================================================================
// TerminalRenderer
// =============================================================================

export function TerminalRenderer({
  fieldKey: _fieldKey,
  value,
  className,
  path = [],
  data,
  schema: _schema,
  ux,
}: TerminalRendererProps) {
  // Extract UX properties
  const label = ux.display_label;
  const renderAs = ux.render_as || "text";
  const nudges = ux.nudges || [];

  // Selection state (null if not selectable or missing props)
  const selectable = useSelectable(path, data ?? value, ux);

  // Handle null/undefined values for display types
  if (value === null || value === undefined) {
    return null;
  }

  // Convert value to string for most renderers
  const stringValue = String(value);

  // Route to appropriate renderer based on render_as
  let content: React.ReactNode;
  switch (renderAs) {
    case "text":
      content = (
        <TextRenderer
          value={stringValue}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
      break;

    case "color":
      content = (
        <ColorRenderer
          value={stringValue}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
      break;

    case "url":
      content = (
        <UrlRenderer
          value={stringValue}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
      break;

    case "datetime":
      content = (
        <DateTimeRenderer
          value={value as string | number}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
      break;

    case "number":
      content = (
        <NumberRenderer
          value={value as number | string}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
      break;

    case "image":
      content = (
        <ImageRenderer
          value={stringValue}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
      break;

    default:
      // Default to text rendering - render_as is a suggestion, not requirement
      content = (
        <TextRenderer
          value={stringValue}
          label={label}
          nudges={nudges}
          className={className}
        />
      );
  }

  // If selectable, wrap in SelectableWrapper
  if (selectable) {
    return (
      <SelectableWrapper selectable={selectable}>
        {content}
      </SelectableWrapper>
    );
  }

  return content;
}
