# Aesthetic Selection UX Improvement - Revision 10

## Summary of R9 Feedback

1. **Arbitrary priority values rejected** - Don't like implicit priority from group order. Want declarative priority values on capabilities.
2. **Option A (keep original) rejected** - User uploads workflow and resumes = they want the new workflow
3. **Option B restart rejected** - User must be able to resume with new workflow, not restart
4. **Deduplication** - Re-evaluate with declarative approach

---

## Part 1: Declarative Priority System

### The Problem (Recap)

WebUI capabilities are superset of TUI. When checking `requires ⊆ client_capabilities`, WebUI matches both webui_path and tui_path resolutions. Need to pick the right one.

### Solution: Explicit Priority on Capabilities

Each capability in `requires` has an explicit priority value. Sum of priorities determines which resolution wins.

### Group Definition Format

```json
{
  "module_id": "pipeline.execution_groups",
  "name": "aesthetic_selection_pipeline",
  "groups": [
    {
      "name": "webui_path",
      "requires": [
        { "capability": "user.form", "priority": 100 }
      ],
      "modules": [...]
    },
    {
      "name": "tui_path",
      "requires": [
        { "capability": "user.text_input", "priority": 50 }
      ],
      "modules": [...]
    }
  ]
}
```

### How Priority Scoring Works

1. **Filter**: Only consider resolutions where ALL required capabilities are present in client
2. **Score**: Sum priority values of all required capabilities
3. **Select**: Pick resolution with **highest** score

### Example: Single Group

```
Workflow:
  webui_path: requires = [{user.form, 100}]
  tui_path: requires = [{user.text_input, 50}]

Generated resolutions:
  res_webui: requires = [{user.form, 100}], score = 100
  res_tui: requires = [{user.text_input, 50}], score = 50

Client: TUI (capabilities: [user.text_input, user.select, ...])
  - res_webui: SKIP (missing user.form)
  - res_tui: score = 50 ✓
  → Use res_tui

Client: WebUI (capabilities: [user.form, user.text_input, user.select, ...])
  - res_webui: score = 100 ✓
  - res_tui: score = 50 ✓
  → Use res_webui (higher score)
```

### Example: Multiple Groups

```
Group 1 (aesthetic):
  webui_path: requires = [{user.form, 100}]
  tui_path: requires = [{user.text_input, 50}]

Group 2 (params):
  webui_path: requires = [{user.form, 80}]
  tui_path: requires = [{user.text_input, 40}]

Generated resolutions (4 combinations):
  (g1=webui, g2=webui): requires = [{user.form, 100}, {user.form, 80}], score = 180
  (g1=webui, g2=tui):   requires = [{user.form, 100}, {user.text_input, 40}], score = 140
  (g1=tui, g2=webui):   requires = [{user.text_input, 50}, {user.form, 80}], score = 130
  (g1=tui, g2=tui):     requires = [{user.text_input, 50}, {user.text_input, 40}], score = 90

Client: WebUI (has all capabilities)
  - All 4 match
  - Scores: 180, 140, 130, 90
  → Use (g1=webui, g2=webui) with score 180

Client: TUI (only has user.text_input)
  - Only (g1=tui, g2=tui) matches
  → Use (g1=tui, g2=tui) with score 90
```

### Key Insight: Declarative Priorities Solve Deduplication

With explicit priorities from each group, combinations naturally have different scores:
- (webui, tui): 100 + 40 = 140
- (tui, webui): 50 + 80 = 130

Different scores → no ambiguity → no deduplication needed.

**Workflow author controls priority** by setting values. Higher value = more preferred when matched.

---

## Part 2: Priority Guidelines for Workflow Authors

### Recommended Priority Ranges

| Client Type | Priority Range | Example |
|-------------|---------------|---------|
| Advanced WebUI features | 100-199 | `user.advanced_form`: 150 |
| Standard WebUI features | 50-99 | `user.form`: 80 |
| TUI features | 1-49 | `user.text_input`: 30 |
| Fallback/universal | 0 | `user.select`: 0 |

### Example: Three-Tier Groups

```json
{
  "groups": [
    {
      "name": "webui_advanced",
      "requires": [
        { "capability": "user.form", "priority": 100 },
        { "capability": "user.advanced_chart", "priority": 50 }
      ]
    },
    {
      "name": "webui_basic",
      "requires": [
        { "capability": "user.form", "priority": 80 }
      ]
    },
    {
      "name": "tui",
      "requires": [
        { "capability": "user.text_input", "priority": 30 }
      ]
    }
  ]
}
```

