# Aesthetic Selection UX Improvement - Revision 9

## Summary of R8 Feedback

1. **WebUI matches both resolutions** - WebUI has `user.form` AND `user.text_input`, so it matches both webui and tui resolutions. Need priority-based selection, not error.
2. **Workflow upload mid-run** - `workflow_run_resolutions` CAN be edited when workflow is updated mid-run. Need to clarify.
3. **Deduplication of capability sets** - Different path combinations can produce same `requires` set (e.g., webui+tui vs tui+webui). Need deduplication logic.

---

## Part 1: Resolution Priority System

### The Problem

WebUI capabilities are a SUPERSET of TUI capabilities:
```python
TUI_CAPABILITIES = {"user.text_input", "user.select", "transform.parse_pattern", ...}
WEBUI_CAPABILITIES = TUI_CAPABILITIES | {"user.form"}  # Superset
```

When we check `requires ⊆ client_capabilities`:
- Resolution with `requires=["user.form"]` → matches WebUI ✓
- Resolution with `requires=["user.text_input"]` → ALSO matches WebUI ✓

WebUI matches BOTH resolutions. We can't error because this is expected behavior.

### Solution: Priority-Based Selection

Each resolution gets a `priority` value. When multiple resolutions match, we pick the one with **lowest priority** (most preferred).

Priority is determined by **group order** in the workflow definition. Groups listed first are more preferred.

<!--
I dont like generating arbitrary values like this, I feel like these are confusing at best, break things 
at worst, but I like the idea of priority, so we will make more declartive like below
 {
  "groups": [
    { "name": "webui_path", "requires": [{"capability": "user.form", "priority": 16}], ... },      // Index 0
    { "name": "tui_path", "requires": [{"capability": "user.text_input", "priority": 8}], ... }   // Index 1
  ]
}   

In this way, capabilities have value and we take sum of all which match the capabilities in workflow,
then pick highest value. 
-->

### How Priority Works

For single execution_groups:
```json
{
  "groups": [
    { "name": "webui_path", "requires": ["user.form"], ... },      // Index 0
    { "name": "tui_path", "requires": ["user.text_input"], ... }   // Index 1
  ]
}
```

Generated resolutions:
- `res_webui`: requires=["user.form"], **priority=0**
- `res_tui`: requires=["user.text_input"], **priority=1**

At start time:
- TUI matches only `res_tui` → use it
- WebUI matches both → pick `res_webui` (priority=0 < priority=1)

### Priority for Multiple Groups

For multiple execution_groups, priority is the **tuple of selected path indices**.

Example: 2 groups, each with 2 paths:
```
Group 1: [webui_path (0), tui_path (1)]
Group 2: [webui_path (0), tui_path (1)]
```

Combinations and priorities:
| Combination | Path Indices | Priority (tuple) | Priority (numeric) |
|-------------|--------------|------------------|-------------------|
| (webui, webui) | (0, 0) | (0, 0) | 0 |
| (webui, tui) | (0, 1) | (0, 1) | 1 |
| (tui, webui) | (1, 0) | (1, 0) | 2 |
| (tui, tui) | (1, 1) | (1, 1) | 3 |

For numeric comparison, convert tuple to single number:
```python
def priority_to_number(indices: list[int], group_sizes: list[int]) -> int:
    """Convert path indices to single priority number.

    Like converting multi-digit number where each digit has different base.
    """
    result = 0
    multiplier = 1
    for i in reversed(range(len(indices))):
        result += indices[i] * multiplier
        multiplier *= group_sizes[i]
    return result
```

Or simpler: just store as tuple and compare lexicographically in MongoDB.

---

## Part 2: Updated Database Schema

### workflow_resolutions (Updated)

```javascript
{
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",
    resolved_workflow_version_id: "ver_flat_xxx",

    // Capabilities required to use this resolution
    requires: ["user.form"],

    // Priority for selection when multiple resolutions match
    // Lower = more preferred. Based on group order in workflow definition.
    priority: 0,

    // Track which path was selected for each execution_groups module
    selected_paths: {
        "aesthetic_selection_pipeline": "webui_path"
    },

    // Path indices (for debugging/audit)
    path_indices: [0],  // Index of selected path in each group

    created_at: ISODate()
}
```

