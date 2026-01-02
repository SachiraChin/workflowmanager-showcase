# Schema Component Deep Dive

Discussion notes documenting the investigation of WebUI schema-driven components.

Reference: `architecture/2026_01_01_schema_driven_ui_flow_working.html`

---

## Q1: What does ArrayField render? (HTML L222)

**Question:** Line 222 says "Renders array items" - does ArrayField render other components, or something else?

**Location:** `webui/src/components/workflow/interactions/structured-select/schema-renderer.tsx:312-362`

### Answer: ArrayField renders PRIMITIVES only, not components

`ArrayField` is a **leaf renderer** - it does NOT recurse into child components. It only handles arrays of primitive values (strings, numbers, etc.).

### Two Rendering Modes

```typescript
// schema-renderer.tsx:312-362
function ArrayField({ label, value, displayFormat, highlight, highlightColor }) {

  // Mode 1: Join format (display_format: "join")
  if (displayFormat === "join") {
    const joined = value.map((v) => String(v)).join(" ");
    return <span>{label}: {joined}</span>;
    // Example: "Keywords: space ambient dreamy"
  }

  // Mode 2: List format (default)
  return (
    <div>
      <div>{label}:</div>
      <div>
        {value.map((item, idx) => (
          <div>[{idx + 1}] {String(item)}</div>
        ))}
      </div>
    </div>
  );
  // Example:
  // Keywords:
  //   [1] space
  //   [2] ambient
  //   [3] dreamy
}
```

### What ArrayField Does NOT Do

1. **Does NOT** recurse with `SchemaFields` for nested objects
2. **Does NOT** check item schema for `display: true` fields
3. **Does NOT** render `DisplayComponents` or templates for items
4. Simply converts each item to `String(item)` regardless of type

### Implication

If you have an array of objects like:
```json
{
  "items": [
    { "name": "Item 1", "description": "Desc 1" },
    { "name": "Item 2", "description": "Desc 2" }
  ]
}
```

ArrayField would render:
```
Items:
  [1] [object Object]
  [2] [object Object]
```

This is likely **incorrect behavior** - arrays of objects should probably recurse into `SchemaFields` for each item.

<!-- you are correct, these should be handled through SchemaFields -->

### Comparison with TUI

Looking at TUI's `_display_schema_fields` in `tui/strategies/mixins.py`, the TUI handles arrays differently:
- For arrays with `selectable: true` → handled separately by selection logic
- For arrays with `display_format: "join"` → joined as string
- For other arrays → **recursively displays each item**

### Recommendation

ArrayField should be enhanced to:
1. Check if array items are objects
2. If objects and schema.items has properties → recurse with `SchemaFields`
3. If primitives → current behavior (stringify)

---

## Component Call Hierarchy (from investigation)

```
SchemaField (schema-renderer.tsx:217)
│
├── schema.type === "array" && Array.isArray(value)
│   └── ArrayField (line 312)
│       ├── displayFormat === "join" → join as single line string
│       └── else → numbered list, each item String(item)
│       └── ⚠️ NO recursion for object items
│
├── schema.type === "object"
│   ├── schema.display_format exists → renderTemplate()
│   └── else → SchemaFields(value, schema) [RECURSES]
│
└── primitive (string, number, boolean)
    ├── schema.display_format → renderTemplate()
    └── else → String(value)
```

---

## Response to Comments

### Q: Where does "join" come from? Is join = having display_format?

**Answer:** Yes, but specifically `display_format === "join"` (literal string "join").

From schema-renderer.tsx:330:
```typescript
if (displayFormat === "join") {
  const joined = value.map((v) => String(v)).join(" ");
  // ...
}
```

So `display_format: "join"` is a **magic keyword** that triggers join behavior. This is inconsistent with how display_format works elsewhere (as a Nunjucks template). It's a special case.

