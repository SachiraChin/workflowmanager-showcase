# Workflow State Recovery Architecture

## Problem Statement

When a workflow execution is interrupted (server crash, connection loss, or error), the workflow can be left in an inconsistent state. The workflow document's `status` field may not match the actual state derived from the event log. This document catalogs all possible inconsistent states and proposes recovery mechanisms.

## Background

The workflow engine uses an **event sourcing architecture**:
- All state changes are stored as immutable events in the `events` collection
- The `workflow_runs` document has a `status` field that acts as a **cache** for quick queries
- The true state can always be reconstructed by replaying events

This design means:
- Event log is the **source of truth**
- Status field can become **stale** if crash occurs between event storage and status update
- Recovery should **derive status from events**, not trust the cached status field

## Recovery Principle

**We never delete data from workflow events.** When recovering from an inconsistent state, we always:
1. Find the **last stable event** in the current branch
2. Create a **new branch** with cutoff at that event
3. Continue execution from that point on the new branch

This preserves the full audit trail and allows debugging what went wrong.

---

## Workflow Statuses

```python
class WorkflowStatus(str, Enum):
    CREATED = "created"           # Initial state
    PROCESSING = "processing"     # Actively executing modules
    AWAITING_INPUT = "awaiting_input"  # Waiting for user interaction
    COMPLETED = "completed"       # Successfully finished
    ERROR = "error"              # Failed with error
```

---

## Catalog of Inconsistent States

### Category A: Status/Event Desynchronization (NEEDS RECOVERY)

#### A1: Status=AWAITING_INPUT but No Pending Interaction

**How it happens:**
1. Module requests interaction, stores `INTERACTION_REQUESTED` event
2. User responds, `INTERACTION_RESPONSE` event stored
3. Module continues, stores `MODULE_COMPLETED` event
4. Server crashes before updating status from `awaiting_input`

**Clarification:** The events are NOT corrupted. The issue is that the status field is stale - it still says `awaiting_input` but the event log shows the interaction was answered and module completed.

**Detection:**
```python
status == "awaiting_input" AND pending_interaction IS NULL
```

**Last Stable Event:** The latest `MODULE_COMPLETED` or `INTERACTION_RESPONSE` (whichever is last)

**Recovery:**
1. Find last stable event (the `MODULE_COMPLETED` after the response)
2. Create new branch with cutoff at that event
3. Continue execution from next module on new branch

---

#### A2: Status=PROCESSING but Actually Awaiting Input

**How it happens:**
1. Module starts executing, status set to `processing`
2. Module requests interaction, stores `INTERACTION_REQUESTED` event
3. Server crashes before updating status to `awaiting_input`

**Detection:**
```python
status == "processing" AND pending_interaction IS NOT NULL
```

