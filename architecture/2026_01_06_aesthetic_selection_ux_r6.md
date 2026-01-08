# Aesthetic Selection UX Improvement - Revision 6

## Summary of R5 Feedback

1. **Table/column names incorrect** - Need to use actual MongoDB collection/field names
2. **`pipeline.execution_groups` not a capability** - It's a meta module, shouldn't be in capability list
3. **`parent_workflow_version_id` on workflow_versions** - Not needed, workflow_resolutions handles this
4. **Index on capabilities needed** - For efficient resolution lookup
5. **Upload flow** - Showed "requires" on workflow_versions incorrectly
6. **Workflow start flow** - Need "create resolution if not exists"
7. **Multi-client filtering issue** - ORDER BY created_at alone doesn't work for concurrent access
8. **State keying** - Removed from this document, added to tech debt

---

## Part 1: Capabilities System

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

    # Transform modules
    "transform.parse_pattern",
    "transform.jinja",
    "transform.reshape",   # New - generic reshaping

    # IO modules
    "io.validate",         # New - validation module

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
    "transform.parse_pattern",
    # Note: NO "user.form" - TUI can't render rich forms
}

# WebUI client capabilities
WEBUI_CAPABILITIES = {
    "user.select",
    "user.text_input",
    "user.confirm",
    "user.file_download",
    "user.form",           # WebUI CAN render rich forms
    "transform.parse_pattern",
}
```

### Group Matching Logic

```python
def select_group(groups: list, client_capabilities: set) -> dict:
    """
    Select first group whose 'requires' is subset of client capabilities.
    Groups are checked in order - first match wins.
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

### Current Schema (MongoDB Collections)

```javascript
// workflow_templates - Stable identity by (user_id, workflow_template_name)
{
    workflow_template_id: "tpl_xxxxxxxxxxxx",  // Random ID
    user_id: "usr_xxxxxxxxxxxx",
    workflow_template_name: "oms_video_generation",  // From workflow JSON
    created_at: ISODate(),
    updated_at: ISODate()
}

// workflow_versions - Content-hashed workflow definitions
{
    workflow_version_id: "ver_xxxxxxxxxxxx",  // UUID v7
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    content_hash: "sha256:abc123...",
    source_type: "json",  // or "zip"
    resolved_workflow: { ... },  // Full workflow JSON with $refs expanded
    created_at: ISODate()
}

// workflow_runs - Workflow execution instances
{
    workflow_run_id: "wf_xxxxxxxxxxxx",
    user_id: "usr_xxxxxxxxxxxx",
    project_name: "my_project",
    workflow_template_name: "oms_video_generation",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    initial_workflow_version_id: "ver_xxxxxxxxxxxx",
    current_workflow_version_id: "ver_xxxxxxxxxxxx",
    current_branch_id: "br_xxxxxxxxxxxx",
    status: "processing",  // created, processing, awaiting_input, completed, error
    current_step: "user_input",
    current_step_name: "User Input",
    current_module: "select_aesthetics",
    created_at: ISODate(),
    updated_at: ISODate(),
    completed_at: ISODate()  // Only set when completed
}

// branches - Branch metadata for retry/jump
{
    branch_id: "br_xxxxxxxxxxxx",  // UUID v7
    workflow_run_id: "wf_xxxxxxxxxxxx",
    lineage: [
        { branch_id: "br_root", cutoff_event_id: null },
        { branch_id: "br_retry1", cutoff_event_id: "evt_xxx" }
    ],
    created_at: ISODate()
}

// events - Immutable event log
{
    event_id: "evt_xxxxxxxxxxxx",  // UUID v7 (time-sortable)
    workflow_run_id: "wf_xxxxxxxxxxxx",
    branch_id: "br_xxxxxxxxxxxx",
    workflow_version_id: "ver_xxxxxxxxxxxx",
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
    workflow_resolution_id: "res_xxxxxxxxxxxx",  // UUID v7
    workflow_template_id: "tpl_xxxxxxxxxxxx",

    // The original (raw) workflow version with execution_groups
    source_workflow_version_id: "ver_raw_xxx",

    // The flattened workflow version (execution_groups resolved)
    resolved_workflow_version_id: "ver_flat_xxx",

    // Capabilities required to use this resolution
    // Empty array = default/fallback resolution
    requires: ["user.form"],

    created_at: ISODate()
}

// Indexes on workflow_resolutions
db.workflow_resolutions.createIndex(
    { workflow_template_id: 1, source_workflow_version_id: 1, requires: 1 },
    { unique: true }
)
db.workflow_resolutions.createIndex(
    { source_workflow_version_id: 1 }
)

// workflow_run_resolutions - Links runs to their resolution
// One record per run (not per client access)
{
    workflow_run_resolution_id: "runres_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    workflow_resolution_id: "res_xxxxxxxxxxxx",

    // Capabilities the client declared when starting this run
    // Used for debugging/audit, not for matching
    client_capabilities: ["user.form", "user.select"],

    created_at: ISODate()
}

// Index for quick lookup by run
db.workflow_run_resolutions.createIndex(
    { workflow_run_id: 1 },
    { unique: true }  // One resolution per run
)
```

### Upload Flow

```
User uploads workflow JSON
    |
    v
Server parses workflow, finds pipeline.execution_groups modules
    |
    v
Server creates raw workflow_version (unflattened)
    source_workflow_version_id = "ver_raw_xxx"
    |
    v
Server generates all flattened combinations:
    - If 1st group has 2 paths, 2nd group has 3 paths = 6 combinations
    |
    v
For each combination:
    1. Flatten workflow (inline selected group's modules)
    2. Merge requires from all selected groups
    3. Create workflow_version for flattened workflow
    4. Create workflow_resolution linking source -> resolved
    |
    v
DB now contains:
    workflow_versions:
        - ver_raw_xxx (raw, has execution_groups)
        - ver_flat_1 (flattened for requires=["user.form"])
        - ver_flat_2 (flattened for requires=["user.text_input", "transform.parse_pattern"])

    workflow_resolutions:
        - source=ver_raw_xxx, resolved=ver_flat_1, requires=["user.form"]
        - source=ver_raw_xxx, resolved=ver_flat_2, requires=["user.text_input", "transform.parse_pattern"]
```

### Workflow Start Flow

```
Client calls POST /workflow/start
    body: {
        workflow_template_id: "tpl_xxx",
        // OR workflow_template_name: "oms_video_generation",
        project_name: "my_project",
        capabilities: ["user.form", "user.select", ...]
    }
    |
    v
<!--following is wrong, how can you determine that just getting sorted you get the correct one.-->
# Server gets latest raw workflow_version for template
#    source_version = db.workflow_versions.findOne({
#        workflow_template_id: template_id
#    }, { sort: { created_at: -1 } })
    |
    v
Server finds matching resolution:
    // Find all resolutions for this source version where
    // requires is subset of client capabilities
    resolutions = db.workflow_resolutions.find({
        workflow_template_id: source_version.workflow_template_id
    })

    // Filter in Python: requires subset of capabilities
    matching = [r for r in resolutions
                if set(r.requires).issubset(client_capabilities)]

    // Pick most specific (longest requires array)
    <!--no max()-->
    resolution = max(matching, key=lambda r: len(r.requires))
    |
    v
If no matching resolution exists:
    - Generate flattened workflow on-the-fly
    - Create new workflow_version for it
    - Create new workflow_resolution
<!-- if more than one, throw -->
    |
    v
Server creates workflow_run with resolved version:
    {
        workflow_run_id: "wf_xxx",
<!--didnt we delete these?-->
        initial_workflow_version_id: resolution.resolved_workflow_version_id,
        current_workflow_version_id: resolution.resolved_workflow_version_id,
        ...
    }
    |
    v
Server creates workflow_run_resolution:
    {
        workflow_run_id: "wf_xxx",
        workflow_resolution_id: resolution.workflow_resolution_id,
        client_capabilities: capabilities
    }
    |
    v
Server loads resolved workflow and proceeds
```

### Resume Flow

```
Client calls POST /workflow/resume
    body: {
        workflow_run_id: "wf_xxx",
        capabilities: ["user.select", ...]  // May differ from original client
    }
    |
    v
Server gets workflow_run
    |
    v
<!-- below doesnt exist -->
Server loads current_workflow_version_id
    // This is the FLATTENED version, already resolved
    // Client capabilities are IGNORED - we use the stored version
<!-- need to load workflow from workflow_run_resolutions -->
    |
    v
Server proceeds with stored workflow
    // Same workflow regardless of which client resumes
```

### Multi-Client Access Handling

The key insight: **one run = one resolution**. <!--NO!!!!!!-->

- When workflow starts, resolution is locked in `workflow_run_resolutions`
- Resume uses the STORED `current_workflow_version_id`, not client capabilities
- Different clients CAN resume the same run (they get the same flattened workflow)
- No filtering by capabilities on resume - the workflow is already resolved

```python
def get_workflow_for_resume(workflow_run_id: str) -> dict:
    """Get workflow for resume - uses stored version, ignores client capabilities."""
    run = db.workflow_runs.find_one({"workflow_run_id": workflow_run_id})
    version_id = run["current_workflow_version_id"]
    version = db.workflow_versions.find_one({"workflow_version_id": version_id})
    return version["resolved_workflow"]
```

---

## Part 3: Flattening Logic

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
          "original_index": 0
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
def flatten_workflow(workflow: dict, selected_groups: dict[str, str]) -> dict:
    """
    Flatten a workflow by inlining selected group paths.

    Args:
        workflow: Raw workflow with execution_groups
        selected_groups: Map of group_name -> selected path_name

    Returns:
        Flattened workflow with _group_origin metadata
    """
    result = copy.deepcopy(workflow)

    for step in result["steps"]:
        new_modules = []

        for module in step["modules"]:
            if module.get("module_id") == "pipeline.execution_groups":
                group_name = module["name"]
                selected_path = selected_groups[group_name]
                output_schema = module.get("output_schema")

                # Find the selected group
                group = next(g for g in module["groups"]
                            if g["name"] == selected_path)

                # Inline modules with metadata
                for i, inner_module in enumerate(group["modules"]):
                    inner_copy = copy.deepcopy(inner_module)
                    inner_copy["_group_origin"] = {
                        "group_name": group_name,
                        "path_name": selected_path,
                        "requires": group.get("requires", []),
                        "original_index": i
                    }
                    new_modules.append(inner_copy)

                # Add validation module at group exit
                if output_schema:
                    # Determine state keys from output_schema
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
                            "path_name": selected_path,
                            "is_group_exit": True,
                            "auto_generated": True
                        }
                    }
                    new_modules.append(validator)
            else:
                new_modules.append(module)

        step["modules"] = new_modules

    return result
```

---

## Part 4: Generic `user.form` Module

### Design Principle

`user.form` outputs clean, generic data structure. Any workflow-specific transformation happens in a separate `transform.*` module.

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

## Part 5: Validation with `io.validate` Module

### Module Behavior

```python
class ValidateModule:
    """
    Validates state values against JSON schema.
    Auto-added by pipeline.execution_groups at group exit during flattening.
    """

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

## Part 6: Complete Example

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
          },
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
        "inputs": { ... },
        "outputs_to_state": { "result": "raw_form_result" },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path",
          "requires": ["user.form"],
          "original_index": 0
        }
      },
      {
        "module_id": "transform.reshape",
        "name": "format_aesthetics",
        "inputs": { ... },
        "outputs_to_state": { "result": "aesthetic_selections" },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path",
          "requires": ["user.form"],
          "original_index": 1
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
| Capability source | Module IDs from server registry (not meta modules) |
| Storage strategy | Strategy A - Flatten at upload |
| Database | New `workflow_resolutions` + `workflow_run_resolutions` collections |
| Resolution per run | One resolution locked at start, resume uses stored version |
| Form output | Generic structure with `_item`, `_index`, user inputs |
| Format conversion | Separate `transform.reshape` module in workflow |
| Validation | `io.validate` module auto-added by flattener |

---

## Questions for Review

1. Is the MongoDB schema correct for the new collections?
2. Does "one resolution per run" handle all multi-client scenarios?
3. Is the flattening algorithm clear?
4. Should `transform.reshape` template syntax be expanded/documented?
