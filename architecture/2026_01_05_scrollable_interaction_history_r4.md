# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 4
**Status:** Draft - Awaiting Feedback

---

## Revision 4 Changes

Based on operator feedback on R3:
- Changed to Option C (discriminated union) for context structure
- Detailed how path-based selection works for hierarchical/recursive UIs
- Clarified that data comes from INTERACTION_REQUESTED event (point-in-time snapshot)
- Virtualization controls available but disabled by default

---

## 1-3. [Same as previous revisions]

*(See revision 2 for Problem Statement, Requirements, Current Architecture)*

---

## 4. Proposed Architecture

### 4.1 Data Model

**New Type: `CompletedInteraction`**
```typescript
interface CompletedInteraction {
  interactionId: string;
  request: InteractionRequest;
  response: InteractionResponseData;
  timestamp: string;
  stepId: string;
  moduleName: string;
}
```

### 4.2 Server API Changes

*(Same as R2 - endpoint returns paired request/response from events)*

---

### 4.3 Context Structure: Discriminated Union (Option C)

Based on operator feedback, we'll use Option C - a discriminated union that ensures type safety and prevents invalid states.

**InteractionProvider context:**
```typescript
/**
 * Discriminated union for interaction mode.
 * - 'active': User is making selections/input
 * - 'readonly': Showing completed interaction with response data
 */
type InteractionMode =
  | { type: 'active' }
  | { type: 'readonly'; response: InteractionResponseData };

interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  mode: InteractionMode;
  // ... existing methods (only functional in active mode)
  updateProvider: (config: ProviderConfig) => void;
  openFeedbackPopup: (groupId: string, groupLabel: string) => void;
  getFeedback: (groupId: string) => string | undefined;
}
```

**Usage in components:**
```typescript
function SomeInteractionComponent() {
  const { request, mode } = useInteraction();

  if (mode.type === 'readonly') {
    // TypeScript knows mode.response exists here
    const { response } = mode;
    // Render with response data
  } else {
    // Active mode - normal interactive behavior
  }
}
```

**Pros of this approach:**
- **Type-safe:** Impossible to access `response` in active mode (TypeScript error)
- **Explicit:** Code clearly shows intent with `mode.type` check
- **No invalid states:** Can't have readonly without response
- **Extensible:** Easy to add new modes like `{ type: 'preview', ... }`

**InteractionHost props:**
```typescript
interface InteractionHostProps {
  request: InteractionRequest;
  onSubmit: (response: InteractionResponseData) => void;
  onCancel?: () => void;
  disabled?: boolean;
  // NEW: Readonly mode
  mode?: InteractionMode;  // Defaults to { type: 'active' }
}
```

---

### 4.4 Path-Based Selection for Hierarchical UIs

**Understanding the current architecture:**

The schema-driven interaction system uses **path-based selection** to handle hierarchical/nested data. This is critical for readonly mode.

**How it works:**

1. **Data + Schema from server:**
```typescript
// INTERACTION_REQUESTED event contains:
request.display_data = {
  data: {
    categories: [
      {
        name: "Category A",
        items: [
          { id: "item1", label: "First" },
          { id: "item2", label: "Second" }
        ]
      },
      {
        name: "Category B",
        items: [
          { id: "item3", label: "Third" }
        ]
      }
    ]
  },
  schema: {
    type: "object",
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            items: {
              type: "array",
              items: {
                selectable: true,  // ← Items at this level are selectable
                type: "object",
                properties: { ... }
              }
            }
          }
        }
      }
    }
  }
}
```

2. **Selection tracked by path:**
```typescript
// SelectionContext manages:
selectedPaths: string[][] = [
  ["categories", "0", "items", "0"],  // First item in Category A
  ["categories", "1", "items", "0"],  // First item in Category B
];
selectedData: unknown[] = [
  { id: "item1", label: "First" },
  { id: "item3", label: "Third" }
];
```

3. **SelectableItem checks path:**
```typescript
// Each selectable item receives its path and calls:
const selected = isSelected(["categories", "0", "items", "0"]);
// Returns true if this path is in selectedPaths
```

4. **Response stores paths:**
```typescript
// When user submits, response contains:
response.selected_indices = [
  ["categories", 0, "items", 0],
  ["categories", 1, "items", 0]
];
response.selected_options = [
  { data: { id: "item1", ... }, index: ["categories", "0", "items", "0"] },
  { data: { id: "item3", ... }, index: ["categories", "1", "items", "0"] }
];
```

**For readonly mode:**

1. Extract paths from response:
```typescript
const initialSelectedPaths = response.selected_options.map(opt =>
  opt.index.map(String)  // Ensure all path segments are strings
);
const initialSelectedData = response.selected_options.map(opt => opt.data);
```

2. Pass to SelectionProvider:
```typescript
<SelectionProvider
  mode="review"  // or a new "readonly" mode
  initialSelectedPaths={initialSelectedPaths}
  initialSelectedData={initialSelectedData}
>
```