<!-- we simply cant do it, display_format is already used and assumed that its jinja expression, and we have to maintain that. if it needs to be joined, display_format can jinja expressoin to do that. -->

### Q: Numbered lists breaking UX - use a list component instead?

**Your point is valid.** The `[1] item` format is TUI-style output that doesn't fit WebUI patterns.

However, I have a counter-question: **When would ArrayField actually be invoked in practice?**

Looking at the code flow:
1. `parseSchemaData` finds selectable arrays → those go to cards/list components, NOT ArrayField
2. `SchemaFields` renders `display: true` fields → if a field is an array, it goes to ArrayField

So ArrayField is only hit when:
- A non-selectable array field has `display: true`
- Example: `keywords: ["space", "ambient"]` with `display: true`

For simple string arrays, "join" mode or a simple list makes sense. For arrays of objects, you're right - we need something better.

**But:** Using SelectFromList with selectable=false feels like overloading. A read-only list renderer (no selection state, no checkboxes) would be cleaner.

<!--
i dont think i get you, this is selectable view, but it can be selectable array as well is it not? the structured selection as far as I an remember now, could render plain lists, without "structure" per say, but if you think about it, array is a structure, but in plain way in this context. So, really should assume that structured selection is always object based structure, it can be plain selectable array.
-->

### Q: Situations where "NO recursion for object items" happens?

**Example scenario:**

Schema:
```json
{
  "type": "object",
  "properties": {
    "variations": {
      "type": "array",
      "display": true,
      "display_label": "Variations",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string", "display": true },
          "description": { "type": "string", "display": true }
        }
      }
    }
  }
}
```

Data:
```json
{
  "variations": [
    { "name": "Bright", "description": "High energy version" },
    { "name": "Dark", "description": "Moody version" }
  ]
}
```

Current ArrayField output:
```
Variations:
  [1] [object Object]
  [2] [object Object]
```

Expected output:
```
Variations:
  Bright: High energy version
  Dark: Moody version
```

### Q: Primitives aren't just String(value) with nudges?

**You're partially right.** Let me be precise:

| Component | Color handling | URL handling | Copyable |
|-----------|---------------|--------------|----------|
| DisplayComponentItem | ✅ `type: "color"` → ColorSwatch | ✅ `type: "url"` → link | ❌ No |
| SchemaField (primitives) | ❌ Just String(value) | ❌ Just String(value) | ❌ No |

So the nudges (color, url) only work in `DisplayComponents`, NOT in `SchemaField`.

**This is a gap.** If you have:
```json
{ "primary_color": { "type": "string", "format": "color", "display": true } }
```

SchemaField will render it as plain text `"#FF0000"`, not as a color swatch.

The `format: "color"` (JSON Schema standard) is ignored. Only `display_components: [{ field: "primary_color", type: "color" }]` works.

<!--
I think this is wrong way to approach this, we need low level structures which will render all primitive types (in a way), so all ux paths will end there. what we need to do is figure out how to apply these nudges at end node. for example, lets say there's object with display_format, the result of the display_format is plain text, which can need copy function. we have to clearly define these low level structure, display_format, display_components, plain values, etc render their target values. display_components has its own complexity which we have to address carefully.
-->

### Q: Don't we already have schema.items?

**Critically: The current implementation is BUGGY.**

SchemaFields line 55-57:
```typescript
if (schema.type === "array" && schema.items) {
  return <SchemaFields data={data} schema={schema.items} indent={indent} className={className} />;
}
```

This passes `data` (an array) to SchemaFields with `schema.items`. But:
- SchemaFields expects `data: Record<string, unknown>` (an object)
- Passing an array will cause it to fail or behave unexpectedly

This code path is likely never hit in practice, or it silently fails. It should be:
```typescript
if (schema.type === "array" && schema.items && Array.isArray(data)) {
  return (
    <div>
      {data.map((item, idx) => (
        <SchemaFields key={idx} data={item} schema={schema.items} indent={indent} />
      ))}
    </div>
  );
}
```

