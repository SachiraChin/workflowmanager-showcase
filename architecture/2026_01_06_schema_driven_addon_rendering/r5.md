# Schema-Driven Addon Rendering

**Date:** 2026-01-06
**Revision:** 5
**Status:** Proposal

---

## Overview

This document proposes migrating addon data rendering from hardcoded client-side knowledge to a decorator-based approach where each addon generates its own decorators with priority-based conflict resolution.

---

## Changes from Revision 4

1. **Priority field in addon config** - Each addon config has `priority` (default 0), passed to all its decorators
2. **All addons generate their decorators including border** - No skipping; both can provide border with their color
3. **Client picks highest priority** - For single-instance decorators (border, swatch), take highest priority
4. **`source` is for debugging only** - Client doesn't use it for decisions
5. **DecoratorWrapper encapsulates ALL logic** - Checks internally, returns `<>{children}</>` if no decorators
6. **SchemaRenderer wraps unconditionally** - No decorator logic outside DecoratorWrapper

---

## Priority-Based Conflict Resolution

### Addon Config with Priority

```json
{
  "addons": [
    {
      "addon_id": "addons.usage_history",
      "priority": 10,
      "inputs": {
        "key_format": "{label}",
        "colors": [...]
      }
    },
    {
      "addon_id": "addons.compatibility",
      "priority": 5,
      "inputs": {
        "source": "{{ state.tone_selection }}",
        "colors": [...]
      }
    }
  ]
}
```

### Priority Passed to Decorators

Each addon receives its `priority` from config and adds it to every decorator it generates:

```python
# usage_history addon (priority=10) returns:
{
    'data': {'last_used': '2025-01-05T10:30:00', 'color': '#7CFFB2'},
    'decorators': [
        {'type': 'border', 'color': '#7CFFB2', 'priority': 10, 'source': 'usage_history'},
        {'type': 'swatch', 'color': '#7CFFB2', 'priority': 10, 'source': 'usage_history'},
        {'type': 'badge', 'text': '2d ago', 'priority': 10, 'source': 'usage_history'}
    ]
}

# compatibility addon (priority=5) returns:
{
    'data': {'score': 85, 'color': '#00FF00'},
    'decorators': [
        {'type': 'border', 'color': '#00FF00', 'priority': 5, 'source': 'compatibility'},
        {'type': 'swatch', 'color': '#00FF00', 'priority': 5, 'source': 'compatibility'},
        {'type': 'badge', 'text': '85% match', 'priority': 5, 'source': 'compatibility'}
    ]
}
```

### Result in Item

```json
{
  "name": "Chord Progression A",
  "_metadata": {
    "addons": {
      "usage_history": {"last_used": "2025-01-05T10:30:00", "color": "#7CFFB2"},
      "compatibility": {"score": 85, "color": "#00FF00"}
    },
    "decorators": [
      {"type": "border", "color": "#7CFFB2", "priority": 10, "source": "usage_history"},
      {"type": "swatch", "color": "#7CFFB2", "priority": 10, "source": "usage_history"},
      {"type": "badge", "text": "2d ago", "priority": 10, "source": "usage_history"},
      {"type": "border", "color": "#00FF00", "priority": 5, "source": "compatibility"},
      {"type": "swatch", "color": "#00FF00", "priority": 5, "source": "compatibility"},
      {"type": "badge", "text": "85% match", "priority": 5, "source": "compatibility"}
    ]
  }
}
```

### Client Rendering Rules

| Decorator Type | Rule |
|---------------|------|
| `border` | Take highest priority (single instance) |
| `swatch` | Take highest priority (single instance) |
| `badge` | Render ALL badges (multiple instances) |

**`source` field**: For debugging only. Client does not use it for any logic.

---

## Data Structure

### Decorator Type