Scoring:
- webui_advanced: 100 + 50 = 150 (only if client has both)
- webui_basic: 80
- tui: 30

Client with `[user.form, user.text_input]` (no advanced_chart):
- webui_advanced: SKIP (missing user.advanced_chart)
- webui_basic: 80 ✓
- tui: 30 ✓
→ Use webui_basic

---

## Part 3: Database Schema Updates

### workflow_resolutions (Updated)

```javascript
{
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",
    resolved_workflow_version_id: "ver_flat_xxx",

    // Capabilities required with their priorities
    requires: [
        { "capability": "user.form", "priority": 100 },
        { "capability": "user.text_input", "priority": 40 }
    ],

    // Pre-computed score (sum of priorities)
    // For efficient sorting in queries
    <!--can you explain value of this? this number doesnt have
        any meaning without where it came form is it not? 
        correct me if i'm missing something. -->
    priority_score: 140,

    // Track which path was selected for each group
    selected_paths: {
        "aesthetic_pipeline": "webui_path",
        "params_pipeline": "tui_path"
    },

    created_at: ISODate()
}
```

### Indexes

```javascript
db.workflow_resolutions.createIndex({
    workflow_template_id: 1,
    source_workflow_version_id: 1,
    priority_score: -1  // Descending for picking highest
})
```

---

## Part 4: Workflow Start Flow (Updated)

### Single Aggregation Query

```javascript
const result = await db.workflow_templates.aggregate([
    // Stage 1: Find template
    { $match: { user_id: user_id, workflow_template_name: name } },

    // Stage 2: Get resolutions
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
            latest_source_version_id: {
                $arrayElemAt: ["$resolutions.source_workflow_version_id", 0]
            }
        }
    },

    // Stage 4: Filter to latest source version
    {
        $addFields: {
            resolutions: {
                $filter: {
                    input: "$resolutions",
                    cond: {
                        $eq: ["$$this.source_workflow_version_id", "$latest_source_version_id"]
                    }
                }
            }
        }
    },

    // Stage 5: Filter by capabilities
    // Check that ALL required capabilities are in client_capabilities
    {
        $addFields: {
            matching_resolutions: {
                $filter: {
                    input: "$resolutions",
                    cond: {
                        $setIsSubset: [
                            { $map: { input: "$$this.requires", as: "r", in: "$$r.capability" } },
                            client_capabilities
                        ]
                    }
                }
            }
        }
    },

    // Stage 6: Sort by priority_score DESC and pick first (highest score)
    {
        $addFields: {
            matching_resolutions: {
                $sortArray: {
                    input: "$matching_resolutions",
                    sortBy: { priority_score: -1 }
                }
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

    // Stage 8: Project
    {
        $project: {
            workflow_template_id: 1,
            workflow_template_name: 1,
            resolution: 1,
            resolved_workflow: { $arrayElemAt: ["$resolved_version.resolved_workflow", 0] }
        }
    }
]).toArray();
```

---

## Part 5: Workflow Update Mid-Run (Resume with New Version)

### Requirements

- User uploads new workflow version
- User resumes existing run
- Run should use NEW workflow version
- State should be preserved where possible

### Approach: Resolution Switch on Resume

When user resumes and new version is available:

1. **Detect new version**: Compare `workflow_run_resolution.source_workflow_version_id` with latest `source_workflow_version_id` for template
2. **Find matching resolution**: Using client capabilities against new version's resolutions
3. **Create new run_resolution**: Link run to new resolution, mark as active
4. **Continue execution**: From current step with existing state

<!--I dont think its this simple. we need tooling set in place to make sure user can
    resume without any issue. I think logic should be
    - if updated module/step before the current step/module on, we can clearly show message to
        user saying, you have made changes to previous steps/modules of workflow, whether they 
        want to continue. if user know that their change doesnt impact overall process of the workflow,
        they can continue, otherwise user can cancel to stay in current workflow version
    - if edited workflow step/module is after curent step of the process, they can simply proceed
        as there is not impact-->

### Database: workflow_run_resolutions

