# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 3
**Status:** Draft - Awaiting Feedback

---

## Revision 3 Changes

Based on operator feedback on R2:
- Added alternatives for context structure with pros/cons analysis
- Explained how multi-select highlighting works with response data
- Virtualization controls available but disabled by default for testing
- Branch handling deferred to future work

---

## 1-3. [Same as R2 - Problem Statement, Requirements, Current Architecture]

*(See revision 2 for these sections)*

---

## 4. Proposed Architecture

### 4.1 Data Model

*(Same as R2)*

### 4.2 Server API Changes

*(Same as R2)*

### 4.3 Context Structure Alternatives Analysis

**Question:** How to structure the readonly state in context?

#### Option A: Separate `mode` + `response` fields (Original)

```typescript
interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  mode: 'active' | 'readonly';
  response?: InteractionResponseData;
}
```

**Pros:**
- Clear separation of concerns
- `mode` explicitly states intent
- `response` is optional, only present when needed
- Easy to extend `mode` in future (e.g., 'preview', 'editing')

**Cons:**
- Two fields to check in components
- Possible invalid state: `mode === 'readonly'` but `response === undefined`
- Slightly more verbose component logic

---

#### Option B: Single `completedResponse` field (Alternative 1)

```typescript
interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  completedResponse?: InteractionResponseData;  // If present, readonly mode
}
```

Components derive mode: `const isReadonly = !!completedResponse;`

**Pros:**
- Single field handles both mode and data
- Impossible to have readonly without response (no invalid state)
- Less context fields to manage
- Natural: "if there's a completed response, show it read-only"

**Cons:**
- Mode is implicit, not explicit
- Harder to extend for other modes (preview, etc.)
- Naming could be confusing (`completedResponse` vs just `response`)

---

#### Option C: Wrapper type with discriminated union (Alternative 2)

```typescript
type InteractionMode =
  | { type: 'active' }
  | { type: 'readonly'; response: InteractionResponseData };

interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  mode: InteractionMode;
}
```

Components use:
```typescript
if (mode.type === 'readonly') {
  const { response } = mode;  // TypeScript knows response exists
}
```

**Pros:**
- Type-safe: impossible to have readonly without response
- Self-documenting discriminated union
- Easy to extend with new modes
- TypeScript narrowing works automatically

**Cons:**
- More complex type definition
- Slightly more verbose access pattern
- Overkill if we only ever have two modes

---

#### Option D: Extend existing `disabled` concept (Alternative 3)

```typescript
interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  initialValue?: InteractionResponseData;  // Pre-populate with this
}
```

For readonly: `disabled={true} initialValue={response}`

**Pros:**
- Minimal changes to existing context
- Reuses existing `disabled` concept
- `initialValue` is intuitive

**Cons:**
- `disabled` doesn't fully capture "readonly with visible response"
- Semantically different: disabled means "can't edit", not "showing past result"
- Styling for disabled vs readonly might differ

---

### Recommendation

**Option B (Single `completedResponse` field)** is recommended for simplicity:

```typescript
interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  completedResponse?: InteractionResponseData;
}

// Usage in components:
const { request, completedResponse } = useInteraction();
const isReadonly = !!completedResponse;
```

**Rationale:**
- Simplest mental model
- No invalid states possible
- We only need two modes for this feature
- If we need more modes later, we can refactor to Option C

<!--I think we should go for C from get go, its very clean, explicit and ensures availablity of values (if not data, fail, nothing to assume.)-->

---

### 4.4 Multi-Select Highlighting: How It Works

**Question:** How does StructuredSelect know which items were selected in readonly mode?

The `response.selected_options` contains the full data of selected items, including their IDs. Here's how the component uses this:

**Data flow:**
```
InteractionRequest (from server)
├── display_data.data: [{id: "opt1", ...}, {id: "opt2", ...}, {id: "opt3", ...}]
└── display_data.schema: {items: {selectable: true, ...}}

CompletedResponse (user's selection)
├── selected_indices: [0, 2]           // Indices of selected items
└── selected_options: [                 // Full data of selected items
      {id: "opt1", label: "First"},
      {id: "opt3", label: "Third"}
    ]
```