### workflow_run_resolutions (Updated)

```javascript
{
    workflow_run_resolution_id: "runres_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    workflow_resolution_id: "res_xxxxxxxxxxxx",

    // Capabilities the client declared when this resolution was selected
    client_capabilities: ["user.form", "user.select"],

    // Is this the active resolution? (for workflow update scenarios)
    is_active: true,

    created_at: ISODate()
}

// Index for finding active resolution for a run
db.workflow_run_resolutions.createIndex(
    { workflow_run_id: 1, is_active: 1 }
)
```

---

## Part 3: Deduplication of Capability Sets

### The Problem

Different path combinations can produce the same `requires` set:

```
(webui, tui): requires = {"user.form"} ∪ {"user.text_input"} = {"user.form", "user.text_input"}
(tui, webui): requires = {"user.text_input"} ∪ {"user.form"} = {"user.form", "user.text_input"}
```

Same capability set, but different flattened workflows (module order differs).

### Solution: Keep Both, Different Priorities

We don't deduplicate based on `requires` alone. Each combination produces a unique resolution with unique priority.

<!--this is one place where arbitrary values make things messier, with my proposal above with declaritive values
can we make this simpler or it will still be same.-->

When client capabilities match both:
- (webui, tui) has priority (0, 1) = 1
- (tui, webui) has priority (1, 0) = 2

Client gets resolution with lowest priority.

### What About Truly Duplicate Requires?

If two combinations have SAME requires AND SAME priority, that's a workflow design issue (shouldn't happen with distinct group indices).

At upload time, we can detect and warn:
```python
def check_resolution_conflicts(resolutions):
    """Warn if multiple resolutions have same requires + priority."""
    seen = {}
    for res in resolutions:
        key = (frozenset(res["requires"]), res["priority"])
        if key in seen:
            logger.warning(f"Duplicate resolution: {res} conflicts with {seen[key]}")
        seen[key] = res
```

---

## Part 4: Upload Flow (Updated)

```
User uploads workflow JSON
    |
    v
Server parses workflow, creates RAW workflow_version
    |
    v
Server scans for pipeline.execution_groups modules
    |
    v
If NO execution_groups:
    - Create single resolution with requires=[], priority=0
    - Done
    |
    v
If execution_groups found:
    - Collect all groups: [(group1_paths), (group2_paths), ...]
    - Generate all combinations using itertools.product
    |
    v
For each combination (path_indices):
    1. Flatten workflow (inline selected paths)
    2. Compute requires = union of all selected paths' requires
    3. Compute priority from path_indices
    4. Create workflow_version for flattened workflow
    5. Create workflow_resolution with requires, priority, path_indices
```

### Example: 2 Groups × 2 Paths

```python
groups = [
    {"name": "g1", "paths": [
        {"name": "webui", "requires": ["user.form"]},
        {"name": "tui", "requires": ["user.text_input"]}
    ]},
    {"name": "g2", "paths": [
        {"name": "webui", "requires": ["user.form"]},
        {"name": "tui", "requires": ["user.text_input"]}
    ]}
]

# Generate combinations
combinations = list(itertools.product(range(2), range(2)))
# [(0,0), (0,1), (1,0), (1,1)]

# For each combination:
# (0,0): requires=["user.form"], priority=0
# (0,1): requires=["user.form", "user.text_input"], priority=1
# (1,0): requires=["user.form", "user.text_input"], priority=2
# (1,1): requires=["user.text_input"], priority=3
```

Result:
- 5 workflow_versions (1 raw + 4 flattened)
- 4 workflow_resolutions

---

## Part 5: Workflow Start Flow (Updated)

### Single Aggregation Query

