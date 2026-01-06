# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 6
**Status:** Draft - Awaiting Feedback

---

## Revision 6 Changes

Based on operator feedback on R5:
- Added comprehensive data flow explanation
- Clarified relationship between InteractionMode, InteractionResponseData, and SelectionProvider
- Explained why `initial...` fields are needed
- Connected the dots between existing code and proposed changes

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

## Complete Data Flow Explanation

### The Two Different Contexts

There are **two separate React contexts** in the interaction system. This is key to understanding the architecture:

```
┌─────────────────────────────────────────────────────────────────────┐
│  InteractionProvider (from interaction-context.tsx)                 │
│  ├── Provides: request, disabled, mode (NEW), updateProvider, etc.  │
│  └── Used by: InteractionHost and all interaction components        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  SelectionProvider (from SelectionContext.tsx)                │  │
│  │  ├── Provides: selectedPaths, selectedData, isSelected, etc.  │  │
│  │  └── Used by: SchemaRenderer, SelectableItem                  │  │
│  │                                                               │  │
│  │  Only exists inside SchemaInteractionHost!                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Where Each Piece Lives

**1. `InteractionMode` (NEW - in InteractionProvider context)**
```typescript
// From interaction-context.tsx
type InteractionMode =
  | { type: 'active' }
  | { type: 'readonly'; response: InteractionResponseData };

interface InteractionContextValue {
  request: InteractionRequest;    // The interaction request from server
  disabled: boolean;
  mode: InteractionMode;          // NEW: contains response in readonly
  updateProvider: ...;
  // etc.
}
```

**2. `InteractionResponseData` (the user's response)**
```typescript
// From types.ts - this is what the user submitted
interface InteractionResponseData {
  value?: any;                    // For text input
  selected_indices?: ...;         // Indices of selected items
  selected_options?: Array<{      // Full data of selected items
    data: unknown;
    index: (string | number)[];   // Path to the item
  }>;
  // etc.
}
```

**3. `SelectionProvider` state (internal to schema rendering)**
```typescript
// From SelectionContext.tsx - manages UI selection state
const [selectedPaths, setSelectedPaths] = useState<string[][]>([]);
const [selectedData, setSelectedData] = useState<unknown[]>([]);
```

---

### Data Flow: Active Mode (Current Behavior)

```
User opens workflow, interaction arrives
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ InteractionHost                                              │
│   mode: { type: 'active' }  ← No response data              │
│   request: { display_data: { data, schema }, ... }          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ StructuredSelect                                             │
│   const { request, mode } = useInteraction();               │
│   // mode.type === 'active', no response to extract         │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SchemaInteractionHost                                        │
│   <SelectionProvider                                         │
│     initialSelectedPaths={[]}  ← Empty, user hasn't selected │
│     initialSelectedData={[]}                                 │
│   >                                                          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SelectionProvider                                            │
│   selectedPaths: []  ← Starts empty                          │
│   selectedData: []                                           │
│                                                              │
│   User clicks item → toggleSelection(path, data)            │
│   selectedPaths: [["items", "0"]]  ← Now has selection      │
│   selectedData: [{...}]                                      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
User clicks "Continue" → response built from selectedPaths/Data
         │
         ▼
Response sent to server, stored as INTERACTION_RESPONSE event
```

---

### Data Flow: Readonly Mode (NEW - For History)

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
│   // mode.type === 'readonly'                                │
│   // mode.response contains the user's past selection        │
│                                                              │
│   // Extract selection data to pass down:                    │
│   const initialPaths = mode.response.selected_options        │
│     .map(opt => opt.index.map(String));                      │
│   const initialData = mode.response.selected_options         │
│     .map(opt => opt.data);                                   │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SchemaInteractionHost                                        │
│   <SelectionProvider                                         │
│     initialSelectedPaths={[["items","0"]]}  ← Pre-populated! │
│     initialSelectedData={[{...}]}                            │
│   >                                                          │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ SelectionProvider                                            │
│   // useState initializes with provided values:              │
│   selectedPaths: [["items", "0"]]  ← Starts with selection! │
│   selectedData: [{...}]                                      │
│                                                              │
│   isSelected(["items", "0"]) → true  ← Item shows as selected│
│                                                              │
│   User clicks item → disabled, nothing happens               │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
SelectableItem renders with selected=true, shows highlight
```

---

### Why `initial...` Fields Are Needed

**Question:** Can't we just use `selectedPaths`/`selectedData` directly?

**Answer:** No, because `SelectionProvider` **owns** its state via `useState`:

```typescript
// Inside SelectionProvider
const [selectedPaths, setSelectedPaths] = useState<string[][]>(
  initialSelectedPaths  // ← This is how React initializes state
);
```

In React:
- `useState(initialValue)` only uses the initial value on **first mount**
- After mount, the component owns the state
- You can't "push" new values into state from outside except through props

The existing `SelectionProvider` already has `initialSelectedPaths` and `initialSelectedData` props (from line 51-52 in SelectionContext.tsx):

```typescript
interface SelectionProviderProps {
  // ... other props
  initialSelectedPaths?: string[][];
  initialSelectedData?: unknown[];
}
```

These are currently unused (always empty), but they're exactly what we need!

---

### The Connection: How It All Fits Together

```
┌──────────────────────────────────────────────────────────────────────┐
│                        EXISTING CODE                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  interaction-context.tsx                                              │
│  └── InteractionProvider                                              │
│      └── provides: request, disabled, updateProvider, etc.            │
│                                                                       │
│  StructuredSelect.tsx                                                 │
│  └── uses: useInteraction() to get request                           │
│  └── renders: SchemaInteractionHost                                   │
│                                                                       │
│  SchemaInteractionHost.tsx                                            │
│  └── renders: SelectionProvider (always with empty initial values)   │
│                                                                       │
│  SelectionContext.tsx                                                 │
│  └── SelectionProvider                                                │
│      └── has: initialSelectedPaths, initialSelectedData props         │
│      └── currently: always initialized as empty []                    │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                │ OUR CHANGES
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        NEW/MODIFIED CODE                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  interaction-context.tsx (MODIFIED)                                   │
│  └── InteractionProvider                                              │
│      └── NEW: mode: InteractionMode in context                        │
│      └── mode can be { type: 'active' }                               │
│              or { type: 'readonly', response: InteractionResponseData }
│                                                                       │
│  StructuredSelect.tsx (MODIFIED)                                      │
│  └── uses: useInteraction() to get request AND mode                  │
│  └── NEW: if mode.type === 'readonly':                               │
│           extract paths/data from mode.response.selected_options      │
│  └── passes: initialSelectedPaths, initialSelectedData to host       │
│                                                                       │
│  SchemaInteractionHost.tsx (MODIFIED)                                 │
│  └── NEW props: initialSelectedPaths, initialSelectedData            │
│  └── passes these through to SelectionProvider                        │
│                                                                       │
│  SelectionContext.tsx (NO CHANGES NEEDED!)                            │
│  └── Already has initialSelectedPaths, initialSelectedData props      │
│  └── Will just start using non-empty values in readonly mode          │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

<!--It's clear now, only problem i have is, i dont like that we have 2 fields for it because those 2 fields always come together, they wont exist without another. is there a specific reason to have two fields? -->

---

### Summary: What Changes Where

| File | Change | Why |
|------|--------|-----|
| `interaction-context.tsx` | Add `mode: InteractionMode` to context | So components know if readonly and can access response |
| `InteractionHost.tsx` | Accept `mode` prop, pass to provider | Entry point for readonly mode |
| `StructuredSelect.tsx` | Extract selection from `mode.response` | Convert response format to initial values |
| `SchemaInteractionHost.tsx` | Accept and pass through initial props | Pipe data to SelectionProvider |
| `SelectionContext.tsx` | **No changes** | Already has the props we need |
| `SelectableItem.tsx` | **No changes** | Already uses `isSelected(path)` |

---

### Concrete Example

**Completed interaction from server:**
```json
{
  "request": {
    "interaction_type": "select_from_structured",
    "display_data": {
      "data": [
        { "id": "opt1", "label": "First" },
        { "id": "opt2", "label": "Second" }
      ],
      "schema": { "type": "array", "items": { "selectable": true } }
    }
  },
  "response": {
    "selected_options": [
      { "data": { "id": "opt1", "label": "First" }, "index": ["0"] }
    ]
  }
}
```

**How it renders:**

1. `InteractionHost` receives `mode: { type: 'readonly', response: {...} }`
2. `StructuredSelect` extracts: `initialPaths = [["0"]]`, `initialData = [{id:"opt1",...}]`
3. `SelectionProvider` initializes with these values
4. `isSelected(["0"])` returns `true`
5. First item shows highlighted, second item shows dimmed
6. Clicks are disabled (readonly mode)

---

## 4.4 Selection State Alternatives

*(Same as R5 - three alternatives with recommendation for Alternative C)*

---

## 7-9. Implementation Plan, Affected Files, Success Criteria

*(Same as R5)*