<!-- isnt this a primary candidate for ArrayField? instead of SchemaField, we will ArrayField here, and ArrayFeild can use SchemaField inside to render each item.-->

---

## Revised Understanding

1. **ArrayField is a leaf node** - only handles primitive arrays
<!--This is wrong, array field can handle anyways, its just an wrapper for arrays which will use SchemField inside.-SchemaField -->
2. **schema.items exists but is broken** - SchemaFields doesn't iterate over array items
<!-- Same comment as above, we were using wrong component here, or in a way, trying to make everything work in single component -->
3. **Nudges (color, url) only work in DisplayComponents** - SchemaField ignores `format`
<!-- We need proper difinition on how nudes work, and where they can be. And define how that will impact UX. -->
4. **TUI patterns don't map 1:1** - agreed, WebUI should have its own component patterns

---

## Round 2: Response to Feedback

### Re: "join" magic keyword

**Your correction is valid.** The `display_format: "join"` magic keyword is a design mistake.

`display_format` should ALWAYS be a Jinja expression. If you want to join an array:
```json
{ "display_format": "{{ value | join(' ') }}" }
```

**Action:** Remove the `if (displayFormat === "join")` special case from ArrayField. Let Jinja handle it.

**However, critical question:** If display_format is removed from ArrayField, what does ArrayField do with arrays that have NO display_format? Currently it falls back to numbered list. Under "no assumptions" principle, should it error instead?

---

### Re: StructuredSelect can handle plain arrays

I was conflating two different code paths. Let me be precise:

| Code Path | Where | Handles |
|-----------|-------|---------|
| `parseSchemaData` → StructuredSelect | Top-level interaction | Selectable arrays (structured or plain) |
| `SchemaField` → `ArrayField` | Inside item rendering | Non-selectable `display: true` arrays |

You're correct that StructuredSelect can handle plain arrays - it doesn't require nested objects. A `selectable: true` array of strings is valid.

But ArrayField is a DIFFERENT code path. It's for rendering non-selectable arrays that appear as fields within items. Example: an item has a `keywords: ["a", "b"]` field to display.

**Critical question:** Should ArrayField even exist separately? Or should ALL array rendering go through a unified component regardless of selectable status?

<!--this is where actually i was confused about, selectable true/false is high level input, there's no different code path, all downstream components needs to support selectable=true/false. isnt thats how it should be done?-->

---

### Re: Low-level structures for nudges

**This is the core architectural question.** Let me try to define what you're describing:

**Principle:** All UX rendering paths must terminate at low-level "terminal renderers" that:
1. Render a specific primitive type
2. Can apply nudges (copy, color swatch, link, etc.)
3. Are the ONLY place rendering happens

**Candidate Terminal Renderers:**
```
TextRenderer      → plain text, supports: copy
ColorRenderer     → color swatch + hex, supports: copy
UrlRenderer       → clickable link, supports: copy, open-in-new-tab
ImageRenderer     → thumbnail/preview
DateRenderer      → formatted date/time
NumberRenderer    → formatted number (currency, percentage, etc.)
```

**How display_format fits:**
```
display_format: "{{ name }}: {{ description }}"
         ↓
    Jinja renders to string
         ↓
    TextRenderer (with copy nudge if specified)
```

**How display_components fits:**
```
display_components: [
  { field: "name", type: "text" },
  { field: "color", type: "color" }
]
         ↓
    Each component → appropriate Terminal Renderer
```

<!--but its confusing isnt it? when we added display_components, individual fields didnt have nudges, so it made sense, but now we have nudges for individual fields, display_components are valid only when it combine mutiple fields, otherwise, its just add additional overhead. i think what we should do is to way render subset of composite fields, if we can figure that that out, we dont need display_components -->

**Critical question:** Where do nudges get declared? Options:
1. In schema: `{ "type": "string", "nudges": ["copy"] }`
2. In display_components: `{ field: "x", type: "text", nudges: ["copy"] }`
3. Global config: "all text fields are copyable"

