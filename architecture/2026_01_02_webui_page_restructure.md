# WebUI Page Restructure Analysis

**Date:** 2026-01-02
**Status:** Proposal
**Scope:** WorkflowExecutionPage, InteractionHost, and related components

---

## Current State Analysis

### WorkflowExecutionPage.tsx (~1200 lines)

**What it currently does:**
1. **Start Form** (pageState="start")
   - Three tabs: Upload, Template, History
   - File upload/drag-drop with ZIP/JSON processing
   - Template selection dropdown
   - Workflow runs list with resume functionality
   - Project name input
   - Version confirmation dialog

2. **Workflow Execution** (pageState="running")
   - Two-column layout (sidebar + main)
   - ExecutionStatus component
   - Status display field polling (every 5s)
   - InteractionHost embedding
   - Cancel button

3. **Completion States** (pageState="completed" | "error")
   - Success/error display
   - Restart button

**Problems:**
- **Monolithic**: 1200 lines mixing unrelated concerns
- **Multiple modes in one component**: Uses `pageState` to switch between fundamentally different UIs
- **Hard to test**: Starting logic, running logic, and completion logic all intertwined
- **State explosion**: 30+ useState calls for different concerns
- **File processing mixed with UI**: ZIP/JSON parsing logic embedded in component

---

### InteractionHost.tsx (~834 lines)

**What it currently does:**
1. **Entry point** (InteractionHost function ~85 lines)
   - Renders title/prompt
   - Routes to specific host by interaction_type

2. **TextInputHost** (~230 lines)
   - Dev mode variant comparison
   - Settings panel with localStorage persistence
   - State management
   - Submit/cancel buttons

3. **FileInputHost** (~220 lines)
   - Nearly identical structure to TextInputHost
   - Duplicated settings logic

4. **FileDownloadHost** (~50 lines)
   - Simplified, single variant

5. **StructuredSelectHost** (~70 lines)
   - Thin wrapper around SchemaInteractionHost
   - Response format conversion

6. **ReviewGroupedHost** (~50 lines)
   - Thin wrapper around SchemaInteractionHost
   - Response format conversion

**Problems:**
- **Duplicated code**: TextInputHost and FileInputHost are 90% identical
- **Mixed responsibilities**: Settings management, state management, UI rendering all in one
- **Inconsistent patterns**: Some hosts have variant settings, others don't
- **File too large**: 834 lines for what should be simple routing

---

## Core Insight

> "InteractionHost should have been its own page, because it single-handedly runs the workflow. WorkflowExecutionPage is landing page + starting point, but not the workflow itself."

The current architecture conflates two distinct user journeys:

| Journey | Purpose | User Goal |
|---------|---------|-----------|
| **Starting** | Choose how to run a workflow | "I want to start/resume a workflow" |
| **Running** | Interact with active workflow | "I'm working through a workflow" |

These should be separate pages with clear navigation between them.

---

## Proposed Architecture

### Page Structure

```
src/pages/
├── WorkflowStartPage.tsx      # Landing page - choose/start workflow
├── WorkflowRunnerPage.tsx     # Active workflow execution
└── (App.tsx routes between them based on workflowRunId)
```

### Component Structure

```
src/components/workflow/
├── start/                      # Start page components
│   ├── WorkflowUploader.tsx       # File upload/drag-drop
│   ├── TemplateSelector.tsx       # Template dropdown
│   ├── WorkflowRunsList.tsx       # History list with resume
│   └── VersionDiffDialog.tsx      # Version change confirmation
│
├── runner/                     # Runner page components
    ├── InteractionPanel.tsx       # Orchestrator: state + shell + router
│   └── WorkflowCompletion.tsx     # Success/error states
│
├── state/                      # Workflow state display components
│   ├── WorkflowSidebar.tsx        # Status, progress, actions
│   └── ExecutionStatus.tsx        # Step progress, elapsed time, messages
│
└── interactions/               # Interaction components (simplified)
    ├── InteractionRouter.tsx      # Pure switch/router (no UI, no state)
    ├── text-input/
    ├── file-input/
    ├── file-download/
    └── schema-interaction/
```

