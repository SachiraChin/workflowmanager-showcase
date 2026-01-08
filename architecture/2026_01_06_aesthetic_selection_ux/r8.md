# Aesthetic Selection UX Improvement - Revision 8

## Summary of R7 Feedback

1. **Version/resolution count clarification** - For 2 groups × 2 paths = 5 versions (1 raw + 4 flattened), 4 resolutions
2. **Single query for start flow** - Combine lines 318-378 into one aggregation
3. **Single query for resume flow** - Combine lines 397-412 into one aggregation

---

## Part 1: Capabilities System

*(Unchanged from R7)*

### Capability = Module ID

Capabilities are the module IDs from the server's module registry. A client declares which modules it can render/handle.

```python
# Server-side known capabilities (from module registry)
# Note: Meta modules like pipeline.execution_groups are NOT capabilities
KNOWN_CAPABILITIES = {
    # User interaction modules
    "user.select",
    "user.text_input",
    "user.confirm",
    "user.form",           # New - rich form UI
    "user.file_download",
    "user.file_input",

    # Transform modules
    "transform.parse_pattern",
    "transform.reshape",   # New - generic reshaping

    # IO modules
    "io.validate",         # New - validation module

    # API modules
    "api.llm",

    # ... other module IDs (NOT meta modules)
}
```

### Client Capability Declaration

```python
# TUI client capabilities
TUI_CAPABILITIES = {
    "user.select",
    "user.text_input",
    "user.confirm",
    "user.file_download",
    "user.file_input",
    "transform.parse_pattern",
    "api.llm",
    # Note: NO "user.form" - TUI can't render rich forms
}

# WebUI client capabilities
WEBUI_CAPABILITIES = {
    "user.select",
    "user.text_input",
    "user.confirm",
    "user.file_download",
    "user.file_input",
    "user.form",           # WebUI CAN render rich forms
    "transform.parse_pattern",
    "api.llm",
}
```

### Group Matching Logic

Groups are checked **in order** - first match wins. No scoring, no "most specific".

```python
def select_group(groups: list, client_capabilities: set) -> dict:
    """
    Select first group whose 'requires' is subset of client capabilities.
    Groups are checked in ORDER - first match wins.

    Raises:
        NoMatchingGroupError: If no group's requires is subset of capabilities
    """
    for group in groups:
        required = set(group.get("requires", []))
        if required.issubset(client_capabilities):
            return group

    raise NoMatchingGroupError(
        f"No group matches client capabilities: {client_capabilities}"
    )
```

### Workflow Definition with `requires`

Order matters - put more specific groups first:

```json
{
  "module_id": "pipeline.execution_groups",
  "name": "aesthetic_selection_pipeline",
  "groups": [
    {
      "name": "webui_rich",
      "requires": ["user.form"],
      "modules": [...]
    },
    {
      "name": "tui_basic",
      "requires": ["user.text_input", "transform.parse_pattern"],
      "modules": [...]
    }
  ]
}
```

---

## Part 2: Database Schema - Strategy A (Flatten at Upload)

<!--I just realized I didnt raise a big problem, lets take current example where webui 
has user.form, while tui not, now if you think about it, while tui cant do user.form, 
webui can do either. So, in this case, how come webui pick one or either? if you remember, 
we do reverse contain, which means, we check client_capabilites.contains(resolution.require),
so, this will yield both resolutions. I think in previous rev, I mentioned added "basic" and
"rich" capabilities to stop this, but i think it dropped somewhere, but now thinking about
it, if webui has the capability "basic", same issue is going to happen. any idea how we address 
this?
-->

### Current Schema (MongoDB Collections)

