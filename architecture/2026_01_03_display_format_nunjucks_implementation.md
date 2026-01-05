# Implementation Plan: Display Format Processing with Nunjucks

## Problem Statement

The WebUI's schema-driven rendering system is missing critical template processing functionality. When `display_format` is specified in schemas (e.g., `"{{ value | join('\n') }}"`), it's completely ignored, causing:

1. Arrays of strings to render as `[object Object]`
2. Computed fields to not render at all
3. State-aware templates to fail silently

## Current State Analysis

### What's Implemented (80% complete)
- Schema-driven recursive rendering (SchemaRenderer.tsx)
- Type-based routing: arrays → ArrayContainer, objects → ObjectContainer
- Terminal renderers for all `render_as` types (text, color, url, datetime, number, image)
- Nudges UI enhancements (copy, swatch, external-link, preview, download)
  - Located in: `src/components/workflow/interactions/schema-interaction/renderers/nudges/`
  - Components: CopyButton.tsx, ColorSwatch.tsx, ExternalLink.tsx
  - Used by: TextRenderer, ColorRenderer, UrlRenderer, etc.
- Selection system with multi-select support
- Addon data support (_addon convention)

### What's Missing
1. **`display_format` template processing** - No Nunjucks integration
2. **`computed` fields** - Defined in types but never rendered
3. **`display_order` sorting** - Fields rendered in key order, not sorted
4. **State context** - Templates can't access `{{ state.key }}`

### What's NOT Needed in WebUI (TUI-only features)
- `[color:field]` syntax - WebUI uses `render_as: "color"` + nudge `"swatch"` instead
- Python-specific formatting (ljust, %) - WebUI uses standard Nunjucks filters

## Display Format Patterns in Production

From analysis of `/workflows/oms/` schemas:

| Pattern | Example | WebUI Support |
|---------|---------|---------------|
| Simple substitution | `{{ label }} - {{ description }}` | Yes (Nunjucks) |
| Array join | `{{ value \| join(', ') }}` | Yes (Nunjucks) |
| String replace | `{{ value \| replace('\n', ' ') }}` | Yes (Nunjucks) |
| State access | `{{ state.selected_core_aesthetic.mj.params }}` | Yes (with context) |
| Color syntax | `[color:text_color]` | NO - TUI only, use nudges |
| Python ljust/% | `{{ name.ljust(22) }}` | NO - TUI only |

## Key Architecture Decision: render_as vs display_format Precedence

### The Challenge: Nested display=true Fields

Consider this schema:
```json
{
  "type": "array",
  "render_as": "text",
  "items": {
    "type": "object",
    "properties": {
      "name": { "type": "string", "display": true },
      "color": { "type": "string", "display": true, "render_as": "color" }
    }
  }
}
```

**Problem:** If we honor `render_as: "text"` at the array level, we'd try to render the whole array as text. But the array contains objects with nested `display=true` fields that need their own recursive rendering.

### Understanding the Difference

| Attribute | Purpose | Works On | Stops Recursion? |
|-----------|---------|----------|------------------|
| `display_format` | Collapse complex data into single string via template | Arrays, Objects | **YES** - template IS the output |
| `render_as` | Tell terminal renderer HOW to display a value | Primitives | N/A - primitives don't recurse |

**Key insight:** `display_format` has templating capability to access nested data (e.g., `{{ items | map('name') | join(', ') }}`). `render_as` does not - it just specifies the rendering type.

### Proposed Solutions

#### Solution A: render_as Only for Primitives (Recommended)

**Rule:** `render_as` is ignored on arrays/objects. Only `display_format` can stop recursion.

```
For arrays/objects:
  if (display_format) → collapse using template, render result with render_as
  else → recursive rendering continues (render_as ignored at this level)

For primitives:
  → use render_as directly
```

**Pros:**
- Clear separation: `display_format` = structure control, `render_as` = presentation
- Doesn't break recursive architecture
- Existing schemas continue to work

**Cons:**
- `render_as` on array/object is silently ignored (could be confusing)

#### Solution B: Explicit Collapse Flag

**Rule:** Add `collapse: true` to explicitly stop recursion.

```json
{
  "type": "array",
  "collapse": true,
  "display_format": "{{ value | join(', ') }}",
  "render_as": "text"
}
```

**Pros:**
- Explicit intent - no ambiguity
- `render_as` without `collapse` clearly means "for nested items"

**Cons:**
- New schema field
- More verbose

#### Solution C: Schema Design Constraint (Documentation)

**Rule:** Document that:
- `render_as` on arrays/objects doesn't prevent recursion
- To collapse an array/object, you MUST use `display_format`
- If both present on array/object: `display_format` collapses, `render_as` formats result

This is a documentation/convention approach rather than code enforcement.

### Recommended Approach: Solution A with Documentation

1. **Code behavior:**
   - For arrays/objects with `display_format`: collapse using template, pass to TerminalRenderer
   - For arrays/objects without `display_format`: continue recursive rendering
   - `render_as` on arrays/objects only applies AFTER `display_format` collapses the data

2. **Schema design guideline:**
   - Use `display_format` when you want to collapse complex data into a single rendered value
   - Use `render_as` on leaf fields to control presentation type
   - Don't put `render_as` on arrays/objects without `display_format` (it will be ignored)

## Current Recursive Flow (SchemaRenderer.tsx)

