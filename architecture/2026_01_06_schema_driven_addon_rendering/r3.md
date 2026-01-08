# Schema-Driven Addon Rendering

**Date:** 2026-01-06
**Revision:** 3
**Status:** Proposal

---

## Overview

This document proposes migrating addon data rendering from hardcoded client-side knowledge to a decorator-based approach. Currently, both WebUI and TUI have hardcoded logic that specifically handles `_addon.color`, `_addon.score`, and `_addon.last_used` fields. The goal is to make clients render addon data using item-level decorators without addon-specific knowledge.

---

## Changes from Revision 2

1. **Removed `timestamp` decorator type** - Server computes relative time string ("2d ago") and sends as `badge` decorator
2. **Removed explicit positioning** - Added as tech debt; start with fixed layout areas
3. **No server-side consolidation** - Each addon's data stored separately under `_metadata.addons.{addon_id}`
4. **DecoratorWrapper** - Wrapper component that handles all decorator rendering (borders, badges) for any entity
5. **Not limited to selectables** - Any entity with `_metadata.decorators` can use the decorator system

---

## Data Structure

### No Consolidation - Preserve Per-Addon Data

Instead of merging addon results (where later addons override earlier), each addon's data is stored separately:

```json
{
  "name": "Chord Progression A",
  "primary_color": "#FF5500",
  "_metadata": {
    "addons": {
      "usage_history": {
        "last_used": "2025-01-05T10:30:00",
        "color": "#7CFFB2"
      },
      "compatibility": {
        "score": 85,
        "color": "#00FF00"
      }
    },
    "decorators": [
    <!--the color here's the the problem. for some modules, both addons provide colors. how can we include both, but provide client mechanism to pick what?-->
      {"type": "border", "color": "#7CFFB2"},
      {"type": "swatch", "color": "#7CFFB2"},
      {"type": "badge", "text": "85% match"},
      {"type": "badge", "text": "2d ago"}
    ]
  }
}
```

**Benefits:**
- Client can access any addon's data if needed
- No data loss from merging
- Decorator generation can choose which addon's color to use (e.g., usage_history for border)
- Debugging: can see what each addon provided

### Decorator Types (Simplified)

| Type | Purpose | Properties |
|------|---------|------------|
| `border` | Colored left border on item | `color` |
| `swatch` | Color swatch indicator | `color` |
| `badge` | Text badge (scores, timestamps, etc.) | `text`, `variant` (default/outline) |

**No `timestamp` type** - Server computes human-readable string (e.g., "2d ago") and sends as `badge`.

### No Explicit Positioning (Tech Debt)

Positioning is deferred to tech debt. Initial implementation uses fixed layout:
- **Border**: Always left side
- **Swatch**: Always in header area, before content
- **Badges**: Always in header area, after content (right-aligned)

The `DecoratorWrapper` component will define these fixed positions. Explicit positioning support can be added later.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Addons Process Items (unchanged)                            │
│     ┌──────────────────┐    ┌──────────────────┐               │
│     │ usage_history    │    │ compatibility    │               │
│     │ {last_used, color}│    │ {score, color}   │               │
│     └────────┬─────────┘    └────────┬─────────┘               │
│              │                       │                          │
│              ▼                       ▼                          │
│  2. Store Per-Addon (NO consolidation)                          │
│     item._metadata.addons.usage_history = {last_used, color}    │
│     item._metadata.addons.compatibility = {score, color}        │
│                        │                                         │
│                        ▼                                         │
│  3. Generate Decorators (server decides priority)               │
│     - border: use usage_history.color (recency indicator)       │
│     - swatch: use usage_history.color                           │
│     - badge: format score as "85% match"                        │
│     - badge: format last_used as "2d ago"                       │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (WebUI)                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  DecoratorWrapper reads _metadata.decorators                    │
│  Renders border, swatch, badges in fixed positions              │
│  Wraps any content (not just selectables)                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT (TUI) - Minimal Changes                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Update _get_addon_display to read from:                        │
│  item._metadata.addons.usage_history                            │
│  item._metadata.addons.compatibility                            │
│                                                                  │
│  Existing hardcoded logic continues to work                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Path

### Phase 1: Server - Restructure Addon Storage

**Goal:** Store addon data per-addon instead of consolidated

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
            result = addon.process(self._items_for_addons, resolved_inputs, context)
            if result:
                for idx, addon_result in result.items():
                    if idx < len(item_refs):
                        item = item_refs[idx]
                        if isinstance(item, dict):
                            # NEW: Store per-addon, no consolidation
                            if '_metadata' not in item:
                                item['_metadata'] = {}
                            if 'addons' not in item['_metadata']:
                                item['_metadata']['addons'] = {}
                            # Store under addon_id (e.g., "usage_history", "compatibility")
                            short_id = addon_id.replace('addons.', '')
                            item['_metadata']['addons'][short_id] = addon_result
        except Exception as e:
            if hasattr(context, 'logger'):
                context.logger.warning(f"Addon {addon_id} failed: {e}")

    # After all addons processed, generate decorators
    self._generate_decorators(item_refs)
