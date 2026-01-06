# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 7
**Status:** Complete

---

## Implementation Progress

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Server API | ✅ Complete |
| 2 | WebUI Types & API | ✅ Complete |
| 3 | InteractionHost Readonly Mode | ✅ Complete |
| 4 | Selection Components | ✅ Complete |
| 5 | Other Interaction Components | ✅ Complete |
| 6 | Page Layout | ✅ Complete |
| 7 | Polish | ✅ Complete |

### Phase 1 Tasks
- [x] Add `get_interaction_history()` to `database_provider.py`
- [x] Add `CompletedInteraction`, `InteractionHistoryResponse` models to `models.py`
- [x] Add `/workflow/{id}/interaction-history` endpoint to `workflow_api.py`
- [x] Verified imports and method existence

### Phase 2 Tasks
- [x] Add `SelectionItem`, `InteractionMode`, `CompletedInteraction` types
- [x] Add `getInteractionHistory()` API function
- [x] Add `completedInteractions` to workflow store

### Phase 3 Tasks
- [x] Add `mode: InteractionMode` to context
- [x] Add `mode` prop to InteractionHost
- [x] Hide footer in readonly mode
- [x] Add readonly styling

### Phase 4 Tasks
- [x] Update SelectionContext props to `initialSelectedItems`
- [x] Update SchemaInteractionHost to pass through
- [x] Update StructuredSelect to extract from response
- [x] Update SelectableItem to respect readonly mode from InteractionContext

### Phase 5 Tasks
- [x] Update TextInputEnhanced for readonly
- [x] Update ReviewGrouped for readonly
- [x] Update FileInputDropzone for readonly
- [x] Update FileDownload for readonly

### Phase 6 Tasks
- [x] Create CompletedInteractionCard component
- [x] Create StepGroup component
- [x] Update WorkflowRunnerPage layout
- [x] Update useWorkflowExecution hook

### Phase 7 Tasks
- [x] Loading states (history loads in background, processing indicator shown)
- [x] Error handling (silent fail for history fetch with console.debug)
- [x] Scroll animations (scroll-smooth on container, smooth scrollIntoView)

---

## Revision 7 Changes

Based on operator feedback on R6:
- Changed from two separate props (`initialSelectedPaths`, `initialSelectedData`) to single combined prop (`initialSelectedItems`)
- Finalized implementation plan with this cleaner API
- Document ready for implementation

---

## Sections Unchanged from Previous Revisions

| Section | Source Revision | Status |
|---------|-----------------|--------|
| 1. Problem Statement | R2 | ✅ Ready |
| 2. Requirements | R2 | ✅ Ready |
| 3. Current Architecture Analysis | R2 | ✅ Ready |
| 4.1 Data Model (CompletedInteraction) | R2 | ✅ Ready |
| 4.2 Server API Changes | R2 | ✅ Ready |
| 4.3 Context Structure (Discriminated Union) | R4 | ✅ Ready |
| 4.5 Data Source: Point-in-Time | R4 | ✅ Ready |
| 5. Performance Analysis | R3 | ✅ Ready |
| 6. Branch Handling | R3 | ✅ Ready |

---

## 4.4 Selection State: Single Combined Prop

### The Design

Use a single combined type for selection items throughout the prop chain:

```typescript
// New shared type
interface SelectionItem {
  path: string[];
  data: unknown;
}
```

### Props Flow

```
response.selected_options          →  SelectionItem[]  →  SelectionProvider internal state
[{ data, index }]                     [{ path, data }]     selectedPaths[], selectedData[]
```

**At each level:**

```typescript
// SchemaInteractionHost props
interface SchemaInteractionHostProps {
  request: { ... };
  mode: InteractionMode;
  variant: VariantStyle;
  disabled?: boolean;
  onStateChange?: (state: SchemaInteractionState) => void;
  initialSelectedItems?: SelectionItem[];  // Single combined prop
}

// SelectionProvider props
interface SelectionProviderProps {
  mode: InteractionMode;
  variant: VariantStyle;
  multiSelect: boolean;
  minSelections: number;
  maxSelections: number;
  initialSelectedItems?: SelectionItem[];  // Single combined prop
  children: React.ReactNode;
}
```

### SelectionProvider Internal Handling