**Note:** Project name input is just a simple Input field - no need for a separate component.
It lives inline in WorkflowStartPage or within WorkflowUploader/TemplateSelector as needed.

**InteractionPanel vs the old InteractionShell idea:**
After reconsideration, we don't need a separate "shell" component. InteractionPanel handles everything:
- Renders title/prompt from request
- Creates and manages interaction state
- Renders the appropriate interaction via InteractionRouter
- Renders submit/cancel buttons
- Converts state to response on submit

The shell concept was over-engineering - one component can do all this in ~100 lines.

---

## Detailed Proposals

### 1. WorkflowStartPage

**Single responsibility:** Help user start or resume a workflow.

```typescript
// WorkflowStartPage.tsx (~200 lines)
export function WorkflowStartPage() {
  const navigate = useNavigate();
  const { startWorkflow, resumeWorkflow } = useWorkflowExecution();

  const handleStart = async (config: StartConfig) => {
    const runId = await startWorkflow(config);
    navigate(`/run/${runId}`);
  };

  const handleResume = async (runId: string) => {
    await resumeWorkflow(runId);
    navigate(`/run/${runId}`);
  };

  return (
    <Tabs>
      <TabsContent value="upload">
        <WorkflowUploader onStart={handleStart} />
      </TabsContent>
      <TabsContent value="template">
        <TemplateSelector onStart={handleStart} />
      </TabsContent>
      <TabsContent value="history">
        <WorkflowRunsList onResume={handleResume} />
      </TabsContent>
    </Tabs>
  );
}
```

**Benefits:**
- Clear purpose: starting workflows
- Each tab is its own component
- Navigation to runner page on start

---

### 2. WorkflowRunnerPage

**Single responsibility:** Display and interact with an active workflow.

```typescript
// WorkflowRunnerPage.tsx (~150 lines)
export function WorkflowRunnerPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const {
    status,
    currentInteraction,
    respond,
    cancel,
  } = useWorkflowExecution(runId);

  // Redirect to start if no active workflow
  if (!runId) {
    navigate('/');
    return null;
  }

  if (status === 'completed' || status === 'error') {
    return <WorkflowCompletion status={status} onRestart={() => navigate('/')} />;
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      <WorkflowSidebar runId={runId} onCancel={cancel} />
      <div className="col-span-2">
        {currentInteraction ? (
          <InteractionPanel
            interaction={currentInteraction}
            onSubmit={respond}
          />
        ) : (
          <LoadingState />
        )}
      </div>
    </div>
  );
}
```

**Benefits:**
- Clear purpose: running workflows
- Simple conditional rendering
- Completion state is separate component

---

### 3. InteractionRouter (Simplified)

**Single responsibility:** Route to correct interaction component.

```typescript
// InteractionRouter.tsx (~50 lines)
// Pure router - no UI, no state, no buttons
export function InteractionRouter({
  request,
  state,
  onStateChange,
  disabled,
}: InteractionRouterProps) {
  switch (request.interaction_type) {
    case "text_input":
      return <TextInputControlled state={state} onStateChange={onStateChange} disabled={disabled} />;
    case "select_from_structured":
      return <SchemaInteraction request={request} mode="select" ... />;
    case "review_grouped":
      return <SchemaInteraction request={request} mode="review" ... />;
    case "file_input":
      return <FileInputControlled state={state} onStateChange={onStateChange} disabled={disabled} />;
    case "file_download":
      return <FileDownloadControlled state={state} onStateChange={onStateChange} disabled={disabled} />;
    default:
      return <UnsupportedInteraction type={request.interaction_type} />;
  }
}
```

---

### 4. InteractionPanel (Orchestrator)

**Single responsibility:** Orchestrate interaction state, UI wrapper, and content routing.