```javascript
// workflow_templates - Stable identity by (user_id, workflow_template_name)
{
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    user_id: "usr_xxxxxxxxxxxx",
    workflow_template_name: "oms_video_generation",
    created_at: ISODate(),
    updated_at: ISODate()
}

// workflow_versions - Content-hashed workflow definitions
{
    workflow_version_id: "ver_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    content_hash: "sha256:abc123...",
    source_type: "json",  // or "zip"
    resolved_workflow: { ... },  // Full workflow JSON with $refs expanded
    created_at: ISODate()
}

// workflow_runs - Workflow execution instances
// NOTE: NO initial_workflow_version_id or current_workflow_version_id
// Workflow is accessed via workflow_run_resolutions
{
    workflow_run_id: "wf_xxxxxxxxxxxx",
    user_id: "usr_xxxxxxxxxxxx",
    project_name: "my_project",
    workflow_template_name: "oms_video_generation",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    current_branch_id: "br_xxxxxxxxxxxx",
    status: "processing",  // created, processing, awaiting_input, completed, error
    current_step: "user_input",
    current_step_name: "User Input",
    current_module: "select_aesthetics",
    created_at: ISODate(),
    updated_at: ISODate(),
    completed_at: ISODate()
}

// branches - Branch metadata for retry/jump
{
    branch_id: "br_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    lineage: [
        { branch_id: "br_root", cutoff_event_id: null },
        { branch_id: "br_retry1", cutoff_event_id: "evt_xxx" }
    ],
    created_at: ISODate()
}

// events - Immutable event log
{
    event_id: "evt_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    branch_id: "br_xxxxxxxxxxxx",
    event_type: "module_completed",
    timestamp: ISODate(),
    data: { ... },
    step_id: "user_input",
    module_name: "select_aesthetics"
}
```

### New Collections for Resolution

```javascript
// workflow_resolutions - Maps raw workflow to flattened versions
// Created at upload time for all capability combinations
{
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",

    // The original (raw) workflow version with execution_groups
    source_workflow_version_id: "ver_raw_xxx",

    // The flattened workflow version (execution_groups resolved)
    resolved_workflow_version_id: "ver_flat_xxx",

    // Capabilities required to use this resolution
    // This is the UNION of all requires from selected groups
    requires: ["user.form"],

    // Track which path was selected for each execution_groups module
    // Useful for debugging and state panel display
    selected_paths: {
        "aesthetic_selection_pipeline": "webui_path"
    },

    created_at: ISODate()
}

// Indexes on workflow_resolutions
db.workflow_resolutions.createIndex(
    { workflow_template_id: 1, source_workflow_version_id: 1 }
)
db.workflow_resolutions.createIndex(
    { source_workflow_version_id: 1, requires: 1 }
)

// workflow_run_resolutions - Links runs to their resolution
// EXACTLY ONE record per run - locked at workflow start
<!-- this is true, but it CAN edit when user upload a new workflow inbetween run,
i hope everything is counted for that -->
{
    workflow_run_resolution_id: "runres_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    workflow_resolution_id: "res_xxxxxxxxxxxx",

    // Capabilities the client declared when starting this run
    // For debugging/audit only, not used for matching on resume
    client_capabilities: ["user.form", "user.select"],

    created_at: ISODate()
}

// Index for quick lookup by run (unique - one resolution per run)
db.workflow_run_resolutions.createIndex(
    { workflow_run_id: 1 },
    { unique: true }
)
```

---

## Part 3: Upload Flow