3. SelectableItem automatically shows correct state:
- Items whose path is in `initialSelectedPaths` are highlighted
- Items whose path is NOT in `initialSelectedPaths` are dimmed
- All items are disabled (clicks do nothing)

**Visual result:**
```
┌─────────────────────────────────────────┐
│ Category A                              │
│ ├─ ☑ First (item1)         ← Selected  │
│ └─ ☐ Second (item2)        ← Dimmed    │
│                                         │
│ Category B                              │
│ └─ ☑ Third (item3)         ← Selected  │
└─────────────────────────────────────────┘
```

---

### 4.5 Data Source: Point-in-Time from Events

**Critical point:** The data shown in readonly mode comes from the `INTERACTION_REQUESTED` event stored in the database, NOT from the current workflow state.

**Why this matters:**
- Workflow definition can change between runs
- Options available at the time of selection may differ from current options
- User's selection must be shown in context of what they actually saw

**Event storage guarantees:**
```javascript
// INTERACTION_REQUESTED event stores full request data:
{
  "event_type": "interaction_requested",
  "data": {
    "interaction_id": "int_001",
    "interaction_type": "select_from_structured",
    "display_data": {
      "data": { /* snapshot of data at that moment */ },
      "schema": { /* schema at that moment */ }
    },
    "_resolved_inputs": { ... }
  }
}
```

**Implementation ensures consistency:**
1. Server endpoint returns `request` from INTERACTION_REQUESTED event
2. Server endpoint returns `response` from INTERACTION_RESPONSE event
3. WebUI renders using the stored `request.display_data` (not current state)
4. This guarantees user sees exactly what they saw when making the selection

---

### 4.6 Component Changes for Readonly Mode

**SchemaInteractionHost changes:**
```typescript
interface SchemaInteractionHostProps {
  request: { ... };
  mode: InteractionMode;  // "select" | "review"
  variant: VariantStyle;
  disabled?: boolean;
  onStateChange?: (state: SchemaInteractionState) => void;
  // NEW: For readonly, pre-populate selection
  initialSelection?: {
    paths: string[][];
    data: unknown[];
  };
}
```

When `initialSelection` is provided:
```typescript
<SelectionProvider
  mode={mode}
  variant={variant}
  multiSelect={multiSelect}
  minSelections={minSelections}
  maxSelections={maxSelections}
  initialSelectedPaths={initialSelection?.paths ?? []}
  initialSelectedData={initialSelection?.data ?? []}
>
```

<!--looking at following examples, it seems like we are using 2 different data structures to figure out selected data. is that correct? if so, why is it like that. that doesnt sit well with me. tell me why you came up with this structure logically, and alternatives to it. -->
**StructuredSelect changes for readonly:**
```typescript
function StructuredSelect() {
  const { request, mode } = useInteraction();

  // Extract initial selection from readonly response
  const initialSelection = useMemo(() => {
    if (mode.type !== 'readonly') return undefined;

    const { response } = mode;
    if (!response.selected_options?.length) return undefined;

    return {
      paths: response.selected_options.map(opt =>
        Array.isArray(opt.index) ? opt.index.map(String) : []
      ),
      data: response.selected_options.map(opt => opt.data)
    };
  }, [mode]);

  return (
    <SchemaInteractionHost
      request={request}
      mode={mode.type === 'readonly' ? 'review' : 'select'}
      variant="cards"
      disabled={mode.type === 'readonly'}
      initialSelection={initialSelection}
    />
  );
}
```

**TextInputEnhanced changes for readonly:**
```typescript
function TextInputEnhanced() {
  const { request, mode } = useInteraction();

  const displayValue = mode.type === 'readonly'
    ? String(mode.response.value ?? '')
    : '';

  const [value, setValue] = useState(
    displayValue || request.default_value || ''
  );

  return (
    <Textarea
      value={mode.type === 'readonly' ? displayValue : value}
      onChange={(e) => mode.type !== 'readonly' && setValue(e.target.value)}
      disabled={mode.type === 'readonly'}
      className={cn(
        mode.type === 'readonly' && 'bg-muted/50 cursor-default'
      )}
      placeholder={mode.type === 'readonly' ? undefined : request.placeholder}
    />
  );
}
```

---

### 4.7 Page Layout

```
WorkflowRunnerPage
├── ScrollableContainer (flex-1, overflow-y-auto)
│   │
│   ├── StepGroup (step: "User Input")
│   │   ├── StepHeader ("Step 1: User Input")
│   │   ├── CompletedInteractionCard
│   │   │   └── InteractionHost (mode: {type:'readonly', response:{...}})
│   │   │       └── StructuredSelect → SchemaInteractionHost
│   │   │           └── SelectionProvider (initialSelectedPaths from response)
│   │   │               └── SchemaRenderer → SelectableItem (highlights by path)
│   │   └── ...more cards
│   │
│   └── CurrentInteractionCard (highlighted)
│       └── InteractionHost (mode: {type:'active'})
│
└── WorkflowSidebar
```

