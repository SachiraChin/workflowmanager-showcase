# WebUI Structured Select Rendering - TUI Parity Implementation

This document tracks all TUI rendering logic paths that must be implemented in WebUI.
Source of truth for session continuity.

## Status: IMPLEMENTED - Ready for Testing

---

## TUI Source Files Analyzed

- `tui/strategies/mixins.py` - SchemaRenderMixin, ColorMixin, RetryableMixin
- `tui/strategies/select_structured.py` - SelectFromStructuredStrategy
- `tui/colors.py` - Color definitions

---

## TUI Logic Paths

### 1. Schema-Based Select Entry (`_handle_schema_based_select`)
Location: `select_structured.py:39-147`

**Flow:**
1. Extract `display_data.schema`, `display_data.data`, `multi_select`, `mode`
2. Set resolver context from `request.resolver_schema`
3. Display title/prompt
4. Call `_display_schema_data(data, schema, multi_select)` - returns selectable items
5. Handle empty selectable_items case
6. Display retryable options if present
7. Parse user selection
8. Build response with `selected_indices`, `selected_options`, `value`

**WebUI Implementation:** ✅
- `StructuredSelectCardsControlled.tsx` and `StructuredSelectListControlled.tsx`
- Extract schema, data, multi_select from request.display_data
- Call `parseSchemaData()` to get groups and selectable items
- Handle selection with `handleSelect()` function
- Submit response via onSubmit callback

### 2. Display Schema Data (`_display_schema_data`)
Location: `mixins.py:425-560`

**Schema Type Handlers:**

#### 2.1 Root Object with Selectable additionalProperties ✅
- Condition: `schema.type === "object"` AND `schema.selectable === true` AND `additionalProperties` exists
- Each key in data becomes a selectable item
- Indices: `[key]` (string key, not numeric)
- **WebUI:** `schema-utils.ts` lines 110-134

#### 2.2 Root Object with Array Properties ✅
- Condition: `schema.type === "object"` with `properties`
- Iterates through schema.properties looking for arrays
- **WebUI:** `schema-utils.ts` lines 137-241

##### 2.2.1 Array with `selectable: true` (no nested selectables) ✅
- Direct array items are selectable
- Indices: `[key, idx]`
- Uses `display_format` OR `_display_schema_fields`
- **WebUI:** `schema-utils.ts` lines 151-171

##### 2.2.2 Array with Nested Selectable Arrays ✅
- Condition: `_has_nested_selectable(items_schema)` returns true
- For each parent item:
  - Display parent header with highlight colors
  - Call `_display_schema_fields(item, items_schema)` for parent fields
  - Call `_display_nested_selectable(item, items_schema, [key, item_idx], start_number)`
- Indices: `[key, parent_idx, child_idx]`
- **WebUI:** `schema-utils.ts` lines 172-204, rendering in components via `group.parentData`

##### 2.2.3 Non-selectable Array (display only) ✅
- Just displays items, no selection
- **WebUI:** `schema-renderer.tsx` `SchemaFields` component handles non-selectable arrays

#### 2.3 Root Array ✅
- Condition: `schema.type === "array"`
- If `selectable: true`: each item is selectable
- Indices: `[idx]`
- Uses `display_format` OR label/description + `_display_schema_fields`
- **WebUI:** `schema-utils.ts` lines 72-101

### 3. Has Nested Selectable (`_has_nested_selectable`) ✅
Location: `mixins.py:562-575`

**Logic:**
- Returns false if schema.type !== "object"
- Checks each property in schema.properties:
  - If prop.type === "array" AND prop.selectable: return true
  - If prop.type === "array": recursively check items schema
- Returns false if no nested selectables found

**WebUI:** `schema-utils.ts` `hasNestedSelectable()` function, lines 250-274

### 4. Display Nested Selectable (`_display_nested_selectable`) ✅
Location: `mixins.py:577-615`

**Parameters:** `parent_data`, `parent_schema`, `parent_indices`, `start_number`

**Flow:**
1. Return empty if parent_schema.type !== "object"
2. For each property in parent_schema.properties:
   - Skip if not array type
   - Get array data from parent_data[key]
   - If `selectable: true`:
     - Display each child with number
     - Use `display_format` OR `_display_schema_fields`
     - Build item with indices: `parent_indices + [child_idx]`

**WebUI:** `schema-utils.ts` `parseNestedSelectable()` function, lines 284-328

### 5. Display Schema Fields (`_display_schema_fields`) ✅
Location: `mixins.py:617-673`

**Critical Rendering Logic:**

For each property in schema.properties:
1. Skip if `display: false` (default is false for fields!)
2. Skip selectable arrays (handled separately)
3. For non-selectable arrays:
   - Get display_label, display_format
   - Check highlight and highlight_color
   - If display_format === "join": join array values
   - Else: display as numbered list
4. For scalar values:
   - Get display_label, highlight, highlight_color
   - If highlight: use highlight color or bright cyan
   - Format: "Display Label: value"

**WebUI:** `schema-renderer.tsx` `SchemaFields` component
- Filters fields by `display: true`
- Skips selectable arrays
- Handles array fields with "join" or numbered list format
- Applies highlight colors

### 6. Format Display String (`_format_display_string`) ✅
Location: `mixins.py:207-298`

**Template Features:**
1. `[color:field_name]` syntax - color swatch + hex value
2. Jinja2 template rendering with context
3. Access to `{{ field_name }}` from item
4. Access to `{{ state.key }}` from workflow state
5. Jinja2 filters support
6. Graceful error handling with fallback display