```

### Phase 2: Server - Generate Decorators

**Goal:** Generate decorator list from per-addon data

<!-- I dont think this is the correct way to do this. these decorators must be provided by addons themselves, server just get decorators from addons and add it to decorators. To top level entity to know that time has to be formatted is simply no go. individual addon know how its decorators should be added. This where i mentioned that 2 addons can provide color data, how can client pick one fron list?-->

```python
def _generate_decorators(self, item_refs: list) -> None:
    """Generate decorators from per-addon data."""
    for item in item_refs:
        if not isinstance(item, dict) or '_metadata' not in item:
            continue

        addons = item['_metadata'].get('addons', {})
        decorators = []

        # Usage history addon -> border, swatch, time badge
        usage = addons.get('usage_history', {})
        if usage.get('color'):
            decorators.append({'type': 'border', 'color': usage['color']})
            decorators.append({'type': 'swatch', 'color': usage['color']})
        if usage.get('last_used'):
            time_ago = self._format_time_ago(usage['last_used'])
            decorators.append({'type': 'badge', 'text': time_ago})

        # Compatibility addon -> score badge
        compat = addons.get('compatibility', {})
        if compat.get('score') is not None:
            decorators.append({
                'type': 'badge',
                'text': f"{int(compat['score'])}% match"
            })

        item['_metadata']['decorators'] = decorators

def _format_time_ago(self, timestamp_str: str) -> str:
    """Convert ISO timestamp to human-readable relative time."""
    from datetime import datetime
    try:
        timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        now = datetime.now(timestamp.tzinfo) if timestamp.tzinfo else datetime.now()
        delta = now - timestamp

        if delta.days > 30:
            months = delta.days // 30
            return f"{months}mo ago"
        elif delta.days > 0:
            return f"{delta.days}d ago"
        elif delta.seconds > 3600:
            hours = delta.seconds // 3600
            return f"{hours}h ago"
        elif delta.seconds > 60:
            minutes = delta.seconds // 60
            return f"{minutes}m ago"
        else:
            return "just now"
    except:
        return ""
```

### Phase 3: TUI - Update Addon Path

**Goal:** TUI reads from new structure with backward compatibility

**Changes to `tui/strategies/mixins.py`:**

```python
def _get_addon_display(self, item: dict) -> tuple:
    if not isinstance(item, dict):
        return "", ""

    # NEW: Read from _metadata.addons, fallback to _addon
    metadata = item.get('_metadata', {})
    addons = metadata.get('addons', {})

    # Combine addon data for display (TUI still uses hardcoded logic)
    usage = addons.get('usage_history', {})
    compat = addons.get('compatibility', {})

    # Fallback to old _addon structure
    if not usage and not compat:
        addon_data = item.get('_addon', {})
        usage = {'color': addon_data.get('color'), 'last_used': addon_data.get('last_used')}
        compat = {'score': addon_data.get('score')}

    color = ""
    suffix_parts = []

    # Use usage_history color for display
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

### Phase 4: WebUI - DecoratorWrapper Component

**Goal:** Create wrapper component that renders decorators for any entity

**New types in `types.ts`:**

```typescript
export interface PerAddonData {
  usage_history?: {
    color?: string;
    last_used?: string;
  };
  compatibility?: {
    score?: number;
    color?: string;
  };
}

export interface ItemMetadata {
  addons?: PerAddonData;
  decorators?: Decorator[];
}

export interface Decorator {
  type: "border" | "badge" | "swatch";
  color?: string;
  text?: string;
  variant?: "default" | "outline";
}
```

**New `DecoratorWrapper.tsx`:**

```typescript
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ColorSwatch } from "./renderers/nudges";

interface DecoratorWrapperProps {
  /** Item data - checks for _metadata.decorators */
  data: unknown;
  /** Content to render inside */
  children: ReactNode;
  /** Additional className */
  className?: string;
}

export function DecoratorWrapper({ data, children, className }: DecoratorWrapperProps) {
  // Extract metadata
  const itemData = typeof data === "object" && data !== null
    ? data as Record<string, unknown>
    : null;
  const metadata = (itemData?._metadata || {}) as ItemMetadata;
  const decorators = metadata.decorators || [];

  // No decorators - render children as-is
  if (decorators.length === 0) {
    return <>{children}</>;
  }

  // Extract decorator types
  const borderDecorator = decorators.find(d => d.type === "border");
  const swatchDecorator = decorators.find(d => d.type === "swatch");
  const badges = decorators.filter(d => d.type === "badge");

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border-2 px-3 py-2 transition-all",
        borderDecorator?.color ? "" : "border-border",
        className
      )}
      style={borderDecorator?.color ? { borderColor: borderDecorator.color } : undefined}
    >
      {/* Swatch in header area */}
      {swatchDecorator?.color && (
        <ColorSwatch color={swatchDecorator.color} size="sm" className="flex-shrink-0 mt-0.5" />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {children}
      </div>

      {/* Badges in header area, right-aligned */}
      {badges.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {badges.map((badge, idx) => (
            <Badge
              key={idx}
              variant={badge.variant || "outline"}
              className="text-xs whitespace-nowrap"
            >
              {badge.text}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Phase 5: WebUI - Use in SchemaRenderer

**Goal:** Apply DecoratorWrapper in SchemaRenderer for any item with decorators

**Update `SchemaRenderer.tsx`:**

<!--again, i dont understand, exaplain me why you are adding decorator only for selectables? whats your logic? why its better from what i suggested? why cant normal components cannot have decorators? explain-->

```typescript
// In the selectable section, wrap with DecoratorWrapper
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

