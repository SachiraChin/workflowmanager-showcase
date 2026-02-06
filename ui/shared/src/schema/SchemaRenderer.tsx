/**
 * SchemaRenderer - Pure type-based router with debug mode support.
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
 *
 * Debug Mode:
 * - When debug mode is enabled, container/layout components get an edit button
 * - The edit button allows editing the node's data and schema
 * - Terminal and Input renderers do not get the edit button
 */

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import type { SchemaProperty, RenderAs } from "../types/schema";
import { normalizeDisplay } from "../types/schema";
import { getUx } from "../utils/ux-utils";
import { TerminalRenderer } from "../renderers";
import { InputRenderer } from "../interactions/InputRenderer";
import { renderTemplate } from "../utils/template-service";
import { useRenderContext } from "../contexts/RenderContext";
import { useWorkflowState } from "../contexts/WorkflowStateContext";
import { JsonEditorDialog } from "../components/ui/json-editor-dialog";
import { cn } from "../utils/cn";

// Import the type-specific renderers
import { ArraySchemaRenderer } from "./ArraySchemaRenderer";
import { ObjectSchemaRenderer } from "./ObjectSchemaRenderer";

// Import special renderers (handled before type routing)
import { ContentPanelSchemaRenderer } from "./ContentPanelSchemaRenderer";
import { TableSchemaRenderer } from "./TableSchemaRenderer";
import { Media, ImageGeneration, VideoGeneration, AudioGeneration } from "../interactions/types/media-generation";
import { TabLayout } from "./tabs/TabLayout";
import { TabsLayout } from "../layouts/TabsLayout";
import { InputSchemaComposer } from "./input/InputSchemaComposer";

// Import layouts to trigger registration
import "../layouts";

// =============================================================================
// Types
// =============================================================================

import type { UxConfig } from "../types/schema";

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
// Debug Edit Wrapper
// =============================================================================

interface DebugEditWrapperProps {
  data: unknown;
  schema: SchemaProperty;
  path: string[];
  children: ReactNode;
}

/**
 * Wrapper that adds an edit button to container/layout components in debug mode.
 * The edit button opens a dialog to edit the node's data.
 */
function DebugEditWrapper({ data, schema, path, children }: DebugEditWrapperProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isButtonHovered, setIsButtonHovered] = useState(false);
  const { onUpdateDisplayData } = useRenderContext();

  // Build the value to edit - combine data and schema for full context
  const editValue = {
    data,
    schema,
  };

  const handleSave = (newValue: unknown) => {
    const edited = newValue as { data: unknown; schema: SchemaProperty };
    // Delegate to the adapter callback from RenderContext
    onUpdateDisplayData?.(path, edited.data, edited.schema);
  };

  return (
    <div
      className={cn(
        "relative group/debug-edit",
        isButtonHovered && "outline outline-2 outline-orange-400 outline-offset-1 rounded"
      )}
    >
      {/* Edit button - top right corner */}
      <button
        type="button"
        onClick={() => setIsEditOpen(true)}
        onMouseEnter={() => setIsButtonHovered(true)}
        onMouseLeave={() => setIsButtonHovered(false)}
        className={cn(
          "absolute top-1 right-1 z-10",
          "p-1 rounded",
          "bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/30 dark:hover:bg-orange-900/50",
          "text-orange-600 dark:text-orange-400",
          "opacity-0 group-hover/debug-edit:opacity-100",
          "transition-opacity duration-150"
        )}
        title={`Edit: ${path.join(".") || "root"}`}
      >
        <Pencil className="h-3 w-3" />
      </button>

      {/* Content */}
      {children}

      {/* Edit dialog */}
      <JsonEditorDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        value={editValue}
        title={`Edit: ${path.join(".") || "root"}`}
        onSave={handleSave}
      />
    </div>
  );
}

// =============================================================================
// Helper: Check if this will render as terminal/input
// =============================================================================

