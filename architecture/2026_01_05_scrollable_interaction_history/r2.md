# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 2
**Status:** Draft - Awaiting Feedback

---

## Revision 2 Changes

Based on operator feedback on R1:
- Clarified step_id consistency (uses same step_id from events)
- Detailed interaction pairing logic with verification
- Changed approach: Extend `InteractionHost` with readonly mode instead of new component
- Decided: Expanded by default, collapsible optional
- Decided: Group by step with headers
- Decided: Use same components in readonly mode
- Added performance estimates with assumptions
- Decided: No limit by default, but server supports limit parameter
- Added branch handling UX proposal

---

## 1. Problem Statement

### Current Behavior
- WebUI displays only the **current interaction** in `WorkflowRunnerPage`
- When a new interaction arrives, the previous one is replaced and disappears from view
- `interactionHistory` array exists in Zustand store but is **not rendered anywhere**
- When user exits and rejoins the session, **no history is loaded**

### User Pain Points
1. No way to review previous selections/inputs made during the session
2. No context of what happened before the current step
3. Cannot verify if earlier choices were correct
4. Loses all visual context after page reload

---

## 2. Requirements

### Functional Requirements
1. **Scrollable Session View**: User can scroll up to see all previous interactions in chronological order
2. **Read-Only History**: Past interactions display with disabled controls showing user's selections/inputs
3. **Persistence**: History loads correctly when user exits and returns to the session
4. **Current Interaction Highlight**: Active interaction is clearly distinguished from history
5. **Auto-Scroll**: Page auto-scrolls to current interaction when new one arrives
6. **Step Grouping**: Interactions grouped by step with visual headers
7. **Collapsible Cards**: Expanded by default, user can collapse individual interactions

### Non-Functional Requirements
1. **Performance**: Handle workflows with 50+ interactions without UI lag
2. **Memory**: Consider virtualization for very long workflows
3. **Consistency**: History must match server events (source of truth)

---

## 3. Current Architecture Analysis

### Server Event Storage

**INTERACTION_REQUESTED Event Structure:**
```javascript
{
  "event_id": "evt_<uuid7>",           // Time-sortable UUID
  "workflow_run_id": "wf_xxx",
  "branch_id": "br_xxx",
  "event_type": "interaction_requested",
  "timestamp": "2026-01-05T10:30:00Z",
  "step_id": "user_input",              // ✅ Same step_id as live interactions
  "module_name": "Select Duration",     // ✅ Module name stored
  "data": {
    "interaction_id": "int_001",        // Used for pairing
    "interaction_type": "select_from_structured",
    "title": "...",
    "prompt": "...",
    "options": [...],
    "display_data": {...},
    "resolver_schema": {...},
    "_resolved_inputs": {...}
  }
}
```

**INTERACTION_RESPONSE Event Structure:**
```javascript
{
  "event_id": "evt_<uuid7>",
  "workflow_run_id": "wf_xxx",
  "branch_id": "br_xxx",
  "event_type": "interaction_response",
  "timestamp": "2026-01-05T10:35:00Z",
  // Note: step_id and module_name NOT stored in response event
  "data": {
    "interaction_id": "int_001",        // Used for pairing
    "response": {
      "value": "...",
      "selected_indices": [0, 2],
      "selected_options": [{...}, {...}],
      "cancelled": false,
      "retry_requested": false,
      ...
    }
  }
}
```

### Pairing Logic Verification

**How pairing works:**
1. Query all `INTERACTION_REQUESTED` events for workflow (includes step_id, module_name)
2. Query all `INTERACTION_RESPONSE` events for workflow
3. Match by `data.interaction_id` field
4. step_id and module_name come from the REQUESTED event (not stored in RESPONSE)

**Verification:** This pairing is reliable because:
- `interaction_id` is generated uniquely per interaction request
- Response event always includes the `interaction_id` it's responding to
- Events are immutable - once stored, they don't change
- Branch handling uses lineage to get only relevant events

---

## 4. Proposed Architecture

### 4.1 Data Model

**New Type: `CompletedInteraction`**
```typescript
interface CompletedInteraction {
  interactionId: string;
  request: InteractionRequest;
  response: InteractionResponseData;
  timestamp: string;           // When response was submitted
  stepId: string;              // From INTERACTION_REQUESTED event
  moduleName: string;          // From INTERACTION_REQUESTED event
}
```

### 4.2 Server API Changes

**New Endpoint:**
```
GET /workflow/{workflow_run_id}/interaction-history
    ?branch_id=<optional>     // Defaults to current branch
    ?limit=<optional>         // For future pagination if needed
```