```typescript
// InteractionPanel.tsx (~100 lines)
export function InteractionPanel({
  interaction,
  onSubmit,
  onCancel,
  disabled,
}: InteractionPanelProps) {
  // Create appropriate state based on interaction type
  const [state, setState] = useState(() =>
    createInteractionState(interaction)
  );

  const handleSubmit = () => {
    const response = stateToResponse(state, interaction);
    onSubmit(response);
  };

  return (
    <Card>
      {/* Title and prompt */}
      {(interaction.title || interaction.prompt) && (
        <CardHeader>
          {interaction.title && <CardTitle>{interaction.title}</CardTitle>}
          {interaction.prompt && (
            <p className="text-foreground/80 whitespace-pre-line">{interaction.prompt}</p>
          )}
        </CardHeader>
      )}

      {/* Interaction content */}
      <CardContent>
        <InteractionRouter
          request={interaction}
          state={state}
          onStateChange={setState}
          disabled={disabled}
        />
      </CardContent>

      {/* Action buttons */}
      <CardFooter className="justify-end gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        )}
        <Button onClick={handleSubmit} disabled={disabled || !state.isValid}>
          Continue
        </Button>
      </CardFooter>
    </Card>
  );
}
```

---

### 5. Extract Variant Settings Hook

The duplicated settings logic in TextInputHost and FileInputHost becomes:

```typescript
// useVariantSettings.ts (~40 lines)
export function useVariantSettings<T extends string>(
  storageKey: string,
  defaultSettings: VariantSettings<T>
) {
  const [settings, setSettings] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    } catch {
      return defaultSettings;
    }
  });

  const updateSettings = useCallback((updates: Partial<VariantSettings<T>>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
      return newSettings;
    });
  }, [storageKey]);

  return [settings, updateSettings] as const;
}
```

---

## File Size Comparison

| File | Current | Proposed |
|------|---------|----------|
| WorkflowExecutionPage | 1200 lines | Split into multiple |
| WorkflowStartPage | - | ~200 lines |
| WorkflowRunnerPage | - | ~150 lines |
| WorkflowUploader | - | ~150 lines |
| TemplateSelector | - | ~80 lines |
| WorkflowRunsList | - | ~200 lines |
| InteractionHost | 834 lines | Split into multiple |
| InteractionRouter | - | ~50 lines |
| InteractionPanel | - | ~100 lines |
| useVariantSettings | - | ~40 lines |

**Total lines reduced from ~2000 to ~970** with much clearer separation.

---

## Navigation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.tsx                                  │
│                                                                  │
│   Route: /              Route: /run/:runId                      │
│       │                        │                                 │
│       ▼                        ▼                                 │
│  ┌─────────────┐        ┌──────────────┐                        │
│  │ WorkflowStart│        │WorkflowRunner│                        │
│  │    Page      │───────▶│    Page      │                        │
│  └─────────────┘ start   └──────────────┘                        │
│       ▲                        │                                 │
│       │                        │ complete/error                  │
│       └────────────────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Migration Strategy

### Phase 1: Extract Start Page Components
1. Create `WorkflowUploader` from upload tab logic
2. Create `TemplateSelector` from template tab logic
3. Create `WorkflowRunsList` from history tab logic
4. Create `WorkflowStartPage` composing these

### Phase 2: Extract Runner Page
1. Create `WorkflowSidebar` from sidebar logic
2. Create `WorkflowCompletion` from completed/error states
3. Create `WorkflowRunnerPage` composing these

### Phase 3: Simplify InteractionHost
1. Extract `useVariantSettings` hook
2. Create `InteractionPanel` (state + UI + routing)
3. Create `InteractionRouter` (pure switch)

### Phase 4: Add Routing
1. Add react-router-dom routes
2. Navigate between pages
3. Remove `pageState` logic

---

## Questions to Resolve

1. **URL structure**: Should running workflows have URLs like `/run/:runId`?
2. **State persistence**: How to handle browser refresh during workflow execution?
3. **Dev mode variants**: Keep variant comparison feature? If so, where does it live?