function isTerminalOrInput(schema: SchemaProperty, ux: UxConfig): boolean {
  // Input type → InputRenderer
  if (ux.input_type) {
    return true;
  }

  // display_format without render_as → TerminalRenderer
  if (ux.display_format && !ux.render_as) {
    return true;
  }

  // Not array/object and no special render_as → TerminalRenderer
  if (schema.type !== "array" && schema.type !== "object" && !ux.render_as && !ux.input_schema) {
    return true;
  }

  return false;
}

// =============================================================================
// SchemaRenderer (public API)
// =============================================================================

/**
 * Main SchemaRenderer - wraps SchemaRendererCore with debug edit functionality.
 * In debug mode, container/layout components get an edit button.
 */
export function SchemaRenderer(props: SchemaRendererProps) {
  const { debugMode } = useRenderContext();

  // If not debug mode, skip wrapper entirely
  if (!debugMode) {
    return <SchemaRendererCore {...props} />;
  }

  // Extract UX to determine if this is terminal/input
  const ux = props.ux ?? getUx(props.schema as Record<string, unknown>);

  // Terminal and input types don't get the edit wrapper
  if (isTerminalOrInput(props.schema, ux)) {
    return <SchemaRendererCore {...props} />;
  }

  // Null data without input_type → will return null, no wrapper needed
  if (props.data == null && !ux.input_type) {
    return <SchemaRendererCore {...props} />;
  }

  // Container/layout type in debug mode → wrap with edit button
  return (
    <DebugEditWrapper
      data={props.data}
      schema={props.schema}
      path={props.path || []}
    >
      <SchemaRendererCore {...props} />
    </DebugEditWrapper>
  );
}

// =============================================================================
// SchemaRendererCore (internal implementation)
// =============================================================================

// SchemaRendererCore uses the same props as SchemaRenderer
type SchemaRendererCoreProps = SchemaRendererProps;

function SchemaRendererCore({
  data,
  schema,
  path = [],
  ux: uxProp,
  children,
  disabled = false,
  readonly = false,
}: SchemaRendererCoreProps) {
  const { state: workflowState } = useWorkflowState();
  const templateState = (workflowState?.state_mapped || {}) as Record<string, unknown>;

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
          disabled={disabled}
          readonly={readonly}
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
          disabled={disabled}
          readonly={readonly}
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
          disabled={disabled}
          readonly={readonly}
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
        disabled={disabled}
        readonly={readonly}
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
      <TabLayout schema={schema} data={data} path={path} ux={ux} disabled={disabled} readonly={readonly}>
        {children}
      </TabLayout>
    );
  }

  // ==========================================================================
  // 4. Tabs container - provides context for tab children
  // ==========================================================================
  if (ux.render_as === "tabs") {
    return (
      <TabsLayout schema={schema} data={data} path={path} ux={ux} disabled={disabled} readonly={readonly}>
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
        disabled={disabled}
        readonly={readonly}
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
        disabled={disabled}
        readonly={readonly}
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
        disabled={disabled}
        readonly={readonly}
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
        disabled={disabled}
        readonly={readonly}
      />
    );
  }

  // audio_generation: Self-contained audio generation component
  if (ux.render_as === "audio_generation") {
    return (
      <AudioGeneration
        data={data}
        schema={schema}
        path={path}
        ux={ux}
        disabled={disabled}
        readonly={readonly}
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
        disabled={disabled}
        readonly={readonly}
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
  // 7. Input types - route to InputRenderer (BEFORE type routing)
  // ==========================================================================
  // Input types manage their own state via context and can render without data.
  // Must be checked before schema.type routing, otherwise array/object inputs
  // (like tag_input with type: "array") get routed to ArraySchemaRenderer.
  if (ux.input_type) {
    return (
      <InputRenderer
        value={data}
        path={path}
        schema={schema}
        ux={ux}
        disabled={disabled}
        readonly={readonly}
      />
    );
  }

  // ==========================================================================
  // 8. Route by schema type
  // ==========================================================================
  if (schema.type === "array") {
    return (
      <ArraySchemaRenderer
        data={data}
        schema={schema}
        path={path}
        ux={ux}
        disabled={disabled}
        readonly={readonly}
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
        disabled={disabled}
        readonly={readonly}
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
