# Aesthetic Selection UX Improvement - Revision 11

## Summary of R10 Feedback

1. **priority_score questioned** - Pre-computed sum hides underlying priorities, loses context for debugging
2. **Version switch too simple** - Need to detect WHERE changes are (before/after current step) and warn user appropriately
3. **Sum-of-priorities concern** - Can hide issues and break things
4. **State compatibility** - Simple check is fine for now

---

## Part 1: Priority Storage - No Pre-computed Score

### The Concern

Storing `priority_score: 140` loses the context of where it came from. When debugging why a resolution was selected, you can't see the breakdown without re-computing.

### Solution: Store Only Individual Priorities

```javascript
// workflow_resolutions
{
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",
    resolved_workflow_version_id: "ver_flat_xxx",

    // Capabilities with priorities - source of truth
    requires: [
        { "capability": "user.form", "priority": 100 },
        { "capability": "user.text_input", "priority": 40 }
    ],

    // NO priority_score field - compute at query time

    selected_paths: {
        "aesthetic_pipeline": "webui_path",
        "params_pipeline": "tui_path"
    },

    created_at: ISODate()
}
```

### Query-Time Score Computation

```javascript
// In aggregation pipeline, compute score when needed
{
    $addFields: {
        matching_resolutions: {
            $map: {
                input: "$matching_resolutions",
                as: "res",
                in: {
                    $mergeObjects: [
                        "$$res",
                        {
                            computed_score: {
                                $reduce: {
                                    input: "$$res.requires",
                                    initialValue: 0,
                                    in: { $add: ["$$value", "$$this.priority"] }
                                }
                            }
                        }
                    ]
                }
            }
        }
    }
}
```

### Benefits

1. **Transparency**: Always see individual priorities
2. **Debuggability**: Can trace why score is what it is
3. **Flexibility**: Can change scoring formula without data migration
4. **Single source of truth**: `requires` array is the only priority data

### Trade-off

Slightly more complex query. But MongoDB handles this efficiently and the computation is trivial (summing a small array).

---

## Part 2: Alternative to Sum - Direct Priority Comparison

### The Concern

Sum-of-priorities can hide issues:
- Resolution A: `[{cap1, 100}, {cap2, 10}]` → sum = 110
- Resolution B: `[{cap1, 60}, {cap2, 60}]` → sum = 120

B wins, but A might be "more specialized" for cap1. Sum flattens this nuance.

### Alternative: Lexicographic Priority Comparison

Instead of summing, compare priorities in order of capability importance.

**Option 1: Sort by highest individual priority first**
```
Resolution A: priorities = [100, 10] → sort desc → [100, 10]
Resolution B: priorities = [60, 60] → sort desc → [60, 60]

Compare lexicographically:
[100, 10] vs [60, 60]
100 > 60 → A wins
```

**Option 2: Workflow-defined capability order**
Workflow author defines which capabilities are most important:
```json
{
  "capability_priority_order": ["user.form", "user.text_input"],
  "groups": [...]
}
```

Compare resolutions by priority of first capability, then second, etc.

### Recommendation: Keep Sum for Simplicity

For now, sum is simple and predictable. Workflow authors control values explicitly.

If issues arise, we can switch to lexicographic comparison later without schema changes (priorities are still stored individually).

---

## Part 3: Workflow Version Switch with Change Detection

### Requirements

When user resumes with new workflow version available:
1. Detect what changed between old and new version
2. If changes are **before** current step/module → warn user, let them decide
3. If changes are **only after** current step → proceed automatically

### Change Detection Logic