**Component logic:**
```typescript
function StructuredSelect() {
  const { request, completedResponse } = useInteraction();
  const isReadonly = !!completedResponse;

  // Build set of selected IDs for fast lookup
  <!--isnt this simply assuming the structure of the response though? also, we have to make sure we only render data from original request, workflow can updated any point of time, and when we show history, we must only show data at that point from time, hopefully i same its stored in interaction_requested node. i just want to emphasize that we have recursive ux generation, and there can be situations where user can select multiple values from differnt levels of hierachy. I am not sure following capture that. understand how InteractionHost and how children are generated recursively and confirm following plan works for those situations. -->
  const selectedIds = useMemo(() => {
    if (!completedResponse?.selected_options) return new Set<string>();
    return new Set(
      completedResponse.selected_options.map(opt => opt.id)
    );
  }, [completedResponse]);

  // In render, for each item:
  return (
    <div>
      {items.map((item, index) => {
        const isSelected = selectedIds.has(item.id);

        return (
          <SelectableItem
            key={item.id}
            item={item}
            isSelected={isSelected}
            disabled={isReadonly}  // Can't toggle in readonly
            className={cn(
              isReadonly && isSelected && "bg-primary/10 border-primary",
              isReadonly && !isSelected && "opacity-50"
            )}
          />
        );
      })}
    </div>
  );
}
```

**Visual result in readonly mode:**
```
┌─────────────────────────────────────┐
│ ☑ Option 1 - First choice           │  ← Selected: highlighted
├─────────────────────────────────────┤
│ ☐ Option 2 - Second choice          │  ← Not selected: dimmed
├─────────────────────────────────────┤
│ ☑ Option 3 - Third choice           │  ← Selected: highlighted
└─────────────────────────────────────┘
```