```
1. Check selectable → wrap in SelectableItem
2. Route by type:
   - Array → ArrayContainer with recursive SchemaRenderer for each item
   - Object → ObjectContainer with recursive SchemaRenderer for each display=true field
3. Primitive → TerminalRenderer
```

## Proposed Recursive Flow (with display_format)

```
1. Check selectable → wrap in SelectableItem
2. Check render_as (NEW - precedence check):
   - If render_as AND primitive → TerminalRenderer directly
   - If render_as AND complex type → continue to next step (render_as saved for later)
3. Check display_format (NEW):
   - If display_format → collapse via Nunjucks template → TerminalRenderer
4. Route by type:
   - Array → ArrayContainer with recursive SchemaRenderer for each item
   - Object → ObjectContainer with recursive SchemaRenderer for each display=true field
5. Primitive → TerminalRenderer
```

## Implementation Plan

### Phase 1: Create Nunjucks Template Service

**File:** `src/lib/template-service.ts`

```typescript
import nunjucks from 'nunjucks';

// Configure Nunjucks environment
const env = new nunjucks.Environment(null, {
  autoescape: false,  // Templates are for display, not HTML
  throwOnUndefined: false,  // Graceful handling of missing vars
});

/**
 * Render a display_format template.
 *
 * Context building:
 * - Objects: all keys available directly (e.g., {{ name }}, {{ description }})
 * - Arrays: available as {{ value }} (e.g., {{ value | join(', ') }})
 * - State: available as {{ state.key }} if provided
 */
export function renderTemplate(
  template: string,
  item: unknown,
  state?: Record<string, unknown>
): string {
  // Build context
  const context: Record<string, unknown> = {};

  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    // Object: spread all keys into context
    Object.assign(context, item);
  } else {
    // Array or primitive: available as "value"
    context.value = item;
  }

  if (state) {
    context.state = state;
  }

  try {
    return env.renderString(template, context);
  } catch (error) {
    console.error('[TemplateService] Render error:', error);
    return `[Template Error: ${(error as Error).message}]`;
  }
}
```

### Phase 2: Update SchemaRenderer for display_format

**File:** `src/components/workflow/interactions/schema-interaction/SchemaRenderer.tsx`

Changes needed:

1. **Import template service and state context**
2. **Add display_format check BEFORE type routing**
3. **For arrays/objects with display_format: collapse and render**
4. **For arrays/objects without display_format: continue recursive rendering**

```typescript
import { renderTemplate } from "@/lib/template-service";
import { useWorkflowStateContext } from "@/contexts/WorkflowStateContext";

export function SchemaRenderer({ data, schema, path = [], className }: SchemaRendererProps) {
  const { state: workflowState } = useWorkflowStateContext();

  // ... existing selectable check ...

  // ==========================================================================
  // NEW: Check display_format - collapses complex data to single value
  // ==========================================================================
  if (schema.display_format) {
    const formatted = renderTemplate(schema.display_format, data, workflowState);
    return (
      <TerminalRenderer
        fieldKey={path.join(".") || "value"}
        value={formatted}
        label={schema.display_label}
        renderAs={schema.render_as || "text"}
        nudges={schema.nudges}
        className={className}
      />
    );
  }

  // ==========================================================================
  // Existing: Route by type - Array
  // ==========================================================================
  if (schemaType === "array" && Array.isArray(data)) {
    // ... existing recursive rendering ...
  }

  // ... rest of existing logic ...
}
```

### Phase 3: Add Computed Fields Support

**File:** `src/components/workflow/interactions/schema-interaction/SchemaRenderer.tsx`

In object handling section, after processing `properties`:

```typescript
// Process computed fields (virtual fields with display_format)
if (schema.computed) {
  for (const [key, computedSchema] of Object.entries(schema.computed)) {
    if (computedSchema.display === true && computedSchema.display_format) {
      fieldsToRender.push({
        key,
        fieldSchema: computedSchema,
        isComputed: true
      });
    }
  }
}

// When rendering computed fields, use display_format to generate value
{fieldsToRender.map(({ key, fieldSchema, isComputed }) => {
  if (isComputed && fieldSchema.display_format) {
    const computedValue = renderTemplate(fieldSchema.display_format, dataObj, workflowState);
    return (
      <TerminalRenderer
        key={key}
        fieldKey={key}
        value={computedValue}
        label={fieldSchema.display_label}
        renderAs={fieldSchema.render_as || "text"}
        nudges={fieldSchema.nudges}
      />
    );
  }
  return (
    <SchemaRenderer
      key={key}
      data={dataObj[key]}
      schema={fieldSchema}
      path={[...path, key]}
    />
  );
})}
```

### Phase 4: Implement display_order Sorting

In object handling, sort fieldsToRender by display_order:

```typescript
// Sort all fields (properties + computed) by display_order
fieldsToRender.sort((a, b) => {
  const orderA = a.fieldSchema.display_order ?? 999;
  const orderB = b.fieldSchema.display_order ?? 999;
  return orderA - orderB;
});
```

### Phase 5: Fix paragraph_display_schema.json

Add `display: true` to `text_sets` property:

```json
{
  "type": "object",
  "properties": {
    "text_sets": {
      "type": "array",
      "display": true,
      "items": { ... }
    }
  }
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/template-service.ts` | NEW - Nunjucks wrapper |
| `src/components/workflow/interactions/schema-interaction/SchemaRenderer.tsx` | Add display_format handling, computed fields, display_order sorting, state context |
| `src/components/workflow/interactions/schema-interaction/types.ts` | Ensure ComputedField type is complete |
| `workflows/oms/steps/5_text_overlays/schemas/paragraph_display_schema.json` | Add `display: true` to text_sets |
| `src/lib/interaction-utils.ts` | Remove old `renderDisplayFormat` (unused, replaced by template-service) |

## Testing Checklist

1. **Simple substitution**: `{{ label }} - {{ description }}` renders correctly
2. **Array join**: `{{ value | join(', ') }}` on string arrays
3. **State access**: `{{ state.selected_core_aesthetic.mj.params }}`
4. **Computed fields**: Virtual fields render with correct order
5. **Nested display=true**: Arrays/objects without display_format continue recursive rendering
6. **Error handling**: Invalid templates show error message, don't crash
7. **Existing functionality**: All current rendering still works

## Migration Notes

- Nunjucks is already installed (`^3.2.4`)
- `display_format` is additive - existing schemas without it continue to work
- No breaking changes to existing functionality
- `[color:field]` and Python patterns are NOT supported - use nudges and standard Nunjucks filters

## Order of Implementation

1. Create `template-service.ts` with Nunjucks integration
2. Update SchemaRenderer with display_format check (before type routing)
3. Add state context integration
4. Add computed fields processing
5. Add display_order sorting
6. Fix paragraph_display_schema.json
7. Test all patterns
8. Remove old renderDisplayFormat from interaction-utils.ts

---

# Container Types Architecture: table/column

## The Problem: render_as Categories

`render_as` is not just for terminal rendering. It has three distinct categories:

| Category | Examples | Purpose |
|----------|----------|---------|
| **Container** | `table`, `grid`, `list` | Control layout of children |
| **Role** | `column`, `row`, `cell` | Metadata for parent container |
| **Terminal** | `text`, `color`, `url`, `datetime`, `number`, `image` | Leaf value rendering |

## Example Schema: Table with Nested Content

```json
{
  "type": "array",
  "render_as": "table",
  "items": {
    "type": "object",
    "properties": {
      "field1": {
        "type": "string",
        "render_as": "column"
      },
      "field2": {
        "type": "number",
        "render_as": "column"
      },
      "field3": {
        "type": "object",
        "render_as": "column",
        "properties": {
          "inner1": {
            "type": "string",
            "display": true
          },
          "inner2": {
            "type": "array",
            "display": true,
            "items": {
              "type": "object",
              "properties": {
                "ainner1": { "type": "string", "display": true },
                "ainner2": { "type": "string", "display": true }
              }
            }
          }
        }
      }
    }
  }
}
```

**Expected rendering:**

| field1 | field2 | field3 |
|--------|--------|--------|
| "val1" | 123 | inner1: "x"<br>inner2: [ainner1: "a", ainner2: "b"], [ainner1: "c", ainner2: "d"] |

**The challenge:** field3's column cell contains nested `display=true` fields that need recursive rendering.

---

## Design Question: display=true Inheritance

### Current Behavior
Only fields with `display=true` are rendered. If parent doesn't have `display=true`, children are never reached.

