# Schema-Driven Addon Rendering

**Date:** 2026-01-06
**Revision:** 6
**Status:** Proposal

---

## Overview

This document proposes migrating addon data rendering from hardcoded client-side knowledge to a decorator-based approach where each addon generates its own decorators with priority-based conflict resolution.

---

## Changes from Revision 5

1. **Centralized addon processing** - Move addon logic out of select.py into shared `AddonProcessor` class
2. **Any module can use addons** - Not tied to select module

---

## Current Addon Architecture (Problem)

Currently, addon processing is tightly coupled to `select.py`:

```
step.json
    │
    └── module.addons = [{addon_id, priority, inputs}, ...]
            │
            ▼
workflow_processor.py
    │
    └── if hasattr(module, 'set_addon_configs'):
            module.set_addon_configs(resolved_addon_configs)
            │
            ▼
select.py (ONLY module with addon support)
    │
    ├── set_addon_configs() - stores configs
    ├── _extract_items_for_addons() - gets items from data
    ├── _embed_addon_data() - iterates addons, embeds results
    └── _get_item_references() - gets item references
```

**Problems:**
1. All addon logic is in `select.py` - other modules can't use addons
2. Nested iteration pattern would be duplicated if another module wants addons
3. `_embed_addon_data()` knows about data structure traversal

---

## Proposed Architecture: Centralized AddonProcessor

Move addon processing to a shared class that any module can use:

```
step.json
    │
    └── module.addons = [{addon_id, priority, inputs}, ...]
            │
            ▼
workflow_processor.py
    │
    └── Creates AddonProcessor with addon_configs
        Passes to module via context or direct injection
            │
            ▼
AddonProcessor (NEW - shared class)
    │
    ├── process_items(items: List[Dict]) -> None
    │   Iterates all addon configs
    │   Calls each addon.process()
    │   Embeds _metadata.addons and _metadata.decorators into items
    │
    └── Called by ANY module that has list of items
            │
            ▼
Any Module (select, review, future modules)
    │
    └── Gets items from its inputs
        Calls addon_processor.process_items(items)
        Items now have _metadata embedded
```

---

## AddonProcessor Implementation

**New file: `server/modules/addons/processor.py`**

```python
from typing import Dict, Any, List
from .base import AddonRegistry, AddonResult

class AddonProcessor:
    """
    Centralized addon processing.

    Usage:
        processor = AddonProcessor(addon_configs, context)
        processor.process_items(items)
        # items now have _metadata.addons and _metadata.decorators
    """

    def __init__(self, addon_configs: List[Dict[str, Any]], context: Any):
        """
        Args:
            addon_configs: List of addon configs from step.json
                [{"addon_id": "addons.usage_history", "priority": 10, "inputs": {...}}, ...]
            context: Execution context (has db, workflow_template_name, step_id, etc.)
        """
        self.addon_configs = addon_configs or []
        self.context = context

    def process_items(self, items: List[Dict[str, Any]]) -> None:
        """
        Process all configured addons and embed results into items.

        Each item gets:
            item['_metadata'] = {
                'addons': {
                    'usage_history': {data from addon},
                    'compatibility': {data from addon}
                },
                'decorators': [
                    {type, color, priority, source},
                    ...
                ]
            }

        Args:
            items: List of item dicts. Modified in place.
        """
        if not self.addon_configs or not items:
            return

        for addon_config in self.addon_configs:
            addon_id = addon_config.get('addon_id')
            addon_inputs = addon_config.get('inputs', {})
            priority = addon_config.get('priority', 0)

            addon = AddonRegistry.create(addon_id)
            if not addon:
                continue

            try:
                results = addon.process(items, addon_inputs, self.context, priority=priority)

                if results:
                    for idx, addon_result in results.items():
                        if idx < len(items):
                            item = items[idx]
                            self._embed_result(item, addon_id, addon_result)

            except Exception as e:
                if hasattr(self.context, 'logger'):
                    self.context.logger.warning(f"Addon {addon_id} failed: {e}")

    def _embed_result(self, item: Dict, addon_id: str, addon_result: AddonResult) -> None:
        """Embed addon result into item's _metadata."""
        if '_metadata' not in item:
            item['_metadata'] = {'addons': {}, 'decorators': []}

        # Store addon data under short id (e.g., "usage_history" not "addons.usage_history")
        short_id = addon_id.replace('addons.', '')
        item['_metadata']['addons'][short_id] = addon_result.data

        # Collect decorators
        item['_metadata']['decorators'].extend(addon_result.decorators)
```

