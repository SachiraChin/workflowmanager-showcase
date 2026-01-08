# Schema-Driven Addon Rendering

**Date:** 2026-01-06
**Revision:** 2
**Status:** Proposal

---

## Overview

This document proposes migrating addon data rendering from hardcoded client-side knowledge to a decorator-based approach. Currently, both WebUI and TUI have hardcoded logic that specifically handles `_addon.color`, `_addon.score`, and `_addon.last_used` fields. The goal is to make clients render addon data using item-level decorators without addon-specific knowledge.

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
       'color': '#00FF00'
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

## Chosen Approach: Item-Level Decorators under `_metadata`

### Core Principle

**Decorators are rendering hints embedded in data, separate from schema.**

- Schema defines **what** to display (structure, field types, display order)
- Decorators define **how** to enhance display (borders, badges, timestamps)
- Client can ignore `_metadata` entirely if it doesn't support decorators

### Data Structure

All metadata moves under `_metadata` object:
- `_metadata.addon` - Raw addon data (for TUI backward compatibility)
- `_metadata.decorators` - Rendering hints for visual enhancements

```json
{
  "name": "Chord Progression A",
  "primary_color": "#FF5500",
  "tags": {...},
  "_metadata": {
    "addon": {
      "color": "#00FF00",
      "score": 85,
      "last_used": "2025-01-05T10:30:00"
    },
    "decorators": [
      {"type": "border", "color": "#00FF00", "side": "left"},
      {"type": "badge", "text": "85% match", "position": "header-right"},
      {"type": "timestamp", "value": "2025-01-05T10:30:00", "label": "Last used", "position": "footer"}
    ]
  }
}
```

### Decorator Types

| Type | Purpose | Properties |
|------|---------|------------|
| `border` | Colored border on item | `color`, `side` (left/all) |
| `badge` | Text badge | `text`, `variant` (default/outline), `position` |
| `swatch` | Color swatch | `color`, `position` |
| `timestamp` | Relative time display | `value` (ISO string), `label`, `position` |

<!--I'm not so sure about the timestamp. the name "timestamp" doesnt clearly say displayed value is a diff/relative time, it simply said what providesd is a timestamp. I feel like this should be computed field on server, and sent to client as a badge with exact value. it will simply remove confusion and we have addon in place on server side to do exactly this-->

### Position Values

- `header-left`: Left side of header row (color swatch)
- `header-right`: Right side of header row (badges, scores)
- `footer`: Below content (timestamps, metadata)

<!--not sure if exact position is an good idea, but in the same time one can argue that client can ignore it. my worry about this king of positioning is that its very very relative to content of the tile. for example, what is the header in card which only has one line. is that single line is a header or we need new header to add badges? but in other hand, without positioning, how does client degine where to show badges. i feel like we can start without positioning, and have dedicated area in cards to show badges. for example, instead of AddOnProvider, we will use Decorator provider which will position all badges and borders in fixed positions. we will adjust them as we go. Also, add this issue (adding positioning data for decorator) as tech tebt.-->

### Why `_metadata` Instead of Root Level

1. **Clear namespace**: All non-content data is in one place
2. **Easy to ignore**: Clients that don't support decorators can skip `_metadata`
3. **Semantic meaning**: "metadata" clearly indicates this isn't content data
4. **Future extensibility**: Other metadata can be added (e.g., `_metadata.debug`, `_metadata.source`)

---

## Data Flow

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
│  2. Consolidate Addon Data                                      │
│     item._metadata.addon = {last_used, score, color}            │
│                        │                                         │
│                        ▼                                         │
│  3. Generate Decorators from Addon Data                         │
│     item._metadata.decorators = [                               │
│       {type: "border", color: addon.color},                     │
│       {type: "badge", text: `${addon.score}% match`},           │
│       {type: "timestamp", value: addon.last_used}               │
│     ]                                                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (WebUI)                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SelectableItem reads _metadata.decorators                      │
│  Renders each decorator by type                                 │
│  NO knowledge of addon fields                                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (TUI) - Minimal Changes                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Update _get_addon_display to read from:                        │
│  item._metadata.addon (instead of item._addon)                  │
│                                                                  │
│  Existing hardcoded logic continues to work                     │
│  (Full decorator support can be added later)                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 1: Server - Move `_addon` to `_metadata.addon`

**Goal:** Restructure addon data without breaking TUI

**Changes to `server/modules/user/select.py`:**

