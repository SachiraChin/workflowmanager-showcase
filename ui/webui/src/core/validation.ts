/**
 * Re-export from @wfm/shared for backwards compatibility.
 * All validation now lives in shared package.
 */
export {
  validateAgainstSchema,
  validateSchema,
  validateField,
  formatErrorsForDisplay,
  type CoreValidationError as ValidationError,
  type CoreValidationResult as ValidationResult,
} from "@wfm/shared";
