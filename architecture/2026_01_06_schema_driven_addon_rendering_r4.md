# Schema-Driven Addon Rendering

**Date:** 2026-01-06
**Revision:** 4
**Status:** Proposal

---

## Overview

This document proposes migrating addon data rendering from hardcoded client-side knowledge to a decorator-based approach where **each addon generates its own decorators**.

---

## Changes from Revision 3

1. **Addons generate their own decorators** - Server doesn't transform addon data into decorators; each addon returns decorators directly
2. **`source` field on decorators** - Each decorator includes which addon generated it, allowing client to filter/prioritize
3. **DecoratorWrapper for any component** - Not limited to selectables; wraps any component in SchemaRenderer that has `_metadata.decorators`

---

## Key Design Decision: Addons Generate Decorators

**Why addons should generate decorators:**

1. **Addon knows its purpose** - usage_history knows its color represents recency, compatibility knows its color represents match quality
2. **No central logic** - Server doesn't need to know how to format timestamps or what each addon's color means
3. **Extensibility** - New addons can add new decorator types without server changes
4. **Conflict resolution** - When two addons provide the same decorator type (e.g., border), `source` field lets client decide

**Example: Two addons, both provide color, different purposes:**

```python
# usage_history addon returns:
{
    'data': {'last_used': '2025-01-05T10:30:00', 'color': '#7CFFB2'},
    'decorators': [
        {'type': 'border', 'color': '#7CFFB2', 'source': 'usage_history'},
        {'type': 'badge', 'text': '2d ago', 'source': 'usage_history'}
    ]
}

# compatibility addon returns:
{
    'data': {'score': 85, 'color': '#00FF00'},
    'decorators': [
    <!-- this returns color too -->
        {'type': 'badge', 'text': '85% match', 'source': 'compatibility'}
    ]
}
```

**Result in item:**
```json
{
  "name": "Chord Progression A",
  "_metadata": {
    "addons": {
      "usage_history": {"last_used": "2025-01-05T10:30:00", "color": "#7CFFB2"},
      "compatibility": {"score": 85, "color": "#00FF00"}
    },
    "decorators": [
      {"type": "border", "color": "#7CFFB2", "source": "usage_history"},
      <!-- color from compatibility -->
      {"type": "border", "color": "#00FF00", "source": "compatibility"},
      {"type": "badge", "text": "2d ago", "source": "usage_history"},
      {"type": "badge", "text": "85% match", "source": "compatibility"}
    ]
  }
}
```

**Client rendering:**
- Takes first `border` decorator (or filters by `source` if needed)
- Renders all `badge` decorators
- No need to know what "usage_history" or "compatibility" means

---

## Data Structure

### Decorator Types

| Type | Purpose | Properties |
|------|---------|------------|
| `border` | Colored border on item | `color`, `source` |
| `swatch` | Color swatch indicator | `color`, `source` |
| `badge` | Text badge | `text`, `variant`, `source` |

### `source` Field

<!--its better to source for debugging, but note that it does not have any meaning for client.-->
Every decorator includes `source` indicating which addon generated it:
- `"usage_history"` - From usage_history addon
- `"compatibility"` - From compatibility addon
- Future addons use their own identifier

**Client can:**
1. Render all decorators (default)
~~2. ~~Filter  by source (e.g., only show usage_history decorators)~~
~~3. Take first of each type (e.g., first border wins)~~
~~4. Prioritize by source (e.g., prefer usage_history border over compatibility border)~~

<!--options 2-4 are no go. client doesnt know about what source is and client cannot make any decision on source. taking first of each is just like randomly picking a value, and its only a fallback, not the primary option.

what i think the solution is to have "prority" field for addons in schema. for example,

```
      "addons": [
        {
          "addon_id": "addons.usage_history",
          "priority": 5, <-- new field
          "inputs": {
            "key_format": "{label}",
            "colors": [
              {
                "min": 14,
                "unit": "day",
                "color": "#7CFFB2"
              },
              ...
            ]
          }
        },
        {
          "addon_id": "addons.compatibility",
          "priority": 5, <-- new field
          "inputs": {
            "resolver_schema": {
              "type": "object",
              "properties": {
                "source": { "resolver": "server" }
              }
            },
            "source": "{{ state.tone_selection }}",
            "colors": [
              {
                "min": 95,
                "color": "#7CFFB2"
              },
              ...
            ]
          }
        }
      ],
```