---

## Usage in Modules

### select.py (Simplified)

```python
class SelectModule(InteractiveModule):
    def __init__(self):
        super().__init__()
        self._addon_processor = None  # Set by workflow processor

    def set_addon_processor(self, processor: AddonProcessor) -> None:
        """Set addon processor. Called by workflow processor."""
        self._addon_processor = processor

    def get_interaction_request(self, inputs, context):
        data = inputs['data']
        schema = inputs['schema']

        # Extract items for addon processing
        items = self._extract_items_for_addons(data, schema)

        # Process addons (single call, all logic in AddonProcessor)
        if self._addon_processor and items:
            self._addon_processor.process_items(items)

        # ... rest of method unchanged ...
```

### workflow_processor.py (Updated)

```python
from modules.addons.processor import AddonProcessor

# In execute_step or similar:
addon_configs = module_config.get('addons', [])
if addon_configs:
    # Resolve addon inputs
    resolved_addon_configs = []
    for addon in addon_configs:
        resolved_addon = addon.copy()
        if 'inputs' in addon:
            resolved_addon['inputs'] = resolver.resolve_with_schema(addon['inputs'], module_outputs)
        resolved_addon_configs.append(resolved_addon)

    # Create processor and pass to module
    addon_processor = AddonProcessor(resolved_addon_configs, context)
    if hasattr(module, 'set_addon_processor'):
        module.set_addon_processor(addon_processor)
```

### Future Module Example

Any module can now use addons:

```python
class ReviewModule(InteractiveModule):
    def __init__(self):
        super().__init__()
        self._addon_processor = None

    def set_addon_processor(self, processor: AddonProcessor) -> None:
        self._addon_processor = processor

    def get_interaction_request(self, inputs, context):
        items = inputs['items']

        # Process addons - same single call
        if self._addon_processor and items:
            self._addon_processor.process_items(items)

        # ... rest of method ...
```

---

## Priority-Based Conflict Resolution

(Same as revision 5)

### Addon Config with Priority

```json
{
  "addons": [
    {
      "addon_id": "addons.usage_history",
      "priority": 10,
      "inputs": {...}
    },
    {
      "addon_id": "addons.compatibility",
      "priority": 5,
      "inputs": {...}
    }
  ]
}
```

### Client Rendering Rules

| Decorator Type | Rule |
|---------------|------|
| `border` | Take highest priority (single instance) |
| `swatch` | Take highest priority (single instance) |
| `badge` | Render ALL badges (multiple instances) |

---

## Migration Path

### Phase 1: Create AddonProcessor

**New file: `server/modules/addons/processor.py`**

- Move addon iteration logic from select.py
- Single `process_items()` method
- Handles all addon configs, embeds results

### Phase 2: Update Addon Base Class

**Changes to `server/modules/addons/base.py`:**

```python
@dataclass
class AddonResult:
    data: Dict[str, Any]
    decorators: List[Dict[str, Any]] = field(default_factory=list)

class Addon(ABC):
    @abstractmethod
    def process(
        self,
        items: List[Dict[str, Any]],
        inputs: Dict[str, Any],
        context: Any,
        priority: int = 0
    ) -> Dict[int, AddonResult]:
        pass
```

### Phase 3: Update Addons to Return Decorators

**usage_history.py and compatibility.py:**

Each addon returns `AddonResult` with both `data` and `decorators`.

### Phase 4: Update workflow_processor.py