### The Problem
In the table example above:
- `field3` has `render_as: "column"` (tells parent it's a column)
- But `field3` doesn't have `display: true`
- Its children (`inner1`, `inner2`) have `display: true`
- **Question:** Can we render inner1/inner2 without field3 having display=true?

### Proposals for display=true Handling

#### Option A: Parent Must Have display=true (Current Behavior)

**Rule:** To render children, parent must have `display=true`.

```json
"field3": {
  "type": "object",
  "render_as": "column",
  "display": true,  // Required to reach children
  "properties": {
    "inner1": { "display": true },
    "inner2": { "display": true }
  }
}
```

**Pros:**
- Simple, predictable
- No traversal overhead for non-displayed subtrees
- Current behavior, no breaking changes

**Cons:**
- Verbose - must mark intermediate nodes
- Easy to forget

#### Option B: Implicit display=true for Containers

**Rule:** Container types (`render_as: "table"`, etc.) automatically have `display=true`. Role types (`render_as: "column"`) pass through to children.

```
if (render_as is container or role type) → implicitly display=true
```

**Pros:**
- Less verbose for common patterns
- Container/role types are inherently "structural" - they exist to show content

**Cons:**
- Magic behavior - less explicit
- What about nested containers?

#### Option C: Check for Displayable Descendants

**Rule:** Before rendering, check if schema has any descendant with `display=true`. If yes, traverse to it even if intermediate nodes don't have `display=true`.

```typescript
function hasDisplayableDescendant(schema: SchemaProperty): boolean {
  if (schema.display === true) return true;
  if (schema.properties) {
    return Object.values(schema.properties).some(hasDisplayableDescendant);
  }
  if (schema.items) {
    return hasDisplayableDescendant(schema.items);
  }
  return false;
}
```

**Pros:**
- Most flexible - children can be displayed without marking every parent
- Matches intuition: "if something needs to display, show the path to it"

**Cons:**
- Processing overhead (can be mitigated with caching/memoization)
- Renders "empty" parent containers for deeply nested display=true

#### Option D: render_as Implies Display Path

**Rule:** Any node with `render_as` (container or role) creates a display path. Children with `display=true` are rendered within that path.

```
render_as: "column" → this node is part of display path
  → children with display=true are rendered
  → children without display=true are skipped
```

**Pros:**
- Role types like "column" explicitly signal "I'm structural"
- No need to check descendants

**Cons:**
- Still requires some marking on intermediate nodes

### Recommendation

**Option A (current) + Option D hybrid:**

1. **Container types** (`table`, `grid`) automatically traverse items - they wouldn't make sense otherwise
2. **Role types** (`column`) create display path - their purpose is to show content
3. **Regular nodes** require `display=true` to be rendered
4. **Within a column cell**, recursive rendering uses standard `display=true` rules

This means for the table example:
- `render_as: "table"` → traverse items
- `render_as: "column"` on field3 → field3 is a column, render its content
- Inside field3, `inner1` and `inner2` have `display=true` → render them

**No need for `display=true` on field3 itself** because `render_as: "column"` implies it's part of the display structure.

<!--even regular nodes can have display_as right? as this logic, should render all render_as instances even without display=true? i feel like is a flaw on exciting rendering mechanism in tui and workflow schema itself. more i think about this, i feel like we need to assume that we dont need to make it required parent to have display=true to child to render. but with current recursive rendering, it can lead to lots empty parent nodes in hierarchy. i wonder if it would be huge overhead for processing. i guess we can check of at least one child in the hierarchy has display=true before start redndering, but this only has to be done in root level. also, we wont assume containing render_as value means display=true. after first child with display=true, any child after that must have display=true to render. -->

---

## Container Architecture Proposals

### Proposal A: Dedicated Container Components (Recommended)

Create separate container renderer components that handle their own child rendering logic.

**Structure:**
```
SchemaRenderer
  └─ checks render_as
      └─ if "table" → TableRenderer
      └─ if "grid" → GridRenderer (future)
      └─ else → existing logic
```

**How TableRenderer works:**
1. Receives array data + schema with `render_as: "table"`
2. Extracts columns from `items.properties` where `render_as: "column"`
<!--
- you assume in #2 that only arrays can have this, but this is not true, objects also can have this.
- also, what would happen of render_as=column in nested field, as in nested 1 or 2 level under. in that case, are we going to loop until we find column schema until we find it? what would happen if there's display=true terminal field betwen table and column?
-->
3. Renders `<table>` with header row
4. For each data row, renders cells
5. Each cell uses SchemaRenderer for nested content (stripping `render_as: "column"`)

**Pros:**
- Clear separation - each container owns its rendering logic
- Extensible - add GridRenderer, ListRenderer later with same pattern
- Cells can have arbitrary nested content via SchemaRenderer recursion

**Cons:**
- More components to maintain
- Container must understand role types ("column") to extract structure

---

### Proposal B: Extend Existing ArrayContainer

Instead of new components, extend ArrayContainer to check for `render_as: "table"`.

<!--we cannot just extend ArrayContainer, but we need same for ObjectContainer, which will lead to requiring Proposal A.-->

**Structure:**
```
SchemaRenderer
  └─ routes array → ArrayContainer
      └─ ArrayContainer checks schema.render_as
          └─ if "table" → render as <table>
          └─ else → render as list (current behavior)
```

**Pros:**
- Less new code - reuses existing component
- Single place for array rendering logic

**Cons:**
- ArrayContainer becomes bloated with multiple rendering modes
- Harder to add new container types without further bloating
- Mixes concerns (list vs table are conceptually different)

---

### Proposal C: Schema-Driven Layout Engine

<!--what the difference between what we do now with this? dont we still need components handling as we do now, or are you proposing completely different schema which you know we cannot do. -->

More abstract approach: containers don't have hardcoded rendering, instead they interpret a layout specification.

```json
{
  "type": "array",
  "render_as": "table",
  "layout": {
    "columns": ["field1", "field2", "field3"],
    "headers": { "field1": "Name", "field2": "Count" }
  }
}
```

**Pros:**
- Very flexible - layout defined in schema
- Could support complex layouts (merged cells, custom ordering)

**Cons:**
- Over-engineered for current needs
- Schema becomes more complex
- Harder to implement and debug

---

### Recommendation: Proposal A

Proposal A (Dedicated Container Components) is cleanest for current needs:
- TableRenderer handles tables
- Future GridRenderer handles grids
- Each container is self-contained
- Cells delegate to SchemaRenderer for nested content

---

## TableRenderer Implementation Details

### Column Extraction

```typescript
// Extract columns from item schema
const columns = Object.entries(itemSchema.properties || {})
  .filter(([_, propSchema]) => propSchema.render_as === "column")
  .map(([key, propSchema]) => ({
    key,
    label: propSchema.display_label || key,
    schema: propSchema,
  }));
```

### Cell Rendering

Each cell strips `render_as: "column"` and delegates to SchemaRenderer:

```typescript
function TableCell({ data, schema, path }: TableCellProps) {
  // Strip role type - it was metadata for parent
  const cellSchema = { ...schema, render_as: undefined };

  // Always use SchemaRenderer - it handles:
  // - Nested objects with display=true fields
  // - Primitives (falls through to TerminalRenderer)
  // - Arrays (recursive)
  return (
    <SchemaRenderer
      data={data}
      schema={cellSchema}
      path={path}
    />
  );
}
```

**Key insight:** TableCell doesn't need special logic for primitives vs objects. SchemaRenderer already handles this - primitives fall through to TerminalRenderer, objects recurse into display=true fields.

---

## Updated Recursive Flow (with Containers)

```
1. Check selectable → wrap in SelectableItem

2. Check display_format → collapse via Nunjucks → TerminalRenderer

3. Check render_as category:
   a. Container type (table, grid, list):
      → ContainerRenderer (handles its own child rendering)

   b. Role type (column, row, cell):
      → Skip (parent container handles these)

   c. Terminal type (text, color, url, etc.):
      → TerminalRenderer (if primitive data)
      → Continue to step 4 (if complex data - render_as applies after recursion)

4. Route by data type:
   - Array → ArrayContainer with recursive SchemaRenderer
   - Object → ObjectContainer with recursive SchemaRenderer for display=true fields

5. Fallback → TerminalRenderer
```

---

## Implementation Phases for Container Support

### Phase A: Type Definitions

```typescript
// Add to types.ts
export type ContainerType = "table" | "grid" | "list";
export type RoleType = "column" | "row" | "cell";
export type TerminalType = "text" | "color" | "url" | "datetime" | "number" | "image";

export type RenderAs = ContainerType | RoleType | TerminalType;

export const CONTAINER_TYPES: ContainerType[] = ["table", "grid", "list"];
export const ROLE_TYPES: RoleType[] = ["column", "row", "cell"];

export function isContainerType(value: string | undefined): value is ContainerType {
  return CONTAINER_TYPES.includes(value as ContainerType);
}

export function isRoleType(value: string | undefined): value is RoleType {
  return ROLE_TYPES.includes(value as RoleType);
}
```

### Phase B: Update SchemaRenderer

```typescript
// In SchemaRenderer, add container check before type routing:

if (isContainerType(schema.render_as)) {
  return (
    <ContainerRenderer
      type={schema.render_as}
      data={data}
      schema={schema}
      path={path}
    />
  );
}

// Role types are handled by parent container, skip
if (isRoleType(schema.render_as)) {
  // This shouldn't happen - role types are consumed by parent
  console.warn(`Role type "${schema.render_as}" found outside container`);
}
```

### Phase C: Create Container Components

```
src/components/workflow/interactions/schema-interaction/
  renderers/
    containers/
      index.ts
      ContainerRenderer.tsx
      TableRenderer.tsx
      TableCell.tsx
      // Future: GridRenderer.tsx, ListRenderer.tsx
```

### Phase D: TableRenderer Implementation

See Proposal 2 and 3 above for implementation details.

---

## Open Questions

1. **Column ordering:** Should columns respect `display_order`? Or order of definition in schema?

2. **Column headers:** Use `display_label` as header? What if not specified?

3. **Empty cells:** How to render cells where data is null/undefined?

4. **Spanning:** Do we need colspan/rowspan support? (Probably not for v1)

5. **Nested tables:** What happens if a column cell contains another array with `render_as: "table"`?

---

## Files to Add for Container Support

| File | Purpose |
|------|---------|
| `renderers/containers/index.ts` | Exports for container components |
| `renderers/containers/ContainerRenderer.tsx` | Routes to specific container |
| `renderers/containers/TableRenderer.tsx` | Table implementation |
| `renderers/containers/TableCell.tsx` | Cell rendering with recursive support |

---

# R2: Revised Design Discussion

## Issues Identified in R1

### Issue 1: display=true Inheritance is Flawed

**Current behavior:** Parent must have `display=true` for children to be reached.

**Problem:** This is verbose and may be a flaw in the overall schema design.

**Proposed new approach:**
1. At root level, check if ANY descendant has `display=true`. If none, skip rendering entirely (no overhead).
2. Traverse the tree without requiring intermediate nodes to have `display=true`.
3. Once the first `display=true` node is found and rendered, children of that node must have `display=true` to render.
<!--
Question: data extraction on situation like this?

{
    "type": "array",
    "properies: {
        "inner1: {
            "re-inner": {
                "type": "string",
                "display: true,
                "selectable": true
            }
        }
    }
}

