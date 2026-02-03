"""
Interaction Response Validation

Validates interaction responses against rules defined in retryable config.
This module provides server-side validation for workflow interactions.

Validation rules are configured per-action in step.json under:
  retryable.options[].validations[]

Each validation has:
  - id: Unique identifier
  - rule: Rule name from registry
  - field: Response field to validate (rule-dependent)
  - severity: "error" (blocks action) or "warning" (requires confirmation)
  - message: Human-readable error message
  - validator: ["webui", "server"] - which layers should validate
"""

import logging
from abc import ABC, abstractmethod
from typing import Dict, Any, List
from dataclasses import dataclass, asdict

logger = logging.getLogger("workflow.validation")


@dataclass
class ValidationMessage:
    """A single validation error or warning."""
    id: str
    field: str
    rule: str
    message: str
    severity: str  # "error" or "warning"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ValidationResult:
    """Result of validating a response."""
    valid: bool
    errors: List[ValidationMessage]
    warnings: List[ValidationMessage]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "errors": [e.to_dict() for e in self.errors],
            "warnings": [w.to_dict() for w in self.warnings],
        }


class ValidationRule(ABC):
    """Base class for validation rules."""

    @abstractmethod
    def evaluate(self, response: Dict[str, Any], params: Dict[str, Any]) -> bool:
        """
        Evaluate the rule against a response.

        Args:
            response: The interaction response data
            params: Rule parameters (field, value, min, etc.)

        Returns:
            True if valid, False if invalid
        """
        pass


class ResponseFieldRequired(ValidationRule):
    """Field must be present and non-null."""

    def evaluate(self, response: Dict[str, Any], params: Dict[str, Any]) -> bool:
        field = params.get("field", "")
        value = response.get(field)
        return value is not None


class ResponseFieldNotEmpty(ValidationRule):
    """Field must have items (for arrays/dicts) or be truthy."""

    def evaluate(self, response: Dict[str, Any], params: Dict[str, Any]) -> bool:
        field = params.get("field", "")
        value = response.get(field)
        if value is None:
            return False
        if isinstance(value, (list, dict)):
            return len(value) > 0
        return bool(value)


class ResponseFieldEquals(ValidationRule):
    """Field must equal a specific value."""

    def evaluate(self, response: Dict[str, Any], params: Dict[str, Any]) -> bool:
        field = params.get("field", "")
        expected = params.get("value")
        actual = response.get(field)
        return actual == expected


class MinSelections(ValidationRule):
    """selected_indices must have at least N items."""

    def evaluate(self, response: Dict[str, Any], params: Dict[str, Any]) -> bool:
        indices = response.get("selected_indices", [])
        min_count = params.get("min", 1)
        return len(indices) >= min_count


# Registry of available rules
VALIDATION_RULES: Dict[str, ValidationRule] = {
    "response_field_required": ResponseFieldRequired(),
    "response_field_not_empty": ResponseFieldNotEmpty(),
    "response_field_equals": ResponseFieldEquals(),
    "min_selections": MinSelections(),
}


def validate_response(
    response: Dict[str, Any],
    validations: List[Dict[str, Any]],
    confirmed_warnings: List[str],
    validator_layer: str = "server"
) -> ValidationResult:
    """
    Validate response against a list of validation configs.

    Args:
        response: The interaction response data
        validations: List of validation configs from retryable option
        confirmed_warnings: List of validation IDs user has confirmed
        validator_layer: Which layer is calling ("server" or "webui")

    Returns:
        ValidationResult with errors and warnings
    """
    errors: List[ValidationMessage] = []
    warnings: List[ValidationMessage] = []

    for validation in validations:
        # Check if this validator layer should evaluate this rule
        validator = validation.get("validator", ["webui", "server"])
        if validator_layer not in validator:
            continue

        rule_name = validation.get("rule", "")
        rule = VALIDATION_RULES.get(rule_name)

        if not rule:
            logger.warning(f"Unknown validation rule: {rule_name}")
            continue

        # Build params from validation config (field, value, min, etc.)
        params = {
            k: v for k, v in validation.items()
            if k not in ("id", "rule", "severity", "message", "validator")
        }

        is_valid = rule.evaluate(response, params)

        if not is_valid:
            validation_id = validation.get("id", "")
            msg = ValidationMessage(
                id=validation_id,
                field=validation.get("field", ""),
                rule=rule_name,
                message=validation.get("message", "Validation failed"),
                severity=validation.get("severity", "error")
            )

            if msg.severity == "error":
                errors.append(msg)
                logger.debug(
                    f"Validation error: {validation_id} - {msg.message}"
                )
            elif msg.severity == "warning":
                # Check if user already confirmed this warning
                if validation_id not in confirmed_warnings:
                    warnings.append(msg)
                    logger.debug(
                        f"Validation warning: {validation_id} - {msg.message}"
                    )
                else:
                    logger.debug(
                        f"Validation warning confirmed: {validation_id}"
                    )

    return ValidationResult(
        valid=len(errors) == 0 and len(warnings) == 0,
        errors=errors,
        warnings=warnings
    )


def get_validations_for_action(
    retryable: Dict[str, Any],
    action_id: str
) -> List[Dict[str, Any]]:
    """
    Get validations for a specific action from retryable config.

    Args:
        retryable: The retryable config from module
        action_id: The action ID (e.g., "continue", "retry")

    Returns:
        List of validation configs for the action
    """
    options = retryable.get("options", [])
    for option in options:
        if option.get("id") == action_id:
            return option.get("validations", [])
    return []
