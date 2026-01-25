/**
 * Terminal renderer - routes to specific renderer based on render_as type.
 * This is the main entry point for rendering individual field values.
 *
 * Selection:
 * - When path/data/schema are provided and ux.selectable is true,
 *   wraps content in SelectableWrapper with selection UI.
 */

import type { SchemaProperty, UxConfig, ControlConfig } from "../types";
import { useSelectable } from "../useSelectable";
import { SelectableWrapper } from "../SelectableWrapper";
import { TextRenderer } from "./TextRenderer";
import { ColorRenderer } from "./ColorRenderer";
import { UrlRenderer } from "./UrlRenderer";
import { DateTimeRenderer } from "./DateTimeRenderer";
import { NumberRenderer } from "./NumberRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { SelectInputRenderer } from "./SelectInputRenderer";
import { SliderInputRenderer } from "./SliderInputRenderer";
import { TextareaInputRenderer } from "./TextareaInputRenderer";

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
  schema,
  ux,
}: TerminalRendererProps) {
  // Extract UX properties
  const label = ux.display_label;
  const renderAs = ux.render_as || "text";
  const inputType = ux.input_type;
  const nudges = ux.nudges || [];

  // Selection state (null if not selectable or missing props)
  const selectable = useSelectable(path, data ?? value, ux);

  // ==========================================================================
  // Input types - editable controls (render even if value is null/undefined)
  // ==========================================================================
  // Input types manage their own state via context, so they can render without
  // an initial value. They are rendered BEFORE null check.
  if (inputType) {
    const schemaRecord = (schema || {}) as Record<string, unknown>;
    const schemaTitle = schemaRecord.title as string | undefined;
    const inputLabel = label || schemaTitle;

    let inputContent: React.ReactNode;
    switch (inputType) {
      case "select": {
        // Extract select config from schema root (not _ux)
        const enumData = schemaRecord.enum as unknown[] | undefined;
        const enumLabels = schemaRecord.enum_labels as Record<string, string> | undefined;
        const valueKey = schemaRecord.value_key as string | undefined;
        const labelKey = schemaRecord.label_key as string | undefined;
        const labelFormat = schemaRecord.label_format as string | undefined;
        const controls = schemaRecord.controls as Record<string, ControlConfig> | undefined;
        inputContent = (
          <SelectInputRenderer
            path={path}
            value={value as string | undefined}
            label={inputLabel}
            enumData={enumData}
            enumLabels={enumLabels}
            valueKey={valueKey}
            labelKey={labelKey}
            labelFormat={labelFormat}
            controls={controls}
            className={className}
          />
        );
        break;
      }
      case "slider": {
        const min = (schemaRecord.minimum as number) ?? 0;
        const max = (schemaRecord.maximum as number) ?? 100;
        const step = schemaRecord.step as number | undefined;
        inputContent = (
          <SliderInputRenderer
            path={path}
            value={value as number | undefined}
            label={inputLabel}
            min={min}
            max={max}
            step={step}
            className={className}
          />
        );
        break;
      }
      case "textarea":
        inputContent = (
          <TextareaInputRenderer
            path={path}
            value={value as string | undefined}
            label={inputLabel}
            className={className}
          />
        );
        break;
      case "text":
      default:
        // Default to textarea for text input type
        inputContent = (
          <TextareaInputRenderer
            path={path}
            value={value as string | undefined}
            label={inputLabel}
            minRows={1}
            className={className}
          />
        );
        break;
    }

    // Input types don't use SelectableWrapper
    return inputContent;
  }

  // ==========================================================================
  // Display types - read-only rendering (requires value)
  // ==========================================================================

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