```javascript
const result = await db.workflow_templates.aggregate([
    // Stage 1: Find template
    { $match: { user_id: user_id, workflow_template_name: name } },

    // Stage 2: Get resolutions for this template
    {
        $lookup: {
            from: "workflow_resolutions",
            let: { template_id: "$workflow_template_id" },
            pipeline: [
                { $match: { $expr: { $eq: ["$workflow_template_id", "$$template_id"] } } },
                { $sort: { created_at: -1 } }
            ],
            as: "resolutions"
        }
    },

    // Stage 3: Get latest source version
    {
        $addFields: {
            latest_source_version_id: { $arrayElemAt: ["$resolutions.source_workflow_version_id", 0] }
        }
    },

    // Stage 4: Filter to latest source version only
    {
        $addFields: {
            resolutions: {
                $filter: {
                    input: "$resolutions",
                    cond: { $eq: ["$$this.source_workflow_version_id", "$latest_source_version_id"] }
                }
            }
        }
    },

    // Stage 5: Filter by capabilities (requires ⊆ client_capabilities)
    {
        $addFields: {
            matching_resolutions: {
                $filter: {
                    input: "$resolutions",
                    cond: { $setIsSubset: ["$$this.requires", client_capabilities] }
                }
            }
        }
    },

    // Stage 6: Sort by priority and pick first (lowest priority = most preferred)
    {
        $addFields: {
            matching_resolutions: {
                $sortArray: { input: "$matching_resolutions", sortBy: { priority: 1 } }
            },
            resolution: { $arrayElemAt: ["$matching_resolutions", 0] }
        }
    },

    // Stage 7: Lookup resolved workflow
    {
        $lookup: {
            from: "workflow_versions",
            localField: "resolution.resolved_workflow_version_id",
            foreignField: "workflow_version_id",
            as: "resolved_version"
        }
    },

    // Stage 8: Project final result
    {
        $project: {
            workflow_template_id: 1,
            workflow_template_name: 1,
            match_count: { $size: "$matching_resolutions" },
            resolution: 1,
            resolved_workflow: { $arrayElemAt: ["$resolved_version.resolved_workflow", 0] }
        }
    }
]).toArray();

// Validate
if (result.length === 0) throw new TemplateNotFoundError(name);
if (!result[0].resolution) throw new NoMatchingResolutionError(client_capabilities);

// result[0].resolution is the best matching resolution
// result[0].resolved_workflow is the flattened workflow
```

### Key Change from R8

**Before (R8)**: Error if multiple resolutions match
**After (R9)**: Pick resolution with lowest priority

---

## Part 6: Workflow Update Mid-Run

### Scenario

1. User starts workflow run with resolution A
2. User uploads new workflow version while run is active
3. User resumes workflow

### Behavior

**Option A: Keep Original Resolution (Simpler)**
<!--this is no go, user upload a workflow and resume means they want the uploaded
workflow in resume, this is not an option-->
- Resume always uses the resolution locked at start
- New workflow version doesn't affect existing runs
- User must restart to use new version

**Option B: Allow Resolution Update (More Flexible)**
- On resume, detect if new version is available
- Prompt user: "New version available. Continue with current or restart?"
- If user chooses new version:
<!--this is no go again, user must be able to resume with new workflow. -->
  - Create new workflow_run_resolution with `is_active=true`
  - Set old workflow_run_resolution to `is_active=false`
  - Execution restarts from affected step

### Recommended: Option A for Now

Keep it simple. Existing runs continue with their original resolution. Users who want the new version can start a new run.

```python
def get_resolution_for_resume(workflow_run_id: str):
    """Get resolution for resume - always uses original, ignores new versions."""
    run_resolution = db.workflow_run_resolutions.find_one({
        "workflow_run_id": workflow_run_id,
        "is_active": True
    })
    return run_resolution["workflow_resolution_id"]
```

### Future Enhancement: Option B

Add `current_workflow_version_id` check on resume:
```python
def check_for_workflow_update(run_resolution, template_id):
    """Check if newer version is available."""
    current_source = run_resolution["resolution"]["source_workflow_version_id"]
    latest = get_latest_source_version(template_id)

    if latest != current_source:
        return {
            "update_available": True,
            "current_version": current_source,
            "latest_version": latest
        }
    return {"update_available": False}
```

---

## Part 7: Resume Flow (Unchanged)