Option 3 violates "no assumptions" principle.
<!--it will be always in item level schema-->

---

### Re: ArrayField should use SchemaField inside

**You're right. I was wrong.**

My suggestion to put array iteration in SchemaFields was backwards. The correct architecture:

```
SchemaField
  ├── type: "array" → ArrayField
  │                      └── for each item → SchemaField (recurse)
  ├── type: "object" → SchemaFields (handles properties)
  └── primitive → TerminalRenderer
```

ArrayField is a **wrapper/orchestrator** for arrays, not a leaf node. It should:
1. Iterate over array items
2. Call SchemaField for each item
3. Handle array-level display (label, container styling)

---

### Re: Workflow agnostic = NO assumptions

**This is the design principle I was missing.**

Current behavior with assumptions:
- No display_format? → Fall back to String(value)
- Unknown type? → Render as text
- Array with no schema? → Numbered list

Correct behavior (no assumptions):
- No display_format and no display_components? → **ERROR or nothing**
- Unknown type? → **ERROR**
- Array with no schema.items? → **ERROR**

**This means:** Every renderable field MUST have explicit rendering instructions. The schema author must declare how things look. The system never guesses.

**Critical implication:** This is a breaking change from current behavior. Existing workflows that rely on implicit rendering would break.

<!--Its okay if it breaks, we need a nice way to show the error with all the details so author can make educated discition-->

---

## Revised Architecture Proposal

### Component Hierarchy (Corrected)

```
SchemaField (entry point for any value)
│
├── Has display_format?
│   └── Jinja render → TextRenderer (or specified terminal)
│
├── Has display_components?
│   └── For each component → TerminalRenderer
│
├── type: "array"?
│   └── ArrayField
│       ├── Has schema.items? → for each item: SchemaField(item, schema.items)
│       └── No schema.items? → ERROR: "Array has no item schema"
│
├── type: "object"?
│   └── SchemaFields(value, schema)
│       └── For each property with display:true → SchemaField
│
├── primitive with explicit type/format?
│   └── Appropriate TerminalRenderer
│
└── None of the above?
    └── ERROR: "No rendering instructions for field"
```

### Terminal Renderers (End Nodes)

All paths must end here:
```
TerminalRenderers/
├── TextRenderer     { value: string, nudges?: ["copy"] }
├── ColorRenderer    { value: string (hex), nudges?: ["copy"] }
├── UrlRenderer      { value: string, nudges?: ["copy", "external"] }
├── ImageRenderer    { value: string (url), nudges?: ["preview", "download"] }
├── DateRenderer     { value: string (ISO), format?: string }
├── NumberRenderer   { value: number, format?: "currency" | "percent" | ... }
└── ErrorRenderer    { message: string }  ← when we can't determine what to render
```

---

## Round 3: Response to Feedback

### Re: selectable=true/false is just a flag, not a code path

**I need to push back on this.**

Currently, there ARE two different code paths:

```
Path 1: parseSchemaData() → finds selectable:true → StructuredSelectCards/List
Path 2: SchemaFields() → finds display:true → SchemaField → ArrayField
```

These are completely separate implementations. They don't share code.

If your vision is "all components support selectable=true/false", then:
- ArrayField would need selection state, checkboxes, etc.
- SchemaField would need to know about selection
- We'd need to unify parseSchemaData and SchemaFields

**Critical question:** Are you saying we should merge these? That ArrayField (when rendering a `keywords: ["a","b"]` field inside an item) should ALSO support being selectable?

Or are you saying the TOP-LEVEL decision (is this interaction selectable?) flows down, but leaf renderers don't need selection logic?

I need clarity because these are very different implementations.