data:
[
    {
        "inner1": {
            "re-inner": "value1"
        }
    },
    {
        "inner1": {
            "re-inner": "value2"
        }
    },
    {
        "inner1": {
            "re-inner": "value3"
        }
    }
]

on this case, when we render values, we will just render values of "re-inner" as flat array,
because only that has display=true. Now lets assume that this is a multi select input, which
means to capture multi select data,  we will need data from parent. is this going to break
this selection if we only render end nodes? check code and confirm.
-->
4. `render_as` does NOT imply `display=true` - they are separate concerns.

**Example:**
```
root (no display)
  └─ wrapper (no display)      ← still traversed
       └─ data (display=true)  ← rendered
            └─ child1 (display=true)  ← rendered
            └─ child2 (no display)    ← NOT rendered (after first display=true, must be explicit)
```

**Questions:**
- Q1: Is this interpretation correct?
<!--partially, depends on answer to my question above-->
- Q2: What's the performance concern threshold? (e.g., max depth to search for displayable descendants?)
<!--I am not too worried about initial analysis to find display=true nodes, this will happen only at root
and we are doing this on schema, not on data, that aspect should be fine. what i'm worried about is that
if answer for my question at #3 required us to render full parent hierarchy, could there be impact when
rendering data-->

---

### Issue 2: Tables Can Be Objects, Not Just Arrays

