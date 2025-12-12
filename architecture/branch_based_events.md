# Branch-Based Event Architecture

## Overview

This document describes the branch-based event architecture for workflow execution. The design solves the problem of state management when users jump back to earlier points in a workflow, ensuring that downstream state is properly invalidated without deleting historical events.

## Core Concepts

### Branch

A branch represents a linear sequence of events within a workflow. When a user jumps back to re-run a module, a new branch is created that forks from a specific point in the parent branch.

**Analogy:** Similar to git branches, but simpler - branches only fork, never merge.

### Event

An immutable record of something that happened during workflow execution. Events are never deleted or modified.

### Parent Event ID

When a branch is created, it stores a reference to the last event from the parent branch that should be included in state reconstruction. All events after this point on the parent branch are ignored for the new branch.

## Collections

### workflows

```json
{
  "workflow_id": "wf_{uuid}",
  "project_path": "/path/to/project",
  "workflow_path": "/path/to/workflow.json",
  "ai_config_path": "/path/to/ai_config.json",
  "current_branch_id": "br_{uuid_v7}",
  "status": "processing|awaiting_input|completed|error",
  "created_at": timestamp,
  "updated_at": timestamp
}
```

### branches

```json
{
  "branch_id": "br_{uuid_v7}",
  "workflow_id": "wf_{uuid}",
  "parent_branch_id": "br_{uuid_v7}" | null,
  "parent_event_id": "evt_{uuid_v7}" | null,
  "created_at": timestamp
}
```

- Root branch has `parent_branch_id = null` and `parent_event_id = null`
- `branch_id` uses UUID v7 for time-sortability (newer branches have lexicographically larger IDs)

### events

```json
{
  "event_id": "evt_{uuid_v7}",
  "workflow_id": "wf_{uuid}",
  "branch_id": "br_{uuid_v7}",
  "event_type": "STEP_STARTED|STEP_COMPLETED|MODULE_COMPLETED|MODULE_ERROR|INTERACTION_REQUESTED|INTERACTION_RESPONSE",
  "step_id": "step_1",
  "module_name": "select_concept",
  "data": { ... },
  "timestamp": timestamp
}
```

- `event_id` uses UUID v7 for time-sortability
- Events are immutable - never deleted or modified

### Indexes

```
events:
  - (workflow_id, branch_id, event_id)  # Primary query path
  - (workflow_id, event_type)            # For specific event lookups

branches:
  - (workflow_id, branch_id)
  - (parent_branch_id)                   # For lineage queries
```

## Operations

### 1. Start Workflow

```python
def start_workflow(project_path, workflow_path, ai_config_path):
    # 1. Create workflow document
    workflow_id = f"wf_{uuid4()}"

    # 2. Create root branch
    branch_id = f"br_{uuid7()}"
    db.branches.insert_one({
        "branch_id": branch_id,
        "workflow_id": workflow_id,
        "parent_branch_id": None,
        "parent_event_id": None,
        "created_at": now()
    })

    # 3. Create workflow with current_branch_id
    db.workflows.insert_one({
        "workflow_id": workflow_id,
        "project_path": project_path,
        "workflow_path": workflow_path,
        "ai_config_path": ai_config_path,
        "current_branch_id": branch_id,
        "status": "processing",
        "created_at": now(),
        "updated_at": now()
    })

    return workflow_id, branch_id
```

### 2. Normal Execution (including Retry)

Retry stays on the same branch. The new MODULE_COMPLETED event overwrites the previous one during state reconstruction (last event per module wins).

```python
def execute_module(workflow_id, branch_id, step_id, module_name, outputs):
    # Store event on current branch
    event_id = f"evt_{uuid7()}"
    db.events.insert_one({
        "event_id": event_id,
        "workflow_id": workflow_id,
        "branch_id": branch_id,
        "event_type": "MODULE_COMPLETED",
        "step_id": step_id,
        "module_name": module_name,
        "data": outputs,
        "timestamp": now()
    })
```

### 3. Jump Back

Jump creates a new branch forking from the event just before the target module.

**"Jump to module_X" means:**
- Re-run module_X from its start
- Keep all state up to (but not including) module_X's first event
- Discard module_X and everything after it