<!--
I really dont see where you are coming from, lets take an example, lets take step 1 -> module 2 of the oms workflow. Since its selectable now, it allows to select 1 item, but lets say its not selectable, then we show the same list, but user cant select. Another example, step 1 -> idea/aesthetic selection. it just have to not to show selection right? Let me take reverse example and tell you how could help. In step 3, prompt view is just a list of prompts shown in UI, they are not selectable, but due to how we render selectable and non-selectable data, prompts are way less richer than above 2 selectable. But these are not different structures, they are essencially same but with single attribute change. in tui, this wasnt an issue because everything looks same, but now in webui, this single modifier gives completely different experiances.
-->

---

### Re: display_components may not be needed

**Let me understand your argument:**

Before nudges:
- Individual fields: just display value
- Composite display: use display_components to combine fields

After nudges:
- Individual fields: display value + nudges (color, copy, etc.)
- Composite display: ???

Your question: if we can render "subset of composite fields" another way, do we need display_components?

**Current display_components use cases:**
```json
display_components: [
  { "field": "name", "type": "text" },           // Single field
  { "field": "color", "type": "color" },         // Single field with type
  { "display_format": "{{ a }} - {{ b }}" }      // Composite
]
```

**Could this be replaced by:**
```json
{
  "properties": {
    "name": { "display": true, "display_order": 1 },
    "color": { "display": true, "display_order": 2, "format": "color" },
    "composite": {
      "display": true,
      "display_order": 3,
      "display_format": "{{ a }} - {{ b }}"  // Virtual field
    }
  }
}
```

**Problem:** The "composite" field doesn't exist in data. It's a computed display.

**Counter-proposal:** What if display_format at the OBJECT level means "render this instead of individual fields"?

```json
{
  "type": "object",
  "display_format": "{{ name }} ({{ color }})",  // Replaces all field rendering
  "properties": { ... }
}
```

But wait - this already exists. display_format at object level does replace field rendering.

**So what's the gap?** When would you need display_components that you can't do with:
1. Individual field `display: true` + nudges in schema
2. Object-level `display_format` for composites

<!--the gap is, by using display format, we simply loose ability to add additional value to display, for example, check oms workflow color display step, reason we added display_components is because we wanted to render colors differently, there we have a composite filed as well. there are thing display_components can do which display_format cannot do in any possible way. thats where issue of composite fields coming from, with display_format, its all or none, display_components, specially composite fields add differnt value. thing is, I am willing not to have composite fields its impossible but i want to entertain the possibity.-->

---

### Re: Nudges always in schema

**Agreed.** Nudges belong in schema:

```json
{
  "type": "object",
  "properties": {
    "hex_code": {
      "type": "string",
      "format": "color",
      "display": true,
      "nudges": ["copy", "swatch"]
    },
    "url": {
      "type": "string",
      "format": "uri",
      "display": true,
      "nudges": ["copy", "external-link"]
    }
  }
}
```

**Question:** Should `format` imply default nudges?
- `format: "color"` → automatically show swatch?
- `format: "uri"` → automatically make clickable?

This might violate "no assumptions" but could be justified as "format defines behavior, nudges are extras".

<!--I dont think we voilates no assumtion rule, this schema clearly says what kind of data it is and what it want us to do. this is why i want to change "format" => "render_as", which without any doubt says how to render it. "format" is too broad term if you remember I wanted to change in the first place-->

---

### Re: Breaking is OK with good errors

**Agreed.** Error display strategy:

| Error Type | Display | Blocks Workflow? |
|------------|---------|------------------|
| Missing display instructions | Inline error in UI | No |
| Invalid schema structure | Sidebar + inline | No |
| Critical render failure | Popup + stop | Yes |

**Error message example:**
```
⚠️ Field "variations" (array) has no rendering instructions.

   Add one of:
   - display_format: "{{ ... }}" for template rendering
   - items.properties with display:true fields

   Location: step_3/generate_ideas.json → schema.properties.variations
```

---

### Re: Migration - TUI ignores unknown fields

**This is clever.** Let me verify the assumption:

- TUI ignores: `nudges`, `format: "color"`, unknown display hints
- Server passes through: all schema fields unchanged
- WebUI: reads new fields, renders accordingly

**So the migration path is:**
1. Add new fields to schemas (nudges, format, etc.)
2. TUI ignores them, keeps working
3. WebUI reads them, renders with nudges
4. No workflow changes needed

**Risk:** If we REMOVE or RENAME existing fields (like changing `display_format` behavior), that breaks both.

**Mitigation:** Only ADD fields. Never change semantics of existing fields.

---

## Revised Open Questions

- [x] Where are nudges declared? → **Schema, at field level**
- [x] Migration path? → **Add-only changes, TUI ignores new fields**
- [x] Error display? → **Prominent inline + sidebar, blocking for critical**
- [x] TUI impact? → **None if we only add fields, never change existing**

## New Questions

- [ ] Should we remove display_components entirely? What's the use case it handles that schema can't?
<!-- one option I am thinking is to have "computed" field at "properties" level. it will essencially have same format for afield but it can have display_format which can have combination of fields or state data. While we are at it, we need support to add nudge for display_order, which will be used to sort fileds available. -->
- [ ] Does `format` imply default nudges, or must nudges always be explicit?
<!-- sice we are renaming this to "render_as", its clear nugdge for render, thats it -->
- [ ] How does selectable=true/false flow through the component tree? Clarify the architecture.
<!-- not sure if i understand the need of clarification, it will be a base field for all components and will be passed downstream right? or you were thinking something else -->

---

## Round 4: Response to Feedback

### Re: selectable - NOW I understand

Your examples made it click. Let me restate to confirm:

**The problem:**
```
Step 1 Module 2 (selectable=true):   Rich card UI, selection controls
Step 3 Prompts (selectable=false):   Bare text list, no visual richness
```

These have the SAME data structure. The ONLY difference is `selectable: true/false`. But WebUI renders them completely differently because:
- Selectable → goes through StructuredSelectCards (rich rendering)
- Non-selectable → goes through SchemaFields (basic rendering)

**Your point:** This is wrong. `selectable` should be a toggle on the SAME component, not a router to different components.

**Correct behavior:**
```
selectable=true:   Same rich UI + checkboxes/radio buttons
selectable=false:  Same rich UI - checkboxes/radio buttons
```

The visual richness should be IDENTICAL. Only the interaction capability changes.

**This means:** We don't need separate "selectable" vs "display-only" code paths. We need ONE renderer that accepts `selectable` as a prop.

**I was wrong** to think these should be separate implementations.

---

### Re: display_components - the "all or none" problem

**Now I understand the gap.**

`display_format` problem:
```json
{
  "display_format": "{{ name }} - {{ description }}"
}
```
This renders ONE string. You can't:
- Apply color swatch to just the name
- Make description copyable but not name
- Mix rendered types (text + color + url)

`display_components` solution:
```json
{
  "display_components": [
    { "field": "name", "render_as": "text" },
    { "field": "hex", "render_as": "color" },
    { "display_format": "{{ extra }} info" }
  ]
}
```
This gives per-field control + composites.

**The question:** Can we achieve this WITHOUT display_components?

---

### Re: "computed" fields proposal

Your idea:
```json
{
  "properties": {
    "name": { "type": "string", "display": true },
    "hex": { "type": "string", "render_as": "color", "display": true },
    "_summary": {
      "computed": true,
      "display": true,
      "display_format": "{{ name }} ({{ hex }})"
    }
  }
}
```

**Issues I see:**

1. **Computed fields don't exist in data** - How does the renderer know `_summary` is computed vs missing?
   - Solution: explicit `"computed": true` flag

2. **Ordering** - You want `display_order` with nudges. What does that mean?
   - Do you mean: `{ "display_order": 1, "order_nudge": "before_selectable" }`?
   - Or grouping: `{ "display_order": 1, "display_group": "header" }`?

