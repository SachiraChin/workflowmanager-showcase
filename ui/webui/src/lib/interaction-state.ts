/**
 * Canonical interaction state types.
 * All interaction variants use these shared state shapes.
 */

import type { SelectOption, InteractionResponseData } from "./types";

// =============================================================================
// Base State
// =============================================================================

/**
 * Base state shared by all interaction types.
 */
export interface BaseInteractionState {
  // Has user made any changes?
  isDirty: boolean;
  // Is the current state valid for submission?
  isValid: boolean;
}

// =============================================================================
// Text Input State
// =============================================================================

export interface TextInputState extends BaseInteractionState {
  value: string;
}

export function createTextInputState(defaultValue?: string): TextInputState {
  return {
    value: defaultValue || "",
    isDirty: false,
    isValid: false,
  };
}

export function validateTextInputState(
  state: TextInputState,
  allowEmpty: boolean
): TextInputState {
  return {
    ...state,
    isValid: allowEmpty || state.value.trim().length > 0,
  };
}

// =============================================================================
// Confirm State
// =============================================================================

export interface ConfirmState extends BaseInteractionState {
  value: boolean | null;
}

export function createConfirmState(defaultValue?: boolean): ConfirmState {
  return {
    value: defaultValue ?? null,
    isDirty: false,
    isValid: defaultValue !== undefined,
  };
}

export function validateConfirmState(state: ConfirmState): ConfirmState {
  return {
    ...state,
    isValid: state.value !== null,
  };
}

// =============================================================================
// Select List State
// =============================================================================

export interface SelectListState extends BaseInteractionState {
  selectedIndices: number[];
  selectedOptions: SelectOption[];
  customValue?: string;
}

export function createSelectListState(
  options: SelectOption[],
  defaultSelection?: number | number[]
): SelectListState {
  const indices = defaultSelection !== undefined
    ? Array.isArray(defaultSelection)
      ? defaultSelection
      : [defaultSelection]
    : [];

  return {
    selectedIndices: indices,
    selectedOptions: indices.map((i) => options[i]).filter(Boolean),
    isDirty: false,
    isValid: false,
  };
}

export function validateSelectListState(
  state: SelectListState,
  minSelections: number,
  maxSelections: number
): SelectListState {
  const count = state.selectedIndices.length;
  return {
    ...state,
    isValid: count >= minSelections && count <= maxSelections,
  };
}

export function toggleSelectListItem(
  state: SelectListState,
  index: number,
  options: SelectOption[],
  maxSelections: number
): SelectListState {
  let newIndices: number[];

  if (state.selectedIndices.includes(index)) {
    // Remove
    newIndices = state.selectedIndices.filter((i) => i !== index);
  } else if (maxSelections === 1) {
    // Single select - replace
    newIndices = [index];
  } else if (state.selectedIndices.length < maxSelections) {
    // Multi select - add
    newIndices = [...state.selectedIndices, index];
  } else {
    // At max - no change
    return state;
  }

  return {
    ...state,
    selectedIndices: newIndices,
    selectedOptions: newIndices.map((i) => options[i]).filter(Boolean),
    isDirty: true,
  };
}

// =============================================================================
// Structured Select State
// =============================================================================

export type StructuredIndex = string | number | (string | number)[];

export interface StructuredSelectState extends BaseInteractionState {
  selectedIndices: StructuredIndex[];
  selectedData: Record<string, unknown>[];
}

export function createStructuredSelectState(
  defaultIndices?: StructuredIndex[]
): StructuredSelectState {
  return {
    selectedIndices: defaultIndices || [],
    selectedData: [],
    isDirty: false,
    isValid: false,
  };
}

export function validateStructuredSelectState(
  state: StructuredSelectState,
  minSelections: number,
  maxSelections: number
): StructuredSelectState {
  const count = state.selectedIndices.length;
  return {
    ...state,
    isValid: count >= minSelections && count <= maxSelections,
  };
}

// =============================================================================
// Review Grouped State
// =============================================================================

export interface ReviewGroupedState extends BaseInteractionState {
  // For retry with per-group feedback
  retryGroups: string[];
  feedbackByGroup: Record<string, string>;
  // Overall feedback
  feedback: string;
}

