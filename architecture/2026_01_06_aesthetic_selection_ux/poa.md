# Aesthetic Selection UX - Plan of Action

Based on architecture revisions R1-R11.

---

## Overview

This POA implements a system for **client-specific workflow execution paths**. The core concept:

1. Workflows can define alternative module sequences for different clients (WebUI vs TUI)
2. At upload time, all path combinations are pre-computed and stored as "resolutions"
3. At runtime, clients declare their capabilities and receive the best matching flattened workflow
4. When workflows are updated mid-run, users are prompted if changes affect completed steps

### Components

| Component | Type | Purpose |
|-----------|------|---------|
| `pipeline.execution_groups` | **Meta-module** | Defines client-specific paths in workflow JSON, processed at upload time |
| `user.form` | Interactive module | Rich form UI with per-item and static groups |
| `io.validate` | Executable module | Schema validation (auto-added by flattener at group exit) |
| `transform.reshape` | Executable module | Generic data transformation using templates |
| `workflow_resolutions` | DB Collection | Maps source workflow to flattened versions by capability requirements |
| `workflow_run_resolutions` | DB Collection | Links workflow runs to their active resolution |

---

## Part 1: Capabilities System

### What Are Capabilities?

Capabilities are **module IDs** from the server's module registry. A client declares which modules it can render/handle.

**Important**: Meta-modules like `pipeline.execution_groups` are NOT capabilities - they are processed at upload time and never sent to clients.

### Capability Sets by Client

```python
# Server-side known capabilities (from module registry)
KNOWN_CAPABILITIES = {
    # User interaction modules
    "user.select",
    "user.text_input",
    "user.confirm",
    "user.form",           # WebUI only - rich form UI
    "user.file_download",
    "user.file_input",

    # Transform modules
    "transform.parse_pattern",
    "transform.reshape",

    # IO modules
    "io.validate",

    # API modules
    "api.llm",
}

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

# WebUI client capabilities (superset of TUI)
WEBUI_CAPABILITIES = TUI_CAPABILITIES | {"user.form"}
```

### Capability Matching

A resolution matches a client if ALL its required capabilities are in the client's set:

```
resolution.requires ⊆ client_capabilities
```

When multiple resolutions match, the one with **highest priority score** wins.

---

## Part 2: `pipeline.execution_groups` Meta-Module

This is the **core component** of the entire design. It defines alternative execution paths within a workflow.

### Definition Format

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
          "inputs": { ... },
          "outputs_to_state": { "result": "aesthetic_selections" }
        }
      ]
    },
    {
      "name": "tui_path",
      "requires": [
        { "capability": "user.text_input", "priority": 50 }
      ],
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
          "inputs": { ... },
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
}
```

### Key Properties

| Property | Required | Description |
|----------|----------|-------------|
| `module_id` | Yes | Must be `"pipeline.execution_groups"` |
| `name` | Yes | Unique identifier for this group (used in `selected_paths`) |
| `groups` | Yes | Array of execution path options |
| `groups[].name` | Yes | Path identifier (e.g., `"webui_path"`, `"tui_path"`) |
| `groups[].requires` | Yes | Array of `{capability, priority}` objects |
| `groups[].modules` | Yes | Array of modules to execute for this path |
| `output_schema` | No | JSON Schema to validate; if present, `io.validate` is auto-added |

### Priority System

Each capability has an explicit priority value. When a client matches multiple resolutions:

1. **Filter**: Only consider resolutions where ALL required capabilities are present
2. **Score**: Sum priority values of all required capabilities
3. **Select**: Pick resolution with **highest** score

Example:
```
WebUI capabilities: [user.form, user.text_input, user.select, ...]

Resolution A: requires=[{user.form, 100}]           → score = 100 ✓
Resolution B: requires=[{user.text_input, 50}]      → score = 50  ✓

WebUI picks Resolution A (higher score)
```

### Processing Behavior

`pipeline.execution_groups` is **NOT executed at runtime**. Instead:

1. **At upload time**: Server scans workflow for `pipeline.execution_groups` modules
2. **Generates combinations**: All possible path selections across all groups
3. **Flattens workflow**: Replaces `execution_groups` with selected modules inline
4. **Creates resolutions**: Links each flattened version to its capability requirements
5. **At runtime**: Client receives pre-flattened workflow (no `execution_groups` visible)

---

## Part 3: Workflow Upload and Flattening

### Upload Flow

```
User uploads workflow JSON
    │
    ▼