```javascript
{
    workflow_run_resolution_id: "runres_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    workflow_resolution_id: "res_xxxxxxxxxxxx",

    // Source version at time of this resolution
    source_workflow_version_id: "ver_raw_xxx",

    client_capabilities: ["user.form", "user.select"],

    // When this resolution was created/switched to
    created_at: ISODate(),

    // Is this the current active resolution?
    is_active: true
}

// Unique constraint: one active resolution per run
db.workflow_run_resolutions.createIndex(
    { workflow_run_id: 1, is_active: 1 },
    { unique: true, partialFilterExpression: { is_active: true } }
)
```

### Resume Flow with Version Check

```python
async def get_resolution_for_resume(
    workflow_run_id: str,
    client_capabilities: list[str]
) -> dict:
    """Get resolution for resume, switching to new version if available."""

    # Get current run and active resolution
    run = await db.workflow_runs.find_one({"workflow_run_id": workflow_run_id})
    current_run_res = await db.workflow_run_resolutions.find_one({
        "workflow_run_id": workflow_run_id,
        "is_active": True
    })

    # Get latest source version for this template
    latest_resolution = await db.workflow_resolutions.find_one(
        {"workflow_template_id": run["workflow_template_id"]},
        sort=[("created_at", -1)]
    )
    latest_source_id = latest_resolution["source_workflow_version_id"]

    # Check if we're on latest version
    if current_run_res["source_workflow_version_id"] == latest_source_id:
        # Already on latest, return current resolution
        return await load_resolution(current_run_res["workflow_resolution_id"])

    # New version available - find matching resolution
    new_resolution = await find_matching_resolution(
        latest_source_id,
        client_capabilities
    )

    if new_resolution is None:
        raise NoMatchingResolutionError(
            f"New version has no resolution matching capabilities: {client_capabilities}"
        )

    # Switch to new resolution
    await db.workflow_run_resolutions.update_one(
        {"workflow_run_resolution_id": current_run_res["workflow_run_resolution_id"]},
        {"$set": {"is_active": False}}
    )

    await db.workflow_run_resolutions.insert_one({
        "workflow_run_resolution_id": generate_id(),
        "workflow_run_id": workflow_run_id,
        "workflow_resolution_id": new_resolution["workflow_resolution_id"],
        "source_workflow_version_id": latest_source_id,
        "client_capabilities": client_capabilities,
        "is_active": True,
        "created_at": datetime.utcnow()
    })

    return new_resolution
```

### State Compatibility

When switching to new version, state from previous execution should still work IF:
- Module names match
- State keys match
- Module types are compatible

If new version has different modules or state structure:
- Execution continues from current step
- Modules already completed keep their state
- New modules execute fresh
- Removed modules' state is orphaned (kept but unused)

---

## Part 6: Unchanged Sections

The following sections are unchanged from R9. Refer to R9 for details:

- **Part 7: Flattening Logic**
- **Part 8: Generic `user.form` Module**
- **Part 9: Validation with `io.validate` Module**
- **Part 10: Complete Example**

---

## Part 7: Updated Summary

| Aspect | Decision |
|--------|----------|
| Priority system | Declarative - explicit priority value on each capability |
| Priority calculation | Sum of all required capabilities' priorities |
| Resolution selection | Pick highest score (not lowest) |
| Multiple matches | Highest score wins, no error |
| Workflow update mid-run | Switch to new resolution on resume |
| State on version switch | Preserved, continue from current step |
| Deduplication | Not needed - declarative priorities create unique scores |

---

## Part 8: requires Format

### Old Format (R9 and earlier)
```json
"requires": ["user.form", "user.text_input"]
```

### New Format (R10)
```json
"requires": [
    { "capability": "user.form", "priority": 100 },
    { "capability": "user.text_input", "priority": 40 }
]
```

### Migration

Workflows using old format need migration. Could support both during transition:
```python
def normalize_requires(requires: list) -> list[dict]:
    """Convert old string format to new object format."""
    result = []
    for item in requires:
        if isinstance(item, str):
            # Old format: assign default priority
            result.append({"capability": item, "priority": 50})
        else:
            # New format
            result.append(item)
    return result
```

---

## Questions for Review

1. Is sum-of-priorities the right scoring method, or should we consider other formulas?
<!--i am not convinced on that. it hides underlying priorities and it can simply break things.-->
2. Is automatic version switch on resume acceptable, or should we prompt user?
3. What should happen if new version removes a step the run is currently in?
<!--above 2, added comment on that section-->
4. Should we validate state compatibility before switching versions?
<!--for now we can have simple check as i said above, we can make it afvanced later if needed.-->
