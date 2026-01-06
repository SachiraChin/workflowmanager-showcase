# Schema-Driven Addon Rendering

**Date:** 2026-01-06
**Revision:** 1
**Status:** Proposal

---

## Overview

This document proposes migrating addon data rendering from hardcoded client-side knowledge to a schema-driven approach. Currently, both WebUI and TUI have hardcoded logic that specifically handles `_addon.color`, `_addon.score`, and `_addon.last_used` fields. The goal is to make clients render addon data using standard schema properties (`render_as`, `nudges`, `display_format`) without any addon-specific knowledge.

---

## Current Architecture

### Server-Side Flow

1. **Addons** (`server/modules/addons/`) process items and return metadata:
   - `usage_history.py`: Returns `{last_used: "2025-12-05T10:30:00", color: "#FF00FF"}`
   - `compatibility.py`: Returns `{score: 85.5, color: "#00FF00"}`

2. **`select.py:_embed_addon_data()`** consolidates all addon results into each item:
   ```python
   item['_addon'] = {
       'last_used': '2024-01-15T10:30:00',
       'score': 85,
       'color': '#00FF00'  # From last addon that set color
   }
   ```

3. **Items sent to client** with `_addon` field embedded in data.

### Client-Side Hardcoded Rendering

**WebUI (`SelectableItem.tsx:60-182`):**
```typescript
const addon = getItemAddon(itemData);  // Extracts _addon field

// Hardcoded rendering logic:
{addon?.color && <ColorSwatch color={addon.color} size="sm" />}
{addon?.score !== undefined && (
  <Badge variant="outline">{Math.round(addon.score)}%</Badge>
)}
{addon?.last_used && (
  <div>Last used: {formatTimeAgo(addon.last_used)}</div>
)}
```

**TUI (`mixins.py:151-181`):**
```python
def _get_addon_display(self, item: dict) -> tuple:
    addon_data = item.get('_addon', {})

    # Hardcoded formatting:
    if addon_data.get('color'):
        color = self._hex_to_ansi_fg(addon_data['color'])
    if addon_data.get('score') is not None:
        suffix_parts.append(f"[{int(score)}%]")
    if addon_data.get('last_used'):
        suffix_parts.append(f"(last: {time_ago})")
```

### Problems

1. **Tight coupling**: Clients must know about specific `_addon` fields
2. **No extensibility**: Adding new addon metadata requires client code changes
3. **Inconsistent UX**: Items have different heights based on addon data presence
4. **Duplicated logic**: Both WebUI and TUI implement the same hardcoded logic

---

## Proposed Architecture

### Core Principle

**Client renders based on schema, not on data field names.**

Instead of clients checking `item._addon.score`, the server transforms addon metadata into schema properties that the client already knows how to render using `render_as` and `nudges`.

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Addons Process Items                                        │
│     ┌──────────────────┐    ┌──────────────────┐               │
│     │ usage_history    │    │ compatibility    │               │
│     │ {last_used, color}│    │ {score, color}   │               │
│     └────────┬─────────┘    └────────┬─────────┘               │
│              └─────────┬─────────────┘                          │
│                        ▼                                         │
│  2. Consolidate Addon Data (existing)                           │
│     item._addon = {last_used, score, color}                     │
│                        │                                         │
│                        ▼                                         │
│  3. NEW: Transform to Schema Properties                         │
│     ┌─────────────────────────────────────────┐                │
│     │ AddonSchemaTransformer                  │                │
│     │                                         │                │
│     │ Input:  _addon: {score: 85, color: ...} │                │
│     │ Output: computed fields in schema       │                │
│     │         OR injected properties in item  │                │
│     └────────────────────────────────────────┘                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (WebUI / TUI)                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Renders using existing schema system:                          │
│  - render_as: "text", "color", "datetime", "number"             │
│  - nudges: ["swatch", "copy"]                                   │
│  - display_format: "{{ score }}% match"                         │
│                                                                  │
│  NO knowledge of _addon field                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Options

### Option A: Computed Fields in Schema

**Approach:** Server adds `computed` fields to the item schema that reference `_addon` data.

**Server generates schema dynamically:**
```json
{
  "type": "object",
  "properties": {
    "name": {"type": "string", "display": true, "display_label": "Name"},
    "primary_color": {"type": "string", "display": true, "render_as": "color"}
  },
  "computed": {
    "compatibility": {
      "display": true,
      "display_order": 100,
      "display_format": "{{ _addon.score | round }}% match",
      "render_as": "text",
      "nudges": ["badge"]
    },
    "last_used_display": {
      "display": true,
      "display_order": 101,
      "display_format": "{{ _addon.last_used | time_ago }}",
      "render_as": "datetime"
    },
    "addon_color": {
      "display": true,
      "display_order": -1,
      "display_format": "{{ _addon.color }}",
      "render_as": "color",
      "nudges": ["swatch"]
    }
  }
}
```