```
User uploads workflow JSON
    |
    v
Server parses workflow
    |
    v
Server creates workflow_version for RAW workflow:
    {
        workflow_version_id: "ver_raw_xxx",
        workflow_template_id: template_id,
        resolved_workflow: <raw workflow with execution_groups intact>,
        content_hash: hash(<raw workflow>)
    }
    |
    v
Server scans workflow for pipeline.execution_groups modules
    |
    v
If NO execution_groups found:
    - Create single workflow_resolution with empty requires:
      {
          source_workflow_version_id: "ver_raw_xxx",
          resolved_workflow_version_id: "ver_raw_xxx",  // Same as source
          requires: [],
          selected_paths: {}
      }
    - Done
    |
    v
If execution_groups found:
    - Generate all path combinations
    - Example: 2 groups × 2 paths each = 4 combinations
    |
    v
For each combination:
    1. Flatten workflow (inline selected groups' modules)
    2. Merge requires from all selected groups (union)
    3. Create workflow_version for flattened workflow
    4. Create workflow_resolution linking source -> resolved
    |
    v
DB now contains (for 2 groups × 2 paths = 4 combinations):
    workflow_versions (5 total = 1 raw + 4 flattened):
    <!--I think this is good example to discuss duplication of capabilities,
        following example, v2 and v3 are same as they are same capabilties
        in differnt order, at evaluation time, this order doesnt change anything.
        so, we need some logic in place to deduplicate this, just iterate over
        all is not going to help us. -->
        - ver_raw_xxx (raw, has execution_groups)
        - ver_flat_1 (flattened: group1=webui, group2=webui)
        - ver_flat_2 (flattened: group1=webui, group2=tui)
        - ver_flat_3 (flattened: group1=tui, group2=webui)
        - ver_flat_4 (flattened: group1=tui, group2=tui)

    workflow_resolutions (4 total):
        - source=ver_raw_xxx, resolved=ver_flat_1, requires=["user.form"]
        - source=ver_raw_xxx, resolved=ver_flat_2, requires=["user.form", "user.text_input"]
        - source=ver_raw_xxx, resolved=ver_flat_3, requires=["user.form", "user.text_input"]
        - source=ver_raw_xxx, resolved=ver_flat_4, requires=["user.text_input", "transform.parse_pattern"]

Note: For single execution_groups with 2 paths = 3 versions (1 raw + 2 flattened), 2 resolutions.
```

---

## Part 4: Workflow Start Flow (Single Aggregation Query)

```
Client calls POST /workflow/start
    body: {
        workflow_template_name: "oms_video_generation",
        project_name: "my_project",
        capabilities: ["user.form", "user.select", "api.llm", ...]
    }
    |
    v
Server runs single aggregation query to get matching resolution + workflow:
```

### Single Aggregation Query

```javascript
// Input parameters
const user_id = "usr_xxx";
const workflow_template_name = "oms_video_generation";
const client_capabilities = ["user.form", "user.select", "api.llm"];

// Single aggregation: workflow_templates -> workflow_resolutions -> workflow_versions
const result = await db.workflow_templates.aggregate([
    // Stage 1: Find template by user + name
    {
        $match: {
            user_id: user_id,
            workflow_template_name: workflow_template_name
        }
    },

    // Stage 2: Get latest resolutions for this template
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

    // Stage 3: Get the latest source_workflow_version_id
    {
        $addFields: {
            latest_source_version_id: { $arrayElemAt: ["$resolutions.source_workflow_version_id", 0] }
        }
    },

    // Stage 4: Filter resolutions to only those matching latest source version
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

    // Stage 5: Filter resolutions where requires ⊆ client_capabilities
    {
        $addFields: {
            matching_resolutions: {
                $filter: {
                    input: "$resolutions",
                    cond: {
                        $setIsSubset: ["$$this.requires", client_capabilities]
                    }
                }
            }
        }
    },

    // Stage 6: Validate exactly one match
    {
        $addFields: {
            match_count: { $size: "$matching_resolutions" },
            resolution: { $arrayElemAt: ["$matching_resolutions", 0] }
        }
    },

    // Stage 7: Lookup the resolved workflow_version
    {
        $lookup: {
            from: "workflow_versions",
            let: { resolved_id: "$resolution.resolved_workflow_version_id" },
            pipeline: [
                { $match: { $expr: { $eq: ["$workflow_version_id", "$$resolved_id"] } } }
            ],
            as: "resolved_version"
        }
    },

    // Stage 8: Final projection
    {
        $project: {
            workflow_template_id: 1,
            workflow_template_name: 1,
            match_count: 1,
            resolution: 1,
            resolved_workflow: { $arrayElemAt: ["$resolved_version.resolved_workflow", 0] }
        }
    }
]).toArray();

// Validate result
if (result.length === 0) {
    throw new TemplateNotFoundError(workflow_template_name);
}

const data = result[0];

if (data.match_count === 0) {
    throw new NoMatchingResolutionError(client_capabilities);
}

if (data.match_count > 1) {
    throw new AmbiguousResolutionError(data.matching_resolutions);
}

// data.resolution contains the workflow_resolution
// data.resolved_workflow contains the flattened workflow JSON
```

