# Display Schema Processing

This document defines how display schemas are processed to render structured data in both TUI and WebUI.

## Overview

Display schemas extend JSON Schema with rendering hints that control how data is displayed to users. The same schema definition is used by:
- **TUI:** `tui/strategies/mixins.py` (SchemaRenderMixin)
- **WebUI:** Any component that renders structured data (structured-select, review, etc.)

## Core Principle: Recursive Schema Processing

Schema processing is **recursive**, not a priority-based if/else cascade.

When rendering any data node with its schema:
1. Check if THIS node has rendering instructions (`display_format`, `display: true`)
2. If so, render THIS node accordingly
3. Then recursively process child nodes with their schemas

**Important:** A parent having `display_format` does NOT prevent children from being processed. Each schema node is processed independently.

---

## Rendering a Schema Node

For any schema node, check these properties:

### 1. `display_format` (Jinja2 Template)
If present, render the data using this Jinja2 template.

```json
{
  "display_format": "{{ title }}: {{ description }}"
}
```

**Note:** `display_format` is a **Jinja2 template**, not "Jinja2-like". WebUI should use [Nunjucks](https://mozilla.github.io/nunjucks/) library for proper Jinja2 support.

The `[color:field_name]` syntax is pre-processed before Jinja2 rendering (used in color display schemas).

### 2. `display: true` (Field Visibility)
If a property has `display: true`, render it.
If `display: false` or absent, skip it.

Default is `false` - fields are hidden unless explicitly marked for display.

### 3. `display_label` (Custom Label)
If present, use this as the field label.
If absent, use the field name **as-is** (no title-casing or transformation).

```json
"aesthetic_title": {
  "type": "string",
  "display": true,
  "display_label": "Aesthetic"
}
// Renders: "Aesthetic: <value>"

"some_field": {
  "type": "string",
  "display": true
}
// Renders: "some_field: <value>" (no transformation)
```

### 4. `highlight` and `highlight_color`
Visual emphasis for fields.

```json
{
  "display": true,
  "highlight": true,
  "highlight_color": "#FF5500"  // Optional, defaults to cyan
}
```

---

## Processing Arrays

When schema `type` is `"array"`:

1. **If array has `display_format`:** Render using that template for the whole array or each item
2. **If no `display_format`:** Process each item using `schema.items`

There is no special "array schema vs items schema" distinction. You simply use the schema at each level:
- Array level schema for array-level rendering decisions
- `items` schema when iterating array items

```json
{
  "type": "array",
  "display_format": "{{ name }} - {{ value }}",  // Used for each item
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "value": { "type": "number" }
    }
  }
}
```

---

## Processing Objects

When schema `type` is `"object"`:

1. **If object has `display_format`:** Render using that template
2. **Process `properties`:** For each property with `display: true`, render it
3. **Recurse:** If a property contains nested objects/arrays, process them with their schemas

```json
{
  "type": "object",
  "properties": {
    "title": { "type": "string", "display": true },
    "hidden": { "type": "string" },  // No display, skip
    "nested": {
      "type": "object",
      "properties": {
        "inner": { "type": "string", "display": true }
      }
    }
  }
}
```

---

## Selectable Arrays

`selectable: true` indicates that array items can be selected by the user.

```json
{
  "type": "array",
  "selectable": true,
  "items": { ... }
}
```

This affects **interaction behavior** (items become clickable/selectable), not display rendering. The display schema rules still apply - use `display_format` or `display: true` properties as usual.

When rendering an object that contains a selectable array:
- Non-selectable fields with `display: true` are rendered normally
- The selectable array is rendered as interactive selection options

---

## Template Syntax (Jinja2)

All `display_format` values are **Jinja2 templates**.

### Variable Substitution
```
{{ field_name }}
```

### Filters
```
{{ field_name | filter_name }}
{{ field_name | replace('\n', ' ') }}
{{ items | join(', ') }}
```

Jinja2 built-in filters are supported via Nunjucks.

### Color Swatch Syntax (Pre-processed)
```
[color:field_name]
```

This is a custom extension pre-processed before Jinja2. Renders a color swatch + hex value.

**Real example from `color_display_schema.json`:**
```json
{
  "display_format": "{{ font_name.ljust(30)[:30] }} | [color:text_color] [color:stroke_color] [color:shadow_color] | ..."
}
```

---

## No Fallback Rendering

If a field does not have `display: true`, it is not rendered. Period.

There is no "fallback" rendering that guesses what to show. The schema must explicitly specify what to display.

---

## Example: Nested Structure

```json
// Schema
{
  "type": "object",
  "properties": {
    "aesthetic_concepts": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "aesthetic_title": { "type": "string", "display": true },
          "aesthetic_description": { "type": "string", "display": true },
          "ideas": {
            "type": "array",
            "selectable": true,
            "items": {
              "type": "object",
              "display_format": "{{ idea_title }}",
              "properties": {
                "idea_title": { "type": "string" },
                "idea_description": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

**Processing:**
1. `aesthetic_concepts` is an array → iterate items
2. Each aesthetic item:
   - Render `aesthetic_title` (display: true)
   - Render `aesthetic_description` (display: true)
   - `ideas` is selectable array → render as selectable options
3. Each idea item:
   - Has `display_format` → use template "{{ idea_title }}"

---

## Addon Data

Items may have `_addon` metadata:
```json
{
  "aesthetic_title": "Modern",
  "_addon": {
    "color": "#4A90D9",
    "score": 85,
    "last_used": "2025-12-30T10:00:00Z"
  }
}
```

This is supplementary display data (color swatches, compatibility scores, recency) added by the server.

---

## Implementation

### TUI
- `tui/strategies/mixins.py` - SchemaRenderMixin
  - `_display_schema_fields()` - Render fields with display: true
  - `_display_schema_data()` - Parse schema and extract selectable items
  - `_format_display_string()` - Jinja2 template rendering with [color:] pre-processing

### WebUI
- Use **Nunjucks** library for Jinja2 template rendering
- Pre-process `[color:field]` syntax before Nunjucks
- `schema-renderer.tsx` - React components for field rendering
- `schema-utils.ts` - Schema parsing
- `template-parser.ts` - Template pre-processing (to be replaced with Nunjucks)