```python
def _embed_addon_data(self, data, schema, inputs, context):
    # ... existing addon processing ...

    for idx, addon_result in result.items():
        if idx < len(item_refs):
            item = item_refs[idx]
            if isinstance(item, dict):
                # NEW: Use _metadata.addon instead of _addon
                if '_metadata' not in item:
                    item['_metadata'] = {}
                if 'addon' not in item['_metadata']:
                    item['_metadata']['addon'] = {}
                item['_metadata']['addon'].update(addon_result)
```

**Changes to `tui/strategies/mixins.py`:**

```python
def _get_addon_display(self, item: dict) -> tuple:
    if not isinstance(item, dict):
        return "", ""

    # NEW: Read from _metadata.addon, fallback to _addon for compatibility
    metadata = item.get('_metadata', {})
    addon_data = metadata.get('addon', {}) or item.get('_addon', {})

    # ... rest of existing logic unchanged ...
```

### Phase 2: Server - Generate Decorators

**Goal:** Server generates decorators based on addon configuration

**Add decorator generation after addon consolidation:**

<!--i'm not 100% convinced at following, can you look into current addons and comeup with a way where we dont consolidate data on server side. I know both addons provide some duplicated data, as far as i know, current addon code priritize last provided entry when merge them. I want to have a way to send all data without deduplication to client and let client decide what to show. -->

```python
def _generate_decorators(self, addon_data: dict) -> list:
    """Generate decorator list from consolidated addon data."""
    decorators = []

    # Border decorator from color
    if addon_data.get('color'):
        decorators.append({
            'type': 'border',
            'color': addon_data['color'],
            'side': 'left'
        })
        decorators.append({
            'type': 'swatch',
            'color': addon_data['color'],
            'position': 'header-left'
        })

    # Badge decorator from score
    if addon_data.get('score') is not None:
        decorators.append({
            'type': 'badge',
            'text': f"{int(addon_data['score'])}% match",
            'position': 'header-right'
        })

    # Timestamp decorator from last_used
    if addon_data.get('last_used'):
        decorators.append({
            'type': 'timestamp',
            'value': addon_data['last_used'],
            'label': 'Last used',
            'position': 'footer'
        })

    return decorators

def _embed_addon_data(self, data, schema, inputs, context):
    # ... existing addon consolidation ...

    # After consolidation, generate decorators
    for item in item_refs:
        if isinstance(item, dict) and '_metadata' in item:
            addon = item['_metadata'].get('addon', {})
            item['_metadata']['decorators'] = self._generate_decorators(addon)
```

### Phase 3: WebUI - Render from Decorators

**Goal:** Remove hardcoded addon rendering, use decorators

**New types in `types.ts`:**

```typescript
export interface ItemMetadata {
  addon?: {
    color?: string;
    score?: number;
    last_used?: string;
  };
  decorators?: Decorator[];
}

export type DecoratorPosition = "header-left" | "header-right" | "footer";

export interface Decorator {
  type: "border" | "badge" | "swatch" | "timestamp";
  color?: string;
  text?: string;
  value?: string;
  label?: string;
  side?: "left" | "all";
  position?: DecoratorPosition;
}
```

**New `DecoratorRenderer.tsx`:**

```typescript
interface DecoratorRendererProps {
  decorators: Decorator[];
  position: DecoratorPosition;
}

<!--I'm not sure i get how this is used, we need all decorator logic encapsulated here, which includes border, in schema renderer, we will use this, like we tried to AddOnProvider, but in this case, its more controlled.-->

export function DecoratorRenderer({ decorators, position }: DecoratorRendererProps) {
  const filtered = decorators.filter(d => d.position === position);

  return (
    <div className="flex items-center gap-2">
      {filtered.map((decorator, idx) => {
        switch (decorator.type) {
          case "swatch":
            return <ColorSwatch key={idx} color={decorator.color} size="sm" />;
          case "badge":
            return (
              <Badge key={idx} variant="outline" className="text-xs">
                {decorator.text}
              </Badge>
            );
          case "timestamp":
            return (
              <span key={idx} className="text-xs text-muted-foreground">
                {decorator.label}: {formatTimeAgo(decorator.value)}
              </span>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
```

**Update `SelectableItem.tsx`:**

