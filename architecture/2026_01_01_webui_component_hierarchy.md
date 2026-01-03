# WebUI Component Hierarchy Analysis

**Date:** 2026-01-01
**Purpose:** Map all component relationships to identify architectural issues

---

## Top-Level Application Structure

```
App.tsx
├── LoginPage
├── HomePage
├── ComponentShowcase
└── WorkflowExecutionPage ←── Main workflow UI
    ├── ExecutionStatus (sidebar)
    ├── VersionDiffDialog
    └── InteractionHost ←── Routes to specific interaction handlers
```

---

## InteractionHost.tsx - The Router (1386 lines)

This file is the main router that dispatches to specific handlers based on `interaction_type`.

```
InteractionHost (router switch)
├── SelectListHost        (select_from_list)     ~220 lines
├── TextInputHost         (text_input)           ~235 lines
├── ConfirmHost           (confirm)              ~230 lines
├── StructuredSelectHost  (select_from_structured) ~30 lines → SchemaInteractionHost
├── ReviewGroupedHost     (review_grouped)       ~25 lines → SchemaInteractionHost
├── FileInputHost         (file_input)           ~230 lines
└── FileDownloadHost      (file_download)        ~60 lines
```

### Pattern Observation: Massive Duplication

The "simple" hosts (SelectList, TextInput, Confirm, FileInput) all follow the **exact same pattern**:

```typescript
// Each Host has identical structure:
1. Settings state (devMode, visibleVariants, selectedVariant)
2. loadSettings() / saveSettings() to localStorage
3. Shared interaction state
4. toggleVariant(), setSelectedVariant(), toggleDevMode() callbacks
5. Settings panel UI (identical across all)
6. Variants grid rendering (identical pattern)
7. Submit/Cancel buttons
```

This pattern is duplicated **4 times** with only these differences:
- State type (SelectListState, TextInputState, etc.)
- Variant list (selectListControlledVariants, textInputControlledVariants, etc.)
- Response conversion function

---

## Schema-Driven Interaction Components

For `select_from_structured` and `review_grouped`:

```
StructuredSelectHost / ReviewGroupedHost
└── SchemaInteractionHost (schema-interaction/SchemaInteractionHost.tsx)
    ├── SelectionProvider (context)
    └── SchemaInteractionContent
        ├── Header (title, prompt)
        ├── SchemaRenderer ←── Entry point for recursive rendering
        │   ├── [type=array, selectable=true] → SelectableArray
        │   │   └── SelectableItem (per item)
        │   │       └── SchemaRenderer (recursive for item content)
        │   │
        │   ├── [type=array, selectable=false] → DisplayArray
        │   │   └── DisplayItem (per item)
        │   │       └── SchemaRenderer (recursive)
        │   │
        │   ├── [type=object] → ObjectRenderer
        │   │   └── FieldRenderer (per field with display=true)
        │   │       └── SchemaRenderer (recursive)
        │   │
        │   └── [primitive] → TerminalRenderer
        │       └── Routes by render_as:
        │           ├── TextRenderer (default/text)
        │           ├── ColorRenderer (color)
        │           ├── UrlRenderer (url)
        │           ├── DateTimeRenderer (datetime)
        │           ├── NumberRenderer (number)
        │           └── ImageRenderer (image)
        │
        ├── Global Feedback UI (review mode only)
        ├── Retryable Options (if present)
        └── Footer (selection count, submit button)
```

---

## Variant System (Simple Interactions)

Each simple interaction type has multiple UI variants:

### select_from_list
```
selectListControlledVariants[]
├── SelectListCheckboxControlled (checkbox)
├── SelectListCardsControlled (cards)
├── SelectListChipsControlled (chips)
└── SelectListDropdownControlled (dropdown)
```

### text_input
```
textInputControlledVariants[]
├── TextInputSimpleControlled (simple)
└── TextInputEnhancedControlled (enhanced)
```