// For non-selectable items that have decorators, wrap them too
// (This can be added where appropriate in the rendering flow)
```

**Update `SelectableItem.tsx`:**

Remove all hardcoded addon rendering - decorators are handled by DecoratorWrapper:

```typescript
export function SelectableItem({ path, data, schema, children }: SelectableItemProps) {
  const { variant, isSelected, toggleSelection, canSelect, mode } = useSelection();
  const { mode: interactionMode } = useInteraction();

  const selected = isSelected(path);
  const canSelectThis = canSelect(path);
  const isReadonly = interactionMode.type === "readonly";
  const disabled = isReadonly || (!canSelectThis && !selected);

  const handleClick = () => {
    if (mode === "review" || isReadonly || disabled) return;
    toggleSelection(path, data);
  };

  // NO addon/decorator logic here - handled by DecoratorWrapper

  return (
    <div
      className={cn(
        "relative flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all",
        selected ? "ring-2 ring-primary bg-primary/5" : "hover:bg-muted/30",
        disabled && !isReadonly && "opacity-50 cursor-not-allowed",
        (mode === "review" || isReadonly) && "cursor-default"
      )}
      onClick={handleClick}
    >
      {/* Selection indicator */}
      {mode === "select" && (
        <SelectionIndicator selected={selected} />
      )}

      {/* Content (includes DecoratorWrapper from parent) */}
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}
```

### Phase 6: Cleanup

1. Remove `getItemAddon()` from `schema-utils.ts`
2. Remove `AddonWrapper.tsx` (replaced by `DecoratorWrapper`)
3. Update tech debt item #5 as resolved
4. Add new tech debt item for decorator positioning

---

## Tech Debt: Decorator Positioning

**To be added to `!TECHNICAL_DEBT.md`:**

```markdown
## 6. Decorator Positioning System

**Date Identified:** 2026-01-06
**Severity:** Low
**Status:** Open

### Problem

Current decorator system uses fixed positions:
- Border: always left
- Swatch: always header-left
- Badges: always header-right

This may not be flexible enough for all use cases (e.g., footer timestamps, variable card layouts).

### Suggested Fix

Add optional `position` property to decorators:
- `header-left`, `header-right`, `footer`, `border-left`, `border-all`

DecoratorWrapper would render decorators in their specified positions, with defaults for backward compatibility.
```

---

## Files Affected

### Server
- `server/modules/user/select.py`
  - `_embed_addon_data()` - Store per-addon, no consolidation
  - New `_generate_decorators()` method
  - New `_format_time_ago()` method

### WebUI
- `webui/src/components/workflow/interactions/schema-interaction/types.ts`
  - Add `PerAddonData`, `ItemMetadata`, `Decorator` types
- New: `webui/src/components/workflow/interactions/schema-interaction/DecoratorWrapper.tsx`
- `webui/src/components/workflow/interactions/schema-interaction/SelectableItem.tsx`
  - Remove hardcoded addon rendering
- `webui/src/components/workflow/interactions/schema-interaction/SchemaRenderer.tsx`
  - Wrap selectable items with DecoratorWrapper
- Remove: `webui/src/components/workflow/interactions/schema-interaction/AddonWrapper.tsx`
- `webui/src/components/workflow/interactions/schema-interaction/schema-utils.ts`
  - Remove `getItemAddon()`

### TUI
- `tui/strategies/mixins.py`
  - Update `_get_addon_display()` to read from `_metadata.addons`
  - Fallback to `_addon` for backward compatibility

### Documentation
- `!TECHNICAL_DEBT.md` - Add item #6 for decorator positioning

---

## Success Criteria

1. Server stores addon data per-addon without consolidation
2. Server generates decorator list from addon data
3. WebUI renders decorators via DecoratorWrapper without addon-specific code
4. TUI continues to work with minimal path changes
5. Any entity with `_metadata.decorators` can be decorated (not just selectables)
6. All existing workflows continue to work (backward compatible)
