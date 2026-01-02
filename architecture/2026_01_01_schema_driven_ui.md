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

## Complete Data Flow

> **📄 Full visualization available:** [2026_01_01_schema_driven_ui_flow.html](./2026_01_01_schema_driven_ui_flow.html)

### Workflow JSON → Server Module → InteractionType → WebUI Component

The `interaction_type` is NOT specified in workflow JSON. Instead, workflow JSON specifies a **module_id** and the module determines the interaction type:

| Workflow module_id | Module Input | InteractionType | WebUI Host |
|-------------------|--------------|-----------------|------------|
| `user.select` | `mode: "select"` (default) | `select_from_structured` | StructuredSelectHost |
| `user.select` | `mode: "review"` | `review_grouped` | ReviewGroupedHost |
| `user.text_input` | (always) | `text_input` | TextInputHost |
| `user.pause` | (always) | `text_input` | TextInputHost |
| `user.file_input` | (always) | `file_input` | FileInputHost |
| `io.client_write` | (always) | `file_download` | FileDownloadHost |

**Source files:**
- `contracts/interactions.py:16-28` - InteractionType enum
- `server/modules/user/select.py:172-176` - mode → interaction_type mapping

### Where Schema is Currently Used

| Component | Schema Source | Parsing Function | Issue |
|-----------|--------------|------------------|-------|
| ReviewGroupedListControlled | `request.display_data.schema` | `parseGroups()` | Only handles nested objects |
| StructuredSelectListControlled | `request.display_data.schema` | `parseSchemaData()` in schema-utils.ts | Works but complex |
| SchemaFields | Passed from parent | Direct iteration | Works for nested display |
| DisplayComponents | `schema.display_components[]` | Direct rendering | Works |

---

## Detailed Component Hierarchy

> **📄 Complete component tree with all variants:** See [2026_01_01_schema_driven_ui_flow.html](./2026_01_01_schema_driven_ui_flow.html)

The HTML file shows every component without shortcuts. Below is a summary of the key schema-related components.

### StructuredSelectHost (Reference Implementation)

```
StructuredSelectHost
    │
    ├── Props: request (contains display_data.data + display_data.schema)
    ├── State: StructuredSelectState (selectedIndices, selectedData)
    │
    ├── StructuredSelectCardsControlled
    │   ├── parseSchemaData(data, schema)    ← schema-utils.ts:63
    │   │   └── Returns: { groups[], flatItems[] }
    │   │
    │   └── For each item:
    │       └── SchemaFields(data, schema)   ← schema-renderer.tsx:39
    │           ├── Checks: schema.properties[key].display === true
    │           └── SchemaField(key, value, propSchema)
    │               ├── type="array"  → ArrayField
    │               ├── type="object" → recurse SchemaFields
    │               └── primitive     → <span>{value}</span>
    │
    └── StructuredSelectListControlled
        ├── parseSchemaData(data, schema)    ← same utility
        │   └── Returns: { groups[], flatItems[] }
        │
        ├── GroupSection (header + parent info)
        │   └── SchemaFields for parentData
        │
        └── SelectableListItem
            ├── DisplayComponents (if display_components present)
            │   └── DisplayComponentItem
            │       ├── type="color" → ColorSwatch
            │       ├── type="url" → <a href>
            │       └── default → <span>
            │
            ├── OR: renderTemplate(displayFormat)
            │
            └── OR: SchemaFields (fallback)
```

### ReviewGroupedHost

```
ReviewGroupedHost
    │
    ├── Props: request (contains display_data.data + display_data.schema)
    ├── State: ReviewGroupedState (feedbackByGroup, retryGroups)
    │
    ├── ReviewGroupedCardsControlled
    │   ├── parseGroups(data, schema)        ← LOCAL function (line 42-84)
    │   └── For each group:
    │       └── SchemaFields(group.data, group.schema)
    │
    └── ReviewGroupedListControlled
        ├── parseGroups(data, schema)        ← LOCAL function (line 38-78)
        └── For each group:
            └── SchemaFields(group.data, group.schema)
```

**Key Files:**
- `structured-select/schema-utils.ts:63` - `parseSchemaData()` - finds selectable items
- `structured-select/schema-renderer.tsx:39` - `SchemaFields()` - renders display:true fields
- `structured-select/schema-renderer.tsx:217` - `SchemaField()` - renders single field