### confirm
```
confirmControlledVariants[]
├── ConfirmButtonsControlled (buttons)
└── ConfirmCardsControlled (cards)
```

### file_input
```
fileInputControlledVariants[]
├── FileInputDropzoneControlled (dropzone)
└── FileInputTextControlled (text)
```

### file_download
```
fileDownloadControlledVariants[]
└── FileDownloadControlled (single variant)
```

---

## Identified Issues

### Issue 1: InteractionHost.tsx is Too Large (1386 lines)

Contains 7 different Host components with massive code duplication. Each simple Host repeats the same:
- Settings management pattern (~50 lines each)
- LocalStorage handling (~20 lines each)
- DevMode/variant toggle logic (~30 lines each)
- Settings panel UI (~50 lines each)

**Estimated duplication:** ~600 lines of nearly identical code

### Issue 2: Host Pattern Not Abstracted

The pattern for "Host with DevMode and Variants" could be a single reusable component:

```typescript
// Instead of 4 separate implementations:
<VariantHost
  interactionType="select_from_list"
  variants={selectListControlledVariants}
  stateFactory={createSelectListState}
  stateValidator={validateSelectListState}
  responseConverter={selectListStateToResponse}
  {...props}
/>
```

### Issue 3: SchemaInteractionHost Complexity

`SchemaInteractionHost.tsx` (345 lines) handles:
1. Selection state via context
2. Header rendering
3. Content rendering via SchemaRenderer
4. Global feedback state (review mode)
5. Retryable options rendering
6. Footer with selection count

Some of this could be split into smaller focused components.

### Issue 4: schema-utils.ts Violations

Contains workflow-specific field name guessing (already documented in workflow_agnostic_principle.md):
- `getItemLabel()` - guesses from hardcoded field names
- `getItemDescription()` - same issue

### Issue 5: SelectableItem/DisplayArray Use Violating Functions

Both components call `getItemLabel()` which violates workflow-agnostic principle.

---

## Component File Locations

