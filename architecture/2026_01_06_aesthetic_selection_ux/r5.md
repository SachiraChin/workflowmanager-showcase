# Aesthetic Selection UX Improvement - Revision 5

<!--make sure tables and column names are correct, i see lots of place you just put non-existing names -->

## Summary of R4 Feedback

1. **Strategy A preferred** - Flatten at upload with new database structure
2. **Capabilities over tags** - Use `requires` field, capabilities = module IDs
3. **Form output format rejected** - Must be generic, no workflow-specific logic in module
4. **Validation** - Use `io.validate` module instead of metadata
5. **State keying** - Need solution that handles workflow updates

---

## Part 1: Capabilities System

### Terminology

| Old Term | New Term | Description |
|----------|----------|-------------|
| tags | capabilities | What a client can handle |
| match | requires | What a group needs from client |

### Capability = Module ID

Capabilities are simply the module IDs the system supports. A client declares which modules it can render/handle.

```python
# Server-side known capabilities (from module registry)
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

    # IO modules
    "io.validate",         # New - validation module

    <!-- this probably shouldnt be there as this is a meta module -->
    # Pipeline modules
    "pipeline.execution_groups",

    # ... all other module IDs
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

**Matching Example:**
- WebUI capabilities: `{"user.form", "user.select", ...}`
- Group "webui_rich" requires: `{"user.form"}`
- `{"user.form"} ⊆ {"user.form", "user.select", ...}` → Match!

---

## Part 2: Database Schema - Strategy A (Flatten at Upload)

### Current Schema (Simplified)

```sql
workflow_templates (
    workflow_template_id UUID PRIMARY KEY,
    name TEXT
)

workflow_versions (
    workflow_version_id UUID PRIMARY KEY,
    workflow_template_id UUID REFERENCES workflow_templates,
    workflow_json JSONB,
    created_at TIMESTAMP
)

workflow_runs (
    workflow_run_id UUID PRIMARY KEY,
    initial_workflow_version_id UUID REFERENCES workflow_versions,
    current_workflow_version_id UUID REFERENCES workflow_versions,
    state JSONB
)
```

### Proposed Schema Changes

```sql
<!-- sorry i added this by mistake, this is not needed, workflow_resolutions already resolves this -->
-- Modified: workflow_versions
-- Add parent reference for flattened versions
ALTER TABLE workflow_versions
    ADD COLUMN parent_workflow_version_id UUID REFERENCES workflow_versions;

-- parent_workflow_version_id:
--   NULL = this is a raw/original workflow
--   UUID = this is a flattened version derived from parent

-- New: workflow_resolutions
-- Maps raw workflow to its flattened versions
CREATE TABLE workflow_resolutions (
    workflow_resolution_id UUID PRIMARY KEY,
    parent_workflow_version_id UUID NOT NULL REFERENCES workflow_versions,
    resolved_workflow_version_id UUID NOT NULL REFERENCES workflow_versions,
    requires TEXT[] NOT NULL,  -- Capabilities needed for this resolution
    created_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(parent_workflow_version_id, requires)
);

-- Modified: workflow_runs
-- Remove version columns, add resolution reference
ALTER TABLE workflow_runs
    DROP COLUMN initial_workflow_version_id,
    DROP COLUMN current_workflow_version_id;