**Last Stable Event:** The `MODULE_STARTED` event before the interaction request (the module that requested input didn't complete)

**Recovery:**
1. Create new branch with cutoff at `MODULE_STARTED` event
2. Re-execute the module from beginning (it will request interaction again)
3. Return the interaction to client

---

#### A3: Status=PROCESSING but All Steps Show Completed in Events

**How it happens:**
1. Last module completes, stores `MODULE_COMPLETED` event
2. Last step completes, stores `STEP_COMPLETED` event
3. Server crashes before updating status to `completed`

**Detection:**
```python
status == "processing" AND all_steps_in_definition IN completed_steps
```

**Last Stable Event:** The last `MODULE_COMPLETED` event

**Recovery:**
1. Create new branch with cutoff at last `MODULE_COMPLETED`
2. Re-execute from that module to verify completion
3. If it completes again, workflow is done

**Note:** We don't just mark as completed because the `WORKFLOW_COMPLETED` event was never stored. Re-executing ensures proper completion.

---

#### A4: Status=PROCESSING but Module Errored

**Status:** TECH DEBT - needs more investigation

**Reason:** Module errors can happen for many reasons (misconfiguration, API failure, etc.). Some are recoverable, some aren't. Need to investigate error types before deciding recovery strategy.

---

### Category B: Orphaned Interactions (NOT AN ISSUE)

#### B1: Interaction Requested Without Response (Normal Pending)

**Status:** NOT AN ISSUE

This is normal expected behavior. Workflow can stay in `awaiting_input` indefinitely until user responds.

---

#### B2: Stale Interaction (Timeout/Abandoned)

**Status:** NOT AN ISSUE

This is expected behavior. User can resume at any time in the future. No automatic timeout needed.

---

### Category C: Incomplete Module Execution (NOT AN ISSUE)

#### C1: Module Started but Not Completed

**Status:** NOT AN ISSUE

Normal resume behavior handles this. When workflow resumes, it re-executes from the incomplete module.

---

#### C2: Step Started but Not Completed

**Status:** NOT AN ISSUE

Normal resume behavior handles this. Continues from `current_module_index`.

---

### Category D: Branch/Jump Inconsistencies

#### D1: Orphaned Branch (Branch Created, No Jump Event)

**Status:** NOT AN ISSUE

Workflow always resumes from `current_branch_id`. Orphaned branches are harmless - they're just not referenced in any lineage.

---

#### D2: Jump Requested but Branch Not Active

**How it happens:**
1. User requests jump/retry
2. `JUMP_REQUESTED` event stored
3. Server crashes before updating `current_branch_id`

**Detection:**
```python
has_jump_requested_event AND
workflow.current_branch_id != jump_event.new_branch_id
```

**Last Stable Event:** The event BEFORE the `JUMP_REQUESTED` event

**Recovery:**
1. Create new branch with cutoff at event before jump request
2. Continue from that point on new branch
3. User can manually request jump again if needed

---

### Category E: Version Tracking Issues

#### E1: Missing Version ID

**Status:** NOT IMPLEMENTING NOW

Legacy workflows without version tracking are rare edge case.

---

#### E2: Version ID Points to Non-Existent Version

**Detection:**
```python
version_id IS NOT NULL AND
workflow_versions.find(version_id) IS NULL
```

**Recovery:**
1. Try `initial_workflow_version_id` as fallback
2. If that also fails, throw error - workflow is unrecoverable

---

### Category F: SSE/Streaming Issues

#### F1: Active Stream Without Active Execution

**Status:** TECH DEBT

Complex issue involving in-memory state. Needs more investigation.

---

#### F2: Execution Running Without Stream

**Status:** NOT AN ISSUE

Server continues execution even if client disconnects. Events are stored correctly. Client will see correct state on reconnect. If server creates corrupted state, recovery mechanisms above will handle it.

---

## Last Stable Event Definition

The "last stable event" is the most recent event after which:
1. The module that produced it completed successfully
2. Any interaction requested was fully responded to
3. The workflow was in a consistent state

**Event Priority (from most stable to least):**

| Event Type | Stable? | Notes |
|------------|---------|-------|
| `STEP_COMPLETED` | Yes | Step fully done |
| `MODULE_COMPLETED` | Yes | Module fully done |
| `INTERACTION_RESPONSE` | Yes | User responded, module can continue |
| `INTERACTION_REQUESTED` | No | Waiting for response |
| `MODULE_STARTED` | No | Module may not complete |
| `STEP_STARTED` | No | Step may not complete |

**Finding Last Stable Event:**

```python
def find_last_stable_event(events: List[Event]) -> Event:
    """Find the last stable event in the event list."""

    for event in reversed(events):
        event_type = event.get("event_type")

        if event_type in ["step_completed", "module_completed"]:
            return event

        if event_type == "interaction_response":
            # Check if there's a subsequent MODULE_COMPLETED for this module
            # If yes, use that. If no, this response is the stable point.
            return event

    # No stable event found - workflow never progressed
    return None
```

---

## Recovery Algorithm

```python
def recover_workflow(workflow_run_id: str) -> RecoveryResult:
    """
    Detect and recover from inconsistent workflow states.

    Returns:
        RecoveryResult with new_branch_id if recovery was needed,
        or None if workflow is consistent.
    """

    # 1. Get current state
    workflow = db.get_workflow(workflow_run_id)
    cached_status = workflow.get("status")

    # 2. Derive true state from events
    position = db.get_workflow_position(workflow_run_id)
    pending_interaction = position.get("pending_interaction")

    # 3. Detect inconsistencies
    needs_recovery = False
    recovery_reason = None

    # A1: AWAITING_INPUT but no pending
    if cached_status == "awaiting_input" and not pending_interaction:
        needs_recovery = True
        recovery_reason = "A1: Status awaiting_input but no pending interaction"

    # A2: PROCESSING but has pending
    elif cached_status == "processing" and pending_interaction:
        needs_recovery = True
        recovery_reason = "A2: Status processing but has pending interaction"

    # A3: PROCESSING but all steps completed
    elif cached_status == "processing":
        completed_steps = position.get("completed_steps", [])
        workflow_def = get_workflow_definition(workflow_run_id)
        all_steps = [s["step_id"] for s in workflow_def.get("steps", [])]
        if set(all_steps) <= set(completed_steps):
            needs_recovery = True
            recovery_reason = "A3: Status processing but all steps completed"

    # D2: Jump requested but branch not active
    # (Check if there's a JUMP_REQUESTED event for a branch that's not current)
    # ... (complex check omitted for brevity)

    if not needs_recovery:
        return RecoveryResult(needed=False)

    # 4. Find last stable event
    events = db.get_lineage_events(workflow_run_id)
    last_stable = find_last_stable_event(events)

    if not last_stable:
        return RecoveryResult(
            needed=True,
            error="No stable event found - workflow may need manual intervention"
        )

    # 5. Create recovery branch
    current_branch = workflow.get("current_branch_id")
    new_branch_id = db.create_branch(
        workflow_run_id=workflow_run_id,
        parent_branch_id=current_branch,
        cutoff_event_id=last_stable["event_id"]
    )

    # 6. Update workflow to use new branch
    db.workflow_runs.update_one(
        {"workflow_run_id": workflow_run_id},
        {"$set": {
            "current_branch_id": new_branch_id,
            "status": "processing"  # Reset to processing, execution will set correct status
        }}
    )

    # 7. Store recovery event for audit
    db.store_event(
        workflow_run_id=workflow_run_id,
        event_type="workflow_recovered",
        data={
            "reason": recovery_reason,
            "previous_branch": current_branch,
            "new_branch": new_branch_id,
            "cutoff_event": last_stable["event_id"]
        }
    )

    logger.info(
        f"Recovered workflow {workflow_run_id}: {recovery_reason}. "
        f"Created branch {new_branch_id} from event {last_stable['event_id']}"
    )

    return RecoveryResult(
        needed=True,
        new_branch_id=new_branch_id,
        reason=recovery_reason
    )
```

---

## When to Trigger Recovery

Recovery should be checked:

1. **On Resume** - When client calls `/resume` endpoint
2. **On Startup** - Server can scan for stale workflows (optional)

```python
@router.post("/{workflow_run_id}/resume")
async def resume_workflow(workflow_run_id: str, ...):
    # Check for recovery before normal resume logic
    recovery = recover_workflow(workflow_run_id)

    if recovery.needed:
        if recovery.error:
            raise HTTPException(500, recovery.error)
        logger.info(f"Applied recovery: {recovery.reason}")

    # Continue with normal resume...
```

---

## Summary Table

| State | Category | Action | Priority |
|-------|----------|--------|----------|
| AWAITING_INPUT + no pending | A1 | New branch from last MODULE_COMPLETED | HIGH |
| PROCESSING + has pending | A2 | New branch from MODULE_STARTED, re-request interaction | HIGH |
| PROCESSING + all completed | A3 | New branch from last MODULE_COMPLETED, re-verify | HIGH |
| PROCESSING + has error | A4 | TECH DEBT | - |
| Normal pending interaction | B1 | Not an issue | - |
| Stale interaction | B2 | Not an issue | - |
| Module incomplete | C1 | Not an issue (handled by resume) | - |
| Step incomplete | C2 | Not an issue (handled by resume) | - |
| Orphaned branch | D1 | Not an issue | - |
| Jump not activated | D2 | New branch before jump, user can retry | MEDIUM |
| Missing version | E1 | Not implementing | - |
| Invalid version | E2 | Fallback to initial, else error | LOW |
| Stream without execution | F1 | TECH DEBT | - |
| Execution without stream | F2 | Not an issue | - |

---

## Implementation Priority

1. **HIGH**: A1, A2, A3 - Status/Event desync recovery with new branch
2. **MEDIUM**: D2 - Jump not activated recovery
3. **LOW**: E2 - Version fallback
4. **TECH DEBT**: A4 (module error investigation), F1 (stream cleanup)