---

### 4.8 Data Flow

**On Page Load / Reconnect:**
```
1. GET /workflow/{id}/interaction-history
2. Response contains:
   - interactions[]: Each has request (from INTERACTION_REQUESTED) + response
   - pending_interaction: Current if awaiting input
3. For each completed interaction:
   - request.display_data.data = snapshot of data at that time
   - response.selected_options = user's selection with paths
4. Render InteractionHost with mode: {type:'readonly', response}
5. Child components extract paths from response, show correct selections
```

---

## 5. Performance Analysis

### Virtualization Controls (Disabled by Default)

```typescript
// webui/src/lib/performance-config.ts
export const PERFORMANCE_CONFIG = {
  // Toggle on to enable virtualization
  enableVirtualization: false,
  virtualizationThreshold: 50,

  // Toggle on to auto-collapse long step groups
  enableAutoCollapse: false,
  autoCollapseThreshold: 30,
};
```

For initial testing, both flags are `false`. Enable based on observed performance.

---

## 6. Branch Handling

Deferred to future work. V1 shows linear history from current branch lineage.

---

## 7. Implementation Plan

### Phase 1: Server API
1. Add `get_interaction_history()` method to `database_provider.py`
2. Add `/workflow/{id}/interaction-history` endpoint
3. Ensure response includes full `request` data from events

### Phase 2: WebUI Types & API
1. Add discriminated union `InteractionMode` type
2. Add `CompletedInteraction` type
3. Add `getInteractionHistory()` API function
4. Update store with `completedInteractions`

### Phase 3: InteractionHost Readonly Mode
1. Add `mode?: InteractionMode` prop
2. Update `InteractionProvider` context
3. Hide footer in readonly mode
4. Add readonly visual styling

### Phase 4: Child Components
1. **StructuredSelect:** Extract paths from response, pass to SchemaInteractionHost
2. **SchemaInteractionHost:** Accept `initialSelection` prop
3. **SelectionProvider:** Use `initialSelectedPaths/Data` when provided
4. **TextInputEnhanced:** Show response.value in readonly
5. **ReviewGrouped:** Show data without retry options
6. **FileInputDropzone:** Show uploaded filename
7. **FileDownload:** Show downloaded filename

### Phase 5: Page Layout
1. Create `CompletedInteractionCard`
2. Create `StepGroup` with headers
3. Update `WorkflowRunnerPage` layout
4. Auto-scroll to current interaction

### Phase 6: Polish
1. Loading states
2. Error handling
3. Testing with hierarchical selections

---

## 8. Affected Files

### Server
- `server/api/database_provider.py` - Add `get_interaction_history()`
- `server/api/workflow_api.py` - Add endpoint
- `server/api/models.py` - Add response model

### WebUI
- `webui/src/lib/types.ts` - Add `InteractionMode`, `CompletedInteraction`
- `webui/src/lib/api.ts` - Add `getInteractionHistory()`
- `webui/src/lib/workflow-store.ts` - Update state
- `webui/src/lib/interaction-context.tsx` - Add `mode: InteractionMode`
- `webui/src/hooks/useWorkflowExecution.ts` - Fetch history
- `webui/src/pages/WorkflowRunnerPage.tsx` - New layout
- `webui/src/components/workflow/interactions/InteractionHost.tsx`
- `webui/src/components/workflow/interactions/structured-select/StructuredSelect.tsx`
- `webui/src/components/workflow/interactions/schema-interaction/SchemaInteractionHost.tsx`
- `webui/src/components/workflow/interactions/schema-interaction/SelectionContext.tsx`
- `webui/src/components/workflow/interactions/text-input/TextInputEnhanced.tsx`
- `webui/src/components/workflow/interactions/review-grouped/ReviewGrouped.tsx`
- `webui/src/components/workflow/interactions/file-input/FileInputDropzone.tsx`
- `webui/src/components/workflow/interactions/file-download/FileDownload.tsx`
- `webui/src/components/workflow/history/CompletedInteractionCard.tsx` - New
- `webui/src/components/workflow/history/StepGroup.tsx` - New
- `webui/src/lib/performance-config.ts` - New

---

## 9. Success Criteria

1. ✅ User can scroll up and see all previous interactions
2. ✅ Previous interactions show user's selections/inputs in read-only mode
3. ✅ Hierarchical selections display correctly (selected items highlighted at all levels)
4. ✅ Data shown is from point-in-time (INTERACTION_REQUESTED event), not current workflow
5. ✅ History persists after page reload
6. ✅ Current interaction is clearly visible and actionable
7. ✅ Interactions grouped by step with headers
8. ✅ Performance controls available but disabled for testing