```
webui/src/
├── App.tsx
├── pages/
│   ├── WorkflowExecutionPage.tsx (1200 lines)
│   ├── ComponentShowcase.tsx
│   └── LoginPage.tsx
├── components/
│   ├── layout/
│   │   ├── header.tsx
│   │   └── theme-toggle.tsx
│   ├── ui/ (shadcn components - DO NOT MODIFY)
│   │   ├── button.tsx, card.tsx, checkbox.tsx, etc.
│   └── workflow/
│       ├── ExecutionStatus.tsx
│       ├── VersionDiffDialog.tsx
│       └── interactions/
│           ├── InteractionHost.tsx (1386 lines) ←── MAIN ROUTER
│           ├── types.ts
│           ├── index.ts
│           ├── schema-interaction/ ←── NEW UNIFIED COMPONENTS
│           │   ├── SchemaInteractionHost.tsx (345 lines)
│           │   ├── SchemaRenderer.tsx
│           │   ├── ObjectRenderer.tsx
│           │   ├── SelectableArray.tsx
│           │   ├── SelectableItem.tsx ←── VIOLATION
│           │   ├── DisplayArray.tsx ←── VIOLATION
│           │   ├── SelectionContext.tsx
│           │   └── index.ts
│           ├── structured-select/
│           │   ├── schema-utils.ts (18KB) ←── ROOT VIOLATIONS
│           │   ├── schema-renderer.tsx
│           │   ├── template-parser.ts
│           │   ├── types.ts
│           │   ├── index.ts
│           │   └── renderers/
│           │       ├── TerminalRenderer.tsx ←── CLEAN
│           │       ├── TextRenderer.tsx
│           │       ├── ColorRenderer.tsx
│           │       ├── UrlRenderer.tsx
│           │       ├── DateTimeRenderer.tsx
│           │       ├── NumberRenderer.tsx
│           │       ├── ImageRenderer.tsx
│           │       ├── ArrayRenderer.tsx
│           │       ├── ErrorRenderer.tsx
│           │       ├── index.ts
│           │       └── nudges/
│           │           ├── ColorSwatch.tsx
│           │           ├── CopyButton.tsx
│           │           └── ExternalLink.tsx
│           ├── select-list/
│           │   ├── SelectListCards.tsx / SelectListCardsControlled.tsx
│           │   ├── SelectListCheckbox.tsx / SelectListCheckboxControlled.tsx
│           │   ├── SelectListChips.tsx / SelectListChipsControlled.tsx
│           │   ├── SelectListDropdown.tsx / SelectListDropdownControlled.tsx
│           │   └── index.ts
│           ├── text-input/
│           │   ├── TextInputSimple.tsx / TextInputSimpleControlled.tsx
│           │   ├── TextInputEnhancedControlled.tsx
│           │   ├── TextInputArea.tsx
│           │   ├── TextInputCard.tsx
│           │   └── index.ts
│           ├── confirm/
│           │   ├── ConfirmButtons.tsx / ConfirmButtonsControlled.tsx
│           │   ├── ConfirmCards.tsx / ConfirmCardsControlled.tsx
│           │   ├── ConfirmRadio.tsx
│           │   ├── ConfirmSwitch.tsx
│           │   └── index.ts
│           ├── file-input/
│           │   ├── FileInputDropzoneControlled.tsx
│           │   ├── FileInputTextControlled.tsx
│           │   └── index.ts
│           ├── file-download/
│           │   ├── FileDownloadControlled.tsx
│           │   └── index.ts
│           └── review-grouped/
│               └── index.ts (empty - just re-exports)
├── contexts/
│   └── WorkflowStateContext.tsx
├── hooks/
│   ├── useWorkflowExecution.ts
│   ├── useWorkflowState.ts
│   └── useWorkflowStream.ts
└── lib/
    ├── api.ts
    ├── types.ts
    ├── utils.ts
    ├── interaction-state.ts
    ├── interaction-utils.ts
    └── workflow-store.ts
```

---

## Data Flow

```
Server (SSE)
    ↓
useWorkflowStream (hook)
    ↓
useWorkflowExecution (hook) - manages currentInteraction state
    ↓
WorkflowExecutionPage
    ↓
InteractionHost (routes by interaction_type)
    ↓
SpecificHost (manages UI state, variant selection)
    ↓
VariantComponent (renders UI, calls onStateChange)
    ↓
onSubmit callback
    ↓
respond() from useWorkflowExecution
    ↓
POST /api/interaction response
```

---

## Recommendations

### 1. Abstract Host Pattern
Create a generic `VariantHostBase` component that handles:
- Settings management
- DevMode/variant toggling
- LocalStorage persistence
- Variant grid rendering

### 2. Fix Workflow-Agnostic Violations
Remove `getItemLabel()`, `getItemDescription()` usage from:
- `SelectableItem.tsx`
- `DisplayArray.tsx`

### 3. Split Large Files
- `InteractionHost.tsx` (1386 lines) → Split into separate files per Host
- `WorkflowExecutionPage.tsx` (1200 lines) → Extract form/state logic

### 4. Mark Obsolete Code
Rename `schema-utils.ts` to `schema-utils.obsolete.ts` to prevent usage.

---

## Review Session - 2026-01-01

### Iteration 1: Initial Feedback and Decisions

#### Item 1: Title/Prompt Logic in SchemaInteractionHost
**Issue:** SchemaInteractionHost has title/prompt rendering logic that shouldn't be there.
**Decision:** Remove title/prompt handling from SchemaInteractionHost. This belongs at a higher level (InteractionHost or page level).
**Status:** Pending

---

#### Item 2: SchemaRenderer Logic is Wrong
**Issue:** Current SchemaRenderer has incorrect branching logic.