```python
def jump_to_module(workflow_id, target_step, target_module):
    workflow = db.workflows.find_one({"workflow_id": workflow_id})
    current_branch_id = workflow["current_branch_id"]

    # 1. Find the first event of target module in current branch lineage
    #    (Need to search across lineage, not just current branch)
    state_events = get_lineage_events(workflow_id, current_branch_id)

    first_target_event = None
    for event in state_events:
        if event["step_id"] == target_step and event["module_name"] == target_module:
            first_target_event = event
            break

    if not first_target_event:
        raise ValueError(f"Module {target_step}/{target_module} not found in branch lineage")

    # 2. Find the last event BEFORE the target module
    parent_event = None
    for event in state_events:
        if event["event_id"] >= first_target_event["event_id"]:
            break
        parent_event = event

    # 3. Determine which branch the parent event belongs to
    parent_branch_id = parent_event["branch_id"] if parent_event else current_branch_id
    parent_event_id = parent_event["event_id"] if parent_event else None

    # 4. Create new branch
    new_branch_id = f"br_{uuid7()}"
    db.branches.insert_one({
        "branch_id": new_branch_id,
        "workflow_id": workflow_id,
        "parent_branch_id": parent_branch_id,
        "parent_event_id": parent_event_id,
        "created_at": now()
    })

    # 5. Update workflow's current branch (atomic)
    db.workflows.update_one(
        {"workflow_id": workflow_id},
        {"$set": {
            "current_branch_id": new_branch_id,
            "updated_at": now()
        }}
    )

    return new_branch_id
```

### 4. Get Branch Lineage

Returns list of branches from root to current, with their cutoff points.

```python
def get_branch_lineage(workflow_id, branch_id):
    """Returns [(branch_id, cutoff_event_id), ...] from root to current"""
    lineage = []

    branch = db.branches.find_one({"branch_id": branch_id})
    while branch:
        lineage.append(branch)
        if branch["parent_branch_id"]:
            branch = db.branches.find_one({"branch_id": branch["parent_branch_id"]})
        else:
            branch = None

    lineage.reverse()  # Root first

    # Build cutoffs: each branch's cutoff is the NEXT branch's parent_event_id
    result = []
    for i, branch in enumerate(lineage):
        if i < len(lineage) - 1:
            cutoff = lineage[i + 1]["parent_event_id"]
        else:
            cutoff = None  # Current branch has no cutoff
        result.append((branch["branch_id"], cutoff))

    return result
```

### 5. Get Lineage Events

Returns all events in the branch lineage, respecting cutoffs.

```python
def get_lineage_events(workflow_id, branch_id):
    """Returns all events from root to current branch, respecting cutoffs"""
    lineage = get_branch_lineage(workflow_id, branch_id)

    all_events = []
    for branch_id, cutoff_event_id in lineage:
        query = {
            "workflow_id": workflow_id,
            "branch_id": branch_id
        }
        if cutoff_event_id:
            query["event_id"] = {"$lte": cutoff_event_id}

        events = list(db.events.find(query).sort("event_id", ASCENDING))
        all_events.extend(events)

    return all_events
```

### 6. Reconstruct State

```python
def get_state(workflow_id, branch_id):
    """Reconstruct current state from branch lineage events"""
    events = get_lineage_events(workflow_id, branch_id)

    state = {}
    for event in events:
        if event["event_type"] == "MODULE_COMPLETED":
            # Apply state mappings
            state_mapped = event.get("data", {}).get("_state_mapped", {})
            for key, value in state_mapped.items():
                state[key] = value

    return state
```

### 7. Get Current Position

```python
def get_position(workflow_id, branch_id):
    """Determine where execution should resume"""
    events = get_lineage_events(workflow_id, branch_id)

    # Find last MODULE_COMPLETED
    last_completed = None
    for event in reversed(events):
        if event["event_type"] == "MODULE_COMPLETED":
            last_completed = event
            break

    if not last_completed:
        return {"step_id": None, "module_name": None, "resume_from": "start"}

    # Check for pending interaction
    last_interaction_req = None
    last_interaction_resp = None
    for event in reversed(events):
        if event["event_type"] == "INTERACTION_REQUESTED" and not last_interaction_req:
            last_interaction_req = event
        if event["event_type"] == "INTERACTION_RESPONSE" and not last_interaction_resp:
            last_interaction_resp = event

    has_pending_interaction = (
        last_interaction_req and
        (not last_interaction_resp or
         last_interaction_resp["event_id"] < last_interaction_req["event_id"])
    )

    return {
        "step_id": last_completed["step_id"],
        "module_name": last_completed["module_name"],
        "has_pending_interaction": has_pending_interaction,
        "pending_interaction": last_interaction_req["data"] if has_pending_interaction else None
    }
```

