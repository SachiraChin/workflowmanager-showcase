"""
Form Module - Table-style input for data items with additional fields

This module presents data items in a table-like layout where:
- First column: Data rendered via SchemaRenderer (based on schema)
- Additional columns: Input fields for each item (based on schema.input_schema)

Primary use case: Collecting additional input for each item in a list,
such as adding style weights or preferences to each generated option.

The module uses the standard data+schema pattern:
- data: Array of items to display and collect input for
- schema: JSON Schema for rendering items, with nested input_schema for inputs

The input_schema is embedded within the schema object, allowing input fields
to be added to any schema definition. This makes the pattern reusable across
different interaction types.

Output is enriched with _item and _index for each entry:
- _item: The original data object from the input data array
- _index: The position in the original data array

Validation is NOT done here - that's io.validate's responsibility.
Client-side validation uses input_schema directly with Ajv.

See: issues/2026_01_08_form_output_format/r5.md for design details.
"""

import uuid6
from typing import Dict, Any, List, Optional
from engine.module_interface import (
    InteractiveModule, ModuleInput, ModuleOutput, ModuleExecutionError,
    InteractionType, InteractionRequest, InteractionResponse
)


class FormModule(InteractiveModule):
    """
    Table-style input module using data+schema pattern.

    Inputs:
        - data: Array of items to display and collect input for
        - schema: JSON Schema for rendering items, with nested input_schema
        - prompt: Prompt/title for the form
        - form_type: Form type identifier for client-side rendering hints

    Outputs:
        - form_data: Array of enriched items, each containing:
            - _item: Original data object
            - _index: Position in data array
            - ...user input fields from form

    Example:
        data: [
            {"name": "Abstract Art", "style": "modern"},
            {"name": "Impressionism", "style": "classic"}
        ]

        schema: {
            "type": "object",
            "properties": {
                "name": {"type": "string", "display": "title"},
                "style": {"type": "string", "display": "badge"}
            },
            "input_schema": {
                "type": "object",
                "properties": {
                    "weight": {"type": "number", "default": 50},
                    "mode": {"type": "string", "enum": ["a", "b", "c"], "default": "a"}
                }
            }
        }

        Output form_data: [
            {"_item": {"name": "Abstract Art", "style": "modern"}, "_index": 0, "weight": 75, "mode": "a"},
            {"_item": {"name": "Impressionism", "style": "classic"}, "_index": 1, "weight": 25, "mode": "b"}
        ]
    """

    @property
    def module_id(self) -> str:
        return "user.form"

    @property
    def inputs(self) -> List[ModuleInput]:
        return [
            ModuleInput(
                name="data",
                type="array",
                required=True,
                description="Array of items to display and collect input for"
            ),
            ModuleInput(
                name="schema",
                type="object",
                required=True,
                description="JSON Schema for rendering items, with nested input_schema for input fields"
            ),
            ModuleInput(
                name="prompt",
                type="string",
                required=False,
                default="Please fill out the form",
                description="Prompt/title for the form"
            ),
            ModuleInput(
                name="form_type",
                type="string",
                required=False,
                default="table",
                description="Form type identifier for client-side rendering hints"
            )
        ]

    @property
    def outputs(self) -> List[ModuleOutput]:
        return [
            ModuleOutput(
                name="form_data",
                type="array",
                description="Array of enriched items with _item, _index, and user input fields"
            )
        ]

    def requires_interaction(self) -> bool:
        return True

    def get_interaction_request(
        self,
        inputs: Dict[str, Any],
        context
    ) -> Optional[InteractionRequest]:
        """Build form interaction request."""
        data = inputs.get('data', [])
        schema = inputs.get('schema', {})
        prompt = self.get_input_value(inputs, 'prompt')
        form_type = self.get_input_value(inputs, 'form_type')

        # Extract input_schema from within schema
        input_schema = schema.get('input_schema', {})

        # Build defaults from input_schema for each item
        defaults = self._build_defaults(data, input_schema)

        return InteractionRequest(
            interaction_type=InteractionType.FORM_INPUT,
            interaction_id=f"form_{uuid6.uuid7().hex}",
            title=prompt,
            form_schema=input_schema,
            form_type=form_type,
            form_defaults=defaults,
            display_data={
                "data": data,
                "schema": schema
            },
            context={
                "module_id": self.module_id
            }
        )

    def _build_defaults(
        self,
        data: List[Any],
        input_schema: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """Build default values for each item based on input_schema."""
        properties = input_schema.get('properties', {})
        item_defaults = {}

        # Extract defaults from schema
        for key, prop in properties.items():
            if 'default' in prop:
                item_defaults[key] = prop['default']

        # Create array of defaults, one per data item
        return [dict(item_defaults) for _ in data]

    def execute_with_response(
        self,
        inputs: Dict[str, Any],
        context,
        response: InteractionResponse
    ) -> Dict[str, Any]:
        """
        Process form response.

        Responsibility: Enrich form_data with _item and _index.
        Does NOT validate - that's io.validate's job at group exit,
        and client-side validation uses input_schema with Ajv.
        """
        if response.cancelled:
            raise ModuleExecutionError(
                self.module_id,
                "User cancelled form input",
                None
            )

        form_data = response.form_data
        data = inputs.get('data', [])

        # Normalize form_data to list
        if isinstance(form_data, dict):
            # Dict keyed by index (e.g., {"0": {...}, "1": {...}}) - convert to list
            form_data = [form_data.get(str(i), {}) for i in range(len(data))]
        elif not isinstance(form_data, list):
            form_data = []

        # Enrich each item with _item and _index
        enriched = []
        for i, item_data in enumerate(form_data):
            enriched.append({
                "_item": data[i] if i < len(data) else None,
                "_index": i,
                **item_data
            })

        if hasattr(context, 'logger'):
            context.logger.debug(f"Form submitted with {len(enriched)} items")

        return {"form_data": enriched}
