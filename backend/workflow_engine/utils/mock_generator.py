"""
Mock Data Generator - Schema-aware mock data generation for preview mode.

Uses the jsf (JSON Schema Faker) library with lorem-text for traditional
Lorem Ipsum text generation. Provides deterministic output via seeding
for consistent previews.

jsf automatically honors JSON Schema constraints including:
- Arrays: minItems, maxItems, uniqueItems
- Numbers: minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf
- Strings: minLength, maxLength, pattern, format
- Enums: picks from enum values

Libraries:
- jsf: https://github.com/ghandic/jsf - JSON Schema to fake data
- lorem-text: https://pypi.org/project/lorem-text/ - Lorem ipsum generator
"""

from typing import Any, Dict, Optional
import logging
import random

from jsf import JSF
from lorem_text import lorem

logger = logging.getLogger(__name__)

# Default seed for deterministic mock data
DEFAULT_SEED = 42


class LoremFaker:
    """
    Faker-compatible wrapper around lorem-text for JSF integration.
    
    JSF expects a Faker instance with methods like sentence(), paragraph(), etc.
    This class provides those methods using lorem-text for real Lorem Ipsum.
    """
    
    def __init__(self, seed: Optional[int] = None):
        if seed is not None:
            random.seed(seed)
    
    def seed(self, seed: int) -> None:
        """Set random seed for reproducibility."""
        random.seed(seed)
    
    def sentence(self, nb_words: int = 10, variable_nb_words: bool = True) -> str:
        """Generate a lorem ipsum sentence."""
        return lorem.sentence()
    
    def sentences(self, nb: int = 3) -> list:
        """Generate multiple sentences."""
        return [lorem.sentence() for _ in range(nb)]
    
    def paragraph(self, nb_sentences: int = 3, variable_nb_sentences: bool = True) -> str:
        """Generate a lorem ipsum paragraph."""
        return lorem.paragraphs(1)
    
    def paragraphs(self, nb: int = 3) -> list:
        """Generate multiple paragraphs."""
        return [lorem.paragraphs(1) for _ in range(nb)]
    
    def text(self, max_nb_chars: int = 200) -> str:
        """Generate lorem ipsum text up to max_nb_chars."""
        text = lorem.paragraphs(1)
        if len(text) > max_nb_chars:
            # Truncate at word boundary
            text = text[:max_nb_chars].rsplit(' ', 1)[0]
        return text
    
    def word(self) -> str:
        """Generate a single lorem word."""
        return lorem.words(1)
    
    def words(self, nb: int = 3, unique: bool = False) -> list:
        """Generate multiple words."""
        words_str = lorem.words(nb)
        return words_str.split()
    
    # Additional methods JSF might call
    def name(self) -> str:
        """Generate a fake name (uses lorem words)."""
        return lorem.words(2).title()
    
    def first_name(self) -> str:
        """Generate a fake first name."""
        return lorem.words(1).title()
    
    def last_name(self) -> str:
        """Generate a fake last name."""
        return lorem.words(1).title()
    
    def email(self) -> str:
        """Generate a fake email."""
        word = lorem.words(1).lower()
        return f"{word}@example.com"
    
    def url(self) -> str:
        """Generate a fake URL."""
        word = lorem.words(1).lower()
        return f"https://example.com/{word}"
    
    def pyint(self, min_value: int = 0, max_value: int = 100) -> int:
        """Generate a random integer."""
        return random.randint(min_value, max_value)
    
    def pyfloat(self, min_value: float = 0, max_value: float = 100) -> float:
        """Generate a random float."""
        return round(random.uniform(min_value, max_value), 2)
    
    def pybool(self) -> bool:
        """Generate a random boolean."""
        return random.choice([True, False])
    
    def date(self) -> str:
        """Generate a fake date."""
        return "2025-01-15"
    
    def date_time(self) -> str:
        """Generate a fake datetime."""
        return "2025-01-15T10:30:00Z"


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
            random.seed(seed)

        # Create custom context with LoremFaker instead of default Faker
        lorem_faker = LoremFaker(seed=seed)
        context = {
            'faker': lorem_faker,
            'random': random,
        }

        # Create JSF instance with custom context
        faker = JSF(schema, context=context)

        return faker.generate()
    except Exception as e:
        logger.warning(f"Failed to generate mock from schema: {e}")
        # Return a simple fallback that also honors constraints
        if seed is not None:
            random.seed(seed)
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
        text = generate_lorem_sentence()
        if len(text) < min_len:
            # Pad with more text
            while len(text) < min_len:
                text += ' ' + lorem.words(1)
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


def generate_lorem_text(sentences: int = 2) -> str:
    """
    Generate lorem ipsum text.

    Args:
        sentences: Number of sentences to generate (approximated via paragraphs)

    Returns:
        Lorem ipsum text string
    """
    if sentences <= 1:
        return lorem.sentence()
    return lorem.paragraphs(1)


def generate_lorem_sentence() -> str:
    """
    Generate a single lorem ipsum sentence.

    Returns:
        Single lorem ipsum sentence
    """
    return lorem.sentence()


def generate_lorem_word() -> str:
    """
    Generate a single lorem ipsum word.

    Returns:
        Single lorem ipsum word
    """
    return lorem.words(1)


def generate_lorem_words(count: int = 3) -> str:
    """
    Generate multiple lorem ipsum words as a string.

    Args:
        count: Number of words to generate

    Returns:
        Space-separated lorem ipsum words
    """
    return lorem.words(count)