the "priority field will be added to each decorator. where it allow client to pick highest priority valye from list. when priority is not provided, it will default to 0.
-->

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Each Addon Processes AND Generates Decorators               │
│     ┌──────────────────────────────────────┐                   │
│     │ usage_history.process()              │                   │
│     │ Returns:                             │                   │
│     │   data: {last_used, color}           │                   │
│     │   decorators: [                      │                   │
│     │     {type: "border", color, source}  │                   │
│     │     {type: "badge", text: "2d ago"}  │                   │
│     │   ]                                  │                   │
│     └──────────────────────────────────────┘                   │
│     ┌──────────────────────────────────────┐                   │
│     │ compatibility.process()              │                   │
│     │ Returns:                             │                   │
│     │   data: {score, color}               │                   │
│     │   decorators: [                      │                   │
│     │     {type: "badge", text: "85%"}     │                   │
│     │   ]                                  │                   │
│     └──────────────────────────────────────┘                   │
│                        │                                         │
│                        ▼                                         │
│  2. Server Collects (no transformation)                         │
 <!--are you sure this what does for addons? if you remember, we have preserve logic and structure for existing addons field.-->
│     item._metadata.addons.usage_history = addon.data            │
│     item._metadata.addons.compatibility = addon.data            │
│     item._metadata.decorators = [...all addon decorators]       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (WebUI)                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SchemaRenderer wraps ANY component with DecoratorWrapper       │
│  if data has _metadata.decorators                               │
│                                                                  │
│  DecoratorWrapper:                                              │
│  - Renders first border decorator                               │
│  - Renders first swatch decorator                               │
│  - Renders all badge decorators                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 1: Update Addon Base Class

**Goal:** Addons return both data and decorators

**Changes to `server/modules/addons/base.py`:**

```python
from dataclasses import dataclass
from typing import Dict, Any, List, Optional

@dataclass
class AddonResult:
    """Result from addon processing for a single item."""
    data: Dict[str, Any]          # Raw addon data (color, score, last_used, etc.)
    decorators: List[Dict[str, Any]]  # Decorators to render

class Addon(ABC):
    @abstractmethod
    def process(
        self,
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any
    ) -> Dict[int, AddonResult]:
        """
        Process items and return addon results.

        Returns:
            Dict mapping item index -> AddonResult with data and decorators.
        """
        pass
```

### Phase 2: Update usage_history Addon

**Changes to `server/modules/addons/usage_history.py`:**

```python
def process(self, items, inputs, context) -> Dict[int, AddonResult]:
    result = {}
    # ... existing logic to get usage_history ...

    for idx, item in enumerate(items):
        option_key = self._get_option_key(item, track_key_format)
        last_used = usage_history.get(option_key)

        decorators = []
        data = {}

        if last_used:
            hours_ago = self._get_hours_ago(last_used)
            color = self._get_color_for_hours(hours_ago, colors)
            time_ago_text = self._format_time_ago(last_used)

            data = {'last_used': last_used, 'color': color}
            decorators = [
                {'type': 'border', 'color': color, 'source': 'usage_history'},
                {'type': 'swatch', 'color': color, 'source': 'usage_history'},
                {'type': 'badge', 'text': time_ago_text, 'source': 'usage_history'}
            ]
        else:
            # Never used - still provide color if configured
            default_color = self._get_never_used_color(colors)
            if default_color:
                data = {'last_used': None, 'color': default_color}
                decorators = [
                    {'type': 'border', 'color': default_color, 'source': 'usage_history'},
                    {'type': 'swatch', 'color': default_color, 'source': 'usage_history'}
                ]

        result[idx] = AddonResult(data=data, decorators=decorators)

    return result

def _format_time_ago(self, timestamp_str: str) -> str:
    """Convert ISO timestamp to human-readable relative time."""
    # ... implementation ...
```

### Phase 3: Update compatibility Addon

**Changes to `server/modules/addons/compatibility.py`:**

```python
def process(self, items, inputs, context) -> Dict[int, AddonResult]:
    result = {}
    # ... existing logic ...

    for idx, item in enumerate(items):
        if not isinstance(item, dict) or 'tags' not in item:
            continue

        score = self._calculate_tag_compatibility(aggregated_tags, item['tags'])
        color = self.get_color_for_value(score, colors, 'min')

        data = {'score': round(score, 1), 'color': color}
        decorators = [
        <!--why are you skipping color data for this. feels like intentionally skiping them so that it we dont have to resolve conflicts.-->
            {'type': 'badge', 'text': f"{int(score)}% match", 'source': 'compatibility'}
        ]

        # Note: compatibility doesn't set border - that's usage_history's role
        # If we wanted compatibility to also show border, we'd add it here

        result[idx] = AddonResult(data=data, decorators=decorators)

    return result
```