**Key points:**
1. `selected_options` contains full item data with IDs
2. Build a `Set<string>` of selected IDs for O(1) lookup
3. Each item checks if its ID is in the selected set
4. Apply different styles: selected items highlighted, others dimmed
5. All items are disabled (can't toggle) in readonly mode

This same pattern works for all selectable components - they just need to check if the item's ID exists in the response's selected set.

---

### 4.5 WebUI Component Architecture

**Updated InteractionHost with Readonly Mode:**

```typescript
interface InteractionHostProps {
  request: InteractionRequest;
  onSubmit: (response: InteractionResponseData) => void;
  onCancel?: () => void;
  disabled?: boolean;
  // Readonly mode: if provided, shows completed interaction
  completedResponse?: InteractionResponseData;
}
```

**InteractionProvider context:**
```typescript
interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  completedResponse?: InteractionResponseData;  // If present = readonly mode
  // ... existing methods (only available in active mode)
  updateProvider: (config: ProviderConfig) => void;
  openFeedbackPopup: (groupId: string, groupLabel: string) => void;
  getFeedback: (groupId: string) => string | undefined;
}
```

**Changes to InteractionHost:**
1. Accept `completedResponse` prop
2. Pass through context
3. Hide footer when `completedResponse` is present
4. Add readonly visual styling

**Changes to Child Components:**

Each child component:
```typescript
const { request, completedResponse } = useInteraction();
const isReadonly = !!completedResponse;

// Use completedResponse data if readonly, otherwise use local state
```

---

### 4.6 Page Layout

*(Same as R2)*

---

### 4.7 New Components

*(Same as R2)*

---

### 4.8 Data Flow

*(Same as R2)*

---

## 5. Performance Analysis

### Virtualization Controls

**Approach:** Implement controls but keep disabled by default for testing.

```typescript
// In a config or environment variable
const PERFORMANCE_CONFIG = {
  enableVirtualization: false,          // Toggle on when needed
  virtualizationThreshold: 50,          // Enable at this interaction count
  autoCollapseThreshold: 30,            // Collapse items in step at this count
  enableAutoCollapse: false,            // Toggle on when needed
};
```

**Usage in component:**
```typescript
function InteractionHistory({ interactions }) {
  const shouldVirtualize =
    PERFORMANCE_CONFIG.enableVirtualization &&
    interactions.length > PERFORMANCE_CONFIG.virtualizationThreshold;

  if (shouldVirtualize) {
    return <VirtualizedList interactions={interactions} />;
  }

  return <SimpleList interactions={interactions} />;
}
```

**For testing:**
- Start with both flags `false`
- Test with various workflow sizes
- Enable as needed based on observed performance

---

## 6. Branch Handling

**Decision:** Deferred to future work.

For V1, show linear history using current branch lineage. The server's `get_lineage_events()` already returns correct events for current branch.

Branch comparison and version history will be addressed in a separate feature.

---

## 7. Implementation Plan

### Phase 1: Server API
1. Add `get_interaction_history()` method to `database_provider.py`
2. Add `/workflow/{id}/interaction-history` endpoint to `workflow_api.py`
3. Add response model to `models.py`
4. Test endpoint with existing workflows

### Phase 2: WebUI Store & API
1. Add `CompletedInteraction` type to `types.ts`
2. Add `getInteractionHistory()` to `api.ts`
3. Update `workflow-store.ts`:
   - Add `completedInteractions: CompletedInteraction[]`
   - Add `setCompletedInteractions`, `addCompletedInteraction` actions
4. Update `useWorkflowExecution.ts` to fetch history on mount

### Phase 3: InteractionHost Readonly Mode
1. Add `completedResponse` prop to `InteractionHost`
2. Update `InteractionProvider` context with `completedResponse`
3. Hide footer when `completedResponse` is present
4. Add readonly styling

### Phase 4: Child Component Updates
1. Update `TextInputEnhanced` for readonly
2. Update `StructuredSelect` for readonly (highlight selected items)
3. Update `ReviewGrouped` for readonly
4. Update `FileInputDropzone` for readonly
5. Update `FileDownload` for readonly

### Phase 5: Page Layout & New Components
1. Create `CompletedInteractionCard` component
2. Create `StepGroup` component
3. Update `WorkflowRunnerPage` layout
4. Implement auto-scroll to current interaction
5. Add performance config (disabled by default)

### Phase 6: Polish
1. Loading states during history fetch
2. Error handling
3. Smooth scroll animations
4. Testing with various workflow sizes

---

## 8. Affected Files

### Server
- `server/api/database_provider.py` - Add `get_interaction_history()`
- `server/api/workflow_api.py` - Add endpoint
- `server/api/models.py` - Add response model

### WebUI
- `webui/src/lib/types.ts` - Add `CompletedInteraction`
- `webui/src/lib/api.ts` - Add `getInteractionHistory()`
- `webui/src/lib/workflow-store.ts` - Update state
- `webui/src/lib/interaction-context.tsx` - Add `completedResponse` to context
- `webui/src/hooks/useWorkflowExecution.ts` - Fetch history on mount
- `webui/src/pages/WorkflowRunnerPage.tsx` - New layout
- `webui/src/components/workflow/interactions/InteractionHost.tsx` - Add readonly mode
- `webui/src/components/workflow/interactions/text-input.tsx` - Handle readonly
- `webui/src/components/workflow/interactions/structured-select.tsx` - Handle readonly
- `webui/src/components/workflow/interactions/review-grouped.tsx` - Handle readonly
- `webui/src/components/workflow/interactions/file-input.tsx` - Handle readonly
- `webui/src/components/workflow/interactions/file-download.tsx` - Handle readonly
- `webui/src/components/workflow/history/CompletedInteractionCard.tsx` - New
- `webui/src/components/workflow/history/StepGroup.tsx` - New
- `webui/src/lib/performance-config.ts` - New (optional, for virtualization controls)

---

## 9. Success Criteria

1. ✅ User can scroll up and see all previous interactions in the session
2. ✅ Previous interactions show the user's selections/inputs in read-only mode
3. ✅ Selected items in multi-select are highlighted, others dimmed
4. ✅ History persists after page reload
5. ✅ Current interaction is clearly visible and actionable
6. ✅ Page auto-scrolls to new interactions
7. ✅ Interactions are grouped by step with headers
8. ✅ Individual interactions can be collapsed
9. ✅ Performance controls available but disabled for testing
