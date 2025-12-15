# Core Aesthetic Selection System

## Overview

Replace the hardcoded aesthetic distribution in Step 1 with a user-driven selection system. Users can choose from 8 core aesthetics and specify counts and person modes using a pattern-based input format.

## Current State

Step 1 currently hardcodes the aesthetic distribution in `aesthetic_concepts_generation_system.txt`:
- 2 mystical (1 with person, 1 without)
- 2 real_world (1 with person, 1 without)
- 2 futuristic (1 with person, 1 without)

This is restrictive and leads to similar outputs over time.

## Proposed Solution

### User Selection Format

Users enter selections as comma-separated patterns:
```
{index}[p/w/b]{count}
```

Where:
- `index`: 1-8, maps to core aesthetic
- `mode`: p=with_person, w=without_person, b=both
- `count`: number of aesthetics to generate

Examples:
- `1p2` = Futuristic, 2 aesthetics with person
- `5b3` = Cozy/Warmth, 3 aesthetics (2 with, 1 without)
- `1p2, 5b4, 7w1` = Multiple selections

### Core Aesthetics (8 total)

| # | ID | Label | Category |
|---|-----|-------|----------|
| 1 | futuristic | Futuristic | world |
| 2 | mystical | Mystical | world |
| 3 | real_world | Real World | world |
| 4 | nature_elemental | Nature / Elemental | environment |
| 5 | cozy_warmth | Cozy / Warmth | mood |
| 6 | minimal_zen | Minimal / Zen | style |
| 7 | symbolic_abstract | Symbolic / Abstract | concept |
| 8 | retro_analog | Retro / Analog | time |

## Implementation

### New Module: `transform.parse_pattern`

A generic pattern parsing module that can handle any structured text input based on configuration.

#### Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `input` | string | Yes | Raw input string to parse |
| `pattern` | object | Yes | Pattern configuration |
| `pattern.regex` | string | Yes | Regex with named groups |
| `pattern.separator` | string | No | Multi-value separator (default: none) |
| `pattern.trim` | boolean | No | Trim whitespace (default: true) |
| `field_types` | object | No | Type casting: `{field: "int"|"float"|"bool"|"string"}` |
| `lookups` | object | No | Lookup configurations per field |
| `mappings` | object | No | Value mappings per field |
| `computed` | array | No | Computed field definitions |
| `validation` | object | No | Validation rules per field |
| `error_behavior` | string | No | "reprompt" (default) or "fail" |

#### Lookup Configuration

```json
{
  "lookups": {
    "field_name": {
      "source": "{{ state.some_array }}",
      "match_by_position": true,
      "position_offset": -1,
      "output_field": "resolved_item"
    }
  }
}
```

Or match by field value:
```json
{
  "lookups": {
    "field_name": {
      "source": "{{ state.some_array }}",
      "match_field": "id",
      "output_field": "resolved_item"
    }
  }
}
```

#### Mappings Configuration

```json
{
  "mappings": {
    "mode": {
      "p": "with_person",
      "w": "without_person",
      "b": "both"
    }
  }
}
```

#### Computed Fields

Uses `simpleeval` for safe expression evaluation.

```json
{
  "computed": [
    {
      "field": "with_count",
      "expression": "math.ceil(count / 2) if mode == 'both' else (count if mode == 'with_person' else 0)"
    }
  ]
}
```

Available in expressions:
- All parsed/mapped fields
- `math.ceil`, `math.floor`, `math.min`, `math.max`
- Basic operators: `+`, `-`, `*`, `/`, `//`, `%`
- Comparisons and conditionals

#### Validation Configuration

```json
{
  "validation": {
    "index": { "min": 1, "max": 8 },
    "count": { "min": 1, "max": 10 },
    "mode": { "in": ["p", "w", "b"] }
  }
}
```

Validation rules:
- `min`, `max`: Numeric range
- `in`: Allowed values list
- `pattern`: Regex pattern match
- `required`: Field must be present

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| `items` | array | Parsed items with all fields |
| `count` | number | Number of parsed items |
| `total` | number | Sum of a specified field (configurable) |
| `valid` | boolean | Whether all items passed validation |
| `errors` | array | Validation error messages |

#### Error Handling

When `error_behavior: "reprompt"`:
1. Module returns `valid: false` with `errors` array
2. Workflow engine detects invalid output
3. Re-prompts user with error message

### File Structure

```
workflows/oms/steps/1_user_input/
├── step.json
├── core_aesthetics.json                    # NEW: 8 aesthetic definitions
├── prompts/
│   ├── aesthetic_concepts_generation_system.txt  # MODIFIED
│   ├── aesthetic_concepts_generation_user.txt    # MODIFIED
│   ├── core_aesthetic_prompt_template.txt        # NEW: Per-aesthetic template
│   ├── scene_expansion_system.txt
│   └── scene_expansion_user.txt
└── schemas/
    ├── aesthetic_concepts_schema.json      # MODIFIED: Add aesthetic_id
    ├── aesthetic_selection_display.json    # NEW: Display for selection help
    └── ... (other schemas unchanged)
```

### Step.json Module Flow (Updated)

