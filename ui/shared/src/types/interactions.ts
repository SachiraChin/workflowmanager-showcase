/**
 * Shared types for interaction components.
 */

import type { InteractionRequest, InteractionResponseData, SelectOption } from "./index";
import type {
  TextInputState,
  StructuredSelectState,
  ReviewGroupedState,
  FileInputState,
} from "./interaction-state";

// =============================================================================
// Base Props (Uncontrolled - with submit button)
// =============================================================================

/**
 * Props for uncontrolled interaction components.
 * Component manages its own state and calls onSubmit when done.
 */
export interface BaseInteractionProps {
  request: InteractionRequest;
  onSubmit: (response: InteractionResponseData) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

// =============================================================================
// Controlled Props (State lifted to parent)
// =============================================================================

/**
 * Props for controlled interaction components.
 * State is managed by parent, component receives state and emits changes.
 */
export interface ControlledInteractionProps<TState> {
  request: InteractionRequest;
  state: TState;
  onStateChange: (state: TState) => void;
  disabled?: boolean;
  // Display options
  showSubmitButton?: boolean;
  onSubmit?: () => void;
}

// Specific controlled props for each interaction type
export type ControlledTextInputProps = ControlledInteractionProps<TextInputState>;
export type ControlledStructuredSelectProps = ControlledInteractionProps<StructuredSelectState>;
export type ControlledReviewGroupedProps = ControlledInteractionProps<ReviewGroupedState>;
export type ControlledFileInputProps = ControlledInteractionProps<FileInputState>;

// =============================================================================
// Variant Types
// =============================================================================

/**
 * Variant definition for uncontrolled components.
 */
export interface ComponentVariant<TProps = BaseInteractionProps> {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType<TProps>;
}

/**
 * Variant definition for controlled components.
 */
export interface ControlledVariant<TState> {
  id: string;
  name: string;
  description: string;
  component: React.ComponentType<ControlledInteractionProps<TState>>;
}

// =============================================================================
// Interaction Host Types
// =============================================================================

export type InteractionTypeId =
  | "text_input"
  | "select_from_structured"
  | "review_grouped"
  | "file_input"
  | "file_download"
  | "form_input"
  | "resume_choice"
  | "retry_options";

/**
 * Settings for dev mode variant comparison.
 */
export interface DevModeSettings {
  enabled: boolean;
  visibleVariants: Record<InteractionTypeId, string[]>;
}

/**
 * Production mode settings - which variant to use.
 */
export interface ProductionSettings {
  variantByType: Record<InteractionTypeId, string>;
}

// =============================================================================
// Legacy Selection State (for backward compatibility)
// =============================================================================

export interface SelectionState {
  selectedIndices: number[];
  selectedOptions: SelectOption[];
  customValue?: string;
}