3. **Context for computed** - Where does `{{ name }}` come from?
   - Sibling properties? Parent data? State?
   - Need to define the template context clearly.

**Counter-question:** Is "computed" just a special case, or do you want arbitrary virtual fields?

<!-- oh, i think I mentioned this wrong, it would be like this, computed is at level of properties, not fields inside properties,

```json
{
  "properties": {
    "name": { "type": "string", "display": true },
    "hex": { "type": "string", "render_as": "color", "display": true }
  },
  "computed": {
    "_summary": {
      "computed": true,
      "display": true,
      "display_format": "{{ name }} ({{ hex }})"
    }
  }
}
```

-->

---

### Re: format → render_as

**Agreed.** Renaming makes intent clear:

| Old | New | Meaning |
|-----|-----|---------|
| `format: "color"` | `render_as: "color"` | Render this value as a color swatch |
| `format: "uri"` | `render_as: "url"` | Render as clickable link |
| `format: "date-time"` | `render_as: "datetime"` | Render as formatted date |

**This is NOT an assumption** because the schema author explicitly declares rendering intent.

**Question:** Do we keep `format` for JSON Schema compatibility, or replace entirely?

Option A: Replace
```json
{ "type": "string", "render_as": "color" }
```

Option B: Both (render_as takes precedence)
```json
{ "type": "string", "format": "color", "render_as": "color" }
```

Option B is redundant. I vote Option A.

<!--Ah, i see now, I didnt realize we use "format", for now, we will keep both, as format is used by tui, lets add this to technical debt to update tui to use "render_as". but webui specifically wont be using "format"-->

---

### Re: selectable as base prop

**Confirmed.** Architecture:

```
InteractionHost
  └── props: { request, selectable: boolean }
        │
        └── StructuredSelectHost (or unified component)
              └── props: { data, schema, selectable }
                    │
                    └── ItemRenderer
                          └── props: { item, schema, selectable }
                                │
                                ├── selectable=true: show checkbox/radio
                                └── selectable=false: no selection UI
                                │
                                └── (both render identically otherwise)
```

**Key insight:** `selectable` flows DOWN through component tree. Leaf renderers receive it but may not use it (only item-level components need it for selection UI).

---

## Decisions So Far

| Topic | Decision |
|-------|----------|
| selectable | Single code path, prop passed down, toggles selection UI only |
| render_as | Replaces `format` for explicit rendering intent |
| nudges | Declared in schema at field level |
| errors | Prominent display, non-blocking unless critical |
| migration | Add-only changes, preserve existing field semantics |

## Still Open

- [ ] Computed fields: exact syntax and context rules
<!-- added example above -->
- [ ] display_components: keep, remove, or replace with computed?
<!-- remove and replace with computed -->
- [ ] display_order nudges: what does this mean exactly?
<!--lets say user have nudge to display as table, but now we have data in propeties level and computed level, if they want to change order of columns in table, they cant do it before we process it in order of schema, but in reality, they may need computed field earlier in columns, this will allow author to sort columns as needed-->

---

## Round 5: Final Clarifications

### Computed fields - corrected structure