### Phase 4: Update select.py to Collect Addon Results

**Changes to `server/modules/user/select.py`:**

```python
def _embed_addon_data(self, data, schema, inputs, context):
    item_refs = self._get_item_references(data, schema)

    for addon_config in self._addon_configs:
        addon_id = addon_config.get('addon_id')
        addon_inputs = addon_config.get('inputs', {})

        addon = AddonRegistry.create(addon_id)
        if not addon:
            continue

        resolved_inputs = self._resolve_addon_inputs(addon_inputs, inputs, context)

        try:
            results = addon.process(self._items_for_addons, resolved_inputs, context)
            <!--is this is how existing logic add addon data to objects? if so, feels like this is very prone adding inoccrect data to objects. -->
            if results:
                for idx, addon_result in results.items():
                    if idx < len(item_refs):
                        item = item_refs[idx]
                        if isinstance(item, dict):
                            if '_metadata' not in item:
                                item['_metadata'] = {'addons': {}, 'decorators': []}

                            # Store addon data
                            short_id = addon_id.replace('addons.', '')
                            item['_metadata']['addons'][short_id] = addon_result.data

                            # Collect decorators
                            item['_metadata']['decorators'].extend(addon_result.decorators)

        except Exception as e:
            if hasattr(context, 'logger'):
                context.logger.warning(f"Addon {addon_id} failed: {e}")
```

### Phase 5: TUI - Update Addon Path

**Changes to `tui/strategies/mixins.py`:**

```python
def _get_addon_display(self, item: dict) -> tuple:
    if not isinstance(item, dict):
        return "", ""

    # Read from _metadata.addons
    metadata = item.get('_metadata', {})
    addons = metadata.get('addons', {})

    usage = addons.get('usage_history', {})
    compat = addons.get('compatibility', {})

    # Fallback to old _addon structure
    if not usage and not compat:
        addon_data = item.get('_addon', {})
        usage = {'color': addon_data.get('color'), 'last_used': addon_data.get('last_used')}
        compat = {'score': addon_data.get('score')}

    color = ""
    suffix_parts = []

    if usage.get('color'):
        color = self._hex_to_ansi_fg(usage['color'])

    if compat.get('score') is not None:
        suffix_parts.append(f"[{int(compat['score'])}%]")

    if usage.get('last_used'):
        time_ago = self._format_time_ago(usage['last_used'])
        suffix_parts.append(f"(last: {time_ago})")

    suffix = " " + " ".join(suffix_parts) if suffix_parts else ""
    return color, suffix
```

### Phase 6: WebUI - DecoratorWrapper for Any Component

**Goal:** DecoratorWrapper wraps any component with `_metadata.decorators`, not just selectables

**New `DecoratorWrapper.tsx`:**

```typescript
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ColorSwatch } from "./renderers/nudges";
import type { Decorator, ItemMetadata } from "./types";

interface DecoratorWrapperProps {
  data: unknown;
  children: ReactNode;
  className?: string;
}

export function DecoratorWrapper({ data, children, className }: DecoratorWrapperProps) {
  const itemData = typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : null;
  const metadata = (itemData?._metadata || {}) as ItemMetadata;
  const decorators = metadata.decorators || [];

  if (decorators.length === 0) {
    return <>{children}</>;
  }

  // Take first of single-instance decorator types
  const borderDecorator = decorators.find(d => d.type === "border");
  const swatchDecorator = decorators.find(d => d.type === "swatch");
  // Render all badges
  const badges = decorators.filter(d => d.type === "badge");

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-2 px-3 py-2",
        borderDecorator?.color ? "" : "border-border",
        className
      )}
      style={borderDecorator?.color ? { borderColor: borderDecorator.color } : undefined}
    >
      {swatchDecorator?.color && (
        <ColorSwatch color={swatchDecorator.color} size="sm" className="flex-shrink-0 mt-0.5" />
      )}

      <div className="flex-1 min-w-0">
        {children}
      </div>

      {badges.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {badges.map((badge, idx) => (
            <Badge key={idx} variant="outline" className="text-xs whitespace-nowrap">
              {badge.text}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Phase 7: WebUI - SchemaRenderer Uses DecoratorWrapper

**Goal:** Any component rendered by SchemaRenderer can have decorators

**Update `SchemaRenderer.tsx`:**

The key insight: DecoratorWrapper should be applied at the **item level**, not just for selectables. Any data object with `_metadata.decorators` should be wrapped.

```typescript
// Helper to check if data has decorators
function hasDecorators(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const metadata = (data as Record<string, unknown>)._metadata as ItemMetadata | undefined;
  return Array.isArray(metadata?.decorators) && metadata.decorators.length > 0;
}