### After Query: Create Run Records

```
Server creates workflow_run:
    {
        workflow_run_id: "wf_xxx",
        workflow_template_id: data.workflow_template_id,
        workflow_template_name: data.workflow_template_name,
        project_name: "my_project",
        status: "created",
        ...
    }
    |
    v
Server creates workflow_run_resolution:
    {
        workflow_run_id: "wf_xxx",
        workflow_resolution_id: data.resolution.workflow_resolution_id,
        client_capabilities: client_capabilities
    }
    |
    v
Server proceeds with data.resolved_workflow
```

---

## Part 5: Workflow Resume Flow (Single Aggregation Query)

```
Client calls POST /workflow/resume (or GET /workflow/{id}/stream)
    body: {
        workflow_run_id: "wf_xxx",
        capabilities: ["user.select", ...]  // IGNORED on resume
    }
    |
    v
Server runs single aggregation query to get workflow:
```

### Single Aggregation Query

```javascript
// Input parameter
const workflow_run_id = "wf_xxx";

// Single aggregation: workflow_run_resolutions -> workflow_resolutions -> workflow_versions
const result = await db.workflow_run_resolutions.aggregate([
    // Stage 1: Find run resolution by workflow_run_id
    {
        $match: {
            workflow_run_id: workflow_run_id
        }
    },

    // Stage 2: Lookup workflow_resolution
    {
        $lookup: {
            from: "workflow_resolutions",
            localField: "workflow_resolution_id",
            foreignField: "workflow_resolution_id",
            as: "resolution"
        }
    },
    { $unwind: "$resolution" },

    // Stage 3: Lookup resolved workflow_version
    {
        $lookup: {
            from: "workflow_versions",
            localField: "resolution.resolved_workflow_version_id",
            foreignField: "workflow_version_id",
            as: "resolved_version"
        }
    },
    { $unwind: "$resolved_version" },

    // Stage 4: Final projection
    {
        $project: {
            workflow_run_id: 1,
            workflow_resolution_id: 1,
            client_capabilities: 1,  // Original capabilities (for audit)
            resolution: 1,
            resolved_workflow: "$resolved_version.resolved_workflow"
        }
    }
]).toArray();

// Validate result
if (result.length === 0) {
    throw new RunResolutionNotFoundError(workflow_run_id);
}

const data = result[0];
// data.resolved_workflow contains the flattened workflow JSON
// NOTE: Client capabilities from request are IGNORED - we use stored resolution
```

### After Query: Load Run and Proceed

```
Server also loads workflow_run for status, current_step, etc:
    run = db.workflow_runs.findOne({ workflow_run_id: workflow_run_id })
    |
    v
Server proceeds with data.resolved_workflow
    // Same workflow regardless of which client resumes
```

---

## Part 6: Multi-Client Scenarios

### Key Principle

Resolution is locked when workflow starts. After that, ANY client can access the run and will get the SAME flattened workflow.

### Scenarios

| Scenario | Behavior |
|----------|----------|
| WebUI starts, WebUI resumes | Normal - same client, same workflow |
| TUI starts, TUI resumes | Normal - same client, same workflow |
| WebUI starts, TUI resumes | TUI sees WebUI's flattened workflow (may have user.form modules) |
| TUI starts, WebUI resumes | WebUI sees TUI's flattened workflow (has text_input + parse_pattern) |

### Cross-Client Resume Handling

When a different client type resumes:
- The workflow is already flattened - no re-resolution
- Client may see modules it doesn't "prefer" but CAN render
- Example: TUI can render user.form in basic mode (fallback UI)
- Example: WebUI can render user.text_input normally

