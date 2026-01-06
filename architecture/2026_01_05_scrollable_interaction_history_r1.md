# Scrollable Interaction History - Architecture Document

**Feature:** Scrollable workflow session with persistent interaction history
**Date:** 2026-01-05
**Revision:** 1
**Status:** Draft - Awaiting Feedback

---

## 1. Problem Statement

### Current Behavior
- WebUI displays only the **current interaction** in `WorkflowRunnerPage`
- When a new interaction arrives, the previous one is replaced and disappears from view
- Users cannot scroll up to see what happened in previous steps
- `interactionHistory` array exists in Zustand store but is **not rendered anywhere**
- When user exits and rejoins the session, **no history is loaded** - they only see the pending interaction

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

### Non-Functional Requirements
1. **Performance**: Handle workflows with 50+ interactions without UI lag
2. **Memory**: Don't load full interaction data until needed (lazy loading consideration)
3. **Consistency**: History must match what actually happened (source of truth: server events)

---

## 3. Current Architecture Analysis

### WebUI State Management (`workflow-store.ts`)
```typescript
interface WorkflowExecutionState {
  currentInteraction: InteractionRequest | null;
  interactionHistory: InteractionRequest[];  // EXISTS but NOT USED in UI
}
```

**Actions:**
- `setCurrentInteraction(interaction)` - Replaces current
- `addToInteractionHistory(interaction)` - Appends to history array
- `reset()` - Clears everything including history

**Gap:** History only contains **requests**, not **responses**. No persistence across page reloads.

### Server Event Storage (`database_provider.py`)
All interactions are persisted in MongoDB `events` collection:

| Event Type | Data Stored |
|------------|-------------|
| `interaction_requested` | Full InteractionRequest (type, options, display_data, etc.) |
| `interaction_response` | Full response (value, selected_indices, selected_options, etc.) |

**Existing Endpoint:**
```
GET /workflow/{workflow_run_id}/events?event_type=interaction_requested
GET /workflow/{workflow_run_id}/events?event_type=interaction_response
```

**Gap:** No endpoint returns **paired** request+response objects for UI consumption.

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
  stepId: string;
  moduleName: string;
}
```

**Updated Store State:**
```typescript
interface WorkflowExecutionState {
  // Existing
  currentInteraction: InteractionRequest | null;

  // Updated - stores completed interactions with responses
  completedInteractions: CompletedInteraction[];

  // Remove or deprecate
  // interactionHistory: InteractionRequest[];  // No longer needed
}
```

### 4.2 Server API Changes

**New Endpoint:**
```
GET /workflow/{workflow_run_id}/interaction-history
```

**Response:**
```json
{
  "workflow_run_id": "wf_xxx",
  "interactions": [
    {
      "interaction_id": "int_001",
      "request": { /* full InteractionRequest */ },
      "response": { /* full InteractionResponseData */ },
      "timestamp": "2026-01-05T10:30:00Z",
      <!--is step_id same as the one sent from server for live interactions? because tui can only handle those types.-->
      "step_id": "user_input",
      "module_name": "Select Duration"
    },
    {
      "interaction_id": "int_002",
      "request": { /* ... */ },
      "response": { /* ... */ },
      "timestamp": "2026-01-05T10:32:00Z",
      "step_id": "user_input",
      "module_name": "Select Tones"
    }
  ],
  "pending_interaction": { /* InteractionRequest if awaiting input, else null */ }
}
```

**Implementation Location:** `server/api/workflow_api.py`

**Logic:**
1. Query all `interaction_requested` events for workflow
2. Query all `interaction_response` events for workflow
3. Pair them by `interaction_id` or by timestamp ordering
4. Return paired list + any pending (unpaired) interaction
<!--can you explain exactly how above is done? also did you verify that we can actually rebuild individual interactions this way? -->

### 4.3 WebUI Component Architecture

```
WorkflowRunnerPage
├── InteractionSessionContainer (new)
│   ├── CompletedInteractionsList (new, scrollable)
│   │   ├── CompletedInteractionCard (new, repeated)
│   │   │   └── ReadOnlyInteractionHost (new)
│   │   │       └── [Type-specific components in disabled mode]
│   │   └── ... more cards
│   │
│   └── CurrentInteractionSection
│       └── InteractionHost (existing)
│           └── [Type-specific components, active]
│
└── WorkflowSidebar (existing)
```

### 4.4 New Components

#### `CompletedInteractionCard`
- Renders a single completed interaction
- Shows: step name, module name, timestamp
- Contains `ReadOnlyInteractionHost` for the interaction content
- Collapsible to save space (optional)

#### `ReadOnlyInteractionHost`
- Same structure as `InteractionHost` but:
  - All inputs disabled
  - Shows user's response values instead of empty inputs
  - No action buttons (Continue, Retry, etc.)
  - Visual styling indicates "completed" state (dimmed, checkmark, etc.)
<!--why do we need ReadOnlyInteractionHost, cant we add readonly mode for InteractionHost? my reasoning being, current InteractionHost is somewhat complicated and handles most cases we need to be handled, if we write brand new component for this, we will have to handle every single logic in two places, which wont be easy. give me analysis on adding ready only mode for InteractionHost, and how can we load existing data to it-->

#### `CompletedInteractionsList`
- Scrollable container for all completed interactions
- Handles virtualization if list gets long (optional, for performance)
- Groups by step (optional visual enhancement)

### 4.5 Data Flow

**On Page Load / Reconnect:**
```
1. WorkflowRunnerPage mounts with workflow_run_id from URL
2. useWorkflowExecution hook calls:
   GET /workflow/{id}/interaction-history
