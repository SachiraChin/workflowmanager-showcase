/**
 * ValidationContext - Manages validation state for interactions.
 *
 * Responsibilities:
 * - Track validation errors and warnings for each action
 * - Provide validation state to buttons (for disable logic)
 * - Manage warning confirmation popup
 * - Handle action submission with validation
 *
 * Usage:
 * - Wrap interaction content with ValidationProvider (inside InteractionProvider)
 * - Use useValidation() hook to access validation state and handlers
 *
 * WORKAROUND NOTE (see TECHNICAL_DEBT.md #16):
 * The response state is derived from providerState + display_data rather than
 * from the actual response data. This is because the interaction architecture
 * doesn't expose current response data before submission. This workaround
 * hardcodes knowledge of specific response fields (selected_content_id,
 * generations, selected_indices) which should be fixed in a future refactor.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type {
  ValidationConfig,
  ValidationMessage,
  ValidationResult,
  InteractionRequest,
} from "../types/index";

// =============================================================================
// Validation Rule Implementations
// =============================================================================

type ResponseData = Record<string, unknown>;

/**
 * Rule implementations matching server-side rules.
 * Each function returns true if valid, false if invalid.
 *
 * Mirrors server-side validation logic in backend/server/workflow/validation.py
 */
const RULES: Record<
  string,
  (response: ResponseData, params: ValidationConfig) => boolean
> = {
  /**
   * Field must be present and non-null.
   */
  response_field_required: (response, params) => {
    const value = response[params.field];
    return value !== null && value !== undefined;
  },

  /**
   * Field must have items (for arrays/dicts) or be truthy.
   */
  response_field_not_empty: (response, params) => {
    const value = response[params.field];
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object" && value !== null) {
      return Object.keys(value).length > 0;
    }
    return Boolean(value);
  },

  /**
   * Field must equal a specific value.
   */
  response_field_equals: (response, params) => {
    const value = response[params.field];
    return value === params.value;
  },

  /**
   * selected_indices must have at least N items.
   */
  min_selections: (response, params) => {
    const indices = (response.selected_indices as unknown[]) || [];
    return indices.length >= (params.min || 1);
  },
};

// =============================================================================
// Validation Functions
// =============================================================================

/**
 * Validate a response against a list of validation configs.
 *
 * @param response - The interaction response data
 * @param validations - List of validation configs from retryable option
 * @param confirmedWarnings - List of validation IDs user has confirmed
 * @returns ValidationResult with errors and warnings
 */
export function validateResponse(
  response: ResponseData,
  validations: ValidationConfig[],
  confirmedWarnings: string[] = []
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];

  for (const validation of validations) {
    // Check if webui should validate this rule
    const validator = validation.validator ?? ["webui", "server"];
    if (!validator.includes("webui")) {
      continue;
    }

    const rule = RULES[validation.rule];
    if (!rule) {
      console.warn(`Unknown validation rule: ${validation.rule}`);
      continue;
    }

    const isValid = rule(response, validation);

    if (!isValid) {
      const msg: ValidationMessage = {
        id: validation.id,
        field: validation.field,
        rule: validation.rule,
        message: validation.message,
        severity: validation.severity,
      };

      if (validation.severity === "error") {
        errors.push(msg);
      } else if (validation.severity === "warning") {
        // Skip if user already confirmed this warning
        if (!confirmedWarnings.includes(validation.id)) {
          warnings.push(msg);
        }
      }
    }
  }

  return {
    valid: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
  };
}

/**
 * Get validations for a specific action from retryable config.
 *
 * @param retryable - The retryable config from display_data
 * @param actionId - The action ID (e.g., "continue", "retry")
 * @returns List of validation configs for the action
 */
export function getValidationsForAction(
  retryable: Record<string, unknown> | undefined,
  actionId: string
): ValidationConfig[] {
  if (!retryable) return [];

  const options = (retryable.options || []) as Array<{
    id: string;
    validations?: ValidationConfig[];
  }>;

  for (const option of options) {
    if (option.id === actionId) {
      return option.validations || [];
    }
  }

  return [];
}

// =============================================================================
// Types
// =============================================================================

export interface ValidationContextValue {
  /**
   * Check if an action has validation errors (for button disable).
   * Returns list of error messages.
   */
  getErrorsForAction: (actionId: string) => ValidationMessage[];

  /**
   * Check if an action has validation warnings.
   * Returns list of warning messages.
   */
  getWarningsForAction: (actionId: string) => ValidationMessage[];

  /**
   * Handle action click with validation.
   * Shows warning popup if needed, otherwise calls onProceed.
   */
  handleActionWithValidation: (
    actionId: string,
    onProceed: (confirmedWarnings: string[]) => void
  ) => void;

  /** Currently showing warning popup */
  warningPopup: WarningPopupState | null;

  /** Confirm warnings and proceed */
  confirmWarnings: () => void;

  /** Cancel warning popup */
  cancelWarnings: () => void;
}

export interface WarningPopupState {
  actionId: string;
  warnings: ValidationMessage[];
  onProceed: (confirmedWarnings: string[]) => void;
}

// =============================================================================
// Context
// =============================================================================

const ValidationContext = createContext<ValidationContextValue | null>(null);

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access validation context.
 * Must be used within ValidationProvider.
 */
export function useValidation(): ValidationContextValue {
  const ctx = useContext(ValidationContext);
  if (!ctx) {
    throw new Error("useValidation must be used within ValidationProvider");
  }
  return ctx;
}

/**
 * Optional hook that returns null if not within ValidationProvider.
 * Useful for components that may or may not have validation.
 */
export function useValidationOptional(): ValidationContextValue | null {
  return useContext(ValidationContext);
}