```typescript
interface Decorator {
  type: "border" | "swatch" | "badge";
  color?: string;      // For border, swatch
  text?: string;       // For badge
  variant?: string;    // For badge (default/outline)
  priority: number;    // From addon config, default 0
  source: string;      // For debugging only
}
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Each Addon Processes AND Generates Decorators               │
│     (Server passes priority from addon config to addon)         │
│                                                                  │
│     usage_history.process(items, inputs, priority=10)           │
│       → returns decorators with priority=10                     │
│                                                                  │
│     compatibility.process(items, inputs, priority=5)            │
│       → returns decorators with priority=5                      │
│                                                                  │
│  2. Server Collects All Results                                 │
│     item._metadata.addons.{addon_id} = addon.data               │
│     item._metadata.decorators.extend(addon.decorators)          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (WebUI)                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SchemaRenderer wraps ALL content with DecoratorWrapper         │
│  (unconditionally - no checks outside wrapper)                  │
│                                                                  │
│  DecoratorWrapper:                                              │
│  - Checks _metadata.decorators internally                       │
│  - If no decorators → returns <>{children}</>                   │
│  - If decorators:                                               │
│    - border: pick highest priority                              │
│    - swatch: pick highest priority                              │
│    - badges: render all                                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 1: Update Addon Base Class

**Changes to `server/modules/addons/base.py`:**

```python
from dataclasses import dataclass, field
from typing import Dict, Any, List

@dataclass
class AddonResult:
    """Result from addon processing for a single item."""
    data: Dict[str, Any]
    decorators: List[Dict[str, Any]] = field(default_factory=list)

class Addon(ABC):
    @abstractmethod
    def process(
        self,
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any,
        priority: int = 0  # NEW: priority from addon config
    ) -> Dict[int, AddonResult]:
        """
        Process items and return addon results.

        Args:
            items: List of items to process
            inputs: Addon inputs from config
            context: Execution context
            priority: Priority from addon config (default 0)

        Returns:
            Dict mapping item index -> AddonResult
        """
        pass
```

### Phase 2: Update usage_history Addon

**Changes to `server/modules/addons/usage_history.py`:**

```python
def process(self, items, inputs, context, priority: int = 0) -> Dict[int, AddonResult]:
    result = {}
    # ... existing logic to get usage_history ...

    for idx, item in enumerate(items):
        option_key = self._get_option_key(item, track_key_format)
        last_used = usage_history.get(option_key)

        if last_used:
            hours_ago = self._get_hours_ago(last_used)
            color = self._get_color_for_hours(hours_ago, colors)
            time_ago_text = self._format_time_ago(last_used)

            data = {'last_used': last_used, 'color': color}
            decorators = [
                {'type': 'border', 'color': color, 'priority': priority, 'source': 'usage_history'},
                {'type': 'swatch', 'color': color, 'priority': priority, 'source': 'usage_history'},
                {'type': 'badge', 'text': time_ago_text, 'priority': priority, 'source': 'usage_history'}
            ]
        else:
            default_color = self._get_never_used_color(colors)
            data = {'last_used': None, 'color': default_color}
            decorators = []
            if default_color:
                decorators = [
                    {'type': 'border', 'color': default_color, 'priority': priority, 'source': 'usage_history'},
                    {'type': 'swatch', 'color': default_color, 'priority': priority, 'source': 'usage_history'}
                ]

        result[idx] = AddonResult(data=data, decorators=decorators)

    return result
```

### Phase 3: Update compatibility Addon

**Changes to `server/modules/addons/compatibility.py`:**

```python
def process(self, items, inputs, context, priority: int = 0) -> Dict[int, AddonResult]:
    result = {}
    # ... existing logic ...

    for idx, item in enumerate(items):
        if not isinstance(item, dict) or 'tags' not in item:
            continue

        score = self._calculate_tag_compatibility(aggregated_tags, item['tags'])
        color = self.get_color_for_value(score, colors, 'min')

        data = {'score': round(score, 1), 'color': color}
        decorators = [
            {'type': 'border', 'color': color, 'priority': priority, 'source': 'compatibility'},
            {'type': 'swatch', 'color': color, 'priority': priority, 'source': 'compatibility'},
            {'type': 'badge', 'text': f"{int(score)}% match", 'priority': priority, 'source': 'compatibility'}
        ]

        result[idx] = AddonResult(data=data, decorators=decorators)

    return result