```javascript
// Single aggregation: workflow_run_resolutions -> workflow_resolutions -> workflow_versions
const result = await db.workflow_run_resolutions.aggregate([
    { $match: { workflow_run_id: workflow_run_id, is_active: true } },

    {
        $lookup: {
            from: "workflow_resolutions",
            localField: "workflow_resolution_id",
            foreignField: "workflow_resolution_id",
            as: "resolution"
        }
    },
    { $unwind: "$resolution" },

    {
        $lookup: {
            from: "workflow_versions",
            localField: "resolution.resolved_workflow_version_id",
            foreignField: "workflow_version_id",
            as: "resolved_version"
        }
    },
    { $unwind: "$resolved_version" },

    {
        $project: {
            workflow_run_id: 1,
            resolution: 1,
            resolved_workflow: "$resolved_version.resolved_workflow"
        }
    }
]).toArray();
```

---

## Part 8: Capability Design Guidelines

### For Workflow Authors

<!--update based on original comment about capability handling. -->
To ensure correct resolution selection:

1. **More specific groups first**: Put groups with more specific requirements first
   ```json
   {
     "groups": [
       { "name": "webui_advanced", "requires": ["user.form", "user.fancy_chart"] },
       { "name": "webui_basic", "requires": ["user.form"] },
       { "name": "tui", "requires": ["user.text_input"] }
     ]
   }
   ```

2. **Use distinguishing capabilities**: If two groups should be mutually exclusive, add distinguishing capabilities
   ```json
   {
     "groups": [
       { "name": "webui", "requires": ["client.webui"] },  // Only WebUI declares this
       { "name": "tui", "requires": ["client.tui"] }       // Only TUI declares this
     ]
   }
   ```

3. **Avoid overlapping requires**: If group A's requires is subset of group B's, put A first (higher priority)

### For Client Developers

1. **Declare accurate capabilities**: Only declare modules the client can actually render
2. **Add client identifier**: Consider adding `client.webui` or `client.tui` capability
3. **Superset is fine**: It's OK if WebUI capabilities are superset of TUI's - priority handles it

---

## Part 9: Updated Examples

### Single Group, 2 Paths

```
Workflow:
  execution_groups "aesthetic":
    - webui_path (requires: ["user.form"])       index=0
    - tui_path (requires: ["user.text_input"])   index=1

Resolutions:
  res_1: requires=["user.form"], priority=0
  res_2: requires=["user.text_input"], priority=1

Client Selection:
  TUI  (caps: ["user.text_input"]):     matches res_2 only → use res_2
  WebUI (caps: ["user.form", "user.text_input"]): matches both → use res_1 (lower priority)
```

### Two Groups, 2 Paths Each

```
Workflow:
  execution_groups "aesthetic":
    - webui (requires: ["user.form"])      index=0
    - tui (requires: ["user.text_input"])  index=1
  execution_groups "params":
    - webui (requires: ["user.form"])      index=0
    - tui (requires: ["user.text_input"])  index=1

Resolutions:
  res_1: path_indices=[0,0], requires=["user.form"], priority=0
  res_2: path_indices=[0,1], requires=["user.form","user.text_input"], priority=1
  res_3: path_indices=[1,0], requires=["user.form","user.text_input"], priority=2
  res_4: path_indices=[1,1], requires=["user.text_input"], priority=3

Client Selection:
  TUI:   matches res_4 only → use res_4
  WebUI: matches res_1, res_2, res_3, res_4 → use res_1 (priority=0)
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| Multiple matches | Pick lowest priority (not error) |
| Priority source | Group order in workflow definition |
| Priority for multiple groups | Tuple of path indices, converted to number |
| Deduplication | Not needed - different priorities distinguish same-requires resolutions |
| Workflow update mid-run | Keep original resolution (Option A) |
| Resume with is_active | Filter by `is_active: true` |

---

## Questions for Review

1. Is priority-based selection the right approach for multiple matches?
2. Should we add explicit `client.webui` / `client.tui` capabilities, or rely on priority?
3. Is Option A (keep original on update) acceptable, or do we need Option B?
4. Any concerns with the priority calculation for multiple groups?