```typescript
// Inside SelectionProvider - split combined items into internal parallel arrays
export function SelectionProvider({
  initialSelectedItems,
  // ...other props
}: SelectionProviderProps) {
  // Internal state remains as parallel arrays (no refactor needed)
  const [selectedPaths, setSelectedPaths] = useState<string[][]>(
    initialSelectedItems?.map(item => item.path) ?? []
  );
  const [selectedData, setSelectedData] = useState<unknown[]>(
    initialSelectedItems?.map(item => item.data) ?? []
  );

  // Rest of implementation unchanged...
}
```

### StructuredSelect Usage

```typescript
function StructuredSelect() {
  const { request, mode } = useInteraction();

  // Extract selection items from readonly response
  const initialSelectedItems = useMemo(() => {
    if (mode.type !== 'readonly') return undefined;
    if (!mode.response.selected_options?.length) return undefined;

    // Direct mapping - response format matches SelectionItem structure
    return mode.response.selected_options.map(opt => ({
      path: Array.isArray(opt.index) ? opt.index.map(String) : [],
      data: opt.data
    }));
  }, [mode]);

  return (
    <SchemaInteractionHost
      request={request}
      mode={mode.type === 'readonly' ? 'review' : 'select'}
      variant="cards"
      disabled={mode.type === 'readonly'}
      initialSelectedItems={initialSelectedItems}
    />
  );
}
```

### Benefits

1. **Single source of truth**: Path and data always travel together
2. **Clean API**: One prop instead of two that must stay in sync
3. **Direct mapping**: `response.selected_options` maps naturally to `SelectionItem[]`
4. **Minimal internal change**: SelectionProvider splits on initialization, internal logic unchanged
5. **Type-safe**: Can't accidentally mismatch paths and data

---

## Complete Data Flow (Updated)

### Readonly Mode Flow

```
Page loads, fetches /interaction-history
         │
         ▼
Server returns: { request: {...}, response: {...} }
  └── response.selected_options: [{ data: {...}, index: ["items","0"] }]
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ CompletedInteractionCard                                     │
│   <InteractionHost                                           │
│     request={interaction.request}                            │
│     mode={{ type: 'readonly', response: interaction.response }}
│   >                                                          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ StructuredSelect                                             │
│   const { request, mode } = useInteraction();               │
│                                                              │
│   // Direct mapping to SelectionItem[]                       │
│   const initialSelectedItems = mode.response.selected_options│
│     .map(opt => ({ path: opt.index.map(String), data: opt.data }));
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SchemaInteractionHost                                        │
│   <SelectionProvider                                         │
│     initialSelectedItems={[{ path: ["items","0"], data: {...} }]}
│   >                                                          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SelectionProvider                                            │
│   // Splits combined items into internal parallel arrays:    │
│   selectedPaths: [["items", "0"]]                           │
│   selectedData: [{...}]                                      │
│                                                              │
│   isSelected(["items", "0"]) → true                         │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
SelectableItem renders with selected=true, shows highlight
```

---

## Summary: What Changes Where

| File | Change | Why |
|------|--------|-----|
| `webui/src/lib/types.ts` | Add `SelectionItem`, `CompletedInteraction`, `InteractionMode` types | Shared type definitions |
| `webui/src/lib/interaction-context.tsx` | Add `mode: InteractionMode` to context | Components know if readonly |
| `webui/src/components/workflow/interactions/InteractionHost.tsx` | Accept `mode` prop, pass to provider | Entry point for readonly mode |
| `webui/src/components/workflow/interactions/structured-select/StructuredSelect.tsx` | Extract `initialSelectedItems` from `mode.response` | Convert response to SelectionItem[] |
| `webui/src/components/workflow/interactions/schema-interaction/SchemaInteractionHost.tsx` | Accept `initialSelectedItems` prop, pass to SelectionProvider | Pipe data through |
| `webui/src/components/workflow/interactions/schema-interaction/SelectionContext.tsx` | Change props from two fields to `initialSelectedItems`, split internally | Cleaner API |
| `webui/src/components/workflow/interactions/schema-interaction/SelectableItem.tsx` | **No changes** | Already uses `isSelected(path)` |

---

## 7. Final Implementation Plan