**Current (Wrong):**
```
SchemaRenderer
├── [selectable array] → SelectableArray → SelectableItem → SchemaRenderer
├── [non-selectable array] → DisplayArray → DisplayItem → SchemaRenderer
├── [object] → ObjectRenderer → FieldRenderer → SchemaRenderer
└── [primitive] → TerminalRenderer
```

**Correct Logic:**
```typescript
if (selectable) {
  // Wrap in SelectableItem FIRST, then continue rendering content inside
  return (
    <SelectableItem>
      <SchemaRenderer ... /> // renders the actual content
    </SelectableItem>
  );
}

if (type === "array") {
  // ArrayRenderer just maps items and renders SchemaRenderer for each
  return <ArrayRenderer>{items.map(item => <SchemaRenderer ... />)}</ArrayRenderer>;
} else if (type === "object") {
  // ObjectRenderer iterates fields and renders SchemaRenderer for each
  return <ObjectRenderer>{fields.map(field => <SchemaRenderer ... />)}</ObjectRenderer>;
} else {
  // Terminal/primitive value
  return <TerminalRenderer />;
}
```

**Key Changes:**
- `selectable` is checked FIRST at any level, wraps content in SelectableItem
- ArrayRenderer does NOT assume terminals only - it recursively renders SchemaRenderer
- ObjectRenderer just iterates fields and renders SchemaRenderer
- DisplayArray is WRONG and should be removed - only SelectableItem exists

**Decision:** Rewrite SchemaRenderer with correct logic
**Status:** Pending

---

#### Item 3: Module-Level Properties (multi_select, retryable)
**Reference:** Lines 92-93 in hierarchy diagram
**Issue:** Are `multi_select` and `retryable` handled correctly?
**Decision:** These are module-level properties from the interaction request, NOT schema properties. Current handling is acceptable.
**Status:** OK - No change needed

---

#### Item 4: Global Feedback UI
**Reference:** Line 94 in hierarchy diagram
**Issue:** Global feedback is handled separately from retryable options.
**Decision:** Needs research - global feedback should be part of retryable options, not a separate mechanism.
**Action:** Investigate how retryable options work and if global feedback can be integrated there.
**Status:** Pending Research

---

#### Item 5: Variant Components Inner Rendering
**Reference:** Lines 103-138 (variant system for simple interactions)
**Question:** Do these variant components (SelectListCheckbox, TextInputSimple, etc.) use SchemaRenderer or handle everything themselves?

**Action Items:**
- [ ] Check SelectListCheckboxControlled - does it render via SchemaRenderer?
- [ ] Check if select_from_list could use SchemaRenderer instead
- [ ] Identify which variants could be replaced by SchemaRenderer

**Decision:** If variants don't use SchemaRenderer, investigate why. `select_from_list` is a prime candidate for SchemaRenderer.
**Status:** Pending Research

---

#### Item 6: InteractionHost Variant System Purpose
**Issue:** InteractionHost has a complex variant/devMode system. Is it needed?
**Original Purpose:** Allow switching between multiple UI variants during development to pick preferred UX.
**Decision:** Analyze all places with multiple rendering modes. If not adding value, remove the entire mechanism.
**Status:** Pending Analysis

---

#### Item 7: Variant Pattern Duplication
**Issue:** 4 Hosts repeat identical variant management pattern (~600 lines duplicated).
**Related To:** Item 6 - if variant system is removed, this issue is automatically resolved.
**Decision:** Defer until Item 6 is resolved.
**Status:** Blocked by Item 6

---

#### Item 8: SchemaInteractionHost Complexity
**Issue:** SchemaInteractionHost is too complex (345 lines).
**Related To:** Items 1, 2, 4 - fixing these will naturally simplify SchemaInteractionHost.
**Decision:** Address after Items 1, 2, 4 are resolved.
**Status:** Blocked by Items 1, 2, 4

---