---

## Summary

The current architecture combines a "launcher" and "runner" into one monolithic page. By separating these concerns:

- **WorkflowStartPage**: Landing page for choosing/starting workflows
- **WorkflowRunnerPage**: Focused page for active workflow execution
- **Simplified components**: Each component has single responsibility
- **Reduced duplication**: Shared hooks and wrappers eliminate copy-paste code

This makes the codebase easier to understand, test, and maintain.

---

## Implementation Plan (POA)

### Phase 1: Create start/ folder components

| # | Task | Source | Target | Notes |
|---|------|--------|--------|-------|
| 1.1 | Create `start/` folder | - | `src/components/workflow/start/` | New folder |
| 1.2 | Extract `WorkflowUploader.tsx` | WorkflowExecutionPage lines 622-717 | `start/WorkflowUploader.tsx` | Upload tab: drag-drop, file processing, entry point selection |
| 1.3 | Extract `TemplateSelector.tsx` | WorkflowExecutionPage lines 719-752 | `start/TemplateSelector.tsx` | Template tab: dropdown, template list |
| 1.4 | Extract `WorkflowRunsList.tsx` | WorkflowExecutionPage lines 754-971 | `start/WorkflowRunsList.tsx` | History tab: runs list, resume, resume-with-update |
| 1.5 | Move `VersionDiffDialog.tsx` | `src/components/workflow/VersionDiffDialog.tsx` | `start/VersionDiffDialog.tsx` | Just move, update imports |
| 1.6 | Create `WorkflowStartPage.tsx` | - | `src/pages/WorkflowStartPage.tsx` | Compose: Tabs + above components + project name input |
| 1.7 | Create `start/index.ts` | - | `start/index.ts` | Export all start components |

### Phase 2: Create state/ and runner/ components

| # | Task | Source | Target | Notes |
|---|------|--------|--------|-------|
| 2.1 | Create `state/` folder | - | `src/components/workflow/state/` | New folder |
| 2.2 | Move `ExecutionStatus.tsx` | `src/components/workflow/ExecutionStatus.tsx` | `state/ExecutionStatus.tsx` | Just move, update imports |
| 2.3 | Extract `WorkflowSidebar.tsx` | WorkflowExecutionPage lines 1048-1092 | `state/WorkflowSidebar.tsx` | Sidebar: ExecutionStatus + action buttons + project info |
| 2.4 | Create `state/index.ts` | - | `state/index.ts` | Export all state components |
| 2.5 | Create `runner/` folder | - | `src/components/workflow/runner/` | New folder |
| 2.6 | Extract `WorkflowCompletion.tsx` | WorkflowExecutionPage lines 1124-1180 | `runner/WorkflowCompletion.tsx` | Completed + error states display |
| 2.7 | Create `InteractionPanel.tsx` | New component | `runner/InteractionPanel.tsx` | Orchestrator: title/prompt + state + router + buttons |
| 2.8 | Create `runner/index.ts` | - | `runner/index.ts` | Export all runner components |
| 2.9 | Create `WorkflowRunnerPage.tsx` | - | `src/pages/WorkflowRunnerPage.tsx` | Compose: sidebar + InteractionPanel/Completion |

### Phase 3: Simplify interactions/

| # | Task | Source | Target | Notes |
|---|------|--------|--------|-------|
| 3.1 | Create `InteractionRouter.tsx` | InteractionHost switch logic | `interactions/InteractionRouter.tsx` | Pure switch, ~50 lines |
| 3.2 | Extract `useVariantSettings.ts` | TextInputHost/FileInputHost duplicated code | `src/hooks/useVariantSettings.ts` | Shared settings hook |
| 3.3 | Simplify `TextInputHost` | Remove settings duplication | Use useVariantSettings | Reduce ~230 → ~80 lines |
| 3.4 | Simplify `FileInputHost` | Remove settings duplication | Use useVariantSettings | Reduce ~220 → ~80 lines |
| 3.5 | Update `interactions/index.ts` | - | - | Export InteractionRouter, remove InteractionHost |