**Original assumption:** `render_as: "table"` only applies to arrays.

**Reality:** Objects can also be tables (e.g., key-value table, or object with named rows).

**Example - Object as table:**
```json
{
  "type": "object",
  "render_as": "table",
  "properties": {
    "row1": { "render_as": "row", "properties": { ... } },
    "row2": { "render_as": "row", "properties": { ... } }
  }
}
```

**Questions:**
- Q3: How should object-tables differ from array-tables?
<!--there's no difference in reality, they just come of differet structures-->
- Q4: For objects, are rows defined by `render_as: "row"` on properties?
<!--no, its still columns, rows are data, columns are definition of that data, so schema contains columns, not rows.-->

---

### Issue 3: Nested Columns (Skip Levels)

**Problem:** What if `render_as: "column"` is nested 1-2 levels under the table, not directly in items?

**Example:**
```json
{
  "type": "array",
  "render_as": "table",
  "items": {
    "type": "object",
    "properties": {
      "metadata": {
        "type": "object",
        "properties": {
          "col1": { "render_as": "column", "type": "string" },
          "col2": { "render_as": "column", "type": "number" }
        }
      }
    }
  }
}
```

Here columns are nested under `metadata`, not directly under items.

**Questions:**
- Q5: Should TableRenderer only look at immediate children for columns?
- Q6: Or recursively search for columns at any depth?
 <!-- recursive search, I think this is fine if there's no display=true data between table and column. if there is,
 only option for us to do is show an error-->
- Q7: If recursive, how deep? What's the stopping condition?
<!--right now there's no limit to recurse. lets keep it like that to this too. as i said before, we
are scanning scheme, which is more straightforward structure. we will keep it without limit for now,
change if it becomes an issue later.-->

---

### Issue 4: display=true Between Table and Column

**Problem:** What happens if there's a `display=true` terminal field at the same level as or between the table and its columns?

**Example:**
```json
{
  "type": "array",
  "render_as": "table",
  "items": {
    "type": "object",
    "properties": {
      "id": { "type": "string", "display": true },
      "name": { "type": "string", "render_as": "column" },
      "details": {
        "type": "object",
        "properties": {
          "value": { "render_as": "column" }
        }
      }
    }
  }
}
```

Here `id` has `display=true` but no `render_as: "column"`. Meanwhile `name` is a column, and `value` is a nested column.

