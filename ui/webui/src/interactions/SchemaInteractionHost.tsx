/**
 * SchemaInteractionHost - Unified host for schema-driven interactions.
 *
 * Features:
 * - Provides SelectionContext for state management
 * - Uses SchemaRenderer for recursive content rendering
 * - Supports cards and list variants
 * - Exposes selection state via onStateChange callback
 *
 * Note: Title/prompt, buttons, and global feedback are handled by InteractionHost.
 * This component only renders schema-driven content.
 */

import { useEffect } from "react";
import type { SchemaProperty } from "./schema/types";
import type { SelectionItem } from "@/core/types";
import {
  SelectionProvider,
  useSelection,
  type InteractionMode,
  type VariantStyle,
} from "./schema/selection/SelectionContext";
import { SchemaRenderer } from "./SchemaRenderer";

// =============================================================================
// Types
// =============================================================================

/** State exposed to parent component */
export interface SchemaInteractionState {
  mode: InteractionMode;
  isValid: boolean;
  selectedCount: number;
  // For select mode
  selectedPaths: string[][];
  selectedData: unknown[];
  // For review mode
  feedbackByPath: Record<string, string>;
}

interface SchemaInteractionHostProps {
  /** Interaction request from server */
  request: {
    title?: string;
    prompt?: string;
    display_data?: {
      data?: unknown;
      schema?: SchemaProperty;
      multi_select?: boolean;
    };
    min_selections?: number;
    max_selections?: number;
  };
  /** Interaction mode */
  mode: InteractionMode;
  /** Visual variant */
  variant: VariantStyle;
  /** Whether interaction is disabled */
  disabled?: boolean;
  /** Called when selection state changes */
  onStateChange?: (state: SchemaInteractionState) => void;
  /** Initial selected items for readonly mode (from history) */
  initialSelectedItems?: SelectionItem[];
}

// Legacy export for type compatibility
export interface SchemaInteractionResult {
  mode: InteractionMode;
  selectedPaths?: string[][];
  selectedData?: unknown[];
  feedbackByPath?: Record<string, string>;
  globalFeedback?: string;
  retryGroups?: string[];
  action?: string;
}

// =============================================================================
// Main Component
// =============================================================================

export function SchemaInteractionHost({
  request,
  mode,
  variant,
  disabled = false,
  onStateChange,
  initialSelectedItems,
}: SchemaInteractionHostProps) {
  const displayData = request.display_data || {};
  const schema = (displayData.schema || { type: "object" }) as SchemaProperty;
  const data = displayData.data;
  const multiSelect = displayData.multi_select === true;
  const minSelections = request.min_selections || 1;
  const maxSelections = multiSelect ? 999 : (request.max_selections || 1);

  return (
    <SelectionProvider
      mode={mode}
      variant={variant}
      multiSelect={multiSelect}
      minSelections={minSelections}
      maxSelections={maxSelections}
      initialSelectedItems={initialSelectedItems}
    >
      <SchemaInteractionContent
        data={data}
        schema={schema}
        mode={mode}
        multiSelect={multiSelect}
        minSelections={minSelections}
        maxSelections={maxSelections}
        disabled={disabled}
        onStateChange={onStateChange}
      />
    </SelectionProvider>
  );
}

// =============================================================================
// Content (Inside Provider)
// =============================================================================

interface SchemaInteractionContentProps {
  data: unknown;
  schema: SchemaProperty;
  mode: InteractionMode;
  multiSelect: boolean;
  minSelections: number;
  maxSelections: number;
  disabled: boolean;
  onStateChange?: (state: SchemaInteractionState) => void;
}

function SchemaInteractionContent({
  data,
  schema,
  mode,
  multiSelect,
  minSelections,
  maxSelections,
  onStateChange,
}: SchemaInteractionContentProps) {
  const {
    selectedPaths,
    selectedData,
    feedbackByPath,
    isValid,
  } = useSelection();

  // Notify parent of state changes
  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        mode,
        isValid,
        selectedCount: selectedPaths.length,
        selectedPaths,
        selectedData,
        feedbackByPath,
      });
    }
  }, [mode, isValid, selectedPaths, selectedData, feedbackByPath, onStateChange]);

  return (
    <div className="h-full flex flex-col">
      {/* Content - fills available space */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-inner pr-2">
        <SchemaRenderer data={data} schema={schema} path={[]} />

        {data === null || data === undefined ? (
          <div className="text-center text-muted-foreground py-8">
            No content to display
          </div>
        ) : null}
      </div>

      {/* Footer - selection count only */}
      <div className="flex-shrink-0 flex items-center pt-2">
        {mode === "select" && (
          <p className="text-sm text-muted-foreground">
            {selectedPaths.length} of{" "}
            {multiSelect ? `${minSelections}-${maxSelections}` : "1"} selected
          </p>
        )}
        {mode === "review" && (
          <p className="text-sm text-muted-foreground">
            Review the content above
          </p>
        )}
      </div>
    </div>
  );
}
