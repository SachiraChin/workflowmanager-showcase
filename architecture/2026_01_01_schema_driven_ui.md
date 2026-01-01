# Schema-Driven UI Architecture

**Version:** 0.1
**Date:** 2026-01-01

---

## Overview

This document discusses the architecture for rendering workflow interactions in the WebUI, specifically how data and schema flow from server to UI components.

---

## Current Problem

### Observed Issue

The `ReviewGroupedListControlled` component shows empty content for the ElevenLabs prompt review step, despite valid data being present.

**Interaction Data Received:**
```json
{
  "data": {
    "track_title": "Starwell Reverie",
    "elevenlabs_prompt_precise": "Delicate nostalgic mystical ambient...",
    "elevenlabs_prompt_evocative": "A fragile, mystical lullaby...",
    "elevenlabs_prompt_voiceover": "Soft, distant dusty music box..."
  },
  "schema": {
    "type": "object",
    "display_mode": "review",
    "properties": {
      "track_title": { "type": "string", "display": true, "display_label": "Track Title" },
      "elevenlabs_prompt_precise": { "type": "string", "display": true, "display_label": "Precise Prompt" }
    }
  }
}
```

### Root Cause

The `parseGroups` function in `ReviewGroupedListControlled.tsx` only creates groups from **object-type values**:

```typescript
for (const [key, value] of Object.entries(rootData)) {
  if (typeof value !== "object" || value === null) continue;  // <-- Skips strings!
  groups.push({ ... });
}
```

Since all values are strings, no groups are created, and `display: true` is never checked.

> **Q:** Why was parseGroups designed this way? Was there a specific use case?

### Fundamental Issue

The code is **data-structure-driven**, not **schema-driven**. It assumes:

- Groups = nested objects in data
- Ignores `display: true` property entirely

The schema explicitly defines what to display, but `parseGroups` ignores it.

---

## Desired Architecture

### High-Level Flow

```
Server Response
      │
      ▼
┌─────────────────┐
│  data + schema  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Schema Interpreter             │  <-- Single source of truth
│  - Reads schema properties      │
│  - Applies display rules        │
│  - Outputs renderable items     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Component Router               │
│  - Looks at display_mode        │
│  - Routes to appropriate        │
│    component variant            │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  UI Component                   │
│  - Receives structured items    │
│  - Renders with appropriate UX  │
└─────────────────────────────────┘
```

---

## Design Questions

### Question 1: Schema Awareness Boundary

Where should schema interpretation happen?

**Option A: Components receive raw data + schema**
```typescript
function ReviewList({ data, schema }) {
  // Component interprets schema itself
  const fields = Object.entries(schema.properties)
    .filter(([_, prop]) => prop.display === true);
}
```

**Option B: Pre-processed data, schema-unaware components**
```typescript
// Central transformer
const items = transformForDisplay(data, schema);

function ReviewList({ items }) {
  // Just render what it's given
  return items.map(item => <Field {...item} />);
}
```

**Option C: Shared utilities, components use them**
```typescript
import { getDisplayFields } from "@/lib/schema-utils";

function ReviewList({ data, schema }) {
  const fields = getDisplayFields(data, schema);  // Shared logic
  return fields.map(f => <Field {...f} />);
}
```

> **TODO:** Decide which option - currently leaning toward C

---

### Question 2: Schema-Enhanced UX

Can schema hints enable richer component behavior?

**Current Schema (minimal):**
```json
{
  "track_title": { "type": "string", "display": true, "display_label": "Track Title" }
}
```

**Enhanced Schema (with UX hints):**
```json
{
  "track_title": {
    "type": "string",
    "display": true,
    "display_label": "Track Title",
    "display_style": "heading"
  },
  "elevenlabs_prompt_precise": {
    "type": "string",
    "display": true,
    "display_label": "Precise Prompt",
    "display_style": "multiline",
    "copyable": true,
    "collapsible": true,
    "max_lines": 5
  }
}
```

**What components could do with enhanced schema:**

| Schema Hint | Component Behavior |
|-------------|-------------------|
| `display_style: "heading"` | Render as `<h3>` instead of plain text |
| `display_style: "multiline"` | Use styled box with proper whitespace |
| `copyable: true` | Add copy-to-clipboard button |
| `collapsible: true` | Show "Show more" for long content |
| `type: "color"` | Render color swatch instead of hex string |
| `type: "url"` | Render as clickable link |

---

### Question 3: Type-Aware Rendering

Should components render differently based on `type`?

**Example: Color fields**
```typescript
function renderValue(value: unknown, schema: SchemaProperty) {
  switch (schema.type) {
    case "color":
      return <ColorSwatch color={value} />;
    case "url":
      return <a href={value}>{value}</a>;
    case "array":
      if (schema.display_style === "pills")
        return <PillList items={value} />;
      return value.join(", ");
    default:
      return <span>{value}</span>;
  }
}
```

> **Q:** Is this overcomplicating things? Or is this the right level of intelligence?

---

## Proposed Schema Properties

Standard properties that components should understand:

### Display Control

| Property | Type | Description |
|----------|------|-------------|
| `display` | boolean | Whether to show this field |
| `display_label` | string | Human-readable label |
| `display_order` | number | Order in which to display (lower first) |
| `display_style` | string | How to render: "default", "heading", "multiline", "code", "pills" |

### UX Enhancements

| Property | Type | Description |
|----------|------|-------------|
| `copyable` | boolean | Add copy button |
| `collapsible` | boolean | Allow expand/collapse for long content |
| `max_lines` | number | Truncate after N lines if collapsible |
| `editable` | boolean | Allow inline editing (future) |

### Type-Specific Rendering

| Type | Rendering |
|------|-----------|
| `string` | Plain text (or multiline based on display_style) |
| `color` | Color swatch + hex value |
| `url` | Clickable link |
| `array` | Comma list or pills based on display_style |
| `object` | Nested display with recursion |

---

## Implementation Plan

> **TODO:** Fill in after discussion

### Phase 1: Fix Immediate Issue

1. Update `parseGroups` to handle flat data with `display: true` fields
2. Ensure ElevenLabs prompt review works

### Phase 2: Centralize Schema Interpretation

1. Create unified `getDisplayFields(data, schema)` utility
2. Migrate components to use shared utility

### Phase 3: Enhanced UX (Optional)

1. Add support for `copyable`, `collapsible`, etc.
2. Create type-aware rendering for `color`, `url`, etc.

---

## Open Questions

1. Should we support custom schema properties defined by workflow authors?
2. How do we handle backwards compatibility if we add new schema properties?
3. Should display_mode affect parsing logic, or just component selection?

---

## Comments

<!-- Add discussion comments below -->