Server parses workflow, resolves $refs
    │
    ▼
Server creates RAW workflow_version:
    {
        workflow_version_id: "ver_raw_xxx",
        resolved_workflow: <workflow with execution_groups intact>
    }
    │
    ▼
Server scans for pipeline.execution_groups modules
    │
    ├─► If NO execution_groups found:
    │       - Create single resolution with requires=[]
    │       - resolved_workflow_version_id = source (same)
    │       - Done
    │
    └─► If execution_groups found:
            │
            ▼
        Collect all groups: [(group1_paths), (group2_paths), ...]
            │
            ▼
        Generate all combinations using itertools.product
            │
            ▼
        For each combination:
            1. Flatten workflow (inline selected paths' modules)
            2. Add _group_origin metadata to inlined modules
            3. Add io.validate module if output_schema defined
            4. Compute requires = union of all selected paths' requires
            5. Create workflow_version for flattened workflow
            6. Create workflow_resolution record
```

### Example: 2 Groups × 2 Paths

```
Group 1 (aesthetic): webui_path, tui_path
Group 2 (params):    webui_path, tui_path

Combinations (4 total):
  (webui, webui): requires=[{user.form, 100}, {user.form, 80}],  score=180
  (webui, tui):   requires=[{user.form, 100}, {user.text_input, 40}], score=140
  (tui, webui):   requires=[{user.text_input, 50}, {user.form, 80}],  score=130
  (tui, tui):     requires=[{user.text_input, 50}, {user.text_input, 40}], score=90

Database records:
  workflow_versions: 5 (1 raw + 4 flattened)
  workflow_resolutions: 4
```

### Flattening Algorithm

```python
def flatten_workflow(
    workflow: dict,
    selected_paths: dict[str, str]  # {group_name: path_name}
) -> tuple[dict, list[dict], dict[str, str]]:
    """
    Flatten workflow by inlining selected paths.

    Returns:
        - Flattened workflow dict
        - Merged requires list
        - Selected paths mapping
    """
    result = copy.deepcopy(workflow)
    all_requires = []

    for step in result["steps"]:
        new_modules = []

        for module in step["modules"]:
            if module.get("module_id") == "pipeline.execution_groups":
                group_name = module["name"]
                output_schema = module.get("output_schema")

                # Find selected path
                selected_path_name = selected_paths[group_name]
                selected_group = next(
                    g for g in module["groups"]
                    if g["name"] == selected_path_name
                )

                # Track requires
                all_requires.extend(selected_group.get("requires", []))

                # Inline modules with metadata
                for i, inner_module in enumerate(selected_group["modules"]):
                    inner_copy = copy.deepcopy(inner_module)
                    inner_copy["_group_origin"] = {
                        "group_name": group_name,
                        "path_name": selected_path_name,
                        "requires": selected_group["requires"],
                        "module_index": i
                    }
                    new_modules.append(inner_copy)

                # Add validator at group exit
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
                            "path_name": selected_path_name,
                            "is_group_exit": True,
                            "auto_generated": True
                        }
                    }
                    new_modules.append(validator)
            else:
                new_modules.append(module)

        step["modules"] = new_modules

    return result, all_requires, selected_paths
```

### Flattened Workflow Example

**Before (raw workflow with execution_groups):**
```json
{
  "steps": [{
    "step_id": "user_input",
    "modules": [
      {
        "module_id": "pipeline.execution_groups",
        "name": "aesthetic_pipeline",
        "groups": [...],
        "output_schema": {...}
      },
      { "module_id": "some.next_module", "name": "next" }
    ]
  }]
}
```

**After (flattened for webui_path):**
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
          "requires": [{"capability": "user.form", "priority": 100}],
          "module_index": 0
        },
        ...
      },
      {
        "module_id": "transform.reshape",
        "name": "format_aesthetics",
        "_group_origin": {
          "group_name": "aesthetic_pipeline",
          "path_name": "webui_path",
          "requires": [{"capability": "user.form", "priority": 100}],
          "module_index": 1
        },
        ...
      },
      {
        "module_id": "io.validate",
        "name": "_aesthetic_pipeline_validator",
        "_group_origin": {
          "group_name": "aesthetic_pipeline",
          "path_name": "webui_path",
          "is_group_exit": true,
          "auto_generated": true
        },
        "inputs": {
          "schema": {...},
          "state_keys": ["aesthetic_selections"]
        }
      },
      { "module_id": "some.next_module", "name": "next" }
    ]
  }]
}
```