#### Item 9: schema-utils.ts Deprecation
**Issue:** File contains workflow-specific field guessing functions that violate workflow-agnostic principle.
**Decision:** Rename to `schema-utils.deprecated.ts`. Do not use. Keep only for reference to identify any missing logic during migration.
**Status:** Ready to Execute

---

#### Item 10: Abstract Host Pattern (Rec 1)
**Question:** Is this the same as SchemaRenderer with correct logic?
**Answer:** Yes, with the correct SchemaRenderer logic from Item 2, a single unified renderer can handle all cases.
**Decision:** SchemaRenderer with correct logic IS the abstracted pattern.
**Status:** Addressed by Item 2

---

#### Item 11: Multiple Array Mechanisms (Rec 2)
**Issue:** Multiple mechanisms exist to render arrays (SelectableArray, DisplayArray, ArrayRenderer).
**Decision:** Pick ONE mechanism. Based on Item 2:
- Keep: `SelectableItem` (wraps selectable content)
- Keep: `ArrayRenderer` (iterates items, renders SchemaRenderer for each)
- **DELETE:** `DisplayArray` - this is wrong, arrays without selection just don't get SelectableItem wrapper
- **DELETE:** `SelectableArray` - merged into SchemaRenderer logic

**Status:** Ready after Item 2 is implemented

---

#### Item 12: Large Files (Rec 3)
**Issue:** Why are files so large?
**Root Causes:**
- `InteractionHost.tsx` (1386 lines) - Contains 7 Host components with duplicated variant logic
- `WorkflowExecutionPage.tsx` (1200 lines) - Contains form state, file upload, multiple tabs

**Decision:** Understand root cause before splitting. If variant system is removed (Item 6), InteractionHost shrinks dramatically.
**Status:** Blocked by Item 6

---

#### Item 13: Mark Obsolete Code (Rec 4)
**Decision:** Yes, rename deprecated files.
**Status:** Ready to Execute (combined with Item 9)

---

#### Item 14: Variant System Value Analysis
**Question:** Does variant/devMode add value?
**Decision:** Analyze all places with multiple rendering modes. Remove if not valuable.
**Action:** Create inventory of all variant systems and their usage.
**Status:** Pending Analysis

---

#### Item 15: Why Separate Hosts?
**Question:** Can a single high-level host handle all interaction types via SchemaRenderer?
**Analysis Needed:**
- All interactions receive data + schema from server
- SchemaRenderer can render any structure
- Why can't `select_from_list` use SchemaRenderer?

**Decision:** Investigate if ALL interaction types can be unified under SchemaRenderer.
**Status:** Pending Research

---

#### Item 16: DisplayArray Removal
**Issue:** DisplayArray is wrong.
**Decision:** Remove DisplayArray. Only SelectableItem should exist as a wrapper. Non-selectable arrays just render without the SelectableItem wrapper.
**Status:** Ready after Item 2 is implemented

---

#### Item 17: Selectable Placement Fix (Array → Items)
**Issue:** `selectable` is currently placed on the ARRAY schema level in workflows:

```json
{
  "type": "array",
  "selectable": true,  // WRONG - on array
  "items": { "type": "object", ... }
}
```