// =============================================================================
// Response State Derivation (WORKAROUND)
// =============================================================================

/**
 * Derive response state from providerState and display_data.
 *
 * WORKAROUND: This hardcodes knowledge of specific response fields because
 * the interaction architecture doesn't expose current response data.
 * See TECHNICAL_DEBT.md #16 for details.
 *
 * @param providerState - State from InteractionProvider
 * @param request - The interaction request
 * @returns Derived response state for validation
 */
function deriveResponseState(
  providerState: { selectedCount: number; selectedGroupIds: string[]; generationsCount?: number },
  request: InteractionRequest
): ResponseData {
  const displayData = request.display_data || {};

  // Base response from providerState
  const response: ResponseData = {
    // For media generation: selected_content_id
    selected_content_id:
      providerState.selectedCount > 0 ? "has_selection" : undefined,

    // For structured select: selected_indices
    selected_indices: providerState.selectedGroupIds,
  };

  // For media generation: use generationsCount from providerState if available
  // This is more reliable than checking display_data._generations arrays
  // because it includes generations made during the current session
  if (providerState.generationsCount !== undefined && providerState.generationsCount > 0) {
    // Create a placeholder generations object to satisfy validation rules
    // The actual generations data is in the response, not needed for validation
    response.generations = { _count: providerState.generationsCount };
  } else {
    // Fallback: check display_data for pre-existing generations (from server)
    // This handles the case where we're viewing an existing interaction
    if (displayData.data && typeof displayData.data === "object") {
      const data = displayData.data as Record<string, unknown>;
      const generations: Record<string, unknown[]> = {};

      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === "object") {
          const val = value as Record<string, unknown>;
          if (
            val._generations &&
            Array.isArray(val._generations) &&
            val._generations.length > 0
          ) {
            generations[key] = val._generations as unknown[];
          }
        }
      }

      // Only set generations if we found any
      if (Object.keys(generations).length > 0) {
        response.generations = generations;
      }
    }
  }

  return response;
}

// =============================================================================
// Provider (Full Implementation)
// =============================================================================

// =============================================================================
// Provider With Request (Full Implementation)
// =============================================================================

interface ValidationProviderWithRequestProps {
  /** The interaction request (for display_data access) */
  request: InteractionRequest;
  /** Retryable config (extracted from request.display_data for convenience) */
  retryable: Record<string, unknown> | undefined;
  /** Provider state from InteractionContext */
  providerState: { selectedCount: number; selectedGroupIds: string[]; generationsCount?: number };
  /** Children to render */
  children: ReactNode;
}

/**
 * Full ValidationProvider that receives all required data as props.
 * Use this when you have access to the interaction state.
 */
export function ValidationProviderWithRequest({
  request,
  retryable,
  providerState,
  children,
}: ValidationProviderWithRequestProps) {
  // Warning popup state
  const [warningPopup, setWarningPopup] = useState<WarningPopupState | null>(
    null
  );

  // Derive response state from providerState + display_data (WORKAROUND)
  const responseState = useMemo(
    () => deriveResponseState(providerState, request),
    [providerState, request]
  );

  // Get validations for an action
  const getValidations = useCallback(
    (actionId: string): ValidationConfig[] => {
      return getValidationsForAction(retryable, actionId);
    },
    [retryable]
  );

  // Validate response for an action
  const validateForAction = useCallback(
    (actionId: string): ValidationResult => {
      const validations = getValidations(actionId);
      if (validations.length === 0) {
        return { valid: true, errors: [], warnings: [] };
      }
      return validateResponse(responseState, validations);
    },
    [getValidations, responseState]
  );

  // Get errors for action (for button disable)
  const getErrorsForAction = useCallback(
    (actionId: string): ValidationMessage[] => {
      const result = validateForAction(actionId);
      return result.errors;
    },
    [validateForAction]
  );

  // Get warnings for action
  const getWarningsForAction = useCallback(
    (actionId: string): ValidationMessage[] => {
      const result = validateForAction(actionId);
      return result.warnings;
    },
    [validateForAction]
  );

  // Handle action with validation
  const handleActionWithValidation = useCallback(
    (actionId: string, onProceed: (confirmedWarnings: string[]) => void) => {
      const result = validateForAction(actionId);

      // If there are errors, don't proceed (button should be disabled anyway)
      if (result.errors.length > 0) {
        console.warn("Validation errors exist, action blocked:", result.errors);
        return;
      }

      // If there are warnings, show confirmation popup
      if (result.warnings.length > 0) {
        setWarningPopup({
          actionId,
          warnings: result.warnings,
          onProceed,
        });
        return;
      }

      // No errors or warnings, proceed immediately
      onProceed([]);
    },
    [validateForAction]
  );

  // Confirm warnings and proceed
  const confirmWarnings = useCallback(() => {
    if (warningPopup) {
      const confirmedIds = warningPopup.warnings.map((w) => w.id);
      warningPopup.onProceed(confirmedIds);
      setWarningPopup(null);
    }
  }, [warningPopup]);

  // Cancel warning popup
  const cancelWarnings = useCallback(() => {
    setWarningPopup(null);
  }, []);

  // Context value
  const contextValue = useMemo<ValidationContextValue>(
    () => ({
      getErrorsForAction,
      getWarningsForAction,
      handleActionWithValidation,
      warningPopup,
      confirmWarnings,
      cancelWarnings,
    }),
    [
      getErrorsForAction,
      getWarningsForAction,
      handleActionWithValidation,
      warningPopup,
      confirmWarnings,
      cancelWarnings,
    ]
  );

  return (
    <ValidationContext.Provider value={contextValue}>
      {children}
    </ValidationContext.Provider>
  );
}