**Response:**
```json
{
  "workflow_run_id": "wf_xxx",
  "branch_id": "br_xxx",
  "interactions": [
    {
      "interaction_id": "int_001",
      "request": { /* full InteractionRequest from event data */ },
      "response": { /* full InteractionResponseData from event data */ },
      "timestamp": "2026-01-05T10:35:00Z",
      "step_id": "user_input",
      "module_name": "Select Duration"
    }
  ],
  "pending_interaction": { /* InteractionRequest if awaiting input, else null */ }
}
```

**Implementation Logic (database_provider.py):**
```python
def get_interaction_history(
    self,
    workflow_run_id: str,
    branch_id: str = None,
    limit: int = None
) -> Dict:
    """Get paired interaction history for a workflow."""
    if branch_id is None:
        branch_id = self.get_current_branch_id(workflow_run_id)

    # Get all events in branch lineage
    request_events = self.get_lineage_events(
        workflow_run_id, branch_id,
        event_type=DbEventType.INTERACTION_REQUESTED
    )
    response_events = self.get_lineage_events(
        workflow_run_id, branch_id,
        event_type=DbEventType.INTERACTION_RESPONSE
    )

    # Build response lookup by interaction_id
    response_lookup = {
        evt["data"]["interaction_id"]: evt["data"]["response"]
        for evt in response_events
        if "data" in evt and "interaction_id" in evt["data"]
    }

    # Pair requests with responses
    interactions = []
    pending = None

    for req_evt in request_events:
        interaction_id = req_evt["data"].get("interaction_id")
        if interaction_id in response_lookup:
            interactions.append({
                "interaction_id": interaction_id,
                "request": req_evt["data"],  # Full request data
                "response": response_lookup[interaction_id],
                "timestamp": req_evt["timestamp"].isoformat(),
                "step_id": req_evt.get("step_id"),
                "module_name": req_evt.get("module_name")
            })
        else:
            # No response yet - this is pending
            pending = req_evt["data"]

    if limit:
        interactions = interactions[-limit:]

    return {
        "workflow_run_id": workflow_run_id,
        "branch_id": branch_id,
        "interactions": interactions,
        "pending_interaction": pending
    }
```

### 4.3 WebUI Component Architecture

**Updated InteractionHost with Readonly Mode:**

Instead of creating a new `ReadOnlyInteractionHost`, we extend the existing `InteractionHost` component to support a readonly mode. This avoids duplicating complex logic.

```typescript
interface InteractionHostProps {
  request: InteractionRequest;
  onSubmit: (response: InteractionResponseData) => void;
  onCancel?: () => void;
  disabled?: boolean;
  // NEW: Readonly mode props
  mode?: 'active' | 'readonly';
  response?: InteractionResponseData;  // User's response to display in readonly
}
```

**Changes to InteractionHost:**
1. Add `mode` prop (default: 'active')
2. Add `response` prop for readonly mode
3. Pass `mode` and `response` through context
4. Hide footer (action buttons) when `mode === 'readonly'`
5. Style differently in readonly mode (muted colors, checkmark badge)

**Changes to InteractionProvider context:**
```typescript
interface InteractionContextValue {
  request: InteractionRequest;
  disabled: boolean;
  // NEW
  <!--is there any other way we structure following data, I'm not saying this is bad, just want to see alternatives, one alternative i want to see is handle readonly state by single field. give me pros/cons of each too. -->
  mode: 'active' | 'readonly';
  response?: InteractionResponseData;  // Available in readonly mode
  // ... existing methods
}
```

**Changes to Child Components:**

Each child component checks `mode` from context:

| Component | Active Mode | Readonly Mode |
|-----------|-------------|---------------|
| `TextInputEnhanced` | Empty textarea, editable | Show `response.value`, disabled |
| `StructuredSelect` | Checkboxes, selectable | Pre-check `response.selected_indices`, disabled |
| `ReviewGrouped` | Review with retry options | Show data, no retry buttons |
| `FileInputDropzone` | Dropzone, uploadable | Show uploaded filename |
| `FileDownload` | Download button | Show downloaded filename |

**Example: TextInputEnhanced readonly handling:**
<!--how does this ensure that correct child gets correct value. for example, lets say we have multi-select view, how can we make sure that selected childs are highlighted by others are disabled? -->
```typescript
function TextInputEnhanced() {
  const { request, disabled, mode, response } = useInteraction();

  const [value, setValue] = useState(
    mode === 'readonly' && response?.value
      ? String(response.value)
      : request.default_value || ''
  );

  return (
    <Textarea
      value={value}
      onChange={(e) => mode !== 'readonly' && setValue(e.target.value)}
      disabled={disabled || mode === 'readonly'}
      className={cn(
        mode === 'readonly' && 'bg-muted cursor-default'
      )}
    />
  );
}
```

### 4.4 Page Layout