```python
def detect_workflow_changes(
    old_workflow: dict,
    new_workflow: dict,
    current_step_id: str,
    current_module_name: str
) -> dict:
    """
    Compare workflows and categorize changes relative to current position.

    Returns:
        {
            "changes_before_current": [...],  # Changes that affect past execution
            "changes_at_current": [...],      # Changes to current step/module
            "changes_after_current": [...],   # Changes that only affect future
            "can_proceed_safely": bool
        }
    """
    old_steps = {s["step_id"]: s for s in old_workflow["steps"]}
    new_steps = {s["step_id"]: s for s in new_workflow["steps"]}

    # Find current position in step order
    step_order = [s["step_id"] for s in new_workflow["steps"]]
    current_step_index = step_order.index(current_step_id) if current_step_id in step_order else -1

    changes_before = []
    changes_at = []
    changes_after = []

    for i, step_id in enumerate(step_order):
        old_step = old_steps.get(step_id)
        new_step = new_steps.get(step_id)

        step_changes = compare_steps(old_step, new_step, current_module_name if i == current_step_index else None)

        if step_changes:
            if i < current_step_index:
                changes_before.extend(step_changes)
            elif i == current_step_index:
                changes_at.extend(step_changes)
            else:
                changes_after.extend(step_changes)

    # Check for removed steps that were before current
    for step_id in old_steps:
        if step_id not in new_steps:
            old_index = [s["step_id"] for s in old_workflow["steps"]].index(step_id)
            if old_index < current_step_index:
                changes_before.append({
                    "type": "step_removed",
                    "step_id": step_id
                })

    return {
        "changes_before_current": changes_before,
        "changes_at_current": changes_at,
        "changes_after_current": changes_after,
        "can_proceed_safely": len(changes_before) == 0 and len(changes_at) == 0
    }


def compare_steps(old_step: dict, new_step: dict, current_module: str = None) -> list:
    """Compare two steps and return list of changes."""
    changes = []

    if old_step is None:
        changes.append({"type": "step_added", "step_id": new_step["step_id"]})
        return changes

    if new_step is None:
        changes.append({"type": "step_removed", "step_id": old_step["step_id"]})
        return changes

    # Compare modules
    old_modules = {m["name"]: m for m in old_step.get("modules", [])}
    new_modules = {m["name"]: m for m in new_step.get("modules", [])}

    for name in set(old_modules.keys()) | set(new_modules.keys()):
        old_mod = old_modules.get(name)
        new_mod = new_modules.get(name)

        if old_mod is None:
            changes.append({
                "type": "module_added",
                "step_id": new_step["step_id"],
                "module_name": name
            })
        elif new_mod is None:
            changes.append({
                "type": "module_removed",
                "step_id": old_step["step_id"],
                "module_name": name
            })
        elif old_mod != new_mod:
            changes.append({
                "type": "module_modified",
                "step_id": new_step["step_id"],
                "module_name": name
            })

    return changes
```

### Resume Flow with Change Detection