```typescript
<!--I still do not agree that this is has to be come only for selectables. whole purpose of decorator is that any entitiy can have decorators to improve ux.-->

export function SelectableItem({ path, data, schema, children }: SelectableItemProps) {
  const itemData = typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : { value: data };

  // NEW: Get decorators from _metadata
  const metadata = (itemData._metadata || {}) as ItemMetadata;
  const decorators = metadata.decorators || [];

  // Get border decorator for styling
  const borderDecorator = decorators.find(d => d.type === "border");

  return (
    <div
      className={cn("relative flex items-start gap-3 p-3 rounded-lg border", ...)}
      style={borderDecorator?.color ? { borderLeftColor: borderDecorator.color, borderLeftWidth: "3px" } : undefined}
    >
      {/* Header row with decorators */}
      <div className="flex items-center gap-2 w-full">
        <DecoratorRenderer decorators={decorators} position="header-left" />
        {label && <span className="font-medium">{label}</span>}
        <div className="ml-auto">
          <DecoratorRenderer decorators={decorators} position="header-right" />
        </div>
      </div>

      {/* Content */}
      {children}

      {/* Footer decorators */}
      <DecoratorRenderer decorators={decorators} position="footer" />
    </div>
  );
}
```

### Phase 4: Cleanup

**Goal:** Remove deprecated code

1. Remove `getItemAddon()` from `schema-utils.ts`
2. Remove hardcoded addon rendering from `SelectableItem.tsx`
3. Update `AddonWrapper.tsx` to use decorators (or remove if no longer needed)
4. Update tech debt item #5 as resolved

---

## Example: Before and After

### Before (Current)

```json
{
  "name": "Chord Progression A",
  "_addon": {
    "color": "#00FF00",
    "score": 85,
    "last_used": "2025-01-05T10:30:00"
  }
}
```

Client: Hardcoded check for `_addon.color`, `_addon.score`, `_addon.last_used`

### After (Proposed)

```json
{
  "name": "Chord Progression A",
  "_metadata": {
    "addon": {
      "color": "#00FF00",
      "score": 85,
      "last_used": "2025-01-05T10:30:00"
    },
    "decorators": [
      {"type": "border", "color": "#00FF00", "side": "left"},
      {"type": "swatch", "color": "#00FF00", "position": "header-left"},
      {"type": "badge", "text": "85% match", "position": "header-right"},
      {"type": "timestamp", "value": "2025-01-05T10:30:00", "label": "Last used", "position": "footer"}
    ]
  }
}
```

Client: Renders based on `_metadata.decorators`, no addon-specific code

---

## Files Affected

### Server
- `server/modules/user/select.py`
  - `_embed_addon_data()` - Move to `_metadata.addon`
  - New `_generate_decorators()` method

### WebUI
- `webui/src/components/workflow/interactions/schema-interaction/types.ts`
  - Add `ItemMetadata`, `Decorator`, `DecoratorPosition` types
- `webui/src/components/workflow/interactions/schema-interaction/SelectableItem.tsx`
  - Remove hardcoded addon rendering
  - Use `DecoratorRenderer`
- `webui/src/components/workflow/interactions/schema-interaction/schema-utils.ts`
  - Remove `getItemAddon()` (after migration complete)
- New: `webui/src/components/workflow/interactions/schema-interaction/renderers/DecoratorRenderer.tsx`

### TUI
- `tui/strategies/mixins.py`
  - Update `_get_addon_display()` to read from `_metadata.addon`
  - Fallback to `_addon` for backward compatibility during transition

---

## Open Questions

1. **Should decorators be configurable per addon in step.json?**
   - Current: Server generates standard decorators for all addons
   - Future: Could allow workflow authors to customize decorator appearance
   - Recommendation: Start with standard, add configuration later if needed

2. **Consistent height handling?**
   - Current issue: Items without `last_used` are shorter
   - Recommendation: Use CSS grid with fixed row heights, footer row always exists but may be empty

3. **Should TUI eventually support full decorator rendering?**
   - Current: TUI continues using `_metadata.addon` with existing hardcoded logic
   - Future: Could implement decorator-based rendering for consistency
   - Recommendation: Defer to future iteration, current approach minimizes TUI changes

---

## Success Criteria

1. WebUI renders addon data from `_metadata.decorators` without addon-specific code
2. TUI continues to work with minimal changes (reads from `_metadata.addon`)
3. Adding a new addon type only requires server-side decorator generation
4. List items have consistent height regardless of decorator presence
5. All existing workflows continue to work (backward compatible)