**Semantic Problem:** Saying "array is selectable" is backwards. What's selectable are the ITEMS, not the array itself. The correct semantic is:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "selectable": true,  // CORRECT - on items
    ...
  }
}
```

**Changes Required:**
1. **Workflows:** Move `selectable` from array level to items level in all display schemas
2. **TUI:** Update `tui/strategies/mixins.py` to check `schema.items.selectable` instead of `schema.selectable`
3. **WebUI:** SchemaRenderer already checks item schema, verify it works correctly

**Approach:** Change one schema at a time, targeted. Only support the correct place, fix incorrect usages as encountered.

**Status:** Ready - execute as part of Phase 2

---

### Schema Passing Verification

**Question:** Are we correctly passing schema for child nodes?

**Analysis:** Reviewed SchemaRenderer.tsx, SelectableArray.tsx, DisplayArray.tsx, ObjectRenderer.tsx

**Finding:** Schema passing IS correct:
- `SchemaRenderer.tsx:94` extracts `itemsSchema = schema.items` for array items
- `SelectableArray.tsx:67-71` passes `itemsSchema` to child SchemaRenderer
- `ObjectRenderer.tsx` uses `collectDisplayableFields()` which extracts `field.schema` for each property

The code correctly passes child schemas - variable naming may be confusing since `schema` is reused, but it refers to the correct child schema from `field.schema`.

---

---

## Research Findings - Iteration 2

### Research I3: Retryable Behavior in OMS Workflow

**Source:** `workflows/oms/steps/2_prompt_generation/step.json:216-253`

**Finding:** Retryable is configured at module level in workflow step.json:

```json
"retryable": {
  "default_option": "continue",
  "options": [
    {
      "id": "continue",
      "mode": "continue",
      "label": "Accept and continue"
    },
    {
      "id": "retry",
      "mode": "retry",
      "label": "Regenerate prompts",
      "feedback": {
        "enabled": true,
        "per_group": true,
        "single_feedback_for_all": false,
        "prompt": "Provide feedback for regeneration:",
        "default_message": "..."
      }
    },
    {
      "id": "pick_different_idea",
      "mode": "jump",
      "label": "Pick different idea",
      "target_step": "user_input",
      "target_module": "select_concept"
    }
  ]
}
```

**Server Side (`server/modules/user/select.py:178-195`):**
```python
return InteractionRequest(
    display_data={
        "data": data,
        "schema": schema,
        "multi_select": multi_select,
        "mode": mode,
        "retryable": retryable  # <-- From context, set by workflow processor
    }
)
```

**Conclusion:** Retryable options are sent inside `display_data.retryable`. The feedback configuration IS part of retryable options (`options[].feedback`), NOT a separate mechanism.

---

### Research I4: Global Feedback in Retryable Options

**Finding:** Global feedback is part of `retryable.options[].feedback`:

```json
"feedback": {
  "enabled": true,
  "per_group": true,           // Per-group feedback enabled
  "single_feedback_for_all": false,  // NOT global for all
  "prompt": "Provide feedback for regeneration:",
  "default_message": "..."
}
```

**Issue in WebUI:** SchemaInteractionHost has separate `globalFeedback` state (lines 43, 227-262) that duplicates what should come from retryable options.

**Decision:** Global feedback UI should be rendered as part of retryable options handling, not as a separate mechanism.

---

### Research I5: Do Variant Components Use SchemaRenderer?

**Finding:** NO. All variant components render everything themselves.

**Example - `SelectListCheckboxControlled.tsx`:**
- Renders `request.title` and `request.prompt` directly (lines 40-45)
- Iterates `request.options[]` directly (line 50)
- Accesses `option.label`, `option.description`, `option.metadata` directly
- Does NOT use SchemaRenderer

**All Controlled Variants (11 total):**

| Component | Renders | Uses SchemaRenderer? |
|-----------|---------|---------------------|
| SelectListCheckboxControlled | options[] | NO |
| SelectListCardsControlled | options[] | NO |
| SelectListChipsControlled | options[] | NO |
| SelectListDropdownControlled | options[] | NO |
| TextInputSimpleControlled | text input | NO (N/A) |
| TextInputEnhancedControlled | text input | NO (N/A) |
| ConfirmButtonsControlled | yes/no | NO (N/A) |
| ConfirmCardsControlled | yes/no | NO (N/A) |
| FileInputDropzoneControlled | file picker | NO (N/A) |
| FileInputTextControlled | file path | NO (N/A) |
| FileDownloadControlled | file save | NO (N/A) |

---

### Research I6/I14: Variant System Value Analysis

**What the variant system does:**
1. Each interaction type has multiple UI variants (checkbox, cards, chips, dropdown)
2. InteractionHost provides devMode toggle to show multiple variants side-by-side
3. User can compare variants and pick preferred UX
4. Settings saved to localStorage

**Inventory of variants:**

| Interaction Type | Variants | Purpose |
|------------------|----------|---------|
| select_from_list | 4 variants | Compare checkbox vs cards vs chips vs dropdown |
| text_input | 2 variants | Compare simple vs enhanced |
| confirm | 2 variants | Compare buttons vs cards |
| file_input | 2 variants | Compare dropzone vs text path |
| file_download | 1 variant | No comparison needed |
| select_from_structured | 0 variants* | Uses SchemaInteractionHost |
| review_grouped | 0 variants* | Uses SchemaInteractionHost |

*These use SchemaInteractionHost which has its own `variant` prop (cards/list)

**Code cost:** ~600 lines of duplicated variant management code in InteractionHost.tsx

**Value assessment:**
- Useful during initial UI development to compare approaches
- NOT useful in production - only one variant will be used
- Currently blocking simplification of the codebase

**Decision:** The variant system was for experimentation. Now that UX decisions should be made, it can be removed. Pick one variant per type and delete the rest.

---

### Research I15: Can All Interactions Use SchemaRenderer?

**Analysis of interaction types:**

| Type | Server Sends | Could Use SchemaRenderer? |
|------|-------------|---------------------------|
| select_from_list | `options[]` with `{id, label, description, metadata}` | YES - options is a schema-describable array |
| text_input | `{placeholder, default_value, multiline}` | NO - fundamentally different (input, not display) |
| confirm | `{yes_label, no_label}` | NO - fundamentally different (binary choice) |
| file_input | `{accepted_types, base_path}` | NO - fundamentally different (file picker) |
| file_download | `{file_content, file_name}` | NO - fundamentally different (file save) |
| select_from_structured | `display_data: {data, schema}` | YES - already uses schema |
| review_grouped | `display_data: {data, schema}` | YES - already uses schema |

**Conclusion:** Only `select_from_list` could potentially use SchemaRenderer. The others are fundamentally different interaction patterns (input vs display).

**For select_from_list:** Server would need to send `display_data: {data: options, schema: optionsSchema}` instead of just `options[]`. This is a server-side change.

**Decision:** Keep separate components for text_input, confirm, file_input, file_download. Consider unifying select_from_list with schema-driven approach in future (requires server change).

---

### Research I2: What Do ArrayRenderer and ObjectRenderer Actually Do?

**ArrayRenderer (`structured-select/renderers/ArrayRenderer.tsx`):**
```typescript
// Current behavior:
- For primitive items → TerminalRenderer
- For object items → callback to renderObjectItem (if provided)
- Does NOT recursively call SchemaRenderer
```

**SelectableArray (`schema-interaction/SelectableArray.tsx`):**
```typescript
// Current behavior:
- Assumes selectable=true (hardcoded)
- Wraps each item in SelectableItem
- Calls SchemaRenderer for item content
- This is WRONG - it's a separate component instead of a behavior in SchemaRenderer
```

**ObjectRenderer (`schema-interaction/ObjectRenderer.tsx`):**
```typescript
// Current behavior:
- Uses collectDisplayableFields() from schema-utils (violation!)
- Renders fields with TerminalRenderer
- Does NOT recursively call SchemaRenderer for nested objects
```

**What they SHOULD do (per correct logic):**

```typescript
// SchemaRenderer should handle everything:
function SchemaRenderer({ data, schema, path }) {
  // 1. Check selectable FIRST
  if (schema.selectable) {
    return (
      <SelectableItem path={path} data={data} schema={schema}>
        <SchemaRenderer data={data} schema={{...schema, selectable: false}} path={path} />
      </SelectableItem>
    );
  }

  // 2. Route by type
  if (schema.type === "array") {
    return (
      <ArrayContainer>
        {data.map((item, idx) => (
          <SchemaRenderer
            key={idx}
            data={item}
            schema={schema.items}
            path={[...path, String(idx)]}
          />
        ))}
      </ArrayContainer>
    );
  }

  if (schema.type === "object") {
    const displayableFields = getDisplayableFields(schema); // from schema.properties
    return (
      <ObjectContainer>
        {displayableFields.map(([key, fieldSchema]) => (
          <SchemaRenderer
            key={key}
            data={data[key]}
            schema={fieldSchema}
            path={[...path, key]}
          />
        ))}
      </ObjectContainer>
    );
  }

  // 3. Primitive
  return <TerminalRenderer value={data} schema={schema} />;
}
```

**Key insight:** ArrayRenderer and ObjectRenderer should just be CONTAINERS (for styling/layout), not renderers. The rendering logic belongs in SchemaRenderer.

---

### Updated Item Decisions

#### Item 1: Title/Prompt
**Clarification:** Title/prompt should NOT exist ANYWHERE in the component hierarchy. The interaction request has title/prompt, but they're for the page-level UI (if needed), not for SchemaRenderer or any child component.

**Decision:** Remove all title/prompt rendering from schema-interaction components. If title/prompt is needed, it's the caller's responsibility (WorkflowExecutionPage).

#### Item 2: SchemaRenderer Correct Logic
**Updated pseudo-code above shows the correct approach:**
1. Check `selectable` first → wrap in SelectableItem
2. Check `type` → delegate to appropriate container
3. Recurse with SchemaRenderer for all children
4. Terminal values → TerminalRenderer

#### Item 3: Module Properties
**Confirmed OK:** `multi_select`, `retryable` are module-level props in `display_data`, not schema properties.

#### Item 4: Global Feedback
**Decision:** Remove separate global feedback handling. It should be rendered as part of retryable options (the option with `feedback.enabled=true`).

---

### Action Items Summary (Updated)

| # | Action | Priority | Status | Blocked By |
|---|--------|----------|--------|------------|
| 9 | Rename schema-utils.ts to deprecated | High | Ready | - |
| 1 | Remove ALL title/prompt from schema-interaction | High | Ready | - |
| 2 | Rewrite SchemaRenderer with correct logic | High | Ready | - |
| 4 | Move global feedback into retryable options | High | Ready | Item 2 |
| 16 | Delete DisplayArray | High | Ready | Item 2 |
| 11 | Convert SelectableArray to just SelectableItem wrapper | High | Ready | Item 2 |
| 17 | Fix selectable placement (array→items) in workflows/TUI | High | Ready | - |
| 6 | Remove variant system (pick one variant per type) | Medium | Ready | - |
| 7 | Simplify InteractionHost (remove Host per type) | Medium | Ready | Item 6 |
| 15 | Future: Unify select_from_list with SchemaRenderer | Low | Deferred | Server change |

---

### Next Steps (Execution Order - Revised)

**Phase 1: Cleanup**
1. Item 9: Rename schema-utils.ts to deprecated
2. Item 1: Remove ALL title/prompt from schema-interaction components

**Phase 2: Core Rewrite**
3. Item 2: Rewrite SchemaRenderer with correct logic
4. Item 17: Fix selectable placement (move from array to items in schemas/TUI)
5. Item 16: Delete DisplayArray
6. Item 11: Make SelectableArray just a wrapper (or inline into SchemaRenderer)
7. Item 4: Integrate feedback into retryable options rendering

**Phase 3: Variant Cleanup**
8. Item 6: Pick one variant per interaction type, delete others
9. Item 7: Simplify InteractionHost

---

### Iteration Log

| Date | Iteration | Changes |
|------|-----------|---------|
| 2026-01-01 | 1 | Initial analysis, 16 items documented, execution order defined |
| 2026-01-01 | 2 | Research completed: retryable, feedback, variants, SchemaRenderer logic |
0| 2026-01-02 | 3 | Added Item 17 (selectable placement fix), verified schema passing is correct |
