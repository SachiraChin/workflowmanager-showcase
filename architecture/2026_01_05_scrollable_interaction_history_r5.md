# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 5
**Status:** Draft - Awaiting Feedback

---

## Revision 5 Changes

Based on operator feedback on R4:
- Analyzed the two data structures issue (parallel arrays vs combined objects)
- Proposed alternatives for selection state representation
- Marked stable sections from previous revisions

---

## Sections Unchanged from Previous Revisions

The following sections are **stable** and don't require review:

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

## 4.4 Selection State: Two Arrays vs Combined Objects

### The Issue

You correctly identified an inconsistency:

**Current `SelectionProvider` internal state (parallel arrays):**
```typescript
const [selectedPaths, setSelectedPaths] = useState<string[][]>([]);
const [selectedData, setSelectedData] = useState<unknown[]>([]);
// Index 0 in paths corresponds to index 0 in data
```

**Server response format (combined objects):**
```typescript
response.selected_options = [
  { data: {...}, index: ["path", "0"] },
  { data: {...}, index: ["path", "1"] }
];
```

**Props to SelectionProvider (parallel arrays):**
```typescript
<SelectionProvider
  initialSelectedPaths={[["path","0"], ["path","1"]]}
  initialSelectedData={[{...}, {...}]}
>
```

This requires converting between formats, which is error-prone.

---

### Why Parallel Arrays Exist (Historical Reasons)

Looking at the existing code, the parallel array structure likely evolved because:

1. **Paths used for lookup:** `isSelected(path)` only needs paths
2. **Data used for response:** `getResponse()` only needs data
3. **Separate operations:** Filtering paths doesn't need data access

But this creates risks:
- Arrays can get out of sync
- Index correlation is implicit
- Extra conversion code needed

---

### Alternative A: Combined Selection Items (Recommended)

Change `SelectionProvider` to use a single array of objects:

```typescript
interface SelectionItem {
  path: string[];
  data: unknown;
}

interface SelectionContextValue {
  // Instead of parallel arrays:
  // selectedPaths: string[][];
  // selectedData: unknown[];

  // Single combined array:
  selectedItems: SelectionItem[];

  // Helpers remain the same:
  isSelected: (path: string[]) => boolean;
  toggleSelection: (path: string[], data: unknown) => void;
  canSelect: (path: string[]) => boolean;
}
```

**Props:**
```typescript
interface SelectionProviderProps {
  initialSelectedItems?: SelectionItem[];  // Single prop
  // ... rest
}
```

**Internal implementation:**
```typescript
const [selectedItems, setSelectedItems] = useState<SelectionItem[]>(
  initialSelectedItems ?? []
);

const isSelected = useCallback(
  (path: string[]) => selectedItems.some(item => pathsEqual(item.path, path)),
  [selectedItems]
);

const toggleSelection = useCallback(
  (path: string[], data: unknown) => {
    if (isSelected(path)) {
      setSelectedItems(prev => prev.filter(item => !pathsEqual(item.path, path)));
    } else {
      setSelectedItems(prev => [...prev, { path, data }]);
    }
  },
  [isSelected]
);
```

**For readonly mode:**
```typescript
// Direct mapping from response - no conversion needed
const initialSelectedItems = response.selected_options.map(opt => ({
  path: opt.index.map(String),
  data: opt.data
}));

<SelectionProvider initialSelectedItems={initialSelectedItems}>
```

**Pros:**
- Single source of truth
- Matches response format
- No risk of sync issues
- Cleaner API

**Cons:**
- Requires refactoring existing `SelectionProvider`
- Existing code using `selectedPaths`/`selectedData` separately needs update

---

### Alternative B: Keep Parallel Arrays, Add Combined Getter

Keep internal state as-is, but expose a combined getter:

```typescript
interface SelectionContextValue {
  // Keep existing:
  selectedPaths: string[][];
  selectedData: unknown[];

  // Add combined getter:
  selectedItems: SelectionItem[];  // Computed from paths + data
}
```

**Implementation:**
```typescript
const selectedItems = useMemo(() =>
  selectedPaths.map((path, i) => ({
    path,
    data: selectedData[i]
  })),
  [selectedPaths, selectedData]
);
```

**Props still take parallel arrays but could also accept combined:**
```typescript
interface SelectionProviderProps {
  // Existing (keep for backward compatibility):
  initialSelectedPaths?: string[][];
  initialSelectedData?: unknown[];

  // New (preferred):
  initialSelectedItems?: SelectionItem[];
}

// Inside provider:
const [selectedPaths, setSelectedPaths] = useState<string[][]>(
  initialSelectedItems?.map(i => i.path) ?? initialSelectedPaths ?? []
);
const [selectedData, setSelectedData] = useState<unknown[]>(
  initialSelectedItems?.map(i => i.data) ?? initialSelectedData ?? []
);
```

**Pros:**
- Backward compatible
- Minimal changes to existing code
- Cleaner API for new code

**Cons:**
- Still has internal parallel arrays (risk remains)
- More complex provider logic
- Technical debt