<!--
Why does this have whole bunch of decortator logic?? whats porpose of DecoratorProvider if its logic is all over the place?? shouldnt DecoratorProvider wrap childs around <></> when there are no decorators?? i am more confused that before with your logic, are you correctly undertanding what i'm trying to convey? this applies for all your examplesfo webui. what i am missing? what are you trying to convey?
-->

// In SchemaRenderer, wrap content when decorators exist
export function SchemaRenderer({ data, schema, path, className, strictMode }: SchemaRendererProps) {
  // ... existing logic ...

  // For selectable items
  if (schema.selectable === true) {
    const innerSchema = { ...schema, selectable: undefined };

    // SelectableItem handles selection UI
    // DecoratorWrapper handles decorator rendering
    // Both are independent concerns
    return (
      <SelectableItem path={path} data={data} schema={schema}>
        <MaybeDecoratorWrapper data={data}>
          <SchemaRenderer
            data={data}
            schema={innerSchema}
            path={path}
            strictMode={strictMode}
          />
        </MaybeDecoratorWrapper>
      </SelectableItem>
    );
  }

  // For non-selectable objects/arrays that might have decorators
  // (e.g., items in a review list)
  if (hasDecorators(data)) {
    return (
      <DecoratorWrapper data={data} className={className}>
        {/* render inner content without wrapper */}
        {renderContent()}
      </DecoratorWrapper>
    );
  }

  // ... rest of existing logic ...
}

// Helper component that only wraps if decorators exist
function MaybeDecoratorWrapper({ data, children }: { data: unknown; children: ReactNode }) {
  if (hasDecorators(data)) {
    return <DecoratorWrapper data={data}>{children}</DecoratorWrapper>;
  }
  return <>{children}</>;
}
```

**Update `SelectableItem.tsx`:**

Remove ALL decorator/addon logic - it only handles selection:

```typescript
export function SelectableItem({ path, data, schema, children }: SelectableItemProps) {
  const { isSelected, toggleSelection, canSelect, mode } = useSelection();
  const { mode: interactionMode } = useInteraction();

  const selected = isSelected(path);
  const disabled = interactionMode.type === "readonly" || (!canSelect(path) && !selected);

  const handleClick = () => {
    if (mode === "review" || disabled) return;
    toggleSelection(path, data);
  };

  return (
    <div
      className={cn(
        "relative cursor-pointer transition-all",
        selected && "ring-2 ring-primary",
        disabled && "opacity-50 cursor-not-allowed"
      )}
      onClick={handleClick}
    >
      {mode === "select" && <SelectionIndicator selected={selected} />}
      {children}
    </div>
  );
}
```

### Phase 8: Cleanup

1. Remove `getItemAddon()` from `schema-utils.ts`
2. Remove `AddonWrapper.tsx`
3. Update `!TECHNICAL_DEBT.md` item #5 as resolved

---

## Handling Decorator Conflicts

When multiple addons provide the same decorator type:

**Example:** Both addons want to set border color
```json
"decorators": [
  {"type": "border", "color": "#7CFFB2", "source": "usage_history"},
  {"type": "border", "color": "#00FF00", "source": "compatibility"}
]
```

**Default behavior:** First one wins (order is addon config order in step.json)

**Alternative:** Client can filter by source:
```typescript
// Only show usage_history decorators
const filtered = decorators.filter(d => d.source === "usage_history");
```

**Future enhancement:** Add `priority` field if needed

---

## Files Affected

### Server
- `server/modules/addons/base.py` - Add `AddonResult` dataclass
- `server/modules/addons/usage_history.py` - Return decorators
- `server/modules/addons/compatibility.py` - Return decorators
- `server/modules/user/select.py` - Collect addon results

### WebUI
- `webui/src/components/workflow/interactions/schema-interaction/types.ts` - Add types
- New: `DecoratorWrapper.tsx`
- `SchemaRenderer.tsx` - Use DecoratorWrapper for any decorated item
- `SelectableItem.tsx` - Remove addon/decorator logic
- Remove: `AddonWrapper.tsx`, `getItemAddon()`

### TUI
- `tui/strategies/mixins.py` - Read from `_metadata.addons`

---

## Success Criteria

1. Each addon generates its own decorators (no server transformation)
2. Decorators include `source` field for conflict resolution
3. DecoratorWrapper works for any component, not just selectables
4. WebUI renders decorators without addon-specific code
5. TUI continues to work with path changes
6. All existing workflows backward compatible