**Client code (existing - no changes):**
```typescript
// SchemaRenderer already handles computed fields
if (isComputed && fieldSchema.display_format) {
  const computedValue = renderTemplate(fieldSchema.display_format, dataObj, templateState);
  return <TerminalRenderer value={computedValue} renderAs={fieldSchema.render_as} />;
}
```

**Pros:**
- Uses existing `computed` field system
- Client code unchanged
- Schema is explicit and debuggable
- Display order is controllable

**Cons:**
- Server must generate dynamic schema per item set
- Schema size increases
- `_addon` field still visible in data (debugging benefit vs clutter)

<!--I dont like this simply because server is changing display schema at runtime. I know that we have schema merging in server side, but in that case, merge is very declaritive and server is merging 2 schema provided in workflow. adding brand new entitities to schema is really a no go. -->

---

### Option B: Server Transforms Addon Data into Item Properties

**Approach:** Server transforms `_addon` into first-class item properties with schema definitions.

**Server transforms data:**
```python
# Before (current):
item = {
    "name": "Option 1",
    "_addon": {"score": 85, "color": "#00FF00", "last_used": "2025-01-05T10:00:00"}
}

# After (transformed):
item = {
    "name": "Option 1",
    "_display_color": "#00FF00",         # For left border / swatch
    "_compatibility_score": 85,           # For badge
    "_last_used": "2025-01-05T10:00:00"  # For timestamp
}
```

**Schema includes display hints:**
```json
{
  "type": "object",
  "properties": {
    "name": {"type": "string", "display": true},
    "_display_color": {
      "type": "string",
      "display": true,
      "display_order": -1,
      "render_as": "color",
      "nudges": ["swatch", "border"]
    },
    "_compatibility_score": {
      "type": "number",
      "display": true,
      "display_order": 100,
      "display_format": "{{ value }}% match",
      "nudges": ["badge"]
    },
    "_last_used": {
      "type": "string",
      "display": true,
      "display_order": 101,
      "render_as": "datetime",
      "display_format": "{{ value | time_ago }}"
    }
  }
}
```

**Pros:**
- Data is self-contained (no `_addon` object)
- Standard schema rendering
- Clear separation of concerns

**Cons:**
- Requires new `nudges` values (`border`, `badge`)
- Server must transform every item
- Property naming convention (`_` prefix) needed to avoid conflicts

<!--same as above-->

---

### Option C: Item-Level Decorators (Separate from Content)

**Approach:** Add `_decorators` array to items that defines visual enhancements without mixing with content schema.

**Data structure:**
```json
{
  "name": "Option 1",
  "tags": {...},
  "_decorators": [
    {"type": "border", "color": "#00FF00"},
    {"type": "badge", "text": "85% match", "position": "right"},
    {"type": "timestamp", "value": "2025-01-05T10:00:00", "label": "Last used", "position": "footer"}
  ]
}
```

**Client renders:**
```typescript
function SelectableItem({ data, children }) {
  const decorators = data._decorators || [];
  const borderDecorator = decorators.find(d => d.type === "border");
  const badges = decorators.filter(d => d.type === "badge");

  return (
    <div style={borderDecorator ? {borderColor: borderDecorator.color} : undefined}>
      <div className="flex">
        {children}
        {badges.map(b => <Badge>{b.text}</Badge>)}
      </div>
    </div>
  );
}
```

**Pros:**
- Clear separation: content vs visual decorations
- Type-safe decorator definitions
- Flexible positioning (header, footer, left, right)
- No schema changes needed for content

**Cons:**
- New concept (`_decorators`) clients must understand
- Still requires client knowledge of decorator types
- Not fully schema-driven

<!--I feel like this is most viable option, where it gives an idea about how each data entry should be rendered. what I'm not sure about here is the location of the decorator entry. I dont believe that it should be on root object. I feel like it should be obj._metadata.decorators, and naming wise it make sense too, because these are just metadata, client can simply not use it. one thing to note is that, i prefer to move _addon to _metadata.addon and update tui to use new path. This is simply because we can't remove addons from logic, and I dont want to make huge refactoring to tui.-->

---

### Option D: Extended nudges System (Recommended)

**Approach:** Extend existing `nudges` system to support parameterized values that reference item data.

**Current `nudges`:** Simple strings - `["copy", "swatch", "external-link"]`