```python
async def resume_with_version_check(
    workflow_run_id: str,
    client_capabilities: list[str]
) -> dict:
    """Resume workflow, handling version changes appropriately."""

    run = await db.workflow_runs.find_one({"workflow_run_id": workflow_run_id})
    current_run_res = await db.workflow_run_resolutions.find_one({
        "workflow_run_id": workflow_run_id,
        "is_active": True
    })

    # Get current and latest workflows
    current_resolution = await load_resolution(current_run_res["workflow_resolution_id"])
    current_workflow = await load_workflow(current_resolution["resolved_workflow_version_id"])

    latest_source_id = await get_latest_source_version(run["workflow_template_id"])

    # Check if on latest version
    if current_run_res["source_workflow_version_id"] == latest_source_id:
        return {
            "action": "proceed",
            "workflow": current_workflow,
            "resolution": current_resolution
        }

    # New version available - find matching resolution
    new_resolution = await find_matching_resolution(latest_source_id, client_capabilities)
    if new_resolution is None:
        return {
            "action": "error",
            "error": "No matching resolution for new version"
        }

    new_workflow = await load_workflow(new_resolution["resolved_workflow_version_id"])

    # Detect changes
    changes = detect_workflow_changes(
        current_workflow,
        new_workflow,
        run["current_step"],
        run["current_module"]
    )

    if changes["can_proceed_safely"]:
        # Only future changes - switch automatically
        await switch_resolution(workflow_run_id, current_run_res, new_resolution, client_capabilities)
        return {
            "action": "proceed",
            "workflow": new_workflow,
            "resolution": new_resolution,
            "changes": changes["changes_after_current"]
        }
    else:
        # Past/current changes - need user decision
        return {
            "action": "confirm_required",
            "current_workflow": current_workflow,
            "new_workflow": new_workflow,
            "changes_before": changes["changes_before_current"],
            "changes_at": changes["changes_at_current"],
            "changes_after": changes["changes_after_current"],
            "message": "Workflow has been updated with changes to steps you've already completed. Continue with new version or stay on current?"
        }


async def confirm_version_switch(
    workflow_run_id: str,
    client_capabilities: list[str],
    user_choice: str  # "switch" or "keep_current"
) -> dict:
    """Handle user's decision on version switch."""

    if user_choice == "keep_current":
        # User wants to stay on current version
        current_run_res = await db.workflow_run_resolutions.find_one({
            "workflow_run_id": workflow_run_id,
            "is_active": True
        })
        current_resolution = await load_resolution(current_run_res["workflow_resolution_id"])
        current_workflow = await load_workflow(current_resolution["resolved_workflow_version_id"])

        return {
            "action": "proceed",
            "workflow": current_workflow,
            "resolution": current_resolution
        }

    elif user_choice == "switch":
        # User wants new version despite changes
        latest_source_id = await get_latest_source_version(
            (await db.workflow_runs.find_one({"workflow_run_id": workflow_run_id}))["workflow_template_id"]
        )
        new_resolution = await find_matching_resolution(latest_source_id, client_capabilities)
        new_workflow = await load_workflow(new_resolution["resolved_workflow_version_id"])

        current_run_res = await db.workflow_run_resolutions.find_one({
            "workflow_run_id": workflow_run_id,
            "is_active": True
        })

        await switch_resolution(workflow_run_id, current_run_res, new_resolution, client_capabilities)

        return {
            "action": "proceed",
            "workflow": new_workflow,
            "resolution": new_resolution
        }
```

### API Response for Confirmation Required

```json
{
  "status": "confirm_required",
  "message": "Workflow has been updated with changes to completed steps.",
  "changes": {
    "before_current": [
      {"type": "module_modified", "step_id": "user_input", "module_name": "select_aesthetics"}
    ],
    "at_current": [],
    "after_current": [
      {"type": "module_added", "step_id": "video_prompts", "module_name": "new_validator"}
    ]
  },
  "options": [
    {"value": "switch", "label": "Continue with new version"},
    {"value": "keep_current", "label": "Stay on current version"}
  ]
}
```

---

## Part 4: Unchanged Sections

Refer to previous revisions for:
- **Capabilities System** (R10 Part 1)
- **Group Matching Logic** (R10)
- **Upload Flow** (R8 Part 3)
- **Flattening Logic** (R9 Part 7)
- **user.form Module** (R9 Part 8)
- **io.validate Module** (R9 Part 9)

---

## Part 5: Updated Database Schema

### workflow_resolutions

```javascript
{
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",
    resolved_workflow_version_id: "ver_flat_xxx",

    // Capabilities with priorities - compute score at query time
    requires: [
        { "capability": "user.form", "priority": 100 },
        { "capability": "user.text_input", "priority": 40 }
    ],

    selected_paths: {
        "aesthetic_pipeline": "webui_path",
        "params_pipeline": "tui_path"
    },

    created_at: ISODate()
}
```

### workflow_run_resolutions

```javascript
{
    workflow_run_resolution_id: "runres_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",  // For version comparison
    client_capabilities: ["user.form", "user.select"],
    is_active: true,
    created_at: ISODate()
}
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| Priority storage | Individual priorities only, no pre-computed sum |
| Score computation | At query time via aggregation |
| Version switch detection | Compare workflows, categorize changes by position |
| Changes before current | Warn user, require confirmation |
| Changes after current | Proceed automatically |
| User choice | Can switch to new version or stay on current |

---

## Questions for Review

1. Is query-time score computation acceptable (vs. stored field)?
2. Is the change detection logic sufficient for determining safe vs. unsafe changes?
3. Should we provide more detail in the confirmation message (e.g., what specifically changed)?