---

## Part 4: Database Schema

### 4.1 Collection: `workflow_resolutions`

Maps raw workflow versions to flattened versions with their capability requirements.

**Schema**:
```javascript
{
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    workflow_template_id: "tpl_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",      // Raw workflow with execution_groups
    resolved_workflow_version_id: "ver_flat_xxx",   // Flattened workflow

    // Capabilities with priorities - NO pre-computed score (compute at query time)
    requires: [
        { "capability": "user.form", "priority": 100 },
        { "capability": "user.text_input", "priority": 40 }
    ],

    // Which path was selected for each execution_groups module
    selected_paths: {
        "aesthetic_pipeline": "webui_path",
        "params_pipeline": "tui_path"
    },

    created_at: ISODate()
}
```

**Indexes**:
```javascript
db.workflow_resolutions.createIndex({ workflow_template_id: 1, source_workflow_version_id: 1 })
db.workflow_resolutions.createIndex({ source_workflow_version_id: 1 })
```

### 4.2 Collection: `workflow_run_resolutions`

Links workflow runs to their active resolution. Supports version switching mid-run.

**Schema**:
```javascript
{
    workflow_run_resolution_id: "runres_xxxxxxxxxxxx",
    workflow_run_id: "wf_xxxxxxxxxxxx",
    workflow_resolution_id: "res_xxxxxxxxxxxx",
    source_workflow_version_id: "ver_raw_xxx",  // For version comparison on resume
    client_capabilities: ["user.form", "user.select"],
    is_active: true,
    created_at: ISODate()
}
```

**Indexes**:
```javascript
// Unique constraint: one active resolution per run
db.workflow_run_resolutions.createIndex(
    { workflow_run_id: 1, is_active: 1 },
    { unique: true, partialFilterExpression: { is_active: true } }
)
```

### 4.3 Database Methods

**File**: `server/api/database_provider.py`

```python
async def create_workflow_resolution(self, resolution: dict) -> str:
    """Create a workflow resolution record."""
    resolution["workflow_resolution_id"] = self._generate_id("res")
    resolution["created_at"] = datetime.utcnow()
    await self.db.workflow_resolutions.insert_one(resolution)
    return resolution["workflow_resolution_id"]

async def get_workflow_resolutions_for_template(
    self,
    workflow_template_id: str,
    source_workflow_version_id: str = None
) -> list[dict]:
    """Get all resolutions for a template, optionally filtered by source version."""
    query = {"workflow_template_id": workflow_template_id}
    if source_workflow_version_id:
        query["source_workflow_version_id"] = source_workflow_version_id
    return await self.db.workflow_resolutions.find(query).to_list(None)

async def create_workflow_run_resolution(self, run_resolution: dict) -> str:
    """Create a workflow run resolution record."""
    run_resolution["workflow_run_resolution_id"] = self._generate_id("runres")
    run_resolution["created_at"] = datetime.utcnow()
    run_resolution["is_active"] = True
    await self.db.workflow_run_resolutions.insert_one(run_resolution)
    return run_resolution["workflow_run_resolution_id"]

async def get_active_run_resolution(self, workflow_run_id: str) -> dict | None:
    """Get active resolution for a workflow run."""
    return await self.db.workflow_run_resolutions.find_one({
        "workflow_run_id": workflow_run_id,
        "is_active": True
    })

async def switch_run_resolution(
    self,
    workflow_run_id: str,
    new_resolution_id: str,
    client_capabilities: list[str],
    source_workflow_version_id: str
) -> str:
    """Switch active resolution for a run (deactivate old, create new)."""
    await self.db.workflow_run_resolutions.update_many(
        {"workflow_run_id": workflow_run_id, "is_active": True},
        {"$set": {"is_active": False}}
    )
    return await self.create_workflow_run_resolution({
        "workflow_run_id": workflow_run_id,
        "workflow_resolution_id": new_resolution_id,
        "source_workflow_version_id": source_workflow_version_id,
        "client_capabilities": client_capabilities
    })
```