---

## Schema Property Types: Clarification

> **Response to comment:** "type in schema is json schema compliant type, not a type we can just add new types"

Correct. The schema follows JSON Schema, where `type` is one of: `string`, `number`, `integer`, `boolean`, `array`, `object`, `null`.

### Two Categories of Properties

| Category | Purpose | JSON Schema Compliant? |
|----------|---------|------------------------|
| **Data Type** | `type` - What the value IS | Yes - standard JSON Schema |
| **Display Hints** | `format`, `display_*` - How to RENDER it | Extensions (allowed by JSON Schema) |

### Schema Property Naming Convention

To avoid confusion between JSON Schema standard properties and our extensions:

| Property | Origin | Purpose | Example |
|----------|--------|---------|---------|
| `type` | JSON Schema | Data type of value | `"string"`, `"array"`, `"object"` |
| `format` | JSON Schema | Semantic subtype for rendering | `"color"`, `"uri"`, `"date-time"` |
| `display` | **Our extension** | Whether to show this field | `true` / `false` |
| `display_label` | **Our extension** | Human-readable label | `"Track Title"` |
| `display_format` | **Our extension** | Nunjucks template for custom rendering | `"{{ name }} ({{ count }})"` |
| `display_mode` | **Our extension** | Layout mode hint for entire schema | `"review"`, `"cards"` |
| `display_components` | **Our extension** | Array of structured render instructions | `[{field: "color", type: "color"}]` |

**Naming rule:** All our custom properties use `display_` prefix, except `selectable`.

### Using `format` for Semantic Type

JSON Schema has a `format` keyword for semantic string types. We leverage this for rendering:

```json
{
  "primary_color": {
    "type": "string",           // JSON Schema: data type
    "format": "color",          // JSON Schema: semantic hint → render as ColorSwatch
    "display": true,            // Our extension: show this field
    "display_label": "Primary Color"  // Our extension: label text
  },
  "description": {
    "type": "string",
    "display": true,
    "display_format": "{{ value | truncate(100) }}"  // Our extension: Nunjucks template
  }
}
```

**Key distinction:**
- `format` = What kind of data it is (color, uri, date-time) → affects **how** to render
- `display_format` = Custom template string → **override** default rendering

### Rendering Decision Matrix

```
┌─────────────┬───────────────┬──────────────────────────────────┐
│ type        │ format        │ Rendering                        │
├─────────────┼───────────────┼──────────────────────────────────┤
│ string      │ (none)        │ Plain text                       │
│ string      │ color         │ ColorSwatch + hex value          │
│ string      │ uri           │ Clickable link                   │
│ string      │ date-time     │ Formatted date                   │
│ string      │ multiline     │ Pre-formatted block (custom)     │
├─────────────┼───────────────┼──────────────────────────────────┤
│ array       │ (none)        │ Comma-separated or list          │
│ array       │ pills         │ Badge/pill list (custom)         │
├─────────────┼───────────────┼──────────────────────────────────┤
│ object      │ (none)        │ Recurse with SchemaFields        │
└─────────────┴───────────────┴──────────────────────────────────┘
```

### Current Implementation in schema-renderer.tsx

The `DisplayComponentItem` already handles some formats:

```typescript
// schema-renderer.tsx:157-193
if (type === "color" && typeof value === "string") {
  return <ColorSwatch color={value} />;
}
if (type === "image" && typeof value === "string") {
  return <span className="text-xs">{displayValue}</span>;
}
if (type === "url" && typeof value === "string") {
  return <a href={value}>{value}</a>;
}
```

Note: This uses `type` from `display_components[].type`, NOT from schema `type`.
This is correct - `display_components` is our custom structure, separate from JSON Schema.

> **📄 See complete hierarchy:** [2026_01_01_schema_driven_ui_flow.html](./2026_01_01_schema_driven_ui_flow.html) shows exactly how each property flows through components.

---

## How the Design Layers Build On Each Other

The three questions are NOT parallel alternatives - they are **layers**:

```
Layer 3: Enhanced UX Hints (copyable, collapsible, etc.)
         ↑ Builds on
Layer 2: Semantic Rendering (format: "color" → ColorSwatch)
         ↑ Builds on
Layer 1: Basic Display Control (display: true/false, display_label)
         ↑ Builds on
Layer 0: Fix parseGroups to read schema at all
```