-- New: workflow_run_resolutions
-- Links a run to its resolution (can have multiple if capabilities change)
CREATE TABLE workflow_run_resolutions (
    workflow_run_resolution_id UUID PRIMARY KEY,
    workflow_run_id UUID NOT NULL REFERENCES workflow_runs,
    workflow_resolution_id UUID NOT NULL REFERENCES workflow_resolutions,
    capabilities TEXT[] NOT NULL,  -- Client capabilities at time of resolution
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding latest resolution for a run
<!--we need another index with capabilites, -->
CREATE INDEX idx_run_resolutions_run_created
    ON workflow_run_resolutions(workflow_run_id, created_at DESC);
```

### Upload Flow

```
User uploads workflow JSON
    ↓
Server parses workflow, finds pipeline.execution_groups modules
    ↓
Server generates all flattened combinations:
    - If 1st group has 2 paths, 2nd group has 3 paths → 6 versions
    ↓
For each flattened version:
    → Insert into workflow_versions (with parent_workflow_version_id set)
    → Insert into workflow_resolutions (with merged requires)
    ↓
DB now contains:
    <!--theres no requires on versions table right?-->
    workflow_versions:
        - "abc" (raw, parent=NULL)
        - "abc-1" (flattened, parent="abc", requires=["user.form"])
        - "abc-2" (flattened, parent="abc", requires=["user.text_input"])
    workflow_resolutions:
        - parent="abc", resolved="abc-1", requires=["user.form"]
        - parent="abc", resolved="abc-2", requires=["user.text_input"]
```

### Workflow Start Flow

```
Client calls POST /workflow/start
    body: {
        workflow_template_id: "...",
        capabilities: ["user.form", "user.select", ...]
    }
    ↓
<!-- you need to create if not exists too -->
Server finds latest raw workflow_version for template
    ↓
Server queries workflow_resolutions:
    SELECT * FROM workflow_resolutions
    WHERE parent_workflow_version_id = ?
    AND requires <@ ?  -- requires is subset of client capabilities
    ORDER BY array_length(requires, 1) DESC  -- Most specific first
    LIMIT 1
    ↓
Server creates workflow_run
    ↓
Server creates workflow_run_resolution linking run to resolution
    ↓
Server loads resolved_workflow_version and proceeds
```

### Resolution Selection Query

```sql
-- Find best matching resolution for client capabilities
SELECT wr.*, wv.workflow_json
FROM workflow_resolutions wr
JOIN workflow_versions wv ON wv.workflow_version_id = wr.resolved_workflow_version_id
WHERE wr.parent_workflow_version_id = :parent_version_id
  AND wr.requires <@ :client_capabilities  -- Postgres array containment
ORDER BY array_length(wr.requires, 1) DESC  -- Prefer more specific match
LIMIT 1;
```

### Open Questions from R4

**Q: How to add new client capabilities?**

A: `workflow_run_resolutions.capabilities` stores the union of base capabilities + any additional ones the client declares. The `requires` matching uses standard set operations.

```python
# Client can declare additional capabilities beyond base
client_capabilities = BASE_CAPABILITIES | client_declared_capabilities

# Validate all capabilities are known
unknown = client_capabilities - KNOWN_CAPABILITIES
if unknown:
    raise UnknownCapabilityError(unknown)
```

**Q: How to filter workflow_run_resolutions?**

A: Always read latest resolution for a run:

<!--this is not going to work right? what if there's 2 clients accessing same workflow? just sorting isnt goiing to work,-->
```sql
SELECT * FROM workflow_run_resolutions
WHERE workflow_run_id = :run_id
ORDER BY created_at DESC
LIMIT 1;
```

---

## Part 3: State Keying - Handling Workflow Updates

<!--i dont think any of proposals going to work, more than anything, this is going to break existing state logic which will be a disaster, for now lets take this out of this document. Add this tom techdebt with full details and current proposals. -->

### The Problem

When user updates a workflow:
- Existing runs have state keyed by some identifier
- New workflow might have different modules
- How do we avoid state corruption?

### Option A: Version-Scoped State (Recommended)

State is tied to specific workflow_resolution. Each run has its own frozen workflow.

```json
{
  "_module_states": {
    "user_input": {
      "0": { "status": "completed", "outputs": {...} },
      "1": { "status": "pending" }
    }
  },
  "_resolution_id": "abc-123"  // Which resolution this state belongs to
}
```

**How it works:**
- State uses module index (simple, deterministic)
- Resolution ID ensures we always load matching workflow
- Workflow updates create NEW resolutions, don't affect existing runs
- Existing runs continue with their original resolution

**Pros:**
- Simple implementation
- No migration needed
- Updates can't corrupt existing runs

**Cons:**
- Can't "upgrade" running workflow to new version
- Each run frozen to its start-time workflow

### Option B: Module Path Keying

Key by `step_id + module_name + group_origin`:

```json
{
  "_module_states": {
    "user_input::select_aesthetics_form::webui_rich": {
      "status": "completed",
      "outputs": {...}
    },
    "user_input::next_module": {
      "status": "pending"
    }
  }
}
```

**How it works:**
- Composite key includes enough context to identify module
- `group_origin` differentiates same-named modules in different groups
- Updates that preserve names are compatible

**Pros:**
- Human-readable state keys
- Some workflow changes are compatible

**Cons:**
- Renames break state
- More complex key generation
- Still fragile to structural changes

### Option C: Server-Assigned Stable IDs

At upload time, server assigns `_stable_id` to each module:

```json
{
  "module_id": "user.form",
  "name": "select_aesthetics_form",
  "_stable_id": "m_8a7b6c5d"  // Generated at upload, never changes
}
```

State keyed by stable ID:

```json
{
  "_module_states": {
    "m_8a7b6c5d": { "status": "completed", "outputs": {...} },
    "m_1f2e3d4c": { "status": "pending" }
  }
}
```

**How it works:**
- IDs assigned at upload, preserved across re-uploads if module unchanged
- Matching algorithm: same step_id + same name + same module_id = same stable_id
- Changed modules get new stable_id

**Pros:**
- Survives renames (if other identifiers match)
- Clear versioning semantics

**Cons:**
- Complex matching algorithm
- Need to handle "is this the same module?" heuristics
- Migration needed for existing workflows

### Option D: Hybrid - Index with Version Check

Use simple index, but validate workflow version matches:

```json
{
  "_module_states": {
    "user_input": {
      "0": { "status": "completed", "outputs": {...} }
    }
  },
  "_workflow_hash": "sha256:abc123"  // Hash of workflow structure
}
```

**How it works:**
- State uses simple index (fast, simple)
- Workflow structure hash stored with state
- On resume, if hash doesn't match, state is invalidated for affected steps
- User prompted to restart affected steps

**Pros:**
- Simple indexing
- Explicit handling of version mismatch
- User has control over what happens

**Cons:**
- May lose progress on workflow update
- Need UI for "workflow changed, restart step?" flow

### Recommendation: Option A (Version-Scoped)

Given that:
1. Flattened workflows are stored per-resolution
2. Each run links to specific resolution
3. Workflow updates create new resolutions

**Option A is the natural fit.** State is inherently tied to the resolution it was created with. No complex matching needed.

If user updates workflow:
- Existing runs continue with old resolution (no impact)
- New runs use new resolution
- No state migration needed

---

## Part 4: Generic `user.form` Module

### Design Principle

`user.form` outputs clean, generic data structure. Any workflow-specific transformation happens in a separate `transform.*` module.

### Module Definition

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
        }
      }
    ]
  },
  "outputs_to_state": {
    "result": "form_result"
  }
}
```

### Generic Output Structure

#### Per-Item Group Output

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
        "_item": { "id": "mystical", "label": "Mystical", "description": "..." },
        "_index": 1,
        "count": 0,
        "mode": "e"
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

**Structure:**
- Keyed by group `id` ("aesthetics")
- Array of items, each containing:
  - `_item`: Original item from data source (full object)
  - `_index`: Position in original data array
  - User input values (`count`, `mode`, etc.)

#### Static Group Output

```json
{
  "module_id": "user.form",
  "inputs": {
    "groups": [
      {
        "id": "mj_params",
        "type": "static",
        "schema": {
          "type": "object",
          "input": [
            { "key": "niji", "type": "select", "options": [5, 6], "default": 6 },
            { "key": "ar", "type": "select", "options": ["2:3", "16:9", "1:1"], "default": "2:3" },
            { "key": "chaos", "type": "number", "min": 0, "max": 100, "default": 0 }
          ]
        }
      }
    ]
  }
}
```

Output:
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

#### Mixed Groups Output

```json
{
  "form_result": {
    "global_settings": {
      "ar": "2:3",
      "raw": true
    },
    "per_prompt": [
      { "_item": {...}, "_index": 0, "stylize": 150, "enabled": true },
      { "_item": {...}, "_index": 1, "stylize": 200, "enabled": false }
    ]
  }
}
```

### Server-Side Filtering (Optional)

Form can optionally filter out items where inputs match certain criteria:

```json
{
  "groups": [{
    "id": "aesthetics",
    "type": "per_item",
    "filter_output": {
      "exclude_when": { "count": 0 }
    }
  }]
}
```

This is generic - just excludes items matching condition. NOT workflow-specific logic.

Output with filter:
```json
{
  "form_result": {
    "aesthetics": [
      { "_item": {...}, "_index": 0, "count": 2, "mode": "w" },
      { "_item": {...}, "_index": 2, "count": 4, "mode": "q" }
      // Index 1 excluded because count=0
    ]
  }
}
```

---

## Part 5: Transform Module for Format Conversion

### Workflow-Specific Transformation

If a workflow needs specific output format (like `aesthetic_selections` with `with_count`/`without_count`), use a transform module:

```json
{
  "modules": [
    {
      "module_id": "user.form",
      "name": "aesthetic_form",
      "inputs": { ... },
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
```

### Benefits

1. **Generic form module** - No workflow knowledge
2. **Workflow-specific logic in workflow** - Transform template is in workflow JSON
3. **Reusable transform module** - `transform.reshape` handles any structure transformation
4. **Clear separation** - Form collects data, transform shapes it

---

## Part 6: Validation with `io.validate` Module

### Approach

Instead of embedding `output_schema` in metadata, `pipeline.execution_groups` adds `io.validate` module at end of each group during flattening.

### Original Workflow

```json
{
  "module_id": "pipeline.execution_groups",
  "name": "aesthetic_pipeline",
  "groups": [...],
  "output_schema": {
    "type": "object",
    "required": ["aesthetic_selections"],
    "properties": {
      "aesthetic_selections": { "type": "array" }
    }
  }
}
```

### Flattened Workflow

```json
{
  "modules": [
    {
      "module_id": "user.form",
      "name": "aesthetic_form",
      "_group_origin": { "group_name": "aesthetic_pipeline", "path_name": "webui_rich" }
    },
    {
      "module_id": "transform.reshape",
      "name": "format_aesthetics",
      "_group_origin": { "group_name": "aesthetic_pipeline", "path_name": "webui_rich" }
    },
    {
      "module_id": "io.validate",
      "name": "_aesthetic_pipeline_validator",
      "inputs": {
        "schema": {
          "type": "object",
          "required": ["aesthetic_selections"],
          "properties": {
            "aesthetic_selections": { "type": "array" }
          }
        },
        "state_keys": ["aesthetic_selections"]
      },
      "_group_origin": {
        "group_name": "aesthetic_pipeline",
        "path_name": "webui_rich",
        "is_group_exit": true,
        "auto_generated": true
      }
    },
    {
      "module_id": "some.other_module",
      "name": "next_step"
    }
  ]
}
```

### `io.validate` Module Behavior

```python
class ValidateModule:
    """
    Validates state values against JSON schema.
    Auto-added by pipeline.execution_groups at group exit.
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

## Part 7: Complete Example

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

### Flattened for WebUI

```json
{
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "user.form",
        "name": "aesthetic_form",
        "inputs": { ... },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
         "path_name": "webui_path"
        }
      },
      {
        "module_id": "transform.reshape",
        "name": "format_aesthetics",
        "inputs": { ... },
        "_group_origin": {
          "group_name": "aesthetic_selection_pipeline",
          "path_name": "webui_path"
        }
      },
      {
        "module_id": "io.validate",
        "name": "_aesthetic_selection_pipeline_validator",
        "inputs": {
          "schema": { ... },
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
| Capability source | Module IDs from server registry |
| Storage strategy | Strategy A - Flatten at upload |
| Database | New `workflow_resolutions` + `workflow_run_resolutions` tables |
| State keying | Option A - Version-scoped (tied to resolution) |
| Form output | Generic structure with `_item`, `_index`, user inputs |
| Format conversion | Separate `transform.reshape` module |
| Validation | `io.validate` module auto-added by flattener |

---

## Questions for Review

1. Does the capabilities = module IDs approach make sense?
2. Is the database schema clear? Any concerns with the resolution tables?
3. Is Option A (version-scoped state) acceptable, or do you need cross-version state compatibility?
4. Does the generic form output structure work for both aesthetics and MJ params use cases?
5. Is `transform.reshape` the right approach for workflow-specific format conversion?