### Why This Works

All clients must support a BASE set of modules. Client-specific modules (like user.form) have fallback rendering in other clients.

```python
# All clients support these (required baseline)
BASE_CAPABILITIES = {
    "user.select",
    "user.text_input",
    "user.confirm",
    "user.file_download",
    "user.file_input",
    "api.llm",
    "transform.parse_pattern",
}

# WebUI adds rich modules
WEBUI_CAPABILITIES = BASE_CAPABILITIES | {"user.form"}

# TUI uses baseline
TUI_CAPABILITIES = BASE_CAPABILITIES
```

---

## Part 7: Flattening Logic

### Input: Raw Workflow with Execution Groups

```json
{
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "pipeline.execution_groups",
        "name": "aesthetic_pipeline",
        "groups": [
          {
            "name": "webui_path",
            "requires": ["user.form"],
            "modules": [
              { "module_id": "user.form", "name": "aesthetic_form", ... }
            ]
          },
          {
            "name": "tui_path",
            "requires": ["user.text_input"],
            "modules": [
              { "module_id": "user.text_input", "name": "get_input", ... },
              { "module_id": "transform.parse_pattern", "name": "parse", ... }
            ]
          }
        ],
        "output_schema": { ... }
      },
      { "module_id": "some.next_module", "name": "next" }
    ]
  }]
}
```

### Output: Flattened Workflow (for webui_path)

```json
{
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "user.form",
        "name": "aesthetic_form",
        "_group_origin": {
          "group_name": "aesthetic_pipeline",
          "path_name": "webui_path",
          "requires": ["user.form"],
          "module_index": 0
        },
        ...
      },
      {
        "module_id": "io.validate",
        "name": "_aesthetic_pipeline_validator",
        "inputs": {
          "schema": { ... },
          "state_keys": ["aesthetic_selections"]
        },
        "_group_origin": {
          "group_name": "aesthetic_pipeline",
          "path_name": "webui_path",
          "is_group_exit": true,
          "auto_generated": true
        }
      },
      { "module_id": "some.next_module", "name": "next" }
    ]
  }]
}
```

### Flattening Algorithm

```python
def flatten_workflow(
    workflow: dict,
    client_capabilities: set
) -> tuple[dict, list[str], dict[str, str]]:
    """
    Flatten a workflow by selecting and inlining group paths.

    Args:
        workflow: Raw workflow with execution_groups
        client_capabilities: Set of module IDs client supports

    Returns:
        Tuple of:
        - Flattened workflow dict
        - Merged requires list (union of all selected groups' requires)
        - Selected paths dict (group_name -> path_name)
    """
    result = copy.deepcopy(workflow)
    all_requires = set()
    selected_paths = {}

    for step in result["steps"]:
        new_modules = []

        for module in step["modules"]:
            if module.get("module_id") == "pipeline.execution_groups":
                group_name = module["name"]
                output_schema = module.get("output_schema")

                # Select matching group (first match wins)
                selected_group = select_group(module["groups"], client_capabilities)
                selected_paths[group_name] = selected_group["name"]

                # Track requires
                group_requires = selected_group.get("requires", [])
                all_requires.update(group_requires)

                # Inline modules with metadata
                for i, inner_module in enumerate(selected_group["modules"]):
                    inner_copy = copy.deepcopy(inner_module)
                    inner_copy["_group_origin"] = {
                        "group_name": group_name,
                        "path_name": selected_group["name"],
                        "requires": group_requires,
                        "module_index": i
                    }
                    new_modules.append(inner_copy)

                # Add validation module at group exit
                if output_schema:
                    state_keys = list(output_schema.get("properties", {}).keys())
                    validator = {
                        "module_id": "io.validate",
                        "name": f"_{group_name}_validator",
                        "inputs": {
                            "schema": output_schema,
                            "state_keys": state_keys
                        },
                        "_group_origin": {
                            "group_name": group_name,
                            "path_name": selected_group["name"],
                            "is_group_exit": True,
                            "auto_generated": True
                        }
                    }
                    new_modules.append(validator)
            else:
                new_modules.append(module)

        step["modules"] = new_modules

    return result, list(all_requires), selected_paths
```