### Phase 4: Add routing and cleanup

| # | Task | Source | Target | Notes |
|---|------|--------|--------|-------|
| 4.1 | Update `App.tsx` | Current single-page | Add react-router routes | `/` → StartPage, `/run/:runId` → RunnerPage |
| 4.2 | Update `useWorkflowExecution` | - | - | Accept optional runId param for resuming |
| 4.3 | Delete `WorkflowExecutionPage.tsx` | `src/pages/WorkflowExecutionPage.tsx` | - | Replaced by Start + Runner pages |
| 4.4 | Delete `InteractionHost` export | `interactions/InteractionHost.tsx` | - | Keep file but remove from index, or delete entirely |
| 4.5 | Update all imports | Various files | - | Ensure all imports point to new locations |
| 4.6 | Run build and fix errors | - | - | `npm run build` |
| 4.7 | Manual testing | - | - | Test start, run, complete, error flows |

### Implementation Order

```
Phase 1 (start/)           Phase 2 (state/, runner/)      Phase 3 (interactions/)    Phase 4 (routing)
─────────────────────────  ───────────────────────────    ────────────────────────   ──────────────────
1.1 Create folder          2.1 Create state/ folder       3.1 InteractionRouter      4.1 App.tsx routes
1.2 WorkflowUploader       2.2 Move ExecutionStatus       3.2 useVariantSettings     4.2 Update hook
1.3 TemplateSelector       2.3 WorkflowSidebar            3.3 Simplify TextInput     4.3 Delete old page
1.4 WorkflowRunsList       2.4 state/index.ts             3.4 Simplify FileInput     4.4 Delete old host
1.5 Move VersionDiff       2.5 Create runner/ folder      3.5 Update index.ts        4.5 Update imports
1.6 WorkflowStartPage      2.6 WorkflowCompletion                                    4.6 Build
1.7 start/index.ts         2.7 InteractionPanel                                      4.7 Test
                           2.8 runner/index.ts
                           2.9 WorkflowRunnerPage
```

### Checkpoints

- **After Phase 1**: WorkflowStartPage works, can start workflows (still uses old runner)
- **After Phase 2**: Both pages work, navigation between them works
- **After Phase 3**: Cleaner interaction code, same functionality
- **After Phase 4**: Old code deleted, build passes, all tests pass

---

## Revision 1: Variant Hosts Architecture (Missing from Original)

**Date:** 2026-01-02 (during implementation)
**Issue:** The original proposal failed to document the variant/host layer and its purpose.

### What Was Missing

The original document analyzed InteractionHost.tsx at a high level but did not document:

1. **The complete variant system architecture**
2. **Why hosts exist between InteractionHost and controlled variants**
3. **The dev mode feature and its value**
4. **How each interaction type is rendered**

This oversight led to confusion during Phase 3 implementation about whether to keep or remove the hosts.

### Current Variant Architecture (As-Is)

#### Full Folder Structure with Components

#### Target Folder Structure (After Refactor)