### Phase 1: Server API

**Files:**
- `server/api/database_provider.py`
- `server/api/workflow_api.py`
- `server/api/models.py`

**Tasks:**
1. Add `get_interaction_history(workflow_id)` method to `DatabaseProvider`
   - Query INTERACTION_REQUESTED and INTERACTION_RESPONSE events
   - Pair by `interaction_id`
   - Return list of `{ request, response, timestamp, step_id, module_name }`
2. Add `GET /workflow/{workflow_id}/interaction-history` endpoint
3. Add `CompletedInteractionResponse` Pydantic model

**Verification:**
- Test endpoint with existing workflow that has completed interactions
- Verify response includes full `display_data` from INTERACTION_REQUESTED events

### Phase 2: WebUI Types & API

**Files:**
- `webui/src/lib/types.ts`
- `webui/src/lib/api.ts`
- `webui/src/lib/workflow-store.ts`

**Tasks:**
1. Add types to `types.ts`:
   ```typescript
   interface SelectionItem {
     path: string[];
     data: unknown;
   }

   type InteractionMode =
     | { type: 'active' }
     | { type: 'readonly'; response: InteractionResponseData };

   interface CompletedInteraction {
     interactionId: string;
     request: InteractionRequest;
     response: InteractionResponseData;
     timestamp: string;
     stepId: string;
     moduleName: string;
   }
   ```
2. Add `getInteractionHistory(workflowId)` to `api.ts`
3. Add `completedInteractions: CompletedInteraction[]` to workflow store
4. Add `setCompletedInteractions`, `addCompletedInteraction` actions

**Verification:**
- Call API function, verify types match server response

### Phase 3: InteractionHost Readonly Mode

**Files:**
- `webui/src/lib/interaction-context.tsx`
- `webui/src/components/workflow/interactions/InteractionHost.tsx`

**Tasks:**
1. Update `InteractionContextValue` interface:
   ```typescript
   interface InteractionContextValue {
     request: InteractionRequest;
     disabled: boolean;
     mode: InteractionMode;  // NEW
     // ...existing methods
   }
   ```
2. Add `mode?: InteractionMode` prop to `InteractionHost`
3. Default `mode` to `{ type: 'active' }` when not provided
4. Pass `mode` through `InteractionProvider`
5. Hide footer (Continue/Cancel buttons) when `mode.type === 'readonly'`
6. Add readonly visual styling (subtle background, no hover effects)

**Verification:**
- Render InteractionHost with `mode={{ type: 'readonly', response: testResponse }}`
- Verify footer hidden, styling applied

### Phase 4: Selection Components

**Files:**
- `webui/src/components/workflow/interactions/schema-interaction/SelectionContext.tsx`
- `webui/src/components/workflow/interactions/schema-interaction/SchemaInteractionHost.tsx`
- `webui/src/components/workflow/interactions/structured-select/StructuredSelect.tsx`

**Tasks:**
1. **SelectionContext.tsx:**
   - Change props from `initialSelectedPaths` + `initialSelectedData` to `initialSelectedItems?: SelectionItem[]`
   - Split into internal parallel arrays on initialization:
     ```typescript
     const [selectedPaths, setSelectedPaths] = useState<string[][]>(
       initialSelectedItems?.map(item => item.path) ?? []
     );
     const [selectedData, setSelectedData] = useState<unknown[]>(
       initialSelectedItems?.map(item => item.data) ?? []
     );
     ```

2. **SchemaInteractionHost.tsx:**
   - Add `initialSelectedItems?: SelectionItem[]` prop
   - Pass through to SelectionProvider

3. **StructuredSelect.tsx:**
   - Get `mode` from `useInteraction()`
   - Extract `initialSelectedItems` from `mode.response.selected_options` when readonly
   - Pass to SchemaInteractionHost

**Verification:**
- Render StructuredSelect in readonly mode with mock response
- Verify correct items highlighted, others dimmed
- Verify clicks disabled

### Phase 5: Other Interaction Components

**Files:**
- `webui/src/components/workflow/interactions/text-input/TextInputEnhanced.tsx`
- `webui/src/components/workflow/interactions/review-grouped/ReviewGrouped.tsx`
- `webui/src/components/workflow/interactions/file-input/FileInputDropzone.tsx`
- `webui/src/components/workflow/interactions/file-download/FileDownload.tsx`