- Create `AddonProcessor` with resolved configs
- Call `module.set_addon_processor(processor)` instead of `set_addon_configs()`

### Phase 5: Simplify select.py

- Remove `_embed_addon_data()` and nested iteration
- Keep only `_extract_items_for_addons()` (module-specific data traversal)
- Call `self._addon_processor.process_items(items)`

### Phase 6: TUI - Update Addon Path

(Same as revision 5)

### Phase 7: WebUI - DecoratorWrapper

(Same as revision 5)

---

## Data Structure

### Decorator Type

```typescript
interface Decorator {
  type: "border" | "swatch" | "badge";
  color?: string;
  text?: string;
  priority: number;
  source: string;  // For debugging only
}
```

### Item with Metadata

```json
{
  "name": "Chord Progression A",
  "_metadata": {
    "addons": {
      "last_used": "2025-01-05T10:30:00",
      "score": 85,
      "color": "#00FF00"
    },
    "decorators": [
      {"type": "border", "color": "#7CFFB2", "priority": 10, "source": "usage_history"},
      {"type": "border", "color": "#00FF00", "priority": 5, "source": "compatibility"},
      {"type": "badge", "text": "2d ago", "priority": 10, "source": "usage_history"},
      {"type": "badge", "text": "85% match", "priority": 5, "source": "compatibility"}
    ]
  }
}
```

Note: `_metadata.addons` is a flat merged dict (same structure as legacy `_addon`).
Later addons override earlier ones for conflicting keys (e.g., `color`).

---

## WebUI Implementation

(Same as revision 5)

### DecoratorWrapper

Encapsulates ALL decorator logic:
- Checks `_metadata.decorators` internally
- If no decorators → `return <>{children}</>`
- If decorators → picks highest priority for border/swatch, renders all badges

### SchemaRenderer

Wraps with DecoratorWrapper unconditionally. No decorator checks outside wrapper.

### SelectableItem

ONLY handles selection. No decorator logic.

---

## Files Affected

### Server
- **New:** `server/modules/addons/processor.py` - AddonProcessor class
- `server/modules/addons/base.py` - Add `AddonResult`, add `priority` param
- `server/modules/addons/usage_history.py` - Return decorators with priority
- `server/modules/addons/compatibility.py` - Return decorators with priority
- `server/modules/user/select.py` - Simplify, use AddonProcessor
- `server/api/workflow_processor.py` - Create and inject AddonProcessor

### WebUI
- `types.ts` - Add `Decorator` type
- **New:** `DecoratorWrapper.tsx` - Encapsulates all decorator logic
- `SchemaRenderer.tsx` - Wrap with DecoratorWrapper unconditionally
- `SelectableItem.tsx` - Remove all addon/decorator logic
- **Remove:** `AddonWrapper.tsx`, `getItemAddon()`

### TUI
- `tui/strategies/mixins.py` - Read from `_metadata.addons`

---

## Benefits of AddonProcessor

1. **Single responsibility** - AddonProcessor handles all addon iteration
2. **Reusable** - Any module can use addons with one method call
3. **No duplication** - Nested iteration logic in one place
4. **Testable** - AddonProcessor can be unit tested independently
5. **Clear interface** - `process_items(items)` is simple and obvious

---

## Success Criteria

1. AddonProcessor centralizes all addon iteration logic
2. Any module can use addons via `set_addon_processor()`
3. Priority field controls which decorator wins for single-instance types
4. Each addon generates all its decorators with priority
5. DecoratorWrapper encapsulates ALL client-side decorator logic
6. All existing workflows backward compatible

---

## Plan of Action (POA)

### Step 1: Server - AddonResult and Base Class
**Files:** `server/modules/addons/base.py`
- [ ] Add `AddonResult` dataclass with `data` and `decorators` fields
- [ ] Add `priority: int = 0` parameter to `Addon.process()` abstract method
- [ ] Update return type annotation to `Dict[int, AddonResult]`

