# Aesthetic Selection UX Improvement - Revision 4

## Summary of R3 Feedback

1. **Option A (Runtime)**: No go - event handling risks
2. **Option B (Meta/Flatten)**: Preferred, but needs storage strategy clarification
3. **Option C**: Extension of B, not separate option
4. **Tag matching**: Need explicit matching, not "most specific" auto-selection
5. **Schema**: Rename `input_fields` → `input`
6. **Transform module**: No go - form must output compatible format directly
7. **Cross-client resume**: Start new branch before group if client changes mid-execution
8. **State indexing**: Concern about index mismatch between different flattened workflows
9. **Validation**: Runtime only (can't validate at load when flattened)
10. **Nested groups**: No
11. **Default group**: No, everything explicit

---

## Part 1: Execution Groups - Storage Strategy

### Question: When to Flatten?

| Strategy | Flatten At | Store |
|----------|------------|-------|
| A | Upload time | Multiple versions per client type in DB |
| B | Workflow start | Flattened version in workflow_run record |
| C | Every load | Nothing stored, always compute |

### Strategy A: Flatten at Upload (Pre-computed)

<!--I like the idea, but i dont think execution is incorrect. 

First of all, I think using term tags will lead to more confusion. instead we will
use capabilities, field name will be "requires" and containing list of capabilites. 
when client make a api call, or start the workflow, it will send list of capabilities. 
by default, we will have base list of capabilities, and the forms will be an another 
capability. the capabilities are measured in  reverse order where we will check if 
client's capabilites list contains "requires" capabilities of workflow. in this way,
when module doesnt have "requires" means it simply work by default. in this case,
we can have "basic" capability for tui use case, and for webui, it will be "rich" and 
"user.form". the tags in "requires" must contain in client capability list for it
to match.

there no way to two two parallel versions of same workflow in versions table, 
at least in current form of that table. if we go this path, we will need multiple 
changes to database to make it work.

    update table:
        workflow_versions:
            parent_workflow_version_id
        workflow_runs
            del initial_workflow_version_id
            del current_workflow_version_id
    new table:
        workflow_resolutions:
            workflow_resolutions_id
            parent_workflow_version_id (nullable) <-- the raw workflow json
            resolved_workflow_version_id
            requires <-- capabilities from workflow json
        workflow_run_resolutions: <-- workflow can have mutiple resolutions, but they will be created only when workflow run started with tags which are not already there
            workflow_run_id
            workflow_resolutions_id 
            created_date <-- we always read latest
            capabilities <-- from client

idea here is, when user upload a new workflow, will will read through the workflow and create 
all flattened workflows, one thing to note here that when flattening workflows, we will create all 
alternatives, for example, lets say workflow has 2 pipeline.execution_groups uses, 1st have 2 groups,
2nd has 3 groups, we will generate total of 6 flattened workflows, add them to workflow_versions, for
each created, we will create new entry in workflow_resolution with flattened version is, real version id,
and merged tags for each. 

at start of the workflow execution, we create the workflow run, pick correct resolution for requested run,
create an entry in workflow_run_resolution, and proceed.

there are few questions still there though,
- how are we going to add new capabilities of client, are we going to create new resolution or maintain current. 
    I feel like "capabilities" of workflow_run_resolusion should contains union of 2 rather than whole list.
    but i dont like the fact that clients gets to say what capability names are, i think for now, we can keep
    list of capabilities which will validated against ones sent by client.
- how we going to do the filtering on workflow_run_resolutions table? are we going to cross check capabilities 
    every time? doesnt feel right

Lets expand on this more in next rev as i like this path.

Note: I am not fixated on table names, columns, etc. Feel feel to change them as need on your proposals.
-->


```
Workflow Upload
    ↓
For each possible tag combination:
    → Generate flattened version
    → Store as separate workflow_version record
    ↓
DB contains:
    - workflow_version_id: "abc-webui"
    - workflow_version_id: "abc-tui"
```

**Pros:**
- Fast workflow start (no computation)
- Clear versioning per client
- Easy to inspect stored versions

**Cons:**
- Combinatorial explosion if many tag combinations
- Must re-upload workflow to update any path
- Storage overhead

### Strategy B: Flatten at Workflow Start (Per-Run)

```
Client starts workflow with tags ["webui"]
    ↓
Server loads original workflow_version
    ↓
Server flattens based on tags
    ↓
Store flattened_workflow in workflow_run record
    ↓
All subsequent operations use stored flattened version
```

**Database Schema Change:**
```sql
ALTER TABLE workflow_runs ADD COLUMN flattened_workflow JSONB;
ALTER TABLE workflow_runs ADD COLUMN execution_tags TEXT[];
```

**Pros:**
- Original workflow preserved in workflow_versions
- Flattened version tied to specific run
- Resume uses same flattened version (no recomputation)
- No storage explosion

**Cons:**
- Slightly slower first load (flatten computation)
- Larger workflow_run records

### Strategy C: Flatten Every Load (Computed)


```
Every workflow load (start or resume)
    ↓
Server loads original workflow_version
    ↓
Server flattens based on current client tags
    ↓
Send to client (not stored)
```

**Pros:**
- Simplest storage
- Always uses current client tags

**Cons:**
- Resume with different client = different workflow = state mismatch
- No record of what was actually executed
- Can't reproduce exact execution

### Recommendation: Strategy B

Flatten once at workflow start, store in workflow_run. This gives:
- Reproducibility (know exactly what was executed)
- Consistent resume (same workflow regardless of client)
- Original workflow preserved for reference

---

## Part 2: State Panel / Debugging

### Problem

When workflow is flattened, client doesn't know which modules came from which group. The state panel shows:
```
step: user_input
  ├─ module: select_aesthetics_form     ← Where did this come from?
  ├─ module: some_other_module
```

### Solution: Group Metadata in Flattened Workflow

Add `_group_origin` metadata to each inlined module:

<!--I like this, but i need this expanded to proposal I wrote earlier.-->

```json
{
  "steps": [
    {
      "step_id": "user_input",
      "modules": [
        {
          "module_id": "user.form",
          "name": "select_aesthetics_form",
          "_group_origin": {
            "group_name": "aesthetic_selection_pipeline",
            "path_name": "webui_path",
            "tags": ["webui"],
            "original_index": 0
          }
        },
        {
          "module_id": "some.other_module",
          "name": "uses_aesthetic_selections"
          // No _group_origin = not from a group
        }
      ]
    }
  ]
}
```

### State Panel Display

```
step: user_input
  ├─ [webui_path] select_aesthetics_form     ← Shows group origin
  ├─ uses_aesthetic_selections
```

Or with expandable group info:
```
step: user_input
  ├─ ▸ aesthetic_selection_pipeline (webui_path)
  │     └─ select_aesthetics_form
  ├─ uses_aesthetic_selections
```

---

## Part 3: Explicit Tag Matching

### Problem with "Most Specific" Matching

Current algorithm picks group with most matching tags. This can cause unexpected selection:

```
Groups: ["tui"], ["webui"], ["webui", "debug"]
Client tags: ["webui", "something_else"]

Current: Picks ["webui"] (partial match)
Risk: What if client has ["webui", "debug", "extra"]? Picks ["webui", "debug"]
```

### Solution: Exact Tag Matching

<!--I dicussed this on proposal above, lets expand on that.-->

Require exact match - group tags must equal a subset of client tags, and be explicitly marked as the target.

**Option 1: Priority-based explicit matching**

```json
{
  "groups": [
    { "name": "tui_path", "match": { "tags": ["tui"], "priority": 1 } },
    { "name": "webui_path", "match": { "tags": ["webui"], "priority": 1 } },
    { "name": "webui_debug", "match": { "tags": ["webui", "debug"], "priority": 2 } }
  ]
}
```

Matching:
1. Filter groups where ALL group tags are in client tags
2. Among matches, pick highest priority
3. If tie, error (ambiguous)

**Option 2: First-match ordering**

```json
{
  "groups": [
    { "name": "webui_debug", "match": ["webui", "debug"] },  // Check first
    { "name": "webui_path", "match": ["webui"] },            // Check second
    { "name": "tui_path", "match": ["tui"] }                 // Check third
  ]
}
```

First group whose tags are all present wins. Order in JSON defines priority.

**Option 3: Explicit client-to-group mapping**

```json
{
  "group_selection": {
    "webui": "webui_path",
    "tui": "tui_path",
    "webui+debug": "webui_debug"
  },
  "groups": [...]
}
```

Direct mapping, no algorithm. Client tag string maps to group name.

### Recommendation: Option 2 (First-match ordering)

Simple, explicit, no hidden algorithm. Workflow author controls priority through ordering.

```python
def select_group(groups, client_tags):
    """Select first group whose tags are all in client_tags."""
    for group in groups:
        group_tags = set(group["match"])
        if group_tags.issubset(set(client_tags)):
            return group
    raise NoMatchingGroupError(client_tags)
```

---

## Part 4: Form Output Format

### Requirement

<!--I simply reject on basis how you approached this. What you did wrong
- you assumed that output in the same format of `transform.parse_pattern`, this is wrong, the module should be 
able to output anything, if module cannot return what we need, we will transform result from module to create
format we need. to think that module retuns this format is no-go from the start
- biggest thing which i reject was the fact the logic of the form has workflow spcific data, we just added critical
issue i saw in code to fix and just an hour later, you suggest me same thing. calude.md contains clearly that 
you can do this, but you do this anyways. 

so, rejected, do better.
-->
 
`user.form` must output in the same format as `transform.parse_pattern` to maintain compatibility. No separate transform module.

### Current parse_pattern Output (from module #7857)

```json
{
  "aesthetic_selections": [
    {
      "index": 1,
      "mode": "with_person",
      "count": 2,
      "aesthetic": { "id": "futuristic", "label": "Futuristic", ... },
      "with_count": 2,
      "without_count": 0
    }
  ]
}
```

### Form Module Configuration

```json
{
  "module_id": "user.form",
  "inputs": {
    "groups": [{
      "id": "aesthetics",
      "type": "per_item",
      "data": { "$ref": "core_aesthetics.json" },
      "schema": { ... }
    }],
    "output_transform": {
      "type": "aesthetic_selections",
      "mode_mapping": {
        "q": { "mode": "without_person", "with_count": 0, "without_count": "$count" },
        "w": { "mode": "with_person", "with_count": "$count", "without_count": 0 },
        "e": { "mode": "either", "with_count": "$count", "without_count": "$count" }
      },
      "include_item_as": "aesthetic",
      "include_index": true
    }
  },
  "outputs_to_state": {
    "result": "aesthetic_selections"
  }
}
```

### Server Processing

```python
class FormModule:
    def process_response(self, response, inputs):
        raw_result = response["result"]

        output_transform = inputs.get("output_transform")
        if output_transform and output_transform["type"] == "aesthetic_selections":
            return self._transform_to_aesthetic_selections(raw_result, output_transform)

        return {"result": raw_result}

    def _transform_to_aesthetic_selections(self, raw, config):
        selections = []
        mode_mapping = config["mode_mapping"]

        for group_id, items in raw.items():
            for item in items:
                if item.get("count", 0) == 0:
                    continue  # Server-side filtering

                mode_key = item.get("mode", "e")
                mode_config = mode_mapping[mode_key]

                selection = {
                    "index": item["_index"],
                    "mode": mode_config["mode"],
                    "count": item["count"],
                    "aesthetic": item["_item"],
                    "with_count": self._resolve_count(mode_config["with_count"], item),
                    "without_count": self._resolve_count(mode_config["without_count"], item),
                }
                selections.append(selection)

        return {"result": selections}

    def _resolve_count(self, value, item):
        if value == "$count":
            return item["count"]
        return value
```

---

## Part 5: State Index Mismatch

### Problem

When different clients flatten the same workflow differently, module indices don't match:

```
WebUI flattened:                    TUI flattened:
step: user_input                    step: user_input
  [0] user.form                       [0] user.text_input
  [1] some.other_module               [1] transform.parse_pattern
                                      [2] some.other_module
```

If state is keyed by `(step_id, module_index)`, TUI and WebUI have different meanings for the same index.

### Solution: Use Module Name, Not Index

<!--I agree to this, but I feel like this is still error prone as these are user provided data. I thoght
to store hash of steps and modules, but that also can break things later when user update workflow. is there
other ways to approach this? -->

State should be keyed by `(step_id, module_name)` not `(step_id, module_index)`.

**Current (problematic):**
```json
{
  "_module_states": {
    "user_input": {
      "0": { "status": "completed", "outputs": {...} },
      "1": { "status": "pending" }
    }
  }
}
```

**Proposed:**
```json
{
  "_module_states": {
    "user_input": {
      "select_aesthetics_form": { "status": "completed", "outputs": {...} },
      "uses_aesthetic_selections": { "status": "pending" }
    }
  }
}
```

### Impact Assessment

Need to verify:
1. Where is module index used for state lookup?
2. Can we switch to module name without breaking existing runs?
3. Are module names guaranteed unique within a step?

---

## Part 6: Runtime Validation

### Problem

With flattened workflow, `output_schema` from execution_groups is lost. How to validate that all paths produce compatible output?

### Solution: Preserve output_schema in Metadata

When flattening, preserve the group's `output_schema` as metadata on the last module of the inlined sequence:

```json
{
  "module_id": "user.form",
  "name": "select_aesthetics_form",
  "_group_origin": {
    "group_name": "aesthetic_selection_pipeline",
    "path_name": "webui_path",
    "output_schema": {
      "type": "object",
      "required": ["aesthetic_selections"],
      "properties": {...}
    },
    "is_group_exit": true  // This is the last module in the group
  }
}
```

Server validates output against `output_schema` when module marked with `is_group_exit` completes.

<!--rather than doing this, may be transformer can add create new module called io.validate, when we flatten worklow
we will add this module at end of group to validate data. this module is global, and the pipeline.exec_groups 
can add it to end of group. just to note, flattening also has to be part of pipeline.exec_groups module. in this way
its more deterministic, and we can clearly define how validation work on io.validate-->

---

## Part 7: Schema with `input` Field

Renamed from `input_fields` per feedback.

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "display": true,
    "properties": {
      "label": { "type": "string", "display": true },
      "description": { "type": "string", "display": true }
    },
    "input": [
      { "key": "count", "type": "number", "min": 0, "max": 10, "default": 0 },
      { "key": "mode", "type": "select", "options": [
        { "value": "q", "label": "Without" },
        { "value": "w", "label": "With" },
        { "value": "e", "label": "Either" }
      ], "default": "e" }
    ]
  }
}
```

---

## Complete Example: Aesthetic Selection

### Workflow Definition

```json
{
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "pipeline.execution_groups",
        "name": "aesthetic_selection_pipeline",
        "groups": [
          {
            "name": "tui_path",
            "match": ["tui"],
            "modules": [
              {
                "module_id": "user.text_input",
                "name": "get_aesthetic_selection",
                "inputs": { "prompt": "Enter selections:" },
                "outputs_to_state": { "value": "raw_aesthetic_input" }
              },
              {
                "module_id": "transform.parse_pattern",
                "name": "parse_aesthetic_selection",
                "inputs": { "input": "{{ state.raw_aesthetic_input }}" },
                "outputs_to_state": { "parsed": "aesthetic_selections" }
              }
            ]
          },
          {
            "name": "webui_path",
            "match": ["webui"],
            "modules": [
              {
                "module_id": "user.form",
                "name": "select_aesthetics_form",
                "inputs": {
                  "groups": [{
                    "id": "aesthetics",
                    "type": "per_item",
                    "data": { "$ref": "core_aesthetics.json" },
                    "schema": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "display": true,
                        "properties": {
                          "label": { "type": "string", "display": true }
                        },
                        "input": [
                          { "key": "count", "type": "number", "min": 0, "max": 10, "default": 0 },
                          { "key": "mode", "type": "select", "options": ["q", "w", "e"], "default": "e" }
                        ]
                      }
                    }
                  }],
                  "output_transform": {
                    "type": "aesthetic_selections",
                    "mode_mapping": {
                      "q": { "mode": "without_person", "with_count": 0, "without_count": "$count" },
                      "w": { "mode": "with_person", "with_count": "$count", "without_count": 0 },
                      "e": { "mode": "either", "with_count": "$count", "without_count": "$count" }
                    },
                    "include_item_as": "aesthetic",
                    "include_index": true
                  }
                },
                "outputs_to_state": { "result": "aesthetic_selections" }
              }
            ]
          }
        ],
        "output_schema": {
          "required": ["aesthetic_selections"],
          "properties": {
            "aesthetic_selections": { "type": "array" }
          }
        }
      },
      {
        "module_id": "some.other_module",
        "name": "next_module"
      }
    ]
  }]
}
```

### Flattened for WebUI

```json
{
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "user.form",
        "name": "select_aesthetics_form",
        "inputs": { ... },
        "outputs_to_state": { "result": "aesthetic_selections" },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path",
          "output_schema": { ... },
          "is_group_exit": true
        }
      },
      {
        "module_id": "some.other_module",
        "name": "next_module"
      }
    ]
  }]
}
```

---

## Open Questions Resolved

| Question | Resolution |
|----------|------------|
| Storage | Strategy B: Flatten at workflow start, store in workflow_run |
| Debugging | Add `_group_origin` metadata to flattened modules |
| Tag matching | First-match ordering (explicit, no algorithm) |
| Transform module | No - form outputs compatible format via `output_transform` |
| State indexing | Use `(step_id, module_name)` instead of index |
| Validation | Preserve `output_schema` in `_group_origin.output_schema` |
| Cross-client resume | Uses stored flattened workflow (same as original run) |

---

## Implementation Plan

1. **Database**: Add `flattened_workflow`, `execution_tags` columns to workflow_runs
2. **Workflow Loader**: Implement flatten logic with `_group_origin` metadata
3. **Tag Matching**: First-match algorithm
4. **State Management**: Refactor to use module_name instead of index (if needed)
5. **user.form Module**: Implement with `output_transform` support
6. **Schema Extension**: Add `input` field support to schema processing
7. **Validation**: Add output_schema validation at group exit
8. **State Panel**: Update to show `_group_origin` info

---

## Questions for Review

1. Is Strategy B (flatten at start, store in run) acceptable?
2. Is first-match ordering explicit enough for tag matching?
3. Is `output_transform` in form module acceptable, or should output format be a separate concern?
4. Should we verify module names are unique within a step, or handle duplicates?