**Got it.** `computed` is a sibling to `properties`, not inside it:

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string", "display": true, "display_order": 1 },
    "hex": { "type": "string", "render_as": "color", "display": true, "display_order": 3 }
  },
  "computed": {
    "_summary": {
      "display": true,
      "display_order": 2,
      "display_format": "{{ name }} ({{ hex }})"
    }
  }
}
```

**Rendering order:** Sort ALL displayable fields (properties + computed) by `display_order`:
1. name (order: 1)
2. _summary (order: 2) - computed
3. hex (order: 3)

**Context for computed templates:** Sibling properties from same object (name, hex available in `{{ }}`).

**Question:** Can computed fields reference other computed fields? Or only real properties?

---

### format vs render_as - coexistence

**Agreed.** Transition plan:

| Component | Uses |
|-----------|------|
| TUI | `format` (existing) |
| WebUI | `render_as` (new) |
| Schema | Both allowed, `render_as` takes precedence |

**Technical debt:** Update TUI to use `render_as`, deprecate `format` for rendering purposes.

**Note:** `format` in JSON Schema has validation meaning (e.g., `format: "email"` validates email format). We're overloading it for rendering. `render_as` separates concerns:
- `format` = validation hint (JSON Schema standard)
- `render_as` = rendering instruction (our extension)

This is actually cleaner long-term.

---

### display_order for mixed properties + computed

**Now I understand.**

Problem: Schema order doesn't match desired display order
```json
{
  "properties": {
    "a": { "display_order": 1 },  // First in schema
    "b": { "display_order": 3 }   // Second in schema
  },
  "computed": {
    "c": { "display_order": 2 }   // Want this BETWEEN a and b
  }
}
```

Without `display_order`, we'd render: a, b, c (schema order + computed after)
With `display_order`, we render: a, c, b (sorted by order)

**Use case:** Table columns
- Properties define data columns
- Computed defines derived columns
- `display_order` controls column position regardless of where defined

**Implementation:**
```typescript
const allFields = [
  ...Object.entries(schema.properties).map(([k, v]) => ({ key: k, ...v, source: 'property' })),
  ...Object.entries(schema.computed || {}).map(([k, v]) => ({ key: k, ...v, source: 'computed' }))
];

const sorted = allFields
  .filter(f => f.display === true)
  .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
```

---

## Final Decisions

| Topic | Decision |
|-------|----------|
| selectable | Single code path, prop toggles selection UI only |
| render_as | New field for WebUI, coexists with format (TUI) |
| nudges | In schema at field level |
| computed | Sibling to properties, replaces display_components |
| display_order | Sorts ALL fields (properties + computed) together |
| display_components | **REMOVE** - replaced by computed fields |
| errors | Prominent, non-blocking unless critical |
| migration | Add-only, preserve existing semantics |

---

## Schema Structure Summary

```json
{
  "type": "object",
  "properties": {
    "field_name": {
      "type": "string",
      "display": true,
      "display_order": 1,
      "display_label": "Custom Label",
      "render_as": "color",
      "nudges": ["copy", "swatch"]
    }
  },
  "computed": {
    "_virtual_field": {
      "display": true,
      "display_order": 2,
      "display_format": "{{ field1 }} - {{ field2 }}",
      "render_as": "text",
      "nudges": ["copy"]
    }
  },
  "selectable": true
}
```

**Field-level properties:**
- `display`: boolean - show this field?
- `display_order`: number - sort position
- `display_label`: string - custom label
- `display_format`: string - Jinja template (for computed or override)
- `render_as`: string - how to render (text, color, url, datetime, etc.)
- `nudges`: string[] - additional UI features (copy, swatch, external-link, etc.)

**Object-level properties:**
- `properties`: real data fields
- `computed`: virtual fields (display_format required)
- `selectable`: can items be selected?

---

## Open Implementation Questions - RESOLVED

- [x] What `render_as` values do we support?
  - **Start with:** text, color, url, datetime, number, image
  - **Design for extensibility:** separately managed, easy to add new types

- [x] What `nudges` do we support?
  - **Start with:** copy, swatch, external-link, preview
  - **Design for extensibility:** separately managed, easy to add new nudges

- [x] Can computed fields reference other computed fields?
  - **No** - only real properties for now
  - **Backlog:** Add computed→computed references in future

- [x] How do errors display when computed template fails?
  - **Inline error** - doesn't break workflow
  - **Also shown in error panel** (left/right sidebar)

---

## Implementation Backlog

- [ ] TUI: Migrate from `format` to `render_as`
- [ ] Computed→computed field references
- [ ] Additional render_as types as needed
- [ ] Additional nudges as needed