---

## Part 8: Generic `user.form` Module

### Design Principle

`user.form` outputs clean, generic data structure. Any workflow-specific transformation happens in a separate `transform.reshape` module.

### Module Configuration

```json
{
  "module_id": "user.form",
  "name": "aesthetic_form",
  "inputs": {
    "title": "Select Aesthetics",
    "groups": [
      {
        "id": "aesthetics",
        "type": "per_item",
        "data": { "$ref": "core_aesthetics.json" },
        "schema": {
          "type": "array",
          "items": {
            "type": "object",
            "display": true,
            "properties": {
              "label": { "type": "string", "display": true },
              "description": { "type": "string" }
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
        },
        "filter_output": { "exclude_when": { "count": 0 } }
      }
    ]
  },
  "outputs_to_state": {
    "result": "form_result"
  }
}
```

### Generic Output Structure

#### Per-Item Group

```json
{
  "form_result": {
    "aesthetics": [
      {
        "_item": { "id": "futuristic", "label": "Futuristic", "description": "..." },
        "_index": 0,
        "count": 2,
        "mode": "w"
      },
      {
        "_item": { "id": "vintage", "label": "Vintage", "description": "..." },
        "_index": 2,
        "count": 4,
        "mode": "q"
      }
    ]
  }
}
```

#### Static Group

```json
{
  "form_result": {
    "mj_params": {
      "niji": 6,
      "ar": "2:3",
      "chaos": 25
    }
  }
}
```

### Transform for Workflow-Specific Format

```json
{
  "module_id": "transform.reshape",
  "name": "format_aesthetics",
  "inputs": {
    "source": "{{ state.form_result.aesthetics }}",
    "template": {
      "_for_each": "$item",
      "_output": {
        "index": "{{ $item._index }}",
        "count": "{{ $item.count }}",
        "aesthetic": "{{ $item._item }}",
        "mode": "{{ {'q': 'without_person', 'w': 'with_person', 'e': 'either'}[$item.mode] }}",
        "with_count": "{{ $item.count if $item.mode in ['w', 'e'] else 0 }}",
        "without_count": "{{ $item.count if $item.mode in ['q', 'e'] else 0 }}"
      }
    }
  },
  "outputs_to_state": { "result": "aesthetic_selections" }
}
```

---

## Part 9: Validation with `io.validate` Module

### Module Behavior

```python
class ValidateModule:
    """
    Validates state values against JSON schema.
    Auto-added by flattener at group exit.
    """
    module_id = "io.validate"

    def execute(self, inputs: dict, state: dict) -> dict:
        schema = inputs["schema"]
        state_keys = inputs["state_keys"]

        # Build object from state keys
        data_to_validate = {
            key: state.get(key)
            for key in state_keys
        }

        # Validate
        try:
            jsonschema.validate(data_to_validate, schema)
        except jsonschema.ValidationError as e:
            raise ModuleExecutionError(
                f"Group output validation failed: {e.message}"
            )

        return {}  # No outputs, just validation
```

---

## Part 10: Complete Example

### Raw Workflow (Before Flattening)

