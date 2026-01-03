# Workflow-Agnostic Rendering Principle

**Date:** 2026-01-01
**Status:** Draft - Pending Review
**Purpose:** Define the fundamental principle that ALL UI components must follow

---

## Core Principle

**UI components MUST NOT access data fields by name.**

All data access and display decisions MUST be driven by schema. Components receive:
1. `data` - opaque payload (unknown structure)
2. `schema` - instructions on how to interpret and render the data

The component's job is to follow schema instructions, NOT to understand or assume data structure.

---

## What This Means

### WRONG - Direct Field Access

```typescript
// ❌ Accessing data fields by name
const label = data.aesthetic_title;
const description = data.visual_description;
const color = data.primary_color;

// ❌ Checking for specific field names
if (data.theme_name) { ... }

// ❌ Guessing which field to use
for (const field of ["label", "name", "title", "aesthetic_title"]) {
  if (data[field]) return data[field];
}
```

### CORRECT - Schema-Driven Access

```typescript
// ✅ Iterate schema.properties - keys come from schema
for (const [key, propSchema] of Object.entries(schema.properties)) {
  if (propSchema.display === true) {
    const value = data[key];  // Key from schema iteration, not hardcoded
    const label = propSchema.display_label || key;  // Fallback to raw key
    const renderAs = propSchema.render_as || "text";  // Fallback to plain text
    // render using schema instructions
  }
}

// ✅ Use display_format for dynamic content
if (schema.display_format) {
  const rendered = renderTemplate(schema.display_format, data);
}
```

---

## Why This Matters

1. **Workflow Independence**: The same components render ANY workflow without modification
2. **No Hidden Assumptions**: All behavior is explicit in schema
3. **Predictability**: Schema author controls rendering, not hidden code logic
4. **Maintainability**: Adding new workflows never requires UI code changes

---

## Current Violations Found

### WebUI Violations

### 1. `getItemLabel()` in `schema-utils.ts:375-389`

```typescript
// VIOLATION: Hardcoded workflow-specific field names
for (const field of ["label", "name", "title", "aesthetic_title", "id", "value"]) {
  if (typeof item[field] === "string" && item[field]) {
    return item[field] as string;
  }
}
```

### 2. `getItemDescription()` in `schema-utils.ts:394-409`

```typescript
// VIOLATION: Hardcoded workflow-specific field names
for (const field of [
  "description",
  "aesthetic_description",
  "visual_description",
  "summary",
  "details",
]) { ... }
```

### 3. `getItemAddon()` in `schema-utils.ts:423-427`

```typescript
// VIOLATION: Assumes _addon field exists
return item._addon as AddonData | undefined;
```

### 4. Components using these functions

- `SelectableItem.tsx:54-55` - uses `getItemLabel`, `getItemAddon`
- `DisplayArray.tsx:118-119` - uses `getItemLabel`, `getItemAddon`

### TUI Violations (for reference)

TUI also has some violations that should be cleaned up:

**Line 540-541** - Hardcoded label guessing:
```python
label = item.get('label') or item.get('name', '')
```

**Line 548-549** - Hardcoded description access:
```python
if isinstance(item, dict) and item.get('description'):
```

**Lines 683-715** - Workflow-specific rendering:
```python
if display_type == 'elevenlabs_prompts':
    self._render_elevenlabs_prompts(data)
```

---

## Existing Schema Properties (Already Sufficient)

**No new schema properties are needed.** The existing properties handle all cases:

| Property | Type | Purpose |
|----------|------|---------|
| `display` | boolean | Whether to display this field |
| `display_label` | string | Static label for the field. If missing, use raw field key. |
| `display_order` | number | Sort order for display |
| `display_format` | string | Jinja2 template for rendering (can reference any field) |
| `render_as` | string | How to render: `text` (default), `color`, `url`, etc. |
| `nudges` | string[] | UI enhancements: `copy`, `swatch`, etc. |
| `selectable` | boolean | Whether array items can be selected |
| `highlight` | boolean | Whether to visually emphasize this field |
| `highlight_color` | string | Color for highlighting |
| `computed` | object | Computed fields with templates |

### How to Handle Labels

