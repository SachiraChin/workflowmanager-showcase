"""
Contract Validation - Ensures API models match contract dataclasses.

This module auto-discovers API models that declare a __contract__ attribute
and validates they have all required fields from their contract dataclass.

Usage in API models:
    class InteractionResponseData(BaseModel):
        __contract__ = InteractionResponse  # Link to contract dataclass
        __contract_exclude__ = {'interaction_id'}  # Optional: fields to skip
        ...

Run validate_all_contracts() at server startup to fail fast on mismatches.
"""

import logging
import inspect
from dataclasses import fields as dataclass_fields, is_dataclass
from typing import Type, List, Set, Any, Dict

logger = logging.getLogger('workflow.api.contracts')


class ContractValidationError(Exception):
    """Raised when API models don't match their contract dataclasses."""
    pass


def get_dataclass_field_names(cls: Type) -> Set[str]:
    """Get all field names from a dataclass."""
    if not is_dataclass(cls):
        raise ValueError(f"{cls.__name__} is not a dataclass")
    return {f.name for f in dataclass_fields(cls)}


def get_pydantic_field_names(cls: Type) -> Set[str]:
    """Get all field names from a Pydantic model."""
    # Pydantic v2 uses model_fields
    if hasattr(cls, 'model_fields'):
        return set(cls.model_fields.keys())
    # Pydantic v1 fallback
    if hasattr(cls, '__fields__'):
        return set(cls.__fields__.keys())
    raise ValueError(f"{cls.__name__} is not a Pydantic model")


def validate_model_against_contract(
    api_cls: Type,
    contract_cls: Type,
    exclude_fields: Set[str]
) -> List[str]:
    """
    Validate that API model has all fields from contract dataclass.

    Returns:
        List of error messages (empty if valid)
    """
    contract_fields = get_dataclass_field_names(contract_cls) - exclude_fields
    api_fields = get_pydantic_field_names(api_cls)

    errors = []

    # Check for fields in contract but missing from API model
    missing_in_api = contract_fields - api_fields
    if missing_in_api:
        errors.append(
            f"{api_cls.__name__} is missing fields from {contract_cls.__name__}: "
            f"{sorted(missing_in_api)}"
        )

    return errors


def discover_contract_models(module: Any) -> List[tuple]:
    """
    Discover all classes in a module that have __contract__ attribute.

    Returns:
        List of (api_class, contract_class, exclude_set) tuples
    """
    discovered = []

    for name, obj in inspect.getmembers(module, inspect.isclass):
        # Check if class has __contract__ attribute (not inherited)
        if '__contract__' in obj.__dict__:
            contract_cls = obj.__contract__
            exclude = getattr(obj, '__contract_exclude__', set())

            # Validate contract is a dataclass
            if not is_dataclass(contract_cls):
                logger.warning(
                    f"{name}.__contract__ = {contract_cls.__name__} is not a dataclass, skipping"
                )
                continue

            discovered.append((obj, contract_cls, exclude))
            logger.debug(f"Discovered contract binding: {name} -> {contract_cls.__name__}")

    return discovered


def validate_all_contracts() -> None:
    """
    Auto-discover and validate all contract ↔ API model pairs.

    Scans server.api.models for classes with __contract__ attribute
    and validates they have all required fields.

    Raises ContractValidationError if any mismatches found.
    Call this at server startup.
    """
    # Import the models module
    from backend.workflow_engine import models

    # Discover all models with contract bindings
    contract_models = discover_contract_models(models)

    if not contract_models:
        logger.warning("No contract bindings found in models.py (no __contract__ attributes)")
        return

    all_errors = []

    for api_cls, contract_cls, exclude in contract_models:
        errors = validate_model_against_contract(api_cls, contract_cls, exclude)
        all_errors.extend(errors)

    if all_errors:
        error_msg = "Contract validation failed:\n" + "\n".join(f"  - {e}" for e in all_errors)
        logger.error(error_msg)
        raise ContractValidationError(error_msg)

    logger.info(
        f"Contract validation passed: {len(contract_models)} API model(s) match their contracts"
    )