```
src/components/workflow/interactions/
│
├── InteractionHost.tsx                    # SLIM DOWN: Only router + title/prompt (~100 lines)
│   └── InteractionHost()                  # Routes to type-specific hosts
│
├── InteractionRouter.tsx                  # Alternative pure router (no title/prompt)
│   └── InteractionRouter()                # Used by InteractionPanel if we skip InteractionHost
│
├── index.ts                               # Exports all public components
├── types.ts                               # ComponentVariant, ControlledVariant types
│
├── text-input/
│   ├── index.ts                           # Exports + variant arrays
│   └── TextInputEnhancedControlled.tsx    # Controlled: with char count, clear btn
│
├── file-input/
│   ├── index.ts                           # Exports + variant array
│   └── FileInputDropzoneControlled.tsx    # Drag-drop file upload
│
├── file-download/
│   ├── index.ts                           # Exports + variant array
│   └── FileDownloadControlled.tsx         # Download with preview
│
├── structured-select/
│   ├── StructuredSelect.tsx           # TO CREATE: thin wrapper
│   └── index.ts
│
├── review-grouped/
│   ├── ReviewGroupedHost.tsx              # TO CREATE: thin wrapper
│   └── index.ts
│
└── schema-interaction/
    ├── index.ts                           # Exports all schema components
    ├── types.ts                           # SchemaProperty, RenderAs, Nudge, etc.
    ├── schema-utils.ts                    # getItemAddon, formatTimeAgo, etc.
    ├── SchemaInteractionHost.tsx          # Main host for select/review modes
    ├── SchemaRenderer.tsx                 # Recursive schema renderer
    ├── SelectableItem.tsx                 # Selectable card/list item
    ├── SelectionContext.tsx               # Selection state context
    ├── ArrayContainer.tsx                 # Renders arrays of items
    ├── ObjectContainer.tsx                # Renders object properties
    └── renderers/
        ├── index.ts
        ├── TextRenderer.tsx               # render_as: "text"
        ├── NumberRenderer.tsx             # render_as: "number"
        ├── ColorRenderer.tsx              # render_as: "color"
        ├── ImageRenderer.tsx              # render_as: "image"
        ├── UrlRenderer.tsx                # render_as: "url"
        ├── DateTimeRenderer.tsx           # render_as: "datetime"
        ├── TerminalRenderer.tsx           # Leaf value renderer
        ├── ErrorRenderer.tsx              # Error display
        └── nudges/
            ├── index.ts
            ├── ColorSwatch.tsx            # Color preview nudge
            ├── CopyButton.tsx             # Copy to clipboard nudge
            └── ExternalLink.tsx           # Open URL nudge
```

#### Simplified Architecture Decision

**Removed:**
- VariantSettingsPanel.tsx - only used by 2 hosts, not worth maintaining
- useVariantSettings hook - no longer needed
- Dev mode / variant comparison feature - removed entirely
- Multiple variants per type - simplified to single best variant
- Host components (TextInputHost, FileInputHost, etc.) - removed

**Implication:** State management moves to InteractionHost or InteractionPanel.

Each interaction type now has:
- One controlled component (receives state via props)
- No host layer
- No variant selection

#### Component Flow Diagram (After Refactor)