---

### Alternative C: Response Adapter Layer

Keep `SelectionProvider` unchanged, add adapter at readonly boundary:

```typescript
// Utility function to convert response to parallel arrays
function extractSelectionFromResponse(response: InteractionResponseData) {
  const paths = response.selected_options?.map(opt =>
    Array.isArray(opt.index) ? opt.index.map(String) : []
  ) ?? [];
  const data = response.selected_options?.map(opt => opt.data) ?? [];
  return { paths, data };
}

// Usage in StructuredSelect:
const { paths, data } = extractSelectionFromResponse(mode.response);

<SelectionProvider
  initialSelectedPaths={paths}
  initialSelectedData={data}
>
```

**Pros:**
- No changes to SelectionProvider
- Conversion logic isolated in one place
- Quick to implement

**Cons:**
- Doesn't fix the underlying parallel array issue
- Conversion still needed
- Technical debt remains

---

### Recommendation

<!--I see the options, but I'm confused than before. lets take fields we have now, selectedData, selectedPath, cant we just use these to load selections in readonly mode? whats advantage of have initial... filds. also, in this context, where does InteractionMode coming from in r4? i thought it meant to contain slection datain InteractionResponseData, am I misunderstanding something here? give me more context on this whole thing, and how this connects with existing code.-->

**For this feature:** Use **Alternative C** (adapter layer) for quick implementation.

**Follow-up refactor:** Plan **Alternative A** (combined SelectionItem) as a separate cleanup task to improve the codebase.

Rationale:
- Alternative C lets us ship the history feature without large refactors
- The adapter function isolates the conversion in one place
- Alternative A is the "right" design but touches more files
- We can schedule Alternative A as a dedicated refactor after this feature

---

### 4.6 Updated Component Implementation

Using Alternative C (adapter):

**Utility function (new file or in schema-utils.ts):**
```typescript
// webui/src/components/workflow/interactions/schema-interaction/selection-utils.ts

import type { InteractionResponseData } from "@/lib/types";

export interface SelectionFromResponse {
  paths: string[][];
  data: unknown[];
}

export function extractSelectionFromResponse(
  response: InteractionResponseData | undefined
): SelectionFromResponse | undefined {
  if (!response?.selected_options?.length) {
    return undefined;
  }

  return {
    paths: response.selected_options.map(opt =>
      Array.isArray(opt.index) ? opt.index.map(String) : []
    ),
    data: response.selected_options.map(opt => opt.data)
  };
}
```

**StructuredSelect for readonly:**
```typescript
function StructuredSelect() {
  const { request, mode } = useInteraction();

  // Extract selection using adapter
  const initialSelection = useMemo(() => {
    if (mode.type !== 'readonly') return undefined;
    return extractSelectionFromResponse(mode.response);
  }, [mode]);

  return (
    <SchemaInteractionHost
      request={request}
      mode={mode.type === 'readonly' ? 'review' : 'select'}
      variant="cards"
      disabled={mode.type === 'readonly'}
      initialSelectedPaths={initialSelection?.paths}
      initialSelectedData={initialSelection?.data}
    />
  );
}
```

**SchemaInteractionHost updated props:**
```typescript
interface SchemaInteractionHostProps {
  request: { ... };
  mode: InteractionMode;
  variant: VariantStyle;
  disabled?: boolean;
  onStateChange?: (state: SchemaInteractionState) => void;
  // For readonly initialization:
  initialSelectedPaths?: string[][];
  initialSelectedData?: unknown[];
}

// Pass through to SelectionProvider:
<SelectionProvider
  mode={mode}
  variant={variant}
  multiSelect={multiSelect}
  minSelections={minSelections}
  maxSelections={maxSelections}
  initialSelectedPaths={initialSelectedPaths ?? []}
  initialSelectedData={initialSelectedData ?? []}
>
```

---

## 7. Implementation Plan (Updated)

### Phase 1: Server API
*(unchanged)*

### Phase 2: WebUI Types & API
*(unchanged)*

### Phase 3: InteractionHost Readonly Mode
*(unchanged)*

### Phase 4: Child Components
1. **Add `extractSelectionFromResponse` utility**
2. **StructuredSelect:** Use adapter to extract selection, pass to SchemaInteractionHost
3. **SchemaInteractionHost:** Accept `initialSelectedPaths/Data` props, pass to SelectionProvider
4. **SelectionProvider:** Already has initial props - no changes needed
5. **TextInputEnhanced, ReviewGrouped, FileInput, FileDownload:** Handle readonly as before

### Phase 5: Page Layout
*(unchanged)*

### Phase 6: Polish
*(unchanged)*

### Future: SelectionProvider Refactor
- Separate task to refactor from parallel arrays to `SelectionItem[]`
- Not blocking for this feature

---

## 8. Affected Files (Updated)

*(Same as R4, plus:)*
- `webui/src/components/workflow/interactions/schema-interaction/selection-utils.ts` - New adapter

---

## 9. Success Criteria

*(Same as R4)*
