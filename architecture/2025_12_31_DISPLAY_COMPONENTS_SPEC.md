# Display Components Specification

**Date:** 2025-12-31
**Status:** Draft
**Purpose:** Define a platform-agnostic schema for rendering structured data across TUI, WebUI, and future clients.

## Problem Statement

The current `display_format` uses Python/Jinja2-specific syntax (e.g., `.ljust()`, `% formatting`) that only works in the TUI. This creates platform lock-in and prevents WebUI and other clients from rendering data consistently.

## Solution Overview

Introduce `display_components` - a declarative, structured approach to define how data should be rendered. Each platform interprets these components according to its native rendering capabilities.

## Schema Structure

### Placement

`display_components` is placed at the **array field level**, alongside existing `display_format`:

```json
{
  "options": {
    "type": "array",
    "selectable": true,
    "display_format": "...",
    "display_components": [...],
    "ux_nudge": "list",
    "items": {
      "type": "object",
      "properties": { ... }
    }
  }
}
```

### Precedence Rules

When rendering array items:

1. **`display_components`** exists → use it, ignore `display_format`
2. **`display_format`** exists → use it (legacy/TUI)
3. **Neither** → fall back to `display: true` fields in properties

This allows gradual migration while maintaining backward compatibility.

## Component Definition

### Basic Structure

```json
{
  "display_components": [
    { "field": "font_name", "display_label": "Font" },
    { "field": "text_color", "type": "color", "display_label": "Text" },
    { "field": "shadow_opacity", "prefix": "Opacity: ", "suffix": "%" },
    {
      "display_label": "Shadow Settings",
      "display_format": "{{ shadow_opacity }}% {{ shadow_angle }}deg"
    }
  ]
}
```

### Component Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `field` | string | No* | Data field to display |
| `display_label` | string | No | Label shown to user |
| `type` | string | No | Rendering type hint (see Types below) |
| `prefix` | string | No | Text prepended to value |
| `suffix` | string | No | Text appended to value |
| `display_format` | string | No | Template for complex rendering |

*Either `field` or `display_format` must be present.

### Component Types

| Type | Description | TUI Rendering | WebUI Rendering |
|------|-------------|---------------|-----------------|
| (default) | Plain text | Text | Text |
| `color` | Hex color value | Swatch + hex code | Color chip + hex |
| `image` | Image URL/path | Path text | Thumbnail |
| `url` | Hyperlink | Underlined text | Clickable link |

Platforms render types according to their capabilities. Unknown types fall back to plain text.

### Template Syntax in `display_format`

The `display_format` within a component follows the **same rules as the array-level `display_format`**. It uses Jinja2 template syntax with the universal subset that works across all platforms:

**Allowed (Jinja2 expressions):**
- `{{ field_name }}` - variable substitution
- `{{ field | filter }}` - filter application (see below)
- `{% if condition %}...{% endif %}` - conditionals
- `{% for item in list %}...{% endfor %}` - loops
- `{{ value + 1 }}`, `{{ a ~ b }}` - Jinja2 operators (arithmetic, concatenation)
- Literal text and symbols

**Not Allowed:**
- Python methods (`.ljust()`, `.upper()`, etc.)
- Python operators (`%` formatting)
- Platform-specific syntax

**Universal Filters:**
- `truncate(n)` - limit to n characters
- `default(val)` - fallback value
- `upper`, `lower` - case conversion

## UX Nudge

Optional hint for preferred display mode:

```json
{
  "ux_nudge": "list"
}
```

| Value | Description |
|-------|-------------|
| `list` | Vertical list of items |
| `table` | Tabular layout |
| `cards` | Card-based grid |
| `compact` | Minimal, inline display |
| `dropdown` | Collapsed selector |

This is **advisory only**. Clients use it if supported, ignore if not.

## Coexistence with `display: true`

For non-selectable parent fields (like group headers), the existing `display: true` pattern continues to work:

```json
{
  "themes": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "theme_name": {
          "type": "string",
          "display": true,
          "display_label": "Theme"
        },
        "options": {
          "type": "array",
          "selectable": true,
          "display_components": [...]
        }
      }
    }
  }
}
```

**Rendering result:**
- `theme_name` renders as group/section header
- `options` items render using `display_components`

## Complete Example

### Schema (color_display_schema.json)

```json
{
  "type": "object",
  "properties": {
    "themes": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "theme_name": {
            "type": "string",
            "display": true,
            "display_label": "Theme"
          },
          "options": {
            "type": "array",
            "selectable": true,
            "ux_nudge": "list",
            "display_components": [
              { "field": "font_name", "display_label": "Font" },
              { "field": "text_color", "type": "color", "display_label": "Text" },
              { "field": "stroke_color", "type": "color", "display_label": "Stroke" },
              { "field": "shadow_color", "type": "color", "display_label": "Shadow" },
              {
                "display_label": "Shadow",
                "display_format": "{{ shadow_opacity }}% {{ shadow_angle }}deg {{ shadow_distance }}px"
              }
            ],
            "items": {
              "type": "object",
              "properties": {
                "font_name": { "type": "string" },
                "text_color": { "type": "string" },
                "stroke_color": { "type": "string" },
                "shadow_color": { "type": "string" },
                "shadow_opacity": { "type": "integer" },
                "shadow_angle": { "type": "integer" },
                "shadow_distance": { "type": "integer" },
                "shadow_size": { "type": "integer" },
                "shadow_blur": { "type": "integer" }
              }
            }
          }
        }
      }
    }
  }
}
```

### Visual Rendering

```
┌─────────────────────────────────────────────────────────┐
│ Theme: Dark Mode Vibrant                                │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ○ Font: Montserrat Bold                             │ │
│ │   Text:   ████ #FFFFFF                              │ │
│ │   Stroke: ████ #000000                              │ │
│ │   Shadow: ████ #333333                              │ │
│ │   Shadow: 85% 135deg 4px                            │ │
│ ├─────────────────────────────────────────────────────┤ │
│ │ ● Font: Roboto Condensed                            │ │
│ │   Text:   ████ #FFD700                              │ │
│ │   Stroke: ████ #8B4513                              │ │
│ │   Shadow: ████ #000000                              │ │
│ │   Shadow: 90% 120deg 3px                            │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ Theme: Light Mode Clean                                 │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ ○ Font: Open Sans                                   │ │
│ │   ...                                               │ │
│ └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Implementation Notes

### WebUI

1. Parse `display_components` from schema
2. For each component:
   - If `type: "color"` → render `<ColorSwatch />` + hex text
   - If `display_format` → render with Nunjucks (universal syntax only)
   - Otherwise → render `display_label: value`
3. Respect `ux_nudge` for layout selection

### TUI

1. Check for `display_components` first
2. If present, render components using Rich/terminal formatting
3. If absent, fall back to existing `display_format` logic
4. Color type → ANSI color swatch + hex

### Migration Path

1. Add `display_components` to schemas alongside `display_format`
2. WebUI uses `display_components` immediately
3. TUI continues using `display_format`
4. Eventually update TUI to use `display_components`
5. Remove `display_format` when all clients migrated

## Future Considerations

- **Nested components**: Components containing child components
- **Conditional display**: Show/hide based on field values
- **Interactive components**: Editable fields, toggles
- **Validation display**: Inline error/warning indicators