```
User clicks "Continue" in UI
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  InteractionPanel (runner/InteractionPanel.tsx)                      │
│  - Card wrapper                                                      │
│  - State management (useState for each interaction type)            │
│  - Submit/Cancel buttons                                             │
│  - Converts state → response on submit                              │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  InteractionHost (interactions/InteractionHost.tsx)            │  │
│  │  - Renders title/prompt                                        │  │
│  │  - Routes directly to controlled component                     │  │
│  │                                                                │  │
│  │  switch(interaction_type) {                                    │  │
│  │    case "text_input":                                          │  │
│  │      ┌─────────────────────────────────────────────────────┐  │  │
│  │      │  TextInputEnhancedControlled                         │  │  │
│  │      │  (text-input/TextInputEnhancedControlled.tsx)        │  │  │
│  │      │  - Pure UI, receives state via props                 │  │  │
│  │      │  - Calls onStateChange when user types               │  │  │
│  │      └─────────────────────────────────────────────────────┘  │  │
│  │    case "file_input":                                          │  │
│  │      └── FileInputDropzoneControlled                           │  │
│  │    case "file_download":                                       │  │
│  │      └── FileDownloadControlled                                │  │
│  │    case "select_from_structured":                              │  │
│  │      └── StructuredSelect → SchemaInteractionHost              │  │
│  │    case "review_grouped":                                      │  │
│  │      └── ReviewGroupedHost → SchemaInteractionHost             │  │
│  │  }                                                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Key change:** No host layer between InteractionHost and controlled components.
State management moves UP to InteractionPanel (or stays in InteractionHost).
### What Each Layer Does

| Layer | Responsibility | Example |
|-------|---------------|---------|
| **InteractionHost** | Route by type, render title/prompt | `switch(interaction_type)` |
| **Type-specific Host** | State management, settings, submit buttons | TextInputHost |
| **Controlled Variant** | Pure UI, receives state via props | TextInputSimpleControlled |


### Why This Wasn't Discussed

The original analysis focused on:
1. Page-level restructuring (WorkflowExecutionPage → Start + Runner)
2. Reducing line counts
3. Separating concerns at the page level

It **failed to deeply analyze** the interaction layer because:
1. InteractionHost was treated as a "black box" that just needed simplification
2. The variant system's value (dev mode comparison) wasn't understood
3. The proposal assumed hosts could be replaced by InteractionPanel + InteractionRouter

### The Contradiction in Original Proposal

The original Phase 3 plan said:

> **3.1** Create `InteractionRouter.tsx` - Pure switch, ~50 lines
> ```typescript
> case "text_input":
>   return <TextInputControlled state={state} onStateChange={onStateChange} />;
> ```

But this ignores that **controlled variants don't manage their own state** - they receive it via props. Someone needs to:
1. Create the initial state
2. Validate the state
3. Convert state to response on submit
4. Render submit/cancel buttons

The original proposal said InteractionPanel would do this, but it also said InteractionPanel would be ~100 lines. That's not possible if InteractionPanel needs to handle state creation/validation for 5 different interaction types.

---

## Implementation Status

### Phase 1: Start Page ✅ COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| Create start/ folder | ✅ Done | |
| WorkflowUploader.tsx | ✅ Done | Controlled component with value/onChange |
| TemplateSelector.tsx | ✅ Done | Fetches templates, Select dropdown |
| WorkflowRunsList.tsx | ✅ Done | List with resume and resume-with-update |
| Move VersionDiffDialog | ✅ Done | Moved to start/ |
| WorkflowStartPage.tsx | ✅ Done | Uses callback prop instead of router |
| start/index.ts | ✅ Done | Exports all components |

### Phase 2: State/Runner ✅ COMPLETE

| Task | Status | Notes |
|------|--------|-------|
| Create state/ folder | ✅ Done | |
| Move ExecutionStatus | ✅ Done | |
| WorkflowSidebar.tsx | ✅ Done | Uses WorkflowStatus type |
| state/index.ts | ✅ Done | |
| Create runner/ folder | ✅ Done | |
| WorkflowCompletion.tsx | ✅ Done | |
| InteractionPanel.tsx | ✅ Done | Thin wrapper around InteractionHost |
| runner/index.ts | ✅ Done | |
| WorkflowRunnerPage.tsx | ✅ Done | Uses callback instead of router |

### Phase 3: Interactions 🔄 IN PROGRESS (SIMPLIFIED)

**New plan:** Remove host layer entirely. Route directly to controlled components.

| Task | Status | Notes |
|------|--------|-------|
| **Delete unused files:** | | |
| Delete VariantSettingsPanel.tsx | ⏳ Pending | No longer needed |
| Delete useVariantSettings.ts | ⏳ Pending | No longer needed |
| Delete InteractionRouter.tsx | ⏳ Pending | InteractionHost does routing |
| Delete TextInputSimpleControlled.tsx | ⏳ Pending | Keep only Enhanced variant |
| Delete TextInputSimple/Area/Card.tsx | ⏳ Pending | Legacy uncontrolled variants |
| Delete FileInputTextControlled.tsx | ⏳ Pending | Keep only Dropzone variant |
| **Create new folders:** | | |
| Create structured-select/ folder | ⏳ Pending | |
| Create structured-select/StructuredSelect.tsx | ⏳ Pending | Thin wrapper → SchemaInteractionHost |
| Create structured-select/index.ts | ⏳ Pending | |
| Create review-grouped/ folder | ⏳ Pending | |
| Create review-grouped/ReviewGroupedHost.tsx | ⏳ Pending | Thin wrapper → SchemaInteractionHost |
| Create review-grouped/index.ts | ⏳ Pending | |
| **Refactor InteractionHost.tsx:** | | |
| Remove TextInputHost | ⏳ Pending | Route directly to TextInputEnhancedControlled |
| Remove FileInputHost | ⏳ Pending | Route directly to FileInputDropzoneControlled |
| Remove FileDownloadHost | ⏳ Pending | Route directly to FileDownloadControlled |
| Move StructuredSelectHost | ⏳ Pending | Move to structured-select/ |
| Move ReviewGroupedHost | ⏳ Pending | Move to review-grouped/ |
| **Move state management to InteractionPanel:** | | |
| Add state creation in InteractionPanel | ⏳ Pending | useState for each interaction type |
| Add state → response conversion | ⏳ Pending | On submit button click |
| Add submit/cancel buttons | ⏳ Pending | Move from hosts |
| **Update exports:** | | |
| Update text-input/index.ts | ⏳ Pending | Remove deleted variants |
| Update file-input/index.ts | ⏳ Pending | Remove deleted variants |
| Update interactions/index.ts | ⏳ Pending | Update exports |
| **Verify:** | | |
| Build passes | ⏳ Pending | npm run build |

### Phase 4: Routing ⏳ PENDING

| Task | Status | Notes |
|------|--------|-------|
| Install react-router-dom | ⏳ Pending | |
| Update App.tsx | ⏳ Pending | |
| Delete old files | ⏳ Pending | |
| Update imports | ⏳ Pending | |
| Final build/test | ⏳ Pending | |

---

## Divergences from Original Plan

### 1. InteractionPanel is a thin wrapper, not an orchestrator

**Original plan:**
> InteractionPanel handles everything: state, title/prompt, routing, buttons (~100 lines)

**What happened:**
InteractionPanel is just a Card wrapper around InteractionHost. The hosts still manage state and buttons.

**Why:** InteractionHost already does routing + title/prompt. Moving state management to InteractionPanel would require:
- Generic state creation for all types
- Type-specific validation
- Type-specific response conversion

This complexity belongs in type-specific hosts, not a generic panel.

### 2. InteractionRouter routes to hosts, not controlled variants

**Original plan:**
```typescript
case "text_input":
  return <TextInputControlled state={state} ... />;