### Step 2: Server - Update usage_history Addon
**Files:** `server/modules/addons/usage_history.py`
- [ ] Update `process()` to accept `priority` parameter
- [ ] Add `_format_time_ago()` method for relative time strings
- [ ] Return `AddonResult` with decorators: border, swatch, badge (time ago text)
- [ ] Include `priority` and `source` in each decorator

### Step 3: Server - Update compatibility Addon
**Files:** `server/modules/addons/compatibility.py`
- [ ] Update `process()` to accept `priority` parameter
- [ ] Return `AddonResult` with decorators: border, swatch, badge (score text)
- [ ] Include `priority` and `source` in each decorator

### Step 4: Server - Create AddonProcessor
**Files:** `server/modules/addons/processor.py` (NEW)
- [ ] Create `AddonProcessor` class
- [ ] Constructor takes `addon_configs` and `context`
- [ ] Implement `process_items(items)` method
- [ ] Implement `_embed_result()` helper to add `_metadata` to items

### Step 5: Server - Update workflow_processor.py
**Files:** `server/api/workflow_processor.py`
- [ ] Import `AddonProcessor`
- [ ] Create `AddonProcessor` instance with resolved addon configs
- [ ] Call `module.set_addon_processor(processor)` instead of `set_addon_configs()`

### Step 6: Server - Simplify select.py
**Files:** `server/modules/user/select.py`
- [ ] Replace `set_addon_configs()` with `set_addon_processor()`
- [ ] Remove `_embed_addon_data()` method
- [ ] Remove `_get_item_references()` method (moved to processor)
- [ ] Update `get_interaction_request()` to call `self._addon_processor.process_items(items)`

### Step 7: TUI - Update Addon Path
**Files:** `tui/strategies/mixins.py`
- [ ] Update `_get_addon_display()` to read from `_metadata.addons`
- [ ] Add fallback to old `_addon` structure for backward compatibility

### Step 8: WebUI - Add Types
**Files:** `webui/src/components/workflow/interactions/schema-interaction/types.ts`
- [ ] Add `Decorator` interface with type, color, text, priority, source
- [ ] Add `ItemMetadata` interface with addons and decorators

### Step 9: WebUI - Create DecoratorWrapper
**Files:** `webui/src/components/workflow/interactions/schema-interaction/DecoratorWrapper.tsx` (NEW)
- [ ] Create component that checks `_metadata.decorators` internally
- [ ] Return `<>{children}</>` if no decorators
- [ ] Implement `getHighestPriority()` helper for single-instance types
- [ ] Render border (highest priority), swatch (highest priority), all badges

### Step 10: WebUI - Update SchemaRenderer
**Files:** `webui/src/components/workflow/interactions/schema-interaction/SchemaRenderer.tsx`
- [ ] Import `DecoratorWrapper`
- [ ] Wrap selectable items with `DecoratorWrapper`
- [ ] Wrap array items with `DecoratorWrapper`
- [ ] Wrap object containers with `DecoratorWrapper`

### Step 11: WebUI - Clean Up SelectableItem
**Files:** `webui/src/components/workflow/interactions/schema-interaction/SelectableItem.tsx`
- [ ] Remove all addon/decorator rendering logic
- [ ] Remove `getItemAddon()` import
- [ ] Keep only selection UI (ring, click handler)

### Step 12: WebUI - Remove Deprecated Code
**Files:** Various
- [ ] Remove `getItemAddon()` from `schema-utils.ts`
- [ ] Delete `AddonWrapper.tsx` if it exists

### Step 13: Testing
- [ ] Test with workflow that uses both addons (usage_history + compatibility)
- [ ] Verify priority controls which border/swatch is shown
- [ ] Verify all badges are rendered
- [ ] Verify TUI still works with new `_metadata.addons` path
- [ ] Verify backward compatibility with old `_addon` structure

### Step 14: Documentation
- [ ] Update `!TECHNICAL_DEBT.md` item #5 as resolved
- [ ] Add tech debt item for decorator positioning (future)