**WebUI:** `template-parser.ts`
- `parseTemplate()` and `renderTemplate()` functions
- `[color:field]` syntax support via `processColorSyntax()`
- `{{ variable }}` and `{{ variable | filter }}` support
- Supported filters: replace, join, lower, upper, title, trim, default
- Graceful error handling with `getRawDisplay()` fallback

### 7. Addon Display (`_get_addon_display`) ✅
Location: `mixins.py:151-181`

**Addon Data Fields:**
- `_addon.color` - hex color for styling
- `_addon.score` - compatibility percentage
- `_addon.last_used` - ISO timestamp

**Returns:** `(ansi_color_code, suffix_string)`

**WebUI:**
- `schema-renderer.tsx` `AddonDisplay` component
- `schema-utils.ts` `getItemAddon()` function
- Components render color swatches, score badges, and "last used" timestamps

### 8. Color Utilities ✅
Location: `mixins.py:92-150`

- `_hex_to_ansi_swatch(hex)` - colored block for terminal
- `_hex_to_ansi_fg(hex)` - foreground color code
- `_get_time_based_color(timestamp)` - legacy time-based coloring
- `_format_time_ago(timestamp)` - "X ago" format

**WebUI:**
- `schema-renderer.tsx` `ColorSwatch` component for color display
- `schema-renderer.tsx` `formatTimeAgo()` function
- Color application via inline styles with `style={{ color: hexColor }}`

### 9. Highlight System ✅

**Schema Properties:**
- `highlight: true/false` - whether to highlight this field
- `highlight_color: "#HEXCOLOR"` - specific color (optional)

**Behavior:**
- If highlight + highlight_color: use that color
- If highlight only: use bright cyan
- Applied to both field labels and array headers

**WebUI:**
- `schema-renderer.tsx` `SchemaField` component applies highlight colors
- Group headers in components apply `group.highlightColor`
- Default cyan color: `text-cyan-400` Tailwind class

---

## WebUI Files Created/Modified

### New Files Created

1. **`types.ts`** - TypeScript interfaces
   - `SchemaProperty` - JSON Schema with display hints
   - `AddonData` - Addon metadata
   - `RenderedField` - Rendered field output
   - `TemplateContext` - Template parsing context
   - `ParsedTemplate` - Template parsing result
   - `RenderableItem`, `RenderableGroup` - Rendering context

2. **`template-parser.ts`** - Template parsing (port of `_format_display_string`)
   - `parseTemplate()` - Full parsing with color swatches
   - `renderTemplate()` - Simple string output
   - `processColorSyntax()` - Handle `[color:field]`
   - `processVariables()` - Handle `{{ variable }}`
   - `evaluateExpression()` - Variable evaluation with filters
   - `applyFilter()` - Filter implementation

3. **`schema-renderer.tsx`** - Schema-aware field rendering
   - `SchemaFields` - Render all display:true fields from schema
   - `SchemaField` - Single field with highlight support
   - `ArrayField` - Array rendering (join or list)
   - `AddonDisplay` - Score, color, last_used display
   - `ColorSwatch` - Color visualization
   - `HighlightedHeader` - Headers with highlight colors
   - `formatTimeAgo()` - Timestamp formatting
   - `getAddonData()` - Extract addon from item

### Modified Files

4. **`schema-utils.ts`** - Complete rewrite
   - Updated interfaces with schema context
   - `parseSchemaData()` - All TUI cases implemented
   - `hasNestedSelectable()` - Recursive detection
   - `parseNestedSelectable()` - Nested array parsing
   - Utility functions retained and enhanced

5. **`StructuredSelectCardsControlled.tsx`** - Updated rendering
   - Uses `SchemaFields` for field rendering
   - Shows parent fields before child items
   - Supports highlight colors on headers
   - Uses `renderTemplate()` for display_format

6. **`StructuredSelectListControlled.tsx`** - Updated rendering
   - Same updates as Cards variant
   - Uses groups instead of manual grouping

---

## Implementation Progress

- [x] Document all TUI paths (this file)
- [x] Create template-parser.ts
- [x] Create schema-renderer.tsx
- [x] Create types.ts
- [x] Update schema-utils.ts with hasNestedSelectable
- [x] Update parseSchemaData for all cases
- [x] Update StructuredSelectCardsControlled to use schema rendering
- [x] Update StructuredSelectListControlled to use schema rendering
- [x] Build passes
- [ ] Test aesthetic/idea selection interaction
- [ ] Test other structured select interactions
- [ ] Verify complete TUI parity

---

## Known Differences from TUI

1. **State Access**: WebUI template parser doesn't have access to workflow state yet.
   The `{{ state.key }}` syntax is parsed but `state` context may be empty.
   TUI has access via `get_current_state()`.

2. **Numbered Items**: TUI displays sequential numbers (1, 2, 3...) for all selectable items.
   WebUI doesn't show numbers - uses visual selection indicators instead.

3. **Interactive Selection**: TUI uses keyboard input, WebUI uses click/tap.

4. **Retryable Options**: TUI shows retry/continue options inline with selection.
   WebUI handles retryable separately via RetryableHost component.

---

## Testing Checklist

- [ ] Root array selection (duration, tone, etc.)
- [ ] Root object with additionalProperties
- [ ] Array with direct selectable items
- [ ] Nested selectable arrays (aesthetic_concepts → ideas)
- [ ] display_format templates
- [ ] highlight colors on fields
- [ ] Addon data (color, score, last_used)
- [ ] Multi-select mode
- [ ] Single-select mode

---

## Last Updated
Date: 2025-12-31
Status: Implementation complete, testing needed