**Extended `nudges`:** Objects with parameters
```json
{
  "type": "object",
  "selectable": true,
  "items": {
    "type": "object",
    "properties": {
      "name": {"type": "string", "display": true}
    },
    "nudges": [
      {"type": "border", "color_from": "_addon.color"},
      {"type": "badge", "format": "{{ _addon.score }}% match", "position": "header-right"},
      {"type": "swatch", "color_from": "_addon.color", "position": "header-left"},
      {"type": "timestamp", "value_from": "_addon.last_used", "format": "{{ value | time_ago }}", "position": "footer"}
    ]
  }
}
```

**Client rendering:**
```typescript
// TerminalRenderer processes nudges with data context
function processNudges(nudges: NudgeConfig[], data: unknown): RenderedNudge[] {
  return nudges.map(nudge => {
    if (typeof nudge === "string") {
      // Legacy simple nudge
      return { type: nudge };
    }
    // Parameterized nudge - resolve values from data
    const resolved = {
      type: nudge.type,
      value: nudge.value_from ? getValueAtPath(data, nudge.value_from) : nudge.value,
      color: nudge.color_from ? getValueAtPath(data, nudge.color_from) : nudge.color,
      text: nudge.format ? renderTemplate(nudge.format, data) : nudge.text,
      position: nudge.position || "default"
    };
    return resolved;
  });
}
```

**Pros:**
- Extends existing system (backward compatible)
- Schema-driven with data references
- Position control for layout
- Client doesn't need to know about `_addon` specifically - just follows nudge instructions
- Simple string nudges still work

**Cons:**
- More complex nudge types
- Client needs to implement new nudge rendering

<!--I dont think this is a viable option, this simply mixes schema properies with data properties. nudges meant to be properties of schema which give nudges to ui render on how to render data. they dont have data, they define how data should be seen. so i would drop this option due to that reason.-->

---

## Comparison Matrix

| Criteria | Option A (Computed) | Option B (Transform) | Option C (Decorators) | Option D (Extended Nudges) |
|----------|---------------------|---------------------|----------------------|---------------------------|
| Client changes | Minimal | Moderate | Moderate | Moderate |
| Server changes | Schema generation | Data transform | Add decorators | Schema generation |
| Backward compatible | Yes | Yes | Yes | Yes |
| Schema complexity | Higher | Higher | Low | Medium |
| Data size | Same | Smaller | Larger | Same |
| Debugging | Good | Good | Good | Good |
| TUI migration | Template filters | Same rendering | New decorator system | Extended nudges |
| Extensibility | High | High | Medium | High |

---

## Recommended Approach: Option D (Extended Nudges)

### Rationale

1. **Builds on existing system**: `nudges` already exists and is understood by both clients
2. **Backward compatible**: Simple string nudges continue to work
3. **Schema-driven**: All rendering decisions are in the schema
4. **Flexible positioning**: Decorations can be placed in header, footer, left, right
5. **Data references**: `color_from`, `value_from` allow referencing any field, not just `_addon`
6. **Format templates**: Existing Jinja2/Nunjucks templates can be used

### New Nudge Types

| Type | Purpose | Parameters |
|------|---------|------------|
| `border` | Colored border on item | `color_from`, `color`, `side` (left/all) |
| `badge` | Text badge | `format`, `value_from`, `position` |
| `timestamp` | Relative time display | `value_from`, `format`, `position` |
| `swatch` | Color swatch (existing) | `color_from`, `color`, `position` |

### Position Values

- `header-left`: Left side of header row
- `header-right`: Right side of header row (badges, scores)
- `footer`: Below content (timestamps)
- `border-left`: Left border only (default for border)
- `border-all`: All borders

---

## Migration Path

### Phase 1: Server Changes

1. Create `AddonSchemaTransformer` that generates extended nudges from addon config
2. Add nudge generation to `_embed_addon_data()` or new method
3. Keep `_addon` field for backward compatibility during transition

**Example transform:**
```python
def transform_addon_to_nudges(addon_config: List[Dict], items_schema: Dict) -> Dict:
    """Generate nudges based on configured addons."""
    nudges = []

    for addon in addon_config:
        if addon['addon_id'] == 'addons.usage_history':
            nudges.append({
                "type": "timestamp",
                "value_from": "_addon.last_used",
                "format": "{{ value | time_ago }}",
                "position": "footer"
            })
            nudges.append({
                "type": "border",
                "color_from": "_addon.color",
                "side": "left"
            })

        if addon['addon_id'] == 'addons.compatibility':
            nudges.append({
                "type": "badge",
                "format": "{{ _addon.score | round }}% match",
                "position": "header-right"
            })

    # Merge with existing nudges
    existing = items_schema.get('nudges', [])
    items_schema['nudges'] = existing + nudges
    return items_schema
```

### Phase 2: WebUI Changes