**Questions:**
- Q8: Should `id` be rendered? As what - a separate field outside the table? A special column?
<!--in caseses like id, i dont thnk we dont have any option but to show an error-->
- Q9: Is mixing `display=true` fields and `render_as: "column"` fields at the same level valid?
<!--no, but to note, it doesnt matter if render_as=column, it must have display=true to render it as i mentioned previous revision-->
- Q10: Should we require that within a table's items, ALL displayed fields must be columns?
<!--i think how should be handled is via merge column, where mrged column name is field name in perent (in this case its
"details", and all display=true columns will be rendered under that column.-->

---

### Issue 5: Proposal B and C Are Flawed

**Proposal B (Extend ArrayContainer):** Doesn't work because tables can be objects too. Would need to extend both ArrayContainer and ObjectContainer, leading back to Proposal A anyway.

**Proposal C (Schema-Driven Layout):** Adds a `layout` field to schema but doesn't fundamentally change how rendering works. Still needs components. Adds complexity without clear benefit.

**Conclusion:** Proposal A (Dedicated Container Components) is the only viable approach, but needs refinement to handle:
- Both array and object tables
- Nested columns
- Mixed display=true and column fields

---

## Proposed Answers (For Discussion)

### A1: display=true Traversal

**Proposal:** Implement "displayable descendant" check at root only.

```typescript
function hasDisplayableDescendant(schema: SchemaProperty): boolean {
  if (schema.display === true) return true;
  if (schema.properties) {
    return Object.values(schema.properties).some(hasDisplayableDescendant);
  }
  if (schema.items) {
    return hasDisplayableDescendant(schema.items);
  }
  return false;
}

// At root level only:
if (!hasDisplayableDescendant(rootSchema)) {
    <!--skeptical about returning null here as these are display components. how does react going to handle these?-->
  return null; // Nothing to render
}
```

After that, traverse without requiring intermediate `display=true`, but once first `display=true` is hit, children must be explicit.

---

### A2: Table Type Detection

**Proposal:** TableRenderer handles both arrays and objects.

```typescript
function TableRenderer({ data, schema, path }) {
  if (Array.isArray(data)) {
    return <ArrayTableRenderer data={data} schema={schema} path={path} />;
  } else if (typeof data === 'object' && data !== null) {
    return <ObjectTableRenderer data={data} schema={schema} path={path} />;
  }
  return <ErrorRenderer message="Table requires array or object data" />;
}
```

- **Array table:** Rows are array items, columns from `items.properties` with `render_as: "column"`
- **Object table:** Rows are properties with `render_as: "row"`, columns from row's properties with `render_as: "column"`

---

### A3: Column Discovery

**Proposal:** Only look at immediate level for columns. No recursive search.

**Reasoning:**
- Recursive column search is complex and ambiguous
- If columns are nested, the intermediate object should have `render_as: "column"` and handle its own nested content
- Keeps TableRenderer simple and predictable

**Example - correct way to handle nested data:**
```json
{
  "type": "array",
  "render_as": "table",
  "items": {
    "properties": {
      "metadata": {
        "type": "object",
        "render_as": "column",
        "display_label": "Metadata",
        "properties": {
          "col1": { "display": true },
          "col2": { "display": true }
        }
      }
    }
  }
}
```

Here `metadata` is the column, and its nested content (col1, col2) renders inside the cell via SchemaRenderer recursion.

---

### A4: Mixed display=true and Columns

**Proposal:** Within a table's items, `render_as: "column"` fields become table columns. Fields with only `display=true` (no column) are NOT rendered in the table.

**Reasoning:**
- A table has a specific structure (rows × columns)
- Mixing arbitrary `display=true` fields breaks that structure
- If you want a field in the table, make it a column

**Alternative:** Render `display=true` non-column fields as a "details" section outside/below the table. But this adds complexity.

<!--as i mentioned earlier, after first detection of display=true, all childreen must have display=true to render, even if field is render_as=column,
also, all nodes which has render_as="**" must have display=true to render, when i said all, no exceptions.-->

---

## Summary of Questions Needing Answers

| # | Question | Proposed Answer |
|---|----------|-----------------|
| Q1 | Is the new display=true traversal interpretation correct? | See A1 |
| Q2 | Performance threshold for descendant search? | Root level only, one pass |
| Q3 | How should object-tables differ from array-tables? | See A2 |
| Q4 | For objects, rows via `render_as: "row"`? | Yes |
| Q5 | Only immediate children for columns? | Yes (A3) |
| Q6 | Recursive column search? | No |
| Q7 | If recursive, how deep? | N/A - not recursive |
| Q8 | Should display=true non-columns render in table? | No (A4) |
| Q9 | Is mixing display=true and columns valid? | No - columns only in table |
| Q10 | Require all displayed fields to be columns? | Yes, within table items |

---

# R3: Final Design Decisions

Based on R2 feedback, here are the consolidated decisions and remaining questions.

## Decision 1: display=true Rules (Finalized)

**Rule:** After the first `display=true` is found, ALL children must have `display=true` to render. This includes `render_as` fields - no exceptions.

```
Traversal without display=true until first display=true is hit
  └─ wrapper (no display) ← traversed but not rendered
       └─ data (display=true) ← RENDERED, now strict mode begins
            <!--on child1, as long as we are not rendering a table, we can render, but if we are rendering a table, error. its fine to have
            column nodes without no having a parent, we will just render them normally as long as they have display=true.-->
            └─ child1 (display=true) ← rendered
            └─ child2 (no display) ← NOT rendered
            └─ child3 (render_as=column, no display) ← NOT rendered (render_as doesn't imply display)
            └─ child4 (render_as=column, display=true) ← rendered
```

**Key clarification:** `render_as` does NOT imply `display=true`. Every rendered field must explicitly have `display=true`, regardless of `render_as` value.

---

## Decision 2: Selection with Nested display=true

### Your Question (Code Analysis)

Given this schema:
```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "inner1": {
        "type": "object",
        "properties": {
          "re-inner": {
            "type": "string",
            "display": true,
            "selectable": true
          }
        }
      }
    }
  }
}
```

With data:
```json
[
  { "inner1": { "re-inner": "value1" } },
  { "inner1": { "re-inner": "value2" } },
  { "inner1": { "re-inner": "value3" } }
]
```

### Analysis from Code

**SelectionContext stores:**
- `selectedPaths: string[][]` - Full paths like `["0", "inner1", "re-inner"]`
- `selectedData: unknown[]` - Data at the selectable level (just `"value1"`, `"value2"`, etc.)

**SelectableItem behavior (line 62):**
```typescript
toggleSelection(path, data);  // data = value at selectable level
```

### Answer: Selection Still Works

**Paths are preserved correctly.** Even if we only render the leaf nodes visually, the full path is tracked:
- Path: `["0", "inner1", "re-inner"]`
- Data: `"value1"`

**Server can reconstruct parent data** using the path against the original data structure.

**However, there's a UX concern:** If we render only leaf nodes without parent wrappers, the UI may look like a flat list of values without context. The "inner1" wrapper won't be visible.

### Proposed Approach

When traversing to find displayable descendants:
1. **Render the path to display=true nodes** - but non-display nodes render as minimal wrappers (no content, just structure)
2. **SelectableItem wraps at the selectable level** - paths remain correct
3. **Parent data can be extracted via path** if server needs it

<!--lets do above, below is not an option-->
**Alternative:** Require `selectable` to be at array item level, not deeply nested. This keeps data extraction simple.

---

## Decision 3: Tables - Both Arrays and Objects

**No difference in schema structure.** Both use columns.

- **Array table:** Each array item is a row, columns from `items.properties`
- **Object table:** Each property is a row, columns from property's schema

```json
// Array table
{
  "type": "array",
  "render_as": "table",
  "items": {
    "properties": {
      "col1": { "render_as": "column", "display": true },
      "col2": { "render_as": "column", "display": true }
    }
  }
}

// Object table (key-value style)
{
  "type": "object",
  "render_as": "table",
  "properties": {
    "row1": { "properties": { "col1": {...}, "col2": {...} } },
    "row2": { "properties": { "col1": {...}, "col2": {...} } }
  }
}
```

**Clarification from feedback:** Rows are DATA, columns are SCHEMA definition. Schema always defines columns, never rows.

---

## Decision 4: Column Discovery - Recursive with Error

**Rule:** Recursively search for `render_as: "column"` under table schema.

**Stopping conditions:**
1. Found `render_as: "column"` → use as column
2. Found `display=true` on a non-column field → **ERROR** (display=true between table and column is invalid)
3. No limit on depth (schema is small, not a concern)

**Error case:**
```json
{
  "type": "array",
  "render_as": "table",
  "items": {
    "properties": {
      "id": { "display": true },  // ERROR: display=true but not a column
      "name": { "render_as": "column", "display": true }  // OK
    }
  }
}
```

---

## Decision 5: Nested Columns → Merged Column

When columns are nested under a parent object, the parent becomes a "merged column" header.

**Example:**
```json
{
  "type": "array",
  "render_as": "table",
  "items": {
    "properties": {
      "details": {
        "type": "object",
        "properties": {
          "col1": { "render_as": "column", "display": true },
          "col2": { "render_as": "column", "display": true }
        }
      }
    }
  }
}
```

**Rendering:**
| details |
| col1 | col2 |
|------|------|
| v1   | v2   |

The parent field name ("details") becomes a merged header spanning its child columns.

---

## Decision 6: React Null Returns

**Question:** Is returning `null` from display components safe?

**Answer:** Yes, React handles `null` returns correctly - the component renders nothing. This is standard React pattern.

```typescript
if (!hasDisplayableDescendant(rootSchema)) {
  return null;  // Safe - React renders nothing
}
```

However, for better UX, we might want to render a placeholder message instead:
```typescript
if (!hasDisplayableDescendant(rootSchema)) {
  return <div className="text-muted">No displayable content</div>;
}
```

<!--got it, lets start with placeholder, it feels more explicit and has information-->
---

## Remaining Questions

| # | Question | Status |
|---|----------|--------|
| Q1 | display=true traversal | **DECIDED** - traverse without, strict after first |
| Q2 | Performance concern | **DECIDED** - schema scan only, fine for now |
| Q3 | Object vs Array tables | **DECIDED** - same structure, both use columns |
| Q4 | Rows in schema | **DECIDED** - no, schema defines columns only |
| Q5-Q7 | Column discovery | **DECIDED** - recursive, error on display=true conflict |
| Q8-Q10 | Mixed display/columns | **DECIDED** - error, use merged columns for nesting |
| **NEW** | Selection with nested display=true | See Decision 2 - paths work, UX concern for flat rendering |

---

## All Decisions Confirmed

| Decision | Summary |
|----------|---------|
| **display=true traversal** | Traverse without display=true until first hit, then strict mode |
| **render_as + display** | render_as does NOT imply display=true, must be explicit |
| **Column without table** | OK - render normally with display=true, only error if inside table context |
| **Selectable nesting** | Allow nested - render path with minimal wrappers, paths preserved |
| **Tables (array/object)** | Both use columns, rows are data |
| **Column discovery** | Recursive search, error on display=true conflict between table and column |
| **Merged columns** | Nested columns use parent as merged header (colspan) |
| **Empty schema** | Show placeholder message, not null |

---

# Implementation Checklist

## Phase 1: Template Service (Nunjucks) - COMPLETED 2026-01-04
- [x] Create `src/lib/template-service.ts`
- [x] Configure Nunjucks environment
- [x] Implement `renderTemplate(template, data, state)`
- [x] Handle errors gracefully

## Phase 2: SchemaRenderer Updates - COMPLETED 2026-01-04
- [x] Add `hasDisplayableDescendant()` check at root
- [x] Show placeholder if no displayable content
- [x] Add display_format check before type routing
- [x] Implement two-mode traversal (pre-display=true and post-display=true)
- [x] Pass workflow state context to template rendering

## Phase 3: Container Support - COMPLETED 2026-01-04
- [x] Add type definitions (ContainerType, RoleType, TerminalType)
- [x] Add `isContainerType()` and `isRoleType()` helpers
- [x] Create `ContainerRenderer.tsx` routing component
- [x] Create `TableRenderer.tsx` for array AND object tables (combined)
- [x] Implement recursive column discovery with error on conflict
- [x] Implement merged column headers for nested columns

## Phase 4: Computed Fields & Sorting - COMPLETED 2026-01-04
- [x] Add computed fields processing in object handling
- [x] Implement display_order sorting for all fields

## Phase 5: Schema Fixes - COMPLETED 2026-01-04
- [x] Verified paragraph_display_schema.json works with two-mode traversal (no changes needed)
- [x] Two-mode traversal eliminates need for display=true on container nodes

## Phase 6: Cleanup - COMPLETED 2026-01-04
- [x] Remove old `renderDisplayFormat` from interaction-utils.ts
- [ ] Test all display_format patterns (manual testing required)
- [ ] Test table rendering with nested columns (manual testing required)
- [ ] Test selection with nested display=true paths (manual testing required)

## Known Limitations

1. **Python-specific display_format patterns not supported:**
   - `{{ name.ljust(22) }}` - Python string method
   - `{{ '%3d' % value }}` - Python % formatting
   - `[color:field]` - TUI-only syntax
   These are TUI-only patterns per architecture decision.

2. **ux_nudge vs render_as:**
   - Existing schemas use `ux_nudge: "table"` with `display_components`
   - New implementation uses `render_as: "table"` with `render_as: "column"` on properties
   - These are separate patterns; schemas may need updating to use new pattern