**Tasks:**
1. **TextInputEnhanced:** Show `mode.response.value` when readonly, disable input
2. **ReviewGrouped:** Show data without retry options when readonly
3. **FileInputDropzone:** Show uploaded filename when readonly
4. **FileDownload:** Show downloaded filename when readonly

**Verification:**
- Render each component in readonly mode
- Verify correct values displayed, inputs disabled

### Phase 6: Page Layout

**Files:**
- `webui/src/components/workflow/history/CompletedInteractionCard.tsx` (NEW)
- `webui/src/components/workflow/history/StepGroup.tsx` (NEW)
- `webui/src/pages/WorkflowRunnerPage.tsx`
- `webui/src/hooks/useWorkflowExecution.ts`

**Tasks:**
1. Create `CompletedInteractionCard` component:
   - Wraps InteractionHost with `mode={{ type: 'readonly', response }}`
   - Collapsible with expand/collapse toggle
   - Shows timestamp, step name

2. Create `StepGroup` component:
   - Groups interactions by step
   - Shows step header with name
   - Contains list of CompletedInteractionCards

3. Update `WorkflowRunnerPage`:
   - Scrollable container for history
   - Render StepGroups for completed interactions
   - Render current interaction at bottom (highlighted)
   - Auto-scroll to current interaction on new interaction

4. Update `useWorkflowExecution`:
   - Fetch interaction history on mount
   - Add completed interaction to store when INTERACTION_RESPONSE received

**Verification:**
- Load page with workflow that has history
- Verify history renders above current interaction
- Verify scrolling works
- Verify auto-scroll to new interactions

### Phase 7: Polish

**Tasks:**
1. Loading state while fetching history
2. Error handling for failed history fetch
3. Empty state when no history
4. Smooth scroll animations
5. Test with various workflow sizes
6. Test with hierarchical/nested selections

---

## 8. Affected Files Summary

### Server (3 files)
- `server/api/database_provider.py` - Add `get_interaction_history()`
- `server/api/workflow_api.py` - Add endpoint
- `server/api/models.py` - Add response model

### WebUI (14 files)
- `webui/src/lib/types.ts` - Add types
- `webui/src/lib/api.ts` - Add API function
- `webui/src/lib/workflow-store.ts` - Add state
- `webui/src/lib/interaction-context.tsx` - Add mode to context
- `webui/src/hooks/useWorkflowExecution.ts` - Fetch history
- `webui/src/pages/WorkflowRunnerPage.tsx` - New layout
- `webui/src/components/workflow/interactions/InteractionHost.tsx` - Add mode prop
- `webui/src/components/workflow/interactions/structured-select/StructuredSelect.tsx` - Extract selection
- `webui/src/components/workflow/interactions/schema-interaction/SchemaInteractionHost.tsx` - Pass through
- `webui/src/components/workflow/interactions/schema-interaction/SelectionContext.tsx` - Change props
- `webui/src/components/workflow/interactions/text-input/TextInputEnhanced.tsx` - Readonly mode
- `webui/src/components/workflow/interactions/review-grouped/ReviewGrouped.tsx` - Readonly mode
- `webui/src/components/workflow/interactions/file-input/FileInputDropzone.tsx` - Readonly mode
- `webui/src/components/workflow/interactions/file-download/FileDownload.tsx` - Readonly mode
- `webui/src/components/workflow/history/CompletedInteractionCard.tsx` - **NEW**
- `webui/src/components/workflow/history/StepGroup.tsx` - **NEW**

---

## 9. Success Criteria

1. ✅ User can scroll up and see all previous interactions in the session
2. ✅ Previous interactions show the user's selections/inputs in read-only mode
3. ✅ Hierarchical selections display correctly (selected items highlighted at correct paths)
4. ✅ Data shown is from point-in-time (INTERACTION_REQUESTED event), not current workflow
5. ✅ History persists after page reload
6. ✅ Current interaction is clearly visible and actionable
7. ✅ Interactions grouped by step with headers
8. ✅ Individual interactions can be collapsed
9. ✅ Single `initialSelectedItems` prop (no parallel arrays in API)