3. Response populates:
   - completedInteractions[] from interactions array
   - currentInteraction from pending_interaction (if any)
4. Page renders full history + current interaction
5. Auto-scroll to current interaction
```

**On New Interaction Arrival (SSE):**
```
1. SSE "interaction" event arrives
2. Move currentInteraction to completedInteractions (if exists)
3. Set new currentInteraction
4. Scroll to new interaction
```

**On User Response:**
```
1. User submits response
2. Response sent to server
3. On success:
   - Create CompletedInteraction from current + response
   - Add to completedInteractions
   - Clear currentInteraction
   - Wait for next SSE event or completion
```

---

## 5. Implementation Plan

### Phase 1: Server API
1. Add `get_interaction_history()` method to `database_provider.py`
2. Add `/workflow/{id}/interaction-history` endpoint to `workflow_api.py`
3. Test endpoint returns correct paired data

### Phase 2: WebUI Store Updates
1. Update `workflow-store.ts`:
   - Add `CompletedInteraction` type
   - Replace `interactionHistory` with `completedInteractions`
   - Add actions: `setCompletedInteractions`, `addCompletedInteraction`
2. Update `useWorkflowExecution.ts`:
   - Fetch history on mount
   - Handle moving current to completed on response

### Phase 3: WebUI Components
1. Create `ReadOnlyInteractionHost` component
2. Create `CompletedInteractionCard` component
3. Create `CompletedInteractionsList` component
4. Update `WorkflowRunnerPage` layout

### Phase 4: Polish
1. Auto-scroll behavior
2. Visual styling for completed vs active
3. Loading states
4. Error handling

---

## 6. Open Questions

1. **Collapsible History?** Should completed interactions be collapsible to save vertical space?
<!--I think it should be expanded by default, but has ability collapse if user wants-->

2. **Grouping by Step?** Should we visually group interactions by step with headers?
<!--yeah, i think it'd be nice to have that.-->

3. **Response Display Format?** How to display user responses in read-only mode:
   - For selections: Show selected items highlighted
   - For text input: Show the entered text
   - For file input: Show filename that was uploaded
<!--all above should be same components user used to make selections, but in read-only mode.-->

4. **Performance Threshold?** At what interaction count should we implement virtualization?
<!--are you talking about on server or webui? for either, I need to have some data, not exact, but data based on some assumptions to make a call on it.-->

5. **History Depth Limit?** Should we limit how many interactions are loaded initially?
<!--we shouldnt, but implement it in a way that we can add limit on server side if needed. -->

6. **Branch Handling?** When user does retry/jump creating new branch, how to show branching history?
<!--good catch here, i was thinking about this and this i a way critical functionality to future changes i want to add to the server and webui. if we can plan ahead on this, it would be nice. give me propossal on how we can handle in thin ux side.-->

---

## 7. Alternatives Considered

### Alternative A: Client-Side Only (Rejected)
Store history only in Zustand, lose on page reload.
- **Rejected because:** Doesn't meet persistence requirement.

### Alternative B: Separate History Panel (Considered)
Show history in a collapsible sidebar instead of inline scroll.
- **Pro:** Cleaner separation
- **Con:** Requires switching context, less intuitive flow
- **Decision:** Defer, could be added later as option

### Alternative C: Timeline View (Considered)
Show history as a vertical timeline with nodes.
- **Pro:** Compact, good for many interactions
- **Con:** Loses ability to see full interaction details
- **Decision:** Could be combined with collapsible cards

---

## 8. Affected Files

### Server
- `server/api/workflow_api.py` - New endpoint
- `server/api/database_provider.py` - New query method

### WebUI
- `webui/src/lib/types.ts` - New types
- `webui/src/lib/workflow-store.ts` - Updated state
- `webui/src/hooks/useWorkflowExecution.ts` - Fetch history
- `webui/src/pages/WorkflowRunnerPage.tsx` - New layout
- `webui/src/components/workflow/interactions/ReadOnlyInteractionHost.tsx` - New
- `webui/src/components/workflow/history/CompletedInteractionCard.tsx` - New
- `webui/src/components/workflow/history/CompletedInteractionsList.tsx` - New
- `webui/src/lib/api.ts` - New API function

---

## 9. Success Criteria

1. User can scroll up and see all previous interactions in the session
2. Previous interactions show the user's selections/inputs in read-only mode
3. History persists after page reload
4. Current interaction is clearly visible and actionable
5. Page auto-scrolls to new interactions
6. Works for workflows with 20+ interactions without performance issues
