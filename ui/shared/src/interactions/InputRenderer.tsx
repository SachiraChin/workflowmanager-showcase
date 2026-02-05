/**
 * InputRenderer - Routes to specific input components based on input_type.
 *
 * This component handles all editable input rendering:
 * - select: Dropdown select (SelectInputRenderer)
 * - slider: Range slider (SliderInputRenderer)
 * - textarea: Multi-line text (TextareaInputRenderer)
 * - text: Single-line text (TextareaInputRenderer with minRows=1)
 * - number: Numeric input (NumberInputRenderer)
 *
 * Input components manage their own state via InputSchemaContext,
 * so they can render without an initial value.
 *
 * If the schema has an `alternative` config, the input is wrapped
 * with AlternativeInputWrapper to provide toggle between primary
 * and alternative input modes.
 */

import type { SchemaProperty, UxConfig, ControlConfig, AlternativeConfig } from "../types/schema";
import { SelectInputRenderer } from "../renderers/SelectInputRenderer";
import { SliderInputRenderer } from "../renderers/SliderInputRenderer";
import { TextareaInputRenderer } from "../renderers/TextareaInputRenderer";
import { NumberInputRenderer } from "../renderers/NumberInputRenderer";
import { CheckboxInputRenderer } from "../renderers/CheckboxInputRenderer";
import { TagInputRenderer } from "../renderers/TagInputRenderer";
import { AlternativeInputWrapper } from "../renderers/AlternativeInputWrapper";

// =============================================================================
// Types
// =============================================================================

interface InputRendererProps {
  /** The value to render (may be undefined for inputs) */
  value: unknown;
  /** Path for context key and tracking */
  path: string[];
  /** Schema for input configuration */
  schema: SchemaProperty;
  /** Pre-extracted UX config */
  ux: UxConfig;
  /** Additional CSS classes */
  className?: string;
  /** Whether inputs are disabled */
  disabled?: boolean;
  /** Whether inputs are readonly */
  readonly?: boolean;
}

// =============================================================================
// InputRenderer
// =============================================================================

export function InputRenderer({
  value,
  path,
  schema,
  ux,
  className,
  disabled = false,
  readonly = false,
}: InputRendererProps) {
  const inputType = ux.input_type;

  // Extract label from UX or schema
  const schemaRecord = (schema || {}) as Record<string, unknown>;
  const schemaTitle = schemaRecord.title as string | undefined;
  const label = ux.display_label || schemaTitle;

  // Check for alternative config
  const alternative = schemaRecord.alternative as AlternativeConfig | undefined;
  const fieldKey = path[path.length - 1];

  // Build the primary input component (without label if alternative exists - wrapper handles label)
  const primaryLabel = alternative ? undefined : label;
  let primaryInput: React.ReactNode;

  switch (inputType) {
    case "select": {
      // Extract select config from schema root (not _ux)
      const enumData = schemaRecord.enum as unknown[] | undefined;
      const enumLabels = schemaRecord.enum_labels as Record<string, string> | undefined;
      const valueKey = schemaRecord.value_key as string | undefined;
      const labelKey = schemaRecord.label_key as string | undefined;
      const labelFormat = schemaRecord.label_format as string | undefined;
      const controls = schemaRecord.controls as Record<string, ControlConfig> | undefined;
      // enum_source: path to resolve enum options from sourceData (e.g., "_provider_metadata.categories")
      const enumSource = ux.enum_source as string | undefined;

      primaryInput = (
        <SelectInputRenderer
          path={path}
          value={value as string | undefined}
          label={primaryLabel}
          enumData={enumData}
          enumLabels={enumLabels}
          valueKey={valueKey}
          labelKey={labelKey}
          labelFormat={labelFormat}
          controls={controls}
          enumSource={enumSource}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;
    }

    case "slider": {
      const min = (schemaRecord.minimum as number) ?? 0;
      const max = (schemaRecord.maximum as number) ?? 100;
      const step = schemaRecord.step as number | undefined;

      primaryInput = (
        <SliderInputRenderer
          path={path}
          value={value as number | undefined}
          label={primaryLabel}
          min={min}
          max={max}
          step={step}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;
    }

    case "textarea":
      primaryInput = (
        <TextareaInputRenderer
          path={path}
          value={value as string | undefined}
          label={primaryLabel}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;

    case "number": {
      const min = schemaRecord.minimum as number | undefined;
      const max = schemaRecord.maximum as number | undefined;
      const step = schemaRecord.step as number | undefined;

      primaryInput = (
        <NumberInputRenderer
          path={path}
          value={value as number | string | undefined}
          label={primaryLabel}
          min={min}
          max={max}
          step={step}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;
    }

    case "checkbox":
      primaryInput = (
        <CheckboxInputRenderer
          path={path}
          value={value as boolean | undefined}
          label={primaryLabel}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;

    case "tag_input":
      primaryInput = (
        <TagInputRenderer
          path={path}
          value={value as string[] | undefined}
          label={primaryLabel}
          placeholder={ux.placeholder}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;

    case "text":
    default:
      // Default to textarea with single row for text input
      primaryInput = (
        <TextareaInputRenderer
          path={path}
          value={value as string | undefined}
          label={primaryLabel}
          minRows={1}
          className={className}
          disabled={disabled}
          readonly={readonly}
        />
      );
      break;
  }

  // Wrap with AlternativeInputWrapper if alternative config exists
  if (alternative) {
    return (
      <AlternativeInputWrapper
        fieldKey={fieldKey}
        path={path}
        alternative={alternative}
        primaryInput={primaryInput}
        label={label}
        className={className}
        disabled={disabled}
        readonly={readonly}
      />
    );
  }

  return primaryInput;
}