```
WorkflowRunnerPage
├── ScrollableContainer (flex-1, overflow-y-auto)
│   │
│   ├── StepGroup (step: "User Input")
│   │   ├── StepHeader ("Step 1: User Input")
│   │   ├── CompletedInteractionCard (collapsed: false)
│   │   │   └── InteractionHost (mode: 'readonly', response: {...})
│   │   ├── CompletedInteractionCard (collapsed: false)
│   │   │   └── InteractionHost (mode: 'readonly', response: {...})
│   │   └── ...
│   │
│   ├── StepGroup (step: "Prompt Generation")
│   │   ├── StepHeader ("Step 2: Prompt Generation")
│   │   └── CompletedInteractionCard (collapsed: true by user)
│   │       └── InteractionHost (mode: 'readonly', response: {...})
│   │
│   └── CurrentInteractionCard (highlighted, sticky-ish)
│       └── InteractionHost (mode: 'active', no response)
│
└── WorkflowSidebar (existing)
```

### 4.5 New Components

**`CompletedInteractionCard`**
```typescript
interface CompletedInteractionCardProps {
  interaction: CompletedInteraction;
  defaultExpanded?: boolean;
}

function CompletedInteractionCard({ interaction, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Card className="border-muted">
      <CardHeader
        className="cursor-pointer flex justify-between items-center py-2"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="font-medium">{interaction.moduleName}</span>
          <span className="text-muted-foreground text-sm">
            {formatTimeAgo(interaction.timestamp)}
          </span>
        </div>
        <ChevronDown className={cn("h-4 w-4", expanded && "rotate-180")} />
      </CardHeader>

      {expanded && (
        <CardContent>
          <InteractionHost
            request={interaction.request}
            mode="readonly"
            response={interaction.response}
            onSubmit={() => {}}  // No-op in readonly
          />
        </CardContent>
      )}
    </Card>
  );
}
```

**`StepGroup`**
```typescript
interface StepGroupProps {
  stepId: string;
  stepName: string;
  interactions: CompletedInteraction[];
}

function StepGroup({ stepId, stepName, interactions }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 py-2 sticky top-0 bg-background z-10">
        <Badge variant="outline">{stepName}</Badge>
        <span className="text-muted-foreground text-sm">
          {interactions.length} interaction{interactions.length !== 1 ? 's' : ''}
        </span>
      </div>
      {interactions.map(interaction => (
        <CompletedInteractionCard
          key={interaction.interactionId}
          interaction={interaction}
        />
      ))}
    </div>
  );
}
```

### 4.6 Data Flow

**On Page Load / Reconnect:**
```
1. WorkflowRunnerPage mounts with workflow_run_id from URL
2. Fetch: GET /workflow/{id}/interaction-history
3. Response contains:
   - interactions[] (completed, paired request+response)
   - pending_interaction (current, if awaiting input)
4. Group interactions by step_id
5. Render:
   - StepGroups with CompletedInteractionCards
   - CurrentInteractionCard with pending_interaction (if any)
6. Auto-scroll to current interaction
```

**On New Interaction Arrival (SSE):**
```
1. SSE "interaction" event arrives
2. If currentInteraction exists:
   - Create CompletedInteraction from current + last response
   - Add to completedInteractions grouped by step
3. Set new currentInteraction
4. Scroll to new interaction
```

**On User Response:**
```
1. User submits response
2. POST /workflow/{id}/stream/respond
3. On success, SSE returns either:
   - Next interaction (add current to history, set new)
   - Complete event (add current to history, clear current)
```

---

## 5. Performance Analysis

### Assumptions
- Typical workflow: 10-30 interactions
- Complex workflow: 50-100 interactions
- Average interaction request size: 2-10 KB (with display_data)
- Average response size: 0.5-2 KB

### Estimated Payload Sizes
| Workflow Size | Interaction Count | Estimated Total Size |
|---------------|-------------------|---------------------|
| Small | 10 | ~50 KB |
| Medium | 30 | ~180 KB |
| Large | 50 | ~350 KB |
| Very Large | 100 | ~700 KB |

### Client-Side Rendering

**React Rendering Benchmarks (estimated):**
- Simple list of 100 items: ~5ms render
- Complex components with nested data: ~50-100ms for 30 items
- With InteractionHost in readonly mode: ~100-200ms for 50 items

**Recommendations:**
1. **No virtualization initially** - Start without virtualization for simplicity
<!--agreed to above, lets put controls in place to enable following 2 if needed, but controls are not enabled while I test, and decide what to do next-->
2. **Add virtualization at 50+ interactions** - If workflow exceeds 50 interactions, implement virtual scrolling using `react-window` or `@tanstack/react-virtual`
3. **Collapse by default at 30+ in same step** - If a single step has 30+ interactions, default to collapsed

### Server-Side Considerations