## Visual Example

### Initial Run

```
Branch: br_001 (root)

evt_001: step_1/user_input       → MODULE_COMPLETED
evt_002: step_1/aesthetic_api    → MODULE_COMPLETED (concepts generated)
evt_003: step_1/select_concept   → INTERACTION_REQUESTED
evt_004: step_1/select_concept   → INTERACTION_RESPONSE (picked option 2)
evt_005: step_1/select_concept   → MODULE_COMPLETED (selected_concept = option 2)
evt_006: step_1/scene_expansion  → MODULE_COMPLETED (scene for option 2)
evt_007: step_2/generate_prompts → MODULE_COMPLETED (prompts based on scene)
evt_008: step_2/review_prompts   → INTERACTION_REQUESTED (user sees prompts)
```

### User Jumps Back to select_concept

User wants to pick a different concept (option 5 instead of option 2).

```
New Branch: br_002
  parent_branch_id: br_001
  parent_event_id: evt_002  (last event BEFORE select_concept)

Branch br_002 events:
evt_009: step_1/select_concept   → INTERACTION_REQUESTED
evt_010: step_1/select_concept   → INTERACTION_RESPONSE (picked option 5)
evt_011: step_1/select_concept   → MODULE_COMPLETED (selected_concept = option 5)
evt_012: step_1/scene_expansion  → MODULE_COMPLETED (NEW scene for option 5)
evt_013: step_2/generate_prompts → MODULE_COMPLETED (NEW prompts)
evt_014: step_2/review_prompts   → INTERACTION_REQUESTED
```

### State Reconstruction for br_002

Lineage: [(br_001, cutoff=evt_002), (br_002, cutoff=None)]

Events included:
- From br_001: evt_001, evt_002 (concepts exist)
- From br_002: evt_009 through evt_014

State after reconstruction:
- `user_input` from evt_001
- `aesthetic_concepts` from evt_002
- `selected_concept` = option 5 (from evt_011, NOT option 2)
- `scene_summary` for option 5 (from evt_012)
- `generated_prompts` based on option 5 (from evt_013)

### User Jumps Back Again to aesthetic_api

User wants completely new concepts.

```
New Branch: br_003
  parent_branch_id: br_002
  parent_event_id: evt_001  (last event BEFORE aesthetic_api, which was on br_001)

Note: parent_event_id points to br_001's event, but parent_branch_id is br_002
      because that's where the jump was initiated from.

Actually, let me reconsider...
```

**Correction:** The parent_branch_id should be the branch that CONTAINS the parent_event_id, not the branch we're jumping from. Otherwise lineage traversal breaks.

```
New Branch: br_003
  parent_branch_id: br_001  (branch containing evt_001)
  parent_event_id: evt_001

Branch br_003 events:
evt_015: step_1/aesthetic_api    → MODULE_COMPLETED (NEW concepts)
evt_016: step_1/select_concept   → INTERACTION_REQUESTED
...
```

State reconstruction for br_003:
- Lineage: [(br_001, cutoff=evt_001), (br_003, cutoff=None)]
- From br_001: only evt_001
- From br_003: evt_015 onwards

This correctly discards br_002 entirely since we jumped to a point before br_002 forked.

## Key Invariants

1. **Events are immutable** - never deleted or modified
2. **Branches only fork, never merge** - tree structure, not DAG
3. **parent_branch_id = branch containing parent_event_id** - ensures correct lineage
4. **Last event wins** - if same module completes multiple times on a branch, last one is used
5. **UUID v7 for IDs** - time-sortable, no timestamp comparison issues

## Migration Notes

To migrate from current architecture:

1. Add `branch_id` field to existing events (set to a generated root branch ID)
2. Create `branches` collection with one root branch per workflow
3. Add `current_branch_id` to workflows collection
4. Update `get_module_outputs()` to use `get_state()` with branch lineage
5. Update jump/retry logic to create branches appropriately