### Layer 0: Current Bug Fix (Immediate)

**Problem:** `parseGroups` ignores schema entirely
**Solution:** Make it check `display: true` in schema.properties

### Layer 1: Basic Display Control (Already Working)

`SchemaFields` already implements this correctly:

```typescript
// schema-renderer.tsx:61-67
const fields = Object.entries(schema.properties)
  .filter(([key, propSchema]) => {
    if (propSchema.display !== true) return false;  // ← Respects display: true
    // ...
  });
```

### Layer 2: Semantic Rendering (Partially Implemented)

`DisplayComponentItem` handles some formats. To extend:

```typescript
function SchemaField({ fieldKey, schema, value, context }) {
  // Add format-aware rendering
  if (schema.type === "string") {
    if (schema.format === "color") {
      return <ColorSwatch color={value} showHex />;
    }
    if (schema.format === "uri") {
      return <a href={value}>{value}</a>;
    }
  }
  // ... existing code
}
```

### Layer 3: Enhanced UX (Future)

Only after Layers 0-2 work, add UX enhancements:

```typescript
function SchemaField({ fieldKey, schema, value }) {
  const content = renderByFormat(value, schema);

  // Layer 3 enhancements
  if (schema.copyable) {
    content = <CopyableWrapper>{content}</CopyableWrapper>;
  }
  if (schema.collapsible && value.length > (schema.max_lines || 5) * 80) {
    content = <CollapsibleWrapper maxLines={schema.max_lines}>{content}</CollapsibleWrapper>;
  }

  return content;
}
```

---

## Proposed Schema Properties

### Core Properties (JSON Schema Standard)

| Property | Type | Description |
|----------|------|-------------|
| `type` | string | JSON Schema type: string, number, array, object, etc. |
| `format` | string | Semantic format: color, uri, date-time, or custom |
| `items` | object | Schema for array elements |
| `properties` | object | Schemas for object properties |

### Display Control (Our Extensions)

| Property | Type | Description |
|----------|------|-------------|
| `display` | boolean | Whether to show this field |
| `display_label` | string | Human-readable label |
| `display_order` | number | Order in which to display (lower first) |
| `display_format` | string | Nunjucks template for custom rendering |

### UX Enhancements (Future)

| Property | Type | Description |
|----------|------|-------------|
| `copyable` | boolean | Add copy-to-clipboard button |
| `collapsible` | boolean | Allow expand/collapse for long content |
| `max_lines` | number | Truncate after N lines if collapsible |
| `highlight` | boolean | Highlight this field |
| `highlight_color` | string | Color for highlighting (hex) |

---

## Implementation Plan

### Phase 1: Fix Immediate Issue

**Goal:** ElevenLabs prompt review shows content

1. Update `parseGroups` in both ReviewGrouped variants to handle flat data with `display: true`
2. Test with ElevenLabs prompt review step

**Files to modify:**
- `review-grouped/ReviewGroupedListControlled.tsx` (lines 38-78)
- `review-grouped/ReviewGroupedCardsControlled.tsx` (lines 42-84)

### Phase 2: Unify Schema Utilities

**Goal:** Single source of truth for schema interpretation

1. Add `getDisplayFields(data, schema)` to `structured-select/schema-utils.ts`
2. Refactor `parseGroups` to use shared utility
3. Consider moving schema-utils to `@/lib/` for broader use

### Phase 3: Format-Aware Rendering

**Goal:** `format` property controls rendering

1. Add format handling to `SchemaField` component
2. Support: color, uri, date-time, multiline
3. Document in tech debt doc what TUI needs to implement

### Phase 4: UX Enhancements (Optional)

**Goal:** Rich interactive features

1. `copyable` - Copy button for long text
2. `collapsible` - Expand/collapse for multiline
3. Only implement if there's a concrete use case

---

## Decisions

1. ✅ Support custom schema properties defined by workflow authors
2. ✅ New schema fields must be documented in tech debt doc with TUI changes needed
3. ✅ `display_mode` affects component selection AND can affect parsing behavior
4. ✅ Use `format` (JSON Schema standard) for semantic type hints, not custom `type` values