```
1.  user.select          → select_duration
2.  user.select          → select_tone
3.  user.select          → select_theme
4.  user.select          → select_brightness
5.  user.select          → select_visual_style
6.  user.select          → select_motion_strength
7.  user.text_input      → user_direction (optional)
8.  transform.conditional_text → format user_direction

--- NEW MODULES ---
9.  io.load_json         → load core_aesthetics.json
10. user.pause           → display available aesthetics (help text)
11. user.text_input      → capture aesthetic selection (e.g., "1p2, 5b4")
12. transform.parse_pattern → parse into structured selections
    - If invalid: re-prompts via error_behavior: "reprompt"
--- END NEW ---

13. db.query             → load_keywords_generated
14. db.query             → load_keywords_selected
15. user.pause           → debug_keyword_query
16. api.llm              → aesthetic_concepts_api (uses dynamic prompt sections)
17. history.keyword_history → save_keywords
18. user.select          → select_concept
19. history.keyword_history → update_selected_keywords
20. io.save_json         → save aesthetic_concepts.json
21. api.llm              → scene_expansion
22. io.save_json         → save scene_summary.json
```

### Prompt Structure

#### aesthetic_concepts_generation_system.txt (Updated)

```
You are an expert at generating aesthetic concepts for anime/Ghibli/lofi style videos.

Your task is to generate original and genuinely distinct aesthetic concepts that align with the user's selections AND avoid previously used conceptual territory as much as possible.

[... general instructions ...]

====================================================
CORE AESTHETIC REQUIREMENTS
====================================================

You will receive one or more CORE AESTHETIC BLOCKS below. Each block specifies:
- The aesthetic type (e.g., Futuristic, Mystical, Cozy/Warmth)
- How many concepts to generate for that aesthetic
- Whether concepts should have a person or not
- Visual language, constraints, and guidance

You MUST follow each block's requirements exactly.

{{ state.rendered_aesthetic_sections }}

====================================================
ANTI-REPETITION & NOVELTY RULES
====================================================

[... existing anti-repetition content ...]
```

#### core_aesthetic_prompt_template.txt (New)

```jinja2
----------------------------------------------------
CORE AESTHETIC BLOCK: {{ aesthetic.label | upper }}
----------------------------------------------------

Aesthetic ID: {{ aesthetic.id }}
Required Count: {{ total_count }} concept(s)

PERSON MODE:
{% if person_mode == "with_person" %}
- ALL {{ total_count }} concepts MUST have has_person = true
{% elif person_mode == "without_person" %}
- ALL {{ total_count }} concepts MUST have has_person = false
{% else %}
- {{ with_count }} concept(s) MUST have has_person = true
- {{ without_count }} concept(s) MUST have has_person = false
{% endif %}

DEFINITION:
{{ aesthetic.definition }}

DESCRIPTION:
{{ aesthetic.description }}

MOTIVATIONAL FIT:
{{ aesthetic.motivational_fit | join(", ") }}

VISUAL LANGUAGE:
- Materials: {{ aesthetic.visual_language.materials | join(", ") }}
- Lighting: {{ aesthetic.visual_language.lighting | join(", ") }}
- Composition: {{ aesthetic.visual_language.composition | join(", ") }}
- Motion Cues: {{ aesthetic.visual_language.motion_cues | join(", ") }}

CONSTRAINTS:
- MUST INCLUDE: {{ aesthetic.constraints.must_include | join("; ") }}
- MUST AVOID: {{ aesthetic.constraints.must_avoid | join("; ") }}
- Borderline (avoid): {{ aesthetic.constraints.borderline_examples | join("; ") }}

PERSON RULES:
{% if person_mode != "without_person" %}
- When has_person = true: {{ aesthetic.person_rule.when_has_person_true }}
{% endif %}
{% if person_mode != "with_person" %}
- When has_person = false: {{ aesthetic.person_rule.when_has_person_false }}
{% endif %}

PROMPTING GUIDANCE:
- Positive keywords: {{ aesthetic.prompting_guidance.keywords_positive | join(", ") }}
- Negative keywords: {{ aesthetic.prompting_guidance.keywords_negative | join(", ") }}

```

### Schema Updates

#### aesthetic_concepts_schema.json

Add to each concept:
```json
{
  "aesthetic_id": {
    "type": "string",
    "description": "The core aesthetic ID this concept belongs to"
  }
}
```

### TUI Display

Before the text input, show a formatted list:
```
Available Core Aesthetics:
  1. Futuristic    - Forward-looking, technology-driven environments
  2. Mystical      - Ethereal, dreamlike realms beyond physics
  3. Real World    - Grounded, recognizable Earth contexts
  4. Nature        - Big landscapes and elemental forces
  5. Cozy/Warmth   - Soft, comforting spaces
  6. Minimal/Zen   - Silence, clarity through simplicity
  7. Symbolic      - Visual metaphors for transformation
  8. Retro/Analog  - Nostalgia-driven grit and craft

Enter selections (e.g., "1p2, 5b4" = 2 Futuristic with person, 4 Cozy both):
```

## Dependencies

### New Python Package

```
simpleeval>=0.9.13
```

Add to requirements.txt for safe expression evaluation in `transform.parse_pattern`.

## Migration

No database migration required. This is a workflow configuration change only.

## Testing

1. Unit tests for `transform.parse_pattern`:
   - Pattern parsing with various formats
   - Lookup by position and by field
   - Value mappings
   - Computed fields with simpleeval
   - Validation rules
   - Error handling and reprompt behavior

2. Integration tests:
   - Full step 1 flow with new selection
   - Various selection combinations
   - Edge cases (single selection, max selections, invalid input)

## Rollback

If issues arise:
1. Revert step.json to use hardcoded distribution
2. Revert prompt files
3. Module can remain (unused) as it's generic