```

### Phase 4: Update select.py

**Changes to `server/modules/user/select.py`:**

```python
def _embed_addon_data(self, data, schema, inputs, context):
    item_refs = self._get_item_references(data, schema)

    for addon_config in self._addon_configs:
        addon_id = addon_config.get('addon_id')
        addon_inputs = addon_config.get('inputs', {})
        priority = addon_config.get('priority', 0)  # NEW: get priority from config

        addon = AddonRegistry.create(addon_id)
        if not addon:
            continue

        resolved_inputs = self._resolve_addon_inputs(addon_inputs, inputs, context)

        try:
            # Pass priority to addon
            results = addon.process(
                self._items_for_addons,
                resolved_inputs,
                context,
                priority=priority
            )

<!--is there better way to do this? as in, is there other places were we iterate objects? i really dont like this kind of nested iterations. i need full picture on this. also, it seems like addons are handled in select, which is not the case, they are universal for any type.-->
            if results:
                for idx, addon_result in results.items():
                    if idx < len(item_refs):
                        item = item_refs[idx]
                        if isinstance(item, dict):
                            if '_metadata' not in item:
                                item['_metadata'] = {'addons': {}, 'decorators': []}

                            # Store addon data under addon id
                            short_id = addon_id.replace('addons.', '')
                            item['_metadata']['addons'][short_id] = addon_result.data

                            # Collect all decorators
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

    # Fallback to old _addon structure for backward compatibility
    if not usage and not compat:
        addon_data = item.get('_addon', {})
        usage = {'color': addon_data.get('color'), 'last_used': addon_data.get('last_used')}
        compat = {'score': addon_data.get('score')}

    color = ""
    suffix_parts = []

    # Use usage_history color (TUI hardcoded preference)
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

### Phase 6: WebUI - DecoratorWrapper (Encapsulates ALL Logic)

**New `DecoratorWrapper.tsx`:**

```typescript
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ColorSwatch } from "./renderers/nudges";

interface Decorator {
  type: "border" | "swatch" | "badge";
  color?: string;
  text?: string;
  priority: number;
  source: string;
}

interface ItemMetadata {
  decorators?: Decorator[];
}

interface DecoratorWrapperProps {
  data: unknown;
  children: ReactNode;
  className?: string;
}

/**
 * DecoratorWrapper - Encapsulates ALL decorator logic.
 *
 * - Checks for _metadata.decorators internally
 * - If no decorators: returns children as-is (no wrapper)
 * - If decorators: renders border, swatch, badges based on priority
 */
export function DecoratorWrapper({ data, children, className }: DecoratorWrapperProps) {
  // Extract metadata internally
  const itemData = typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : null;
  const metadata = (itemData?._metadata || {}) as ItemMetadata;
  const decorators = metadata.decorators || [];

  // No decorators - return children as-is, no wrapper
  if (decorators.length === 0) {
    return <>{children}</>;
  }

  // Pick highest priority for single-instance types
  const borderDecorator = getHighestPriority(decorators, "border");
  const swatchDecorator = getHighestPriority(decorators, "swatch");

  // Get all badges (multiple instances allowed)
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

/**
 * Get decorator with highest priority for a given type.
 */
function getHighestPriority(decorators: Decorator[], type: string): Decorator | undefined {
  const filtered = decorators.filter(d => d.type === type);
  if (filtered.length === 0) return undefined;

  return filtered.reduce((highest, current) =>
    current.priority > highest.priority ? current : highest
  );
}
```

### Phase 7: WebUI - SchemaRenderer Uses DecoratorWrapper Unconditionally