Use `display_format` on items schema:
```json
{
  "type": "array",
  "items": {
    "type": "object",
    "display_format": "{{ aesthetic_title }}",
    "properties": { ... }
  }
}
```

If no `display_format`, render using `display: true` properties only.

### How to Handle "Descriptions"

**No special handling.** If you want to display a description field:
1. Mark it with `display: true`
2. Optionally use `display_format` for formatting

There is no concept of a "special description" - just fields with `display: true`.

### About `_addon` Data

`_addon` is a **server-side convention**, not a workflow field:
- Server modules (like `usage_history`) inject `_addon` into items
- Contains: `color`, `score`, `last_used`
- Client reads `item._addon` if present

This is acceptable because:
1. `_addon` is a **reserved convention**, not workflow-specific
2. It's **server-injected**, not assumed from workflow data
3. It's **optional** - items without `_addon` render normally

```typescript
// ✅ Acceptable - reading server-injected convention
const addon = item._addon as AddonData | undefined;
if (addon?.color) { /* apply color */ }
```

---

## Implementation Rules

### Rule 1: No Hardcoded Field Names

Components MUST NOT contain any workflow-specific field names:
- ❌ `aesthetic_title`, `visual_description`, `theme_name`
- ❌ `primary_color`, `similarity_score`
- ❌ Any field name that only makes sense in one workflow

**Exception:** `_addon` is acceptable (server-injected convention).

### Rule 2: All Field Access Via Schema Iteration

```typescript
// ✅ CORRECT - iterate schema.properties
for (const [key, propSchema] of Object.entries(schema.properties || {})) {
  if (propSchema.display === true) {
    const value = data[key];  // Key comes from schema
    const label = propSchema.display_label || key;  // Fallback to raw key
    const renderAs = propSchema.render_as || "text";  // Fallback to plain text
    // render using schema instructions
  }
}

// ✅ CORRECT - evaluate display_format template
if (schema.display_format) {
  const rendered = renderTemplate(schema.display_format, data);
}

// ✅ CORRECT - read server-injected _addon
const addon = data._addon as AddonData | undefined;
```

### Rule 3: No "Smart" Fallbacks

```typescript
// ❌ WRONG - trying to be helpful by guessing
const label = data.name || data.title || data.label || "Item";

// ✅ CORRECT - use what schema provides
const label = propSchema.display_label || key;  // Fallback to raw key only
```

**Fallback hierarchy:**
1. `display_label` if provided → use it
2. No `display_label` → use raw field key (no formatting, no Title Case)
3. `display: true` but no renderable content → show error

**For `render_as`:**
- If missing, default to `"text"` (render as plain string)
- Never guess based on value type or field name

### Rule 4: Fail Loudly for Missing Schema

When schema doesn't specify how to render something, show an error - don't guess:

```typescript
// If schema has no displayable properties, show error
const displayableFields = Object.entries(schema.properties || {})
  .filter(([_, p]) => p.display === true);

if (displayableFields.length === 0 && !schema.display_format) {
  return <ErrorRenderer message="Schema has no displayable fields" />;
}
```

---

## Migration Path

1. **Phase 1: Document violations** (this document)
2. **Phase 2: Update workflow schemas** to ensure all displayed fields have proper schema
3. **Phase 3: Remove violating code** from WebUI components
4. **Phase 4: Clean up TUI violations** (lower priority, TUI works)
5. **Phase 5: Add error rendering** for missing schema configuration

---

## Decisions Made

1. **No new schema properties needed** - `display_format` handles dynamic labels
2. **No special "description" concept** - just use `display: true` on fields
3. **Fallback for missing display_label** - use raw field key (no formatting)
4. **Fallback for missing render_as** - default to `"text"` (plain string)
5. **Error behavior** - show error when schema doesn't specify displayable content
6. **Backwards compatibility** - existing fields keep their meaning, can add new fields

---

## Checklist for Code Review

Before approving any UI component change, verify:

- [ ] No hardcoded field names (search for quotes around field names)
- [ ] All data access goes through schema iteration
- [ ] No "guessing" logic for labels/descriptions
- [ ] Error handling for missing schema configuration
- [ ] No workflow-specific logic anywhere in the component

---

## Notes

This document should be referenced in CLAUDE.md to ensure future changes follow these principles.