### 4.4 Migration Script

**File**: `server/api/database_migrations/m_6.py`

- Create `workflow_resolutions` collection
- Create `workflow_run_resolutions` collection
- Create indexes
- No data migration needed (new feature)

---

## Part 5: Workflow Start Flow

### API Request

```python
class StartWorkflowRequest(BaseModel):
    workflow_template_name: str = None
    project_name: str
    capabilities: list[str] = []  # NEW - client declares its capabilities
    # ... existing fields
```

### Single Aggregation Query

Find matching resolution in one query:

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

    // Stage 6: Compute score and sort (highest score wins)
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
    },
    {
        $addFields: {
            matching_resolutions: {
                $sortArray: { input: "$matching_resolutions", sortBy: { computed_score: -1 } }
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
            resolution: 1,
            resolved_workflow: { $arrayElemAt: ["$resolved_version.resolved_workflow", 0] }
        }
    }
]).toArray();
```

### After Query: Create Run Records

```python
# Create workflow_run
run = {
    "workflow_run_id": generate_id("wf"),
    "workflow_template_id": data["workflow_template_id"],
    "workflow_template_name": data["workflow_template_name"],
    "project_name": request.project_name,
    "status": "created",
    ...
}
await db.workflow_runs.insert_one(run)

# Create workflow_run_resolution
await db.workflow_run_resolutions.insert_one({
    "workflow_run_resolution_id": generate_id("runres"),
    "workflow_run_id": run["workflow_run_id"],
    "workflow_resolution_id": data["resolution"]["workflow_resolution_id"],
    "source_workflow_version_id": data["resolution"]["source_workflow_version_id"],
    "client_capabilities": request.capabilities,
    "is_active": True,
    "created_at": datetime.utcnow()
})