1. Update `types.ts` with extended `Nudge` type:
   ```typescript
   export type SimpleNudge = "copy" | "swatch" | "external-link" | "preview" | "download";

   export interface ParameterizedNudge {
     type: "border" | "badge" | "timestamp" | "swatch";
     color_from?: string;  // JSONPath to color value
     color?: string;       // Static color
     value_from?: string;  // JSONPath to value
     format?: string;      // Display format template
     position?: "header-left" | "header-right" | "footer" | "border-left";
   }

   export type Nudge = SimpleNudge | ParameterizedNudge;
   ```

2. Update `SelectableItem.tsx` to render nudges from schema instead of hardcoded `_addon`

3. Create `NudgeRenderer` component:
   ```typescript
   function NudgeRenderer({ nudges, data, position }: NudgeRendererProps) {
     const filtered = nudges.filter(n => n.position === position);
     return filtered.map(nudge => {
       switch (nudge.type) {
         case "border": return null; // Border handled at container level
         case "badge": return <Badge>{renderTemplate(nudge.format, data)}</Badge>;
         case "timestamp": return <span>{renderTemplate(nudge.format, data)}</span>;
         case "swatch": return <ColorSwatch color={resolveColor(nudge, data)} />;
       }
     });
   }
   ```

### Phase 3: TUI Changes

1. Update `_get_addon_display()` to read from schema nudges instead of `_addon`
2. Add format template support for new nudge types
3. Keep legacy `_addon` handling as fallback

### Phase 4: Deprecation

1. Mark `_addon` field as deprecated
2. Update all workflows to use new schema format
3. Remove hardcoded addon rendering from clients
4. Remove `getItemAddon()` utility function

---

## Example: Before and After

### Before (Current)

**Data:**
```json
{
  "name": "Chord Progression A",
  "primary_color": "#FF5500",
  "_addon": {
    "color": "#00FF00",
    "score": 85,
    "last_used": "2025-01-05T10:30:00"
  }
}
```

**Schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {"type": "string", "display": true},
    "primary_color": {"type": "string", "display": true, "render_as": "color"}
  }
}
```

**Client:** Hardcoded check for `_addon` fields

### After (Proposed)

**Data:** Same (no change to data structure)

**Schema:**
```json
{
  "type": "object",
  "properties": {
    "name": {"type": "string", "display": true},
    "primary_color": {"type": "string", "display": true, "render_as": "color"}
  },
  "nudges": [
    {"type": "border", "color_from": "_addon.color", "side": "left"},
    {"type": "swatch", "color_from": "_addon.color", "position": "header-left"},
    {"type": "badge", "format": "{{ _addon.score | round }}% match", "position": "header-right"},
    {"type": "timestamp", "value_from": "_addon.last_used", "format": "{{ value | time_ago }}", "position": "footer"}
  ]
}
```

**Client:** Renders based on schema nudges, no addon-specific code

---

## Open Questions

1. **Should `_addon` field be removed entirely?**
   - Pro: Cleaner data
   - Con: Useful for debugging, requires full migration
   - Recommendation: Keep during transition, remove in future phase

2. **Should nudges live on item schema or array schema?**
   - Item-level: Different items could have different nudges (unlikely need)
   - Array-level: Cleaner, applies uniformly
   - Recommendation: Array-level (on `items` schema)

3. **How to handle missing addon data?**
   - Option: Don't render nudge if referenced field is null/undefined
   - Option: Show placeholder (e.g., "No data")
   - Recommendation: Skip rendering if data missing

4. **Position for consistent height?**
   - Current issue: Items without `last_used` are shorter
   - Option: Always reserve space for all positions
   - Recommendation: Use CSS grid with fixed rows, empty cells collapse

---

## Files Affected

### Server
- `server/modules/user/select.py` - Add nudge generation to `_embed_addon_data()`
- `server/modules/addons/base.py` - Optional: Add nudge metadata to addon output

### WebUI
- `webui/src/components/workflow/interactions/schema-interaction/types.ts` - Extend Nudge type
- `webui/src/components/workflow/interactions/schema-interaction/SelectableItem.tsx` - Remove hardcoded addon, use nudges
- `webui/src/components/workflow/interactions/schema-interaction/schema-utils.ts` - Remove `getItemAddon()`
- New: `webui/src/components/workflow/interactions/schema-interaction/renderers/nudges/NudgeRenderer.tsx`

### TUI
- `tui/strategies/mixins.py` - Update `_get_addon_display()` to use schema nudges

### Documentation
- Update `!TECHNICAL_DEBT.md` item #5 when complete

---

## Success Criteria

1. WebUI renders addon data without any `_addon`-specific code
2. TUI renders addon data without any `_addon`-specific code
3. Adding a new addon type requires only server-side changes
4. List items have consistent height regardless of addon data presence
5. All existing workflows continue to work (backward compatible)