export function createReviewGroupedState(): ReviewGroupedState {
  return {
    retryGroups: [],
    feedbackByGroup: {},
    feedback: "",
    isDirty: false,
    isValid: true, // Review is always valid (can continue or retry)
  };
}

// =============================================================================
// File Input State
// =============================================================================

export interface FileInputState extends BaseInteractionState {
  filePath: string;
  fileData?: string; // Base64 data URL
  fileName?: string;
  fileType?: string;
}

export function createFileInputState(): FileInputState {
  return {
    filePath: "",
    isDirty: false,
    isValid: false,
  };
}

// =============================================================================
// File Download State
// =============================================================================

export interface FileDownloadState extends BaseInteractionState {
  downloaded: boolean;
  filePath: string;
  error?: string;
}

export function createFileDownloadState(): FileDownloadState {
  return {
    downloaded: false,
    filePath: "",
    isDirty: false,
    isValid: false,
  };
}

export function validateFileDownloadState(state: FileDownloadState): FileDownloadState {
  return {
    ...state,
    isValid: state.downloaded,
  };
}

// =============================================================================
// Union Type
// =============================================================================

export type InteractionState =
  | TextInputState
  | ConfirmState
  | SelectListState
  | StructuredSelectState
  | ReviewGroupedState
  | FileInputState
  | FileDownloadState;

// =============================================================================
// State to Response Conversion
// =============================================================================

export function textInputStateToResponse(
  state: TextInputState,
  _interactionId: string
): InteractionResponseData {
  // Only set value, NOT custom_value
  // custom_value is for "custom/other" responses in selection interactions
  // Setting it here causes server to treat this as a retry request
  return {
    value: state.value,
  };
}

export function confirmStateToResponse(
  state: ConfirmState,
  _interactionId: string
): InteractionResponseData {
  return {
    value: state.value,
  };
}

export function selectListStateToResponse(
  state: SelectListState,
  _interactionId: string
): InteractionResponseData {
  return {
    selected_indices: state.selectedIndices,
    selected_options: state.selectedOptions.map((opt) => ({
      id: opt.id,
      label: opt.label,
      description: opt.description,
      metadata: opt.metadata,
    })),
    custom_value: state.customValue,
  };
}

export function structuredSelectStateToResponse(
  state: StructuredSelectState,
  _interactionId: string,
  multiSelect: boolean = false
): InteractionResponseData {
  let resultIndices: (string | number | (string | number)[])[] = [...state.selectedIndices];

  // Flatten indices for single select (match TUI behavior)
  // For single select with one result, unwrap: [['key']] -> ['key']
  if (!multiSelect && resultIndices.length === 1) {
    const itemIndices = resultIndices[0];
    if (Array.isArray(itemIndices)) {
      resultIndices = itemIndices as (string | number)[];
    } else {
      resultIndices = [itemIndices];
    }
  }

  return {
    selected_indices: resultIndices,
    selected_options: state.selectedData.map((data, i) => ({
      metadata: {
        indices: state.selectedIndices[i],
        data,
      },
    })),
    value: JSON.stringify(resultIndices),
  };
}

export function reviewGroupedStateToResponse(
  state: ReviewGroupedState,
  _interactionId: string,
  mode: "continue" | "retry"
): InteractionResponseData {
  if (mode === "continue") {
    return {
      value: "accepted",
    };
  }

  // Build combined feedback
  let feedback = state.feedback;
  if (Object.keys(state.feedbackByGroup).length > 0) {
    feedback = Object.entries(state.feedbackByGroup)
      .map(([group, fb]) => `[${group}]: ${fb}`)
      .join("\n");
  }

  return {
    retry_requested: true,
    retry_groups: state.retryGroups,
    retry_feedback: feedback,
  };
}

export function fileInputStateToResponse(
  state: FileInputState,
  _interactionId: string
): InteractionResponseData {
  // Only set value, NOT custom_value
  // custom_value is for "custom/other" responses in selection interactions
  // Setting it here causes server to treat this as a retry request
  return {
    value: state.fileData || state.filePath,
  };
}

export function fileDownloadStateToResponse(
  state: FileDownloadState,
  _interactionId: string
): InteractionResponseData {
  return {
    file_written: state.downloaded,
    file_path: state.filePath,
    file_error: state.error || "",
  };
}