```

**What happened:**
```typescript
case "text_input":
  return <TextInputHost request={request} ... />;
```

**Why:** Controlled variants are pure UI - they don't create state or handle submission. The hosts do that.

### 3. Pages use callbacks instead of react-router

**Original plan:**
```typescript
navigate(`/run/${runId}`);
```

**What happened:**
```typescript
onWorkflowStarted?.(runId);
```

**Why:** react-router-dom not installed yet. Pages work standalone with callback props. Routing deferred to Phase 4.

### 4. Remove host layer entirely (FINAL DECISION)

**Original plan:**
> Simplify TextInputHost/FileInputHost by using shared hook

**First revision:**
> Move hosts to their own folders

**Final decision:**
> Remove hosts entirely. Route directly to controlled components.

**Why:**
- Variant comparison (dev mode) only used by 2 hosts - not worth maintaining
- Hosts added a layer of complexity for little benefit
- State management can move to InteractionPanel
- Each interaction type needs only ONE controlled component

**What gets deleted:**
- VariantSettingsPanel.tsx
- useVariantSettings.ts
- InteractionRouter.tsx
- TextInputHost, FileInputHost, FileDownloadHost (from InteractionHost.tsx)
- TextInputSimpleControlled.tsx (keep only Enhanced)
- TextInputSimple/Area/Card.tsx (legacy)
- FileInputTextControlled.tsx (keep only Dropzone)

**What remains:**
- InteractionHost.tsx - slim router + title/prompt
- InteractionPanel.tsx - state management + buttons
- One controlled component per type
