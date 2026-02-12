"""
Mock Data Generator - Schema-aware mock data generation for preview mode.

Uses the jsf (JSON Schema Faker) library with Faker for lorem ipsum style
text generation. Provides deterministic output via seeding for consistent
previews.

jsf automatically honors JSON Schema constraints including:
- Arrays: minItems, maxItems, uniqueItems
- Numbers: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
- Strings: minLength, maxLength, pattern, format
- Enums: picks from enum values

Libraries:
- jsf: https://github.com/ghandic/jsf - JSON Schema to fake data
- Faker: https://github.com/joke2k/faker - Fake data generation
"""

from typing import Any, Dict, Optional
import logging
import random

from jsf import JSF
from faker import Faker

logger = logging.getLogger(__name__)

# Global Faker instance for lorem ipsum generation
_faker = Faker()

# Default seed for deterministic mock data
DEFAULT_SEED = 42


def generate_mock_from_schema(
    schema: Dict[str, Any],
    seed: Optional[int] = DEFAULT_SEED
) -> Any:
    """
    Generate mock data that conforms to a JSON schema.

    Uses the jsf library which automatically honors schema constraints:
    - Arrays: minItems, maxItems, uniqueItems
    - Numbers: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
    - Strings: minLength, maxLength, pattern, format
    - Enums: picks from enum values

    Output is deterministic when seed is provided.

    Args:
        schema: JSON Schema definition
        seed: Random seed for deterministic output (default: 42)

    Returns:
        Mock data matching the schema structure with lorem ipsum text

    Example:
        schema = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "score": {"type": "integer", "minimum": 1, "maximum": 10}
                }
            },
            "minItems": 3,
            "maxItems": 5
        }

        result = generate_mock_from_schema(schema)
        # Returns 3-5 items, each with score between 1-10
    """
    try:
        # Seed for deterministic output
        if seed is not None:
            Faker.seed(seed)
            random.seed(seed)

        # Create JSF instance with the schema
        faker = JSF(schema)

        return faker.generate()
    except Exception as e:
        logger.warning(f"Failed to generate mock from schema: {e}")
        # Return a simple fallback that also honors constraints
        if seed is not None:
            random.seed(seed)
            Faker.seed(seed)
        return _generate_fallback_from_schema(schema)


def _generate_fallback_from_schema(schema: Dict[str, Any]) -> Any:
    """
    Simple fallback mock generator when jsf fails.
    Also honors schema constraints like minItems, maxItems, minimum, maximum.

    Args:
        schema: JSON Schema definition

    Returns:
        Basic mock data matching schema structure and constraints
    """
    schema_type = schema.get('type', 'string')

    if schema_type == 'string':
        if 'enum' in schema:
            return schema['enum'][0] if schema['enum'] else 'mock_value'

        min_len = schema.get('minLength', 0)
        max_len = schema.get('maxLength', 200)

        # Generate sentence and trim/pad to fit constraints
        text = generate_lorem_sentence(seed=None)
        if len(text) < min_len:
            # Pad with more text
            while len(text) < min_len:
                text += ' ' + _faker.word()
        if len(text) > max_len:
            text = text[:max_len]
        return text

    elif schema_type == 'number':
        minimum = schema.get('minimum', 0)
        maximum = schema.get('maximum', 100)
        exclusive_min = schema.get('exclusiveMinimum')
        exclusive_max = schema.get('exclusiveMaximum')

        if isinstance(exclusive_min, (int, float)):
            minimum = exclusive_min + 0.1
        elif exclusive_min is True:
            minimum = minimum + 0.1

        if isinstance(exclusive_max, (int, float)):
            maximum = exclusive_max - 0.1
        elif exclusive_max is True:
            maximum = maximum - 0.1

        return round(random.uniform(minimum, maximum), 2)

    elif schema_type == 'integer':
        minimum = schema.get('minimum', 0)
        maximum = schema.get('maximum', 100)
        exclusive_min = schema.get('exclusiveMinimum')
        exclusive_max = schema.get('exclusiveMaximum')

        if isinstance(exclusive_min, (int, float)):
            minimum = int(exclusive_min) + 1
        elif exclusive_min is True:
            minimum = minimum + 1

        if isinstance(exclusive_max, (int, float)):
            maximum = int(exclusive_max) - 1
        elif exclusive_max is True:
            maximum = maximum - 1

        return random.randint(minimum, maximum)

    elif schema_type == 'boolean':
        return True

    elif schema_type == 'array':
        items_schema = schema.get('items', {'type': 'string'})
        min_items = schema.get('minItems', 2)
        max_items = schema.get('maxItems', 3)

        # Ensure min_items <= max_items
        min_items = min(min_items, max_items)

        count = random.randint(min_items, max_items)
        return [_generate_fallback_from_schema(items_schema) for _ in range(count)]

    elif schema_type == 'object':
        obj = {}
        properties = schema.get('properties', {})
        for prop_name, prop_schema in properties.items():
            obj[prop_name] = _generate_fallback_from_schema(prop_schema)
        return obj

    elif schema_type == 'null':
        return None

    # Fallback for unknown types
    return 'mock_value'


def generate_lorem_text(
    sentences: int = 2,
    seed: Optional[int] = DEFAULT_SEED
) -> str:
    """
    Generate lorem ipsum text using Faker.

    Args:
        sentences: Number of sentences to generate
        seed: Random seed for deterministic output

    Returns:
        Lorem ipsum text string
    """
    if seed is not None:
        Faker.seed(seed)

    return _faker.paragraph(nb_sentences=sentences)


def generate_lorem_sentence(seed: Optional[int] = DEFAULT_SEED) -> str:
    """
    Generate a single lorem ipsum sentence using Faker.

    Args:
        seed: Random seed for deterministic output

    Returns:
        Single lorem ipsum sentence
    """
    if seed is not None:
        Faker.seed(seed)

    return _faker.sentence()


def generate_lorem_word(seed: Optional[int] = DEFAULT_SEED) -> str:
    """
    Generate a single lorem ipsum word using Faker.

    Args:
        seed: Random seed for deterministic output

    Returns:
        Single lorem ipsum word
    """
    if seed is not None:
        Faker.seed(seed)

    return _faker.word()


def generate_lorem_words(count: int = 3, seed: Optional[int] = DEFAULT_SEED) -> str:
    """
    Generate multiple lorem ipsum words as a string.

    Args:
        count: Number of words to generate
        seed: Random seed for deterministic output

    Returns:
        Space-separated lorem ipsum words
    """
    if seed is not None:
        Faker.seed(seed)

    return ' '.join(_faker.words(nb=count))
