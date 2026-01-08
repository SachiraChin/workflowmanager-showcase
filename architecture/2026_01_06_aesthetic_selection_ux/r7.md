# Aesthetic Selection UX Improvement - Revision 7

## Summary of R6 Feedback

1. **Workflow version lookup wrong** - Can't use `sort by created_at` to get source version
2. **No `max()` for resolution selection** - First match wins, order in groups array matters
3. **Multiple matches = error** - If more than one resolution matches, throw error
4. **workflow_runs schema still wrong** - Still showed deleted columns (`initial_workflow_version_id`, `current_workflow_version_id`)
5. **Resume flow wrong** - Must load workflow via `workflow_run_resolutions`, not non-existent columns
6. **"One run = one resolution" wrong** - Needs clarification on multi-client scenarios

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
    - Example: 2 groups with 2 paths each = 4 combinations
    |
    v
For each combination:
    1. Flatten workflow (inline selected groups' modules)
    2. Merge requires from all selected groups (union)
    3. Create workflow_version for flattened workflow
    4. Create workflow_resolution linking source -> resolved
    |
    v
<!--Just to be clear, it will be 5 versions and 4 resolutions-->
DB now contains:
    workflow_versions:
        - ver_raw_xxx (raw, has execution_groups)
        - ver_flat_webui (flattened, webui_path selected)
        - ver_flat_tui (flattened, tui_path selected)

    workflow_resolutions:
        - source=ver_raw_xxx, resolved=ver_flat_webui, requires=["user.form"]
        - source=ver_raw_xxx, resolved=ver_flat_tui, requires=["user.text_input", "transform.parse_pattern"]
```

---

## Part 4: Workflow Start Flow

```
Client calls POST /workflow/start
    body: {
        workflow_template_name: "oms_video_generation",
        project_name: "my_project",
        capabilities: ["user.form", "user.select", "api.llm", ...]
    }
    |
    v
<!--is it possible to make logic 318 - 351 a single query? -->
Server looks up workflow_template by (user_id, workflow_template_name)
    |
    v
Server gets latest source workflow version:
    // Get all resolutions for this template, pick latest source version
    latest_resolution = db.workflow_resolutions.findOne(
        { workflow_template_id: template_id },
        { sort: { created_at: -1 } }
    )
    source_version_id = latest_resolution.source_workflow_version_id
    |
    v
Server finds matching resolution:
    // Get all resolutions for this source version
    all_resolutions = db.workflow_resolutions.find({
        source_workflow_version_id: source_version_id
    })

    // Filter: requires must be subset of client capabilities
    matching = []
    for resolution in all_resolutions:
        if set(resolution.requires).issubset(client_capabilities):
            matching.append(resolution)
    |
    v
Validate exactly one match:
    if len(matching) == 0:
        raise NoMatchingResolutionError(
            f"No resolution matches capabilities: {client_capabilities}"
        )
    if len(matching) > 1:
        raise AmbiguousResolutionError(
            f"Multiple resolutions match: {[r.workflow_resolution_id for r in matching]}"
        )
    resolution = matching[0]
    |
    v
Server creates workflow_run:
    {
        workflow_run_id: "wf_xxx",
        workflow_template_id: template_id,
        workflow_template_name: "oms_video_generation",
        project_name: "my_project",
        status: "created",
        ...
    }
    |
    v
Server creates workflow_run_resolution:
    {
        workflow_run_id: "wf_xxx",
        workflow_resolution_id: resolution.workflow_resolution_id,
        client_capabilities: capabilities  // For audit only
    }
    |
    v
Server loads resolved workflow and proceeds:
    resolved_version = db.workflow_versions.findOne({
        workflow_version_id: resolution.resolved_workflow_version_id
    })
    workflow = resolved_version.resolved_workflow
```

---

## Part 5: Workflow Resume Flow

```
Client calls POST /workflow/resume (or GET /workflow/{id}/stream)
    body: {
        workflow_run_id: "wf_xxx",
        capabilities: ["user.select", ...]  // May differ from start client
    }
    |
    v
Server gets workflow_run
    |
    v
<!--same question as above, can we make 397-412 a single query? -->
Server gets resolution via workflow_run_resolutions:
    run_resolution = db.workflow_run_resolutions.findOne({
        workflow_run_id: "wf_xxx"
    })
    // NOTE: Client capabilities are IGNORED on resume
    // We use the resolution that was locked at start
    |
    v
Server loads resolved workflow:
    resolution = db.workflow_resolutions.findOne({
        workflow_resolution_id: run_resolution.workflow_resolution_id
    })
    resolved_version = db.workflow_versions.findOne({
        workflow_version_id: resolution.resolved_workflow_version_id
    })
    workflow = resolved_version.resolved_workflow
    |
    v
Server proceeds with stored workflow
    // Same workflow regardless of which client resumes
    // TUI can resume a WebUI-started run (it will see webui_path modules)
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
| Resolution per run | Locked at start, resume uses stored resolution |
| Cross-client resume | Allowed - client gets same flattened workflow |
| Form output | Generic structure with `_item`, `_index`, user inputs |
| Format conversion | Separate `transform.reshape` module in workflow |
| Validation | `io.validate` module auto-added by flattener |

---

## Questions for Review

1. Is the resolution selection logic clear (first match, error on multiple)?
2. Is the database schema correct with workflow accessed via `workflow_run_resolutions`?
3. Is cross-client resume behavior acceptable (TUI sees WebUI's workflow)?
4. Should `transform.reshape` template syntax be documented separately?