```json
{
  "workflow_id": "oms_video_generation",
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "pipeline.execution_groups",
        "name": "aesthetic_selection_pipeline",
        "groups": [
          {
            "name": "webui_path",
            "requires": ["user.form"],
            "modules": [
              {
                "module_id": "user.form",
                "name": "aesthetic_form",
                "inputs": {
                  "title": "Select Aesthetics",
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
                    },
                    "filter_output": { "exclude_when": { "count": 0 } }
                  }]
                },
                "outputs_to_state": { "result": "raw_form_result" }
              },
              {
                "module_id": "transform.reshape",
                "name": "format_aesthetics",
                "inputs": {
                  "source": "{{ state.raw_form_result.aesthetics }}",
                  "template": {
                    "_for_each": "$item",
                    "_output": {
                      "index": "{{ $item._index }}",
                      "count": "{{ $item.count }}",
                      "aesthetic": "{{ $item._item }}",
                      "mode": "{{ {'q': 'without_person', 'w': 'with_person', 'e': 'either'}[$item.mode] }}",
                      "with_count": "{{ $item.count if $item.mode in ['w', 'e'] else 0 }}",
                      "without_count": "{{ $item.count if $item.mode in ['q', 'e'] else 0 }}"
                    }
                  }
                },
                "outputs_to_state": { "result": "aesthetic_selections" }
              }
            ]
          },
          {
            "name": "tui_path",
            "requires": ["user.text_input", "transform.parse_pattern"],
            "modules": [
              {
                "module_id": "user.text_input",
                "name": "get_aesthetic_input",
                "inputs": { "prompt": "Enter selections (e.g., 1w2 5e4):" },
                "outputs_to_state": { "value": "raw_aesthetic_input" }
              },
              {
                "module_id": "transform.parse_pattern",
                "name": "parse_aesthetics",
                "inputs": {
                  "input": "{{ state.raw_aesthetic_input }}",
                  "data": { "$ref": "core_aesthetics.json" }
                },
                "outputs_to_state": { "parsed": "aesthetic_selections" }
              }
            ]
          }
        ],
        "output_schema": {
          "type": "object",
          "required": ["aesthetic_selections"],
          "properties": {
            "aesthetic_selections": { "type": "array" }
          }
        }
      },
      {
        "module_id": "some.next_module",
        "name": "use_aesthetics"
      }
    ]
  }]
}
```

### Flattened Workflow (For WebUI)

```json
{
  "workflow_id": "oms_video_generation",
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "user.form",
        "name": "aesthetic_form",
        "inputs": { "..." },
        "outputs_to_state": { "result": "raw_form_result" },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path",
          "requires": ["user.form"],
          "module_index": 0
        }
      },
      {
        "module_id": "transform.reshape",
        "name": "format_aesthetics",
        "inputs": { "..." },
        "outputs_to_state": { "result": "aesthetic_selections" },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path",
          "requires": ["user.form"],
          "module_index": 1
        }
      },
      {
        "module_id": "io.validate",
        "name": "_aesthetic_selection_pipeline_validator",
        "inputs": {
          "schema": {
            "type": "object",
            "required": ["aesthetic_selections"],
            "properties": { "aesthetic_selections": { "type": "array" } }
          },
          "state_keys": ["aesthetic_selections"]
        },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path",
          "is_group_exit": true,
          "auto_generated": true
        }
      },
      {
        "module_id": "some.next_module",
        "name": "use_aesthetics"
      }
    ]
  }]
}
```

---

## Summary

| Aspect | Decision |
|--------|----------|
| Terminology | `requires` (group needs) / `capabilities` (client has) |
| Capability source | Module IDs from server registry (NOT meta modules) |
| Group selection | First match wins (order in array matters) |
| Multiple matches | Error - workflow author must ensure unambiguous resolution |
| Storage strategy | Strategy A - Flatten at upload |
| Database | New `workflow_resolutions` + `workflow_run_resolutions` collections |
| workflow_runs | NO version columns - use workflow_run_resolutions |
| Start flow | Single aggregation: templates → resolutions → versions |
| Resume flow | Single aggregation: run_resolutions → resolutions → versions |
| Resolution per run | Locked at start, resume uses stored resolution |
| Cross-client resume | Allowed - client gets same flattened workflow |
| Form output | Generic structure with `_item`, `_index`, user inputs |
| Format conversion | Separate `transform.reshape` module in workflow |
| Validation | `io.validate` module auto-added by flattener |

---

## Questions for Review

1. Are the single aggregation queries correct and efficient?
2. Is the version/resolution count example clear (5 versions, 4 resolutions for 2×2)?
3. Any concerns with the aggregation approach for start/resume flows?