**Query Performance:**
- Events are indexed by `workflow_run_id` and `event_type`
- Typical query returns <100 events in <10ms
- No pagination needed initially; `limit` parameter available for future use

---

## 6. Branch Handling UX Proposal

### Current Branch Model

When user performs retry/jump:
1. New branch is created with `parent_branch_id` and `parent_event_id` (cutoff)
2. Events after cutoff in parent branch are "on a different path"
3. Workflow's `current_branch_id` is updated to new branch
4. State is reconstructed from branch lineage only

### UX Design for Branch History

**Option A: Linear History (Recommended for V1)**

Show only the current branch lineage. Previous "abandoned" paths are not shown.

```
┌─────────────────────────────────────────────┐
│ Step 1: User Input                          │
│ ├─ [✓] Select Duration (30s)                │
│ ├─ [✓] Select Tones (Gratitude, Joy)        │
│ └─ [✓] Select Theme (Mystical)              │
│                                             │
│ Step 2: Prompt Generation                   │
│ ├─ [✓] Generate Prompts (retried)           │  ← Shows current version
│ └─ [●] Review Prompts                       │  ← Current interaction
└─────────────────────────────────────────────┘
```

**Pros:**
- Simple to understand
- Clean linear history
- Matches current behavior (users see linear flow)

**Cons:**
- Can't see what was generated before retry
- No comparison between branches

**Option B: Branch Indicators (Future Enhancement)**

Add visual indicators when interactions were retried, with ability to view previous versions.

```
┌─────────────────────────────────────────────┐
│ Step 2: Prompt Generation                   │
│ ├─ [✓] Generate Prompts                     │
│ │      └─ 🔄 Retried (2 previous versions)  │  ← Click to expand
│ │         ├─ v1: "Initial generation..."    │
│ │         └─ v2: "With feedback..."         │
│ └─ [●] Review Prompts                       │
└─────────────────────────────────────────────┘
```

**Implementation for Future:**
1. Store branch tree in workflow (all branches, not just current)
2. New endpoint: `GET /workflow/{id}/branches` returns branch tree
3. UI component to show version history per interaction
4. Compare view to see differences between versions

### Recommendation

**Start with Option A (Linear History)** for this feature. The branch history enhancement can be added later as a separate feature, building on top of this foundation.

The server endpoint already respects branch lineage via `get_lineage_events()`, so the history returned is already "correct" for the current branch. Branch comparison would require additional UI/API work.

<!--agreed to above, we will look into branching later-->

---

## 7. Implementation Plan

### Phase 1: Server API (Day 1)
1. Add `get_interaction_history()` method to `database_provider.py`
2. Add `/workflow/{id}/interaction-history` endpoint to `workflow_api.py`
3. Add response model to `models.py`
4. Test endpoint with existing workflows

### Phase 2: WebUI Store & API (Day 1-2)
1. Add `CompletedInteraction` type to `types.ts`
2. Add `getInteractionHistory()` to `api.ts`
3. Update `workflow-store.ts`:
   - Add `completedInteractions: CompletedInteraction[]`
   - Add `setCompletedInteractions`, `addCompletedInteraction` actions
4. Update `useWorkflowExecution.ts` to fetch history on mount

### Phase 3: InteractionHost Readonly Mode (Day 2-3)
1. Add `mode` and `response` props to `InteractionHost`
2. Update `InteractionProvider` context with new fields
3. Hide footer when `mode === 'readonly'`
4. Add readonly styling (muted colors, checkmark)

### Phase 4: Child Component Updates (Day 3-4)
1. Update `TextInputEnhanced` for readonly
2. Update `StructuredSelect` for readonly (pre-select items)
3. Update `ReviewGrouped` for readonly
4. Update `FileInputDropzone` for readonly
5. Update `FileDownload` for readonly

### Phase 5: Page Layout & New Components (Day 4-5)
1. Create `CompletedInteractionCard` component
2. Create `StepGroup` component
3. Update `WorkflowRunnerPage` layout
4. Implement auto-scroll to current interaction

### Phase 6: Polish (Day 5-6)
1. Loading states during history fetch
2. Error handling (retry fetch, fallback UI)
3. Smooth scroll animations
4. Responsive design adjustments
5. Testing with various workflow sizes

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
- `webui/src/lib/interaction-context.tsx` - Add `mode`, `response` to context
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

---

## 9. Success Criteria

1. ✅ User can scroll up and see all previous interactions in the session
2. ✅ Previous interactions show the user's selections/inputs in read-only mode
3. ✅ History persists after page reload
4. ✅ Current interaction is clearly visible and actionable
5. ✅ Page auto-scrolls to new interactions
6. ✅ Interactions are grouped by step with headers
7. ✅ Individual interactions can be collapsed
8. ✅ Works for workflows with 50+ interactions without noticeable lag