# Proceed with data["resolved_workflow"]
```

---

## Part 6: Workflow Resume Flow

### Resume Aggregation Query

```javascript
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
            source_workflow_version_id: 1,
            resolved_workflow: "$resolved_version.resolved_workflow"
        }
    }
]).toArray();
```

### Version Change Detection

On resume, check if a new workflow version is available:

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

    # Get latest source version for this template
    latest_source_id = await get_latest_source_version(run["workflow_template_id"])

    # Check if on latest version
    if current_run_res["source_workflow_version_id"] == latest_source_id:
        # Already on latest, proceed normally
        return {"action": "proceed", "workflow": current_workflow}

    # New version available - find matching resolution
    new_resolution = await find_matching_resolution(latest_source_id, client_capabilities)
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
        await switch_resolution(workflow_run_id, new_resolution, client_capabilities)
        return {"action": "proceed", "workflow": new_workflow}
    else:
        # Past/current changes - need user decision
        return {
            "action": "confirm_required",
            "changes": changes,
            "message": "Workflow updated with changes to completed steps."
        }
```

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
            "changes_before_current": [...],  # Changes to past execution
            "changes_at_current": [...],      # Changes to current step/module
            "changes_after_current": [...],   # Changes to future steps
            "can_proceed_safely": bool        # True if no past/current changes
        }
    """
    old_steps = {s["step_id"]: s for s in old_workflow["steps"]}
    new_steps = {s["step_id"]: s for s in new_workflow["steps"]}

    step_order = [s["step_id"] for s in new_workflow["steps"]]
    current_step_index = step_order.index(current_step_id) if current_step_id in step_order else -1

    changes_before = []
    changes_at = []
    changes_after = []

    for i, step_id in enumerate(step_order):
        step_changes = compare_steps(old_steps.get(step_id), new_steps.get(step_id))

        if step_changes:
            if i < current_step_index:
                changes_before.extend(step_changes)
            elif i == current_step_index:
                changes_at.extend(step_changes)
            else:
                changes_after.extend(step_changes)

    return {
        "changes_before_current": changes_before,
        "changes_at_current": changes_at,
        "changes_after_current": changes_after,
        "can_proceed_safely": len(changes_before) == 0 and len(changes_at) == 0
    }
```

---

## Part 7: New Modules

### 7.1 `user.form` Module

Rich form interaction with multiple field types for WebUI.

**Server**: `server/modules/user/form.py`

```python
class FormModule(InteractiveModule):
    """Rich form interaction with multiple field types."""

    module_id = "user.form"

    def create_interaction_request(self, inputs: dict, context: WorkflowContext) -> InteractionRequest:
        """Create form interaction request."""
        return InteractionRequest(
            interaction_type="form",
            title=inputs.get("title", "Form"),
            groups=self._process_groups(inputs["groups"], context)
        )

    def process_response(self, response: InteractionResponse, inputs: dict) -> dict:
        """Process form response, apply filters, return structured output."""
        result = response["result"]

        # Apply server-side filtering
        for group in inputs["groups"]:
            if "filter_output" in group:
                filter_config = group["filter_output"]
                group_id = group["id"]
                if group_id in result and isinstance(result[group_id], list):
                    result[group_id] = [
                        item for item in result[group_id]
                        if not self._matches_exclude(item, filter_config.get("exclude_when", {}))
                    ]

        return {"result": result}
```

**Module Configuration**:
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
  "outputs_to_state": { "result": "form_result" }
}
```

**Output Format (per_item group)**:
```json
{
  "form_result": {
    "aesthetics": [
      {
        "_item": { "id": "futuristic", "label": "Futuristic", "description": "..." },
        "_index": 0,
        "count": 2,
        "mode": "w"
      }
    ]
  }
}
```

**Output Format (static group)**:
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

**Field Types**:
| Type | Description | Config |
|------|-------------|--------|
| `number` | Numeric with +/- controls | `min`, `max`, `step`, `default` |
| `select` | Single choice dropdown/buttons | `options[]`, `default` |
| `toggle` | Boolean on/off | `default`, `labels` |
| `text` | Free text input | `placeholder`, `max_length` |

### 7.2 `io.validate` Module

Schema validation module. Auto-added by flattener at group exit.

**Server**: `server/modules/io/validate.py`

```python
class ValidateModule(ExecutableModule):
    """Validate state values against JSON schema."""

    module_id = "io.validate"

    def execute(self, inputs: dict, context: WorkflowContext) -> dict:
        """Validate state keys against schema, raise on failure."""
        schema = inputs["schema"]
        state_keys = inputs["state_keys"]

        data = {key: context.state.get(key) for key in state_keys}

        try:
            jsonschema.validate(data, schema)
        except jsonschema.ValidationError as e:
            raise ModuleExecutionError(f"Group output validation failed: {e.message}")

        return {}  # No outputs, just validation
```

**Usage (auto-generated by flattener)**:
```json
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
  }
}
```

### 7.3 `transform.reshape` Module

Generic data transformation using templates. Converts `user.form` generic output to workflow-specific format.

**Server**: `server/modules/transform/reshape.py`

```python
class ReshapeModule(ExecutableModule):
    """Generic data transformation using templates."""

    module_id = "transform.reshape"

    def execute(self, inputs: dict, context: WorkflowContext) -> dict:
        """Transform source data using template."""
        source = inputs["source"]
        template = inputs["template"]

        if "_for_each" in template:
            return self._transform_array(source, template)
        else:
            return self._transform_object(source, template)

    def _transform_array(self, source: list, template: dict) -> dict:
        """Transform array using _for_each template."""
        item_var = template["_for_each"]  # e.g., "$item"
        output_template = template["_output"]

        result = []
        for item in source:
            transformed = self._apply_template(output_template, {item_var: item})
            result.append(transformed)

        return {"result": result}

    def _apply_template(self, template: dict, context: dict) -> dict:
        """Apply Jinja2 templates in template dict."""
        # Process each value as Jinja2 template
        pass
```

**Usage Example**:
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

## Part 8: API Changes

### 8.1 Request/Response Models

**File**: `server/api/models.py`

```python
class StartWorkflowRequest(BaseModel):
    workflow_template_name: str = None
    project_name: str
    capabilities: list[str] = []  # NEW
    # ... existing fields

class VersionChangeInfo(BaseModel):
    changes_before_current: list[dict]
    changes_at_current: list[dict]
    changes_after_current: list[dict]

class WorkflowResponse(BaseModel):
    # ... existing fields
    version_change: VersionChangeInfo | None = None
    confirm_required: bool = False
```

### 8.2 New Endpoint: Confirm Version Switch

**File**: `server/api/workflow_api.py`

```python
@app.post("/workflow/{workflow_run_id}/confirm-version")
async def confirm_version_switch(
    workflow_run_id: str,
    choice: Literal["switch", "keep_current"],
    capabilities: list[str]
):
    """Handle user decision on version switch."""
    if choice == "keep_current":
        # Continue with current resolution
        current_workflow = await load_current_workflow(workflow_run_id)
        return {"action": "proceed", "workflow": current_workflow}

    elif choice == "switch":
        # Switch to new version
        run = await db.workflow_runs.find_one({"workflow_run_id": workflow_run_id})
        latest_source_id = await get_latest_source_version(run["workflow_template_id"])
        new_resolution = await find_matching_resolution(latest_source_id, capabilities)

        await switch_run_resolution(
            workflow_run_id,
            new_resolution["workflow_resolution_id"],
            capabilities,
            latest_source_id
        )

        new_workflow = await load_workflow(new_resolution["resolved_workflow_version_id"])
        return {"action": "proceed", "workflow": new_workflow}
```

---

## Part 9: WebUI Changes

### 9.1 Types

**File**: `webui/src/lib/types.ts`

```typescript
// Add to InteractionType
type InteractionType =
  | "text_input"
  | "select_from_structured"
  | "review_grouped"
  | "file_input"
  | "file_download"
  | "form"  // NEW
  | "resume_choice"
  | "retry_options";

// Form interaction types
interface FormFieldBase {
  key: string;
  type: "number" | "select" | "toggle" | "text";
  label?: string;
  default?: unknown;
}

interface NumberField extends FormFieldBase {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
}

interface SelectField extends FormFieldBase {
  type: "select";
  options: Array<{ value: string; label: string }>;
}

interface ToggleField extends FormFieldBase {
  type: "toggle";
}

interface TextField extends FormFieldBase {
  type: "text";
  placeholder?: string;
  maxLength?: number;
}

type FormField = NumberField | SelectField | ToggleField | TextField;

interface FormGroup {
  id: string;
  type: "per_item" | "static";
  data?: unknown[];
  schema: {
    type: string;
    items?: {
      properties?: Record<string, unknown>;
      input?: FormField[];
    };
    input?: FormField[];  // For static groups
  };
  filter_output?: { exclude_when: Record<string, unknown> };
}

interface FormInteractionRequest {
  interaction_type: "form";
  title: string;
  groups: FormGroup[];
}

// Version change types
interface WorkflowChange {
  type: "step_added" | "step_removed" | "module_added" | "module_removed" | "module_modified";
  step_id: string;
  module_name?: string;
}

interface VersionChangeInfo {
  changes_before_current: WorkflowChange[];
  changes_at_current: WorkflowChange[];
  changes_after_current: WorkflowChange[];
}
```

### 9.2 Form Interaction Components

**Directory**: `webui/src/components/workflow/interactions/form/`

| File | Purpose |
|------|---------|
| `FormInteractionHost.tsx` | Main form component, renders groups |
| `PerItemGroup.tsx` | Renders per-item group with data rows |
| `StaticGroup.tsx` | Renders static group fields |
| `fields/NumberField.tsx` | Number input with +/- controls |
| `fields/SelectField.tsx` | Dropdown or button group |
| `fields/ToggleField.tsx` | Toggle switch |
| `fields/TextField.tsx` | Text input |

### 9.3 Version Confirmation Dialog

**File**: `webui/src/components/workflow/VersionConfirmDialog.tsx`

- Show when API returns `confirm_required: true`
- Display changes categorized by position (before/at/after current)
- Let user choose "Continue with new version" or "Stay on current version"

---

## Part 10: TUI Changes

### 10.1 Form Strategy

**File**: `tui/strategies/form.py`

```python
class FormStrategy(InteractionStrategy):
    """Handle form interactions in TUI with text-based fallback."""

    def handle(self, request: InteractionRequest) -> InteractionResponse:
        """Render form fields and collect input."""
        result = {}

        for group in request.groups:
            if group["type"] == "per_item":
                result[group["id"]] = self._handle_per_item_group(group)
            else:
                result[group["id"]] = self._handle_static_group(group)

        return InteractionResponse(result=result)

    def _handle_per_item_group(self, group: dict) -> list:
        """Render per-item group as text list with inputs."""
        # For each item in data, show item display and collect field inputs
        pass

    def _handle_static_group(self, group: dict) -> dict:
        """Render static group as vertical field list."""
        # For each field, prompt for input
        pass
```

### 10.2 Register Strategy

**File**: `tui/handler.py`

```python
from tui.strategies.form import FormStrategy

self._strategies = {
    # ... existing strategies
    InteractionType.FORM: FormStrategy(self),
}
```

---

## Part 11: Contracts Update

**File**: `contracts/interaction.py`

```python
class InteractionType(str, Enum):
    TEXT_INPUT = "text_input"
    SELECT_FROM_STRUCTURED = "select_from_structured"
    REVIEW_GROUPED = "review_grouped"
    FILE_INPUT = "file_input"
    FILE_DOWNLOAD = "file_download"
    FORM = "form"  # NEW
    RESUME_CHOICE = "resume_choice"
    RETRY_OPTIONS = "retry_options"
```

---

## Implementation Order

### Stage 1: Foundation
1. Database migration (collections + indexes)
2. `ExecutionGroupsProcessor` class with flattening logic
3. `io.validate` module
4. `transform.reshape` module

### Stage 2: Upload Pipeline
1. Modify workflow resolver to detect `pipeline.execution_groups`
2. Generate all path combinations
3. Create flattened workflow_versions
4. Create workflow_resolutions

### Stage 3: Start Flow
1. Add `capabilities` to start request
2. Implement aggregation query for resolution selection
3. Create `workflow_run_resolution` on start
4. Return flattened workflow to client

### Stage 4: Resume Flow
1. Implement resume aggregation query
2. Add version change detection
3. Implement `confirm-version` endpoint
4. Return appropriate response based on changes

### Stage 5: `user.form` Module
1. Server module implementation
2. WebUI form components
3. TUI fallback strategy
4. Register in module registry and contracts

### Stage 6: Testing
1. Unit tests for flattening logic
2. Unit tests for resolution selection (priority scoring)
3. Unit tests for version change detection
4. Integration tests for full start/resume flows
5. Manual testing with OMS workflow

---

## Files Summary

### New Files
| File | Purpose |
|------|---------|
| `server/engine/execution_groups.py` | Flattening engine for `pipeline.execution_groups` |
| `server/modules/io/validate.py` | Schema validation module |
| `server/modules/transform/reshape.py` | Data transformation module |
| `server/modules/user/form.py` | Rich form interaction module |
| `server/api/database_migrations/m_6.py` | Create new collections |
| `tui/strategies/form.py` | TUI form strategy |
| `webui/src/components/workflow/interactions/form/FormInteractionHost.tsx` | Main form component |
| `webui/src/components/workflow/interactions/form/PerItemGroup.tsx` | Per-item group renderer |
| `webui/src/components/workflow/interactions/form/StaticGroup.tsx` | Static group renderer |
| `webui/src/components/workflow/interactions/form/fields/*.tsx` | Field components |
| `webui/src/components/workflow/VersionConfirmDialog.tsx` | Version switch dialog |

### Modified Files
| File | Changes |
|------|---------|
| `server/api/database_provider.py` | New collection methods |
| `server/api/workflow_resolver.py` | Flattening integration |
| `server/api/workflow_api.py` | Start/resume changes, new endpoint |
| `server/api/workflow_diff.py` | Change detection logic |
| `server/api/models.py` | New request/response types |
| `server/engine/module_registry.py` | Register new modules |
| `contracts/interaction.py` | New interaction type |
| `tui/handler.py` | Register form strategy |
| `webui/src/lib/types.ts` | New types |
| `webui/src/components/workflow/interactions/InteractionHost.tsx` | Handle form type |

---

## Risk Areas

1. **Flattening correctness** - Must preserve all module properties, handle nested $refs
2. **Priority scoring edge cases** - Same score scenarios (first match wins)
3. **State compatibility on version switch** - Orphaned state from old modules
4. **WebUI form complexity** - Schema-driven rendering with multiple field types
5. **Cross-client resume** - TUI resuming WebUI workflow (or vice versa)

---

## Success Criteria

1. Workflow upload correctly generates all flattened versions
2. Client capabilities correctly select best matching resolution
3. WebUI can render form interactions with per-item and static groups
4. TUI falls back gracefully to text-based form input
5. Resume with new version prompts user when changes affect completed steps
6. All existing workflows continue to work (no execution_groups = single resolution)
7. `_group_origin` metadata visible in workflow state panel for debugging