**Update `SchemaRenderer.tsx`:**

SchemaRenderer wraps with DecoratorWrapper unconditionally. No decorator checks outside the wrapper.

```typescript
import { DecoratorWrapper } from "./DecoratorWrapper";

export function SchemaRenderer({ data, schema, path, className, strictMode }: SchemaRendererProps) {
  // ... existing checks (root level, selectable) ...

  // For selectable items
  if (schema.selectable === true) {
    const innerSchema = { ...schema, selectable: undefined };

    return (
      <SelectableItem path={path} data={data} schema={schema}>
        <DecoratorWrapper data={data}>
          <SchemaRenderer
            data={data}
            schema={innerSchema}
            path={path}
            strictMode={strictMode}
          />
        </DecoratorWrapper>
      </SelectableItem>
    );
  }

  // For object type - wrap each item with DecoratorWrapper
  if (schemaType === "object" && typeof data === "object" && data !== null) {
    // ... existing field collection logic ...

    return (
      <DecoratorWrapper data={data} className={className}>
        <ObjectContainer>
          {fieldsToRender.map(({ key, fieldSchema, isComputed }) => {
            // ... existing rendering logic ...
          })}
        </ObjectContainer>
      </DecoratorWrapper>
    );
  }

  // For array items - each item wrapped with DecoratorWrapper
  if (schemaType === "array" && Array.isArray(data)) {
    return (
      <ArrayContainer label={schema.display_label} className={className}>
        {data.map((item, idx) => (
          <DecoratorWrapper key={idx} data={item}>
            <SchemaRenderer
              data={item}
              schema={itemsSchema}
              path={[...path, String(idx)]}
              strictMode={strictMode}
            />
          </DecoratorWrapper>
        ))}
      </ArrayContainer>
    );
  }

  // Primitive - still wrap (DecoratorWrapper returns children if no decorators)
  return (
    <DecoratorWrapper data={data} className={className}>
      <TerminalRenderer ... />
    </DecoratorWrapper>
  );
}
```

**Key point:** DecoratorWrapper is used everywhere. It internally checks if decorators exist and either:
- Returns `<>{children}</>` if no decorators
- Returns wrapped content with border/swatch/badges if decorators exist

### Phase 8: SelectableItem - Only Selection Logic

**Update `SelectableItem.tsx`:**

SelectableItem ONLY handles selection. No decorator logic.

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

  // ONLY selection UI - no decorator logic
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

### Phase 9: Cleanup

1. Remove `getItemAddon()` from `schema-utils.ts`
2. Remove `AddonWrapper.tsx`
3. Update `!TECHNICAL_DEBT.md` item #5 as resolved

---

## Files Affected

### Server
- `server/modules/addons/base.py` - Add `AddonResult`, add `priority` param
- `server/modules/addons/usage_history.py` - Return decorators with priority
- `server/modules/addons/compatibility.py` - Return decorators with priority
- `server/modules/user/select.py` - Pass priority to addons, collect decorators

### WebUI
- `webui/src/components/workflow/interactions/schema-interaction/types.ts` - Add `Decorator` type
- New: `DecoratorWrapper.tsx` - Encapsulates all decorator logic
- `SchemaRenderer.tsx` - Wrap with DecoratorWrapper unconditionally
- `SelectableItem.tsx` - Remove all addon/decorator logic
- Remove: `AddonWrapper.tsx`, `getItemAddon()`

### TUI
- `tui/strategies/mixins.py` - Read from `_metadata.addons`

---

## Success Criteria

1. Priority field in addon config controls which decorator wins for single-instance types
2. Each addon generates all its decorators (including border) with priority
3. DecoratorWrapper encapsulates ALL decorator logic
4. SchemaRenderer wraps unconditionally - no decorator checks outside wrapper
5. Client picks highest priority for border/swatch, renders all badges
6. `source` field exists for debugging only
7. All existing workflows backward compatible
