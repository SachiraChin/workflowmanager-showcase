# Aesthetic Selection UX Improvement - Revision 3

## Summary of R2 Feedback

1. **`items_from` → `data`**: Use "data" for consistency
2. **`item_label` → `schema`**: Use existing schema mechanism for rendering
3. **Fields in schema**: Explore integrating input fields into the schema system
4. **`include_when`**: Move filtering to server-side, not client
5. **Output format**: Keep compatibility with existing parse_aesthetic module (#7857)
6. **Execution groups**: New mechanism for client-specific module paths - needs full proposal

---

## Part 1: Execution Groups (`pipeline.execution_groups`)

This is a workflow-level mechanism for client-specific paths. The workflow engine selects the appropriate path based on tags.

### Core Concept

A meta-module that contains multiple execution paths. Each path:
- Has tags (e.g., `["tui"]`, `["webui"]`, `["tui", "webui"]`)
- Contains a sequence of modules
- Must produce output matching a defined schema

### Key Design Questions

1. **When does path selection happen?**
2. **How is the workflow sent to client?**
3. **How to handle cross-client resume (TUI → WebUI)?**

---

### Option A: Runtime Path Selection

<!--I feel like this is a no go, primarily being, high possiblity of break in handling event, building workflow state, etc.-->

Path is selected at runtime when the execution_groups module is reached.

```
Workflow Load → Full workflow with all groups sent to client
                ↓
Execution reaches execution_groups
                ↓
Server checks client tag → Selects matching group → Executes modules
```

**Module Definition:**
```json
{
  "module_id": "pipeline.execution_groups",
  "name": "aesthetic_selection_pipeline",
  "inputs": {
    "tag_source": "client"  // or "state.some_field" for dynamic selection
  },
  "groups": [
    {
      "name": "tui_path",
      "tags": ["tui"],
      "modules": [
        { "module_id": "user.text_input", ... },
        { "module_id": "transform.parse_pattern", ... }
      ]
    },
    {
      "name": "webui_path",
      "tags": ["webui"],
      "modules": [
        { "module_id": "user.form", ... }
      ]
    }
  ],
  "output_schema": {
    "type": "object",
    "properties": {
      "aesthetic_selections": { "type": "array" }
    }
  }
}
```

**Pros:**
- Simpler implementation
- Workflow structure is preserved
- Can inspect full workflow

**Cons:**
- Client receives all paths (larger payload)
- Client sees modules it won't execute
- Cross-client resume is complex (which group was active?)

---

### Option B: Meta-Module (Workflow Load-Time Flattening)

Path is selected when workflow loads. The workflow is flattened before sending to client.

```
Client connects with tag (e.g., "webui")
        ↓
Server loads workflow definition
        ↓
Server encounters execution_groups → Selects matching group
        ↓
Server flattens: replaces execution_groups with selected modules
        ↓
Client receives flattened workflow (no execution_groups visible)
```

**Server Processing:**
```python
def flatten_workflow(workflow_def, client_tags):
    """Replace execution_groups with selected path's modules."""
    flattened_steps = []

    for step in workflow_def["steps"]:
        flattened_modules = []
        for module in step["modules"]:
            if module["module_id"] == "pipeline.execution_groups":
                # Find matching group
                selected = select_group(module["groups"], client_tags)
                # Inline the selected group's modules
                flattened_modules.extend(selected["modules"])
            else:
                flattened_modules.append(module)

        flattened_steps.append({**step, "modules": flattened_modules})

    return {**workflow_def, "steps": flattened_steps}
```

<!--I think bigger problem here is not how we flatten is, but how are we going to store it.
- are we going to flatten it every time workflow start/resume?
- are we going to flatten it at upload and then store versions in db?
- in either case, how are we handling debuging on client side, specially workflow state panel, 
how are we clearly convey that given set of modules are from a group?-->

**Pros:**
- Client sees clean, linear workflow
- Smaller payload (only relevant modules)
- Existing client code works unchanged
- Clear separation: server handles routing, client handles execution

**Cons:**
- Workflow structure is modified at load time
- Harder to debug (original structure not visible to client)
- Cross-client resume needs special handling

---

### Option C: Hybrid - Store Original, Execute Flattened

Store the original workflow but execute the flattened version. Track which path was taken.

<!-- how come this is different from above? i feel like this is an extension of above, am i 
reading this wrong?-->

```
Workflow stored with execution_groups intact
        ↓
On load: flatten for client + record path selection
        ↓
Store path selection in workflow run state:
  { "_execution_paths": { "aesthetic_selection_pipeline": "webui_path" } }
        ↓
On resume: use stored path selection (even if client changes)
```

**Handling Cross-Client Resume:**

```json
{
  "workflow_run_state": {
    "_execution_paths": {
      "aesthetic_selection_pipeline": "webui_path"
    },
    "_client_history": ["webui", "tui"],  // Track client switches
    "aesthetic_selections": [...]  // Actual data
  }
}
```

**Resume Scenarios:**

| Start | Resume | Behavior |
|-------|--------|----------|
| WebUI | WebUI | Continue normally |
| TUI | TUI | Continue normally |
| WebUI | TUI | Use original webui_path selection (TUI renders webui module's interaction) |
| TUI | WebUI | Use original tui_path selection (WebUI renders tui module's interaction) |

**Question:** Should cross-client resume:
- A) Force the original path (simpler, may have UX issues)
- B) Allow path switch if at a "switchable" point (complex)
- C) Warn user and offer restart with new path

---

### Tag Matching Rules

Tags are not just for client type. They can represent any execution context.

```json
{
  "groups": [
    { "tags": ["tui"], ... },
    { "tags": ["webui"], ... },
    { "tags": ["webui", "advanced"], ... },  // WebUI advanced mode
    { "tags": ["api"], ... },  // Headless API execution
    { "tags": ["test"], ... }  // Test mode with mocks
  ]
}
```

**Matching Algorithm:**
```python
def select_group(groups, active_tags):
    """Select group with best tag match."""
    candidates = []
    for group in groups:
        if all(tag in active_tags for tag in group["tags"]):
            candidates.append((group, len(group["tags"])))

    if not candidates:
        raise NoMatchingGroupError(active_tags)

    # Return group with most specific match (most tags)
    return max(candidates, key=lambda x: x[1])[0]
```

**Example:**
- Active tags: `["webui", "advanced"]`
- Groups: `["tui"]`, `["webui"]`, `["webui", "advanced"]`
- Selected: `["webui", "advanced"]` (most specific match)

<!--I feel like we need more explicit way to handle tags. this prone to picking incorrect group for tags. -->

---

### Implementation Complexity Assessment

| Component | Option A (Runtime) | Option B (Meta) | Option C (Hybrid) |
|-----------|-------------------|-----------------|-------------------|
| Server: Workflow loader | Low | Medium | Medium |
| Server: Execution engine | Medium | Low | Low |
| Server: State management | Low | Low | Medium |
| Server: Resume handling | High | Medium | Medium |
| Client: Changes needed | None | None | None |
| Total complexity | Medium | Medium | Medium-High |

**Recommendation:** Option B (Meta-Module) with elements of Option C for resume handling.

---

## Part 2: Schema Extension for Input Fields

Extend existing display schema to support input field definitions.

### Current Schema (Display Only)

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "display": true,
    "properties": {
      "label": {
        "type": "string",
        "display": true,
        "display_label": "Aesthetic"
      },
      "description": {
        "type": "string",
        "display": true
      }
    }
  }
}
```

### Proposed Schema (Display + Input)

<!--this one probably is the way to go.-->

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "display": true,
    "properties": {
      "label": {
        "type": "string",
        "display": true,
        "display_label": "Aesthetic"
      },
      "description": {
        "type": "string",
        "display": true
      }
    },
    <!--this can be just "input"-->
    "input_fields": [
      {
        "key": "count",
        "type": "number",
        "label": "Count",
        "min": 0,
        "max": 10,
        "default": 0
      },
      {
        "key": "mode",
        "type": "select",
        "label": "Mode",
        "options": [
          { "value": "q", "label": "Without Person" },
          { "value": "w", "label": "With Person" },
          { "value": "e", "label": "Either" }
        ],
        "default": "e"
      }
    ]
  }
}
```

### Side-by-Side Comparison

| Aspect | Current Schema | Proposed Schema |
|--------|---------------|-----------------|
| Purpose | Display data | Display data + collect input |
| Properties | Describe data structure | Describe data structure |
| New field | - | `input_fields[]` at item level |
| Rendering | Read-only display | Display + input controls |
| Output | - | Collected values per item |

### Alternative: Inline Input in Properties

Instead of separate `input_fields`, extend property definitions:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "label": {
        "type": "string",
        "display": true
      },
      "count": {
        "type": "number",
        "input": true,
        "input_type": "number",
        "min": 0,
        "max": 10,
        "default": 0
      },
      "mode": {
        "type": "string",
        "input": true,
        "input_type": "select",
        "options": ["q", "w", "e"],
        "default": "e"
      }
    }
  }
}
```

**Comparison:**

| Aspect | Separate `input_fields` | Inline `input: true` |
|--------|------------------------|---------------------|
| Clarity | Clear separation of display vs input | Mixed concerns |
| Existing code impact | Additive (new field) | Modifies property handling |
| Flexibility | Can have inputs without properties | Input tied to property |
| Schema validation | Easier to validate separately | More complex validation |

**Recommendation:** Separate `input_fields` array for cleaner separation.

---

## Part 3: Module Examples

### Example: Aesthetic Selection (WebUI - user.form)

```json
{
  "module_id": "user.form",
  "name": "select_aesthetics",
  "inputs": {
    "groups": [
      {
        "id": "aesthetics",
        "title": "Select Aesthetics",
        "type": "per_item",
        "data": { "$ref": "core_aesthetics.json" },
        "schema": {
          "type": "array",
          "items": {
            "type": "object",
            "display": true,
            "display_format": "{{ label }}",
            "properties": {
              "label": { "type": "string", "display": true },
              "description": { "type": "string", "display": true }
            },
            "input_fields": [
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
    "result": "form_aesthetic_selections"
  }
}
```

### Example: Aesthetic Selection (TUI - user.text_input)

```json
{
  "module_id": "user.text_input",
  "name": "select_aesthetics_text",
  "inputs": {
    "prompt": "Enter aesthetic selections (format: {index}{mode}{count}, e.g., '1w2 5e4'):",
    "multiline": false
  },
  "outputs_to_state": {
    "value": "raw_aesthetic_input"
  }
}
```

### Example: MJ Params (WebUI - user.form)

```json
{
  "module_id": "user.form",
  "name": "edit_mj_params",
  "inputs": {
    "groups": [
      {
        "id": "mj_params",
        "title": "Midjourney Parameters",
        "type": "static",
        "schema": {
          "type": "object",
          "input_fields": [
            { "key": "niji", "type": "select", "label": "Model", "options": [5, 6], "default": 6 },
            { "key": "ar", "type": "select", "label": "Aspect Ratio", "options": ["2:3", "16:9", "1:1"], "default": "2:3" },
            { "key": "c", "type": "number", "label": "Chaos", "min": 0, "max": 100, "default": 0 },
            { "key": "raw", "type": "toggle", "label": "Raw Mode", "default": true },
            { "key": "s", "type": "number", "label": "Stylize", "min": 0, "max": 1000, "default": 150 }
          ]
        }
      }
    ]
  },
  "outputs_to_state": {
    "result": "mj_params"
  }
}
```

### Example: MJ Params (TUI - user.text_input or simple form)

```json
{
  "module_id": "user.text_input",
  "name": "edit_mj_params_text",
  "inputs": {
    "prompt": "Enter MJ params (or press Enter for defaults):\nFormat: --ar 2:3 --s 150 --c 0",
    "default": "--ar 2:3 --s 150 --c 0 --raw"
  },
  "outputs_to_state": {
    "value": "raw_mj_params"
  }
}
```

---

## Part 4: Execution Groups Full Example

### Workflow Definition with Execution Groups

```json
{
  "steps": [
    {
      "step_id": "user_input",
      "modules": [
        {
          "module_id": "pipeline.execution_groups",
          "name": "aesthetic_selection_pipeline",
          "groups": [
            {
              "name": "tui_path",
              "tags": ["tui"],
              "modules": [
                {
                  "module_id": "user.text_input",
                  "name": "get_aesthetic_selection",
                  "inputs": {
                    "prompt": "Enter selections (format: {index}{mode}{count}):"
                  },
                  "outputs_to_state": {
                    "value": "raw_aesthetic_input"
                  }
                },
                {
                  "module_id": "transform.parse_pattern",
                  "name": "parse_aesthetic_selection",
                  "inputs": {
                    "pattern": "aesthetic_pattern",
                    "input": "{{ state.raw_aesthetic_input }}"
                  },
                  "outputs_to_state": {
                    "parsed": "aesthetic_selections"
                  }
                }
              ]
            },
            {
              "name": "webui_path",
              "tags": ["webui"],
              "modules": [
                {
                  "module_id": "user.form",
                  "name": "select_aesthetics_form",
                  "inputs": {
                    "groups": [
                      {
                        "id": "aesthetics",
                        "type": "per_item",
                        "data": { "$ref": "core_aesthetics.json" },
                        "schema": { ... }
                      }
                    ]
                  },
                  "outputs_to_state": {
                    "result": "form_result"
                  }
                },
                {
                  "module_id": "transform.form_to_aesthetic_selections",
                  "name": "convert_form_output",
                  "inputs": {
                    "form_result": "{{ state.form_result }}"
                  },
                  "outputs_to_state": {
                    "selections": "aesthetic_selections"
                  }
                }
              ]
            }
          ],
          "output_schema": {
            "type": "object",
            "required": ["aesthetic_selections"],
            "properties": {
              "aesthetic_selections": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "aesthetic": { "type": "object" },
                    "count": { "type": "number" },
                    "mode": { "type": "string" }
                  }
                }
              }
            }
          }
        },
        {
          "module_id": "some.other_module",
          "name": "uses_aesthetic_selections",
          "inputs": {
            "selections": "{{ state.aesthetic_selections }}"
          }
        }
      ]
    }
  ]
}
```

### How Client Receives Flattened Workflow

**WebUI client connects:**
```json
{
  "steps": [
    {
      "step_id": "user_input",
      "modules": [
        {
          "module_id": "user.form",
          "name": "select_aesthetics_form",
          ...
        },
        {
            <!--this module is no go-->
          "module_id": "transform.form_to_aesthetic_selections",
          ...
        },
        {
          "module_id": "some.other_module",
          ...
        }
      ]
    }
  ]
}
```

**TUI client connects:**
```json
{
  "steps": [
    {
      "step_id": "user_input",
      "modules": [
        {
          "module_id": "user.text_input",
          "name": "get_aesthetic_selection",
          ...
        },
        {
          "module_id": "transform.parse_pattern",
          ...
        },
        {
          "module_id": "some.other_module",
          ...
        }
      ]
    }
  ]
}
```

---

## Part 5: Server-Side Filtering

Instead of `include_when` on client, the `user.form` module filters on server before outputting.

### Module Input

```json
{
  "module_id": "user.form",
  "inputs": {
    "groups": [...],
    "output_filter": {
      "per_item_groups": {
        "include_when": { "count": { "$gt": 0 } }
      }
    }
  }
}
```

### Server Processing

```python
class FormModule:
    def process_response(self, response, inputs):
        result = response["result"]

        # Apply server-side filtering
        if "output_filter" in inputs:
            filter_config = inputs["output_filter"]
            if "per_item_groups" in filter_config:
                include_when = filter_config["per_item_groups"]["include_when"]
                for group_id, items in result.items():
                    if isinstance(items, list):
                        result[group_id] = [
                            item for item in items
                            if self._matches_filter(item, include_when)
                        ]

        return {"result": result}

    def _matches_filter(self, item, condition):
        # Implement condition matching: {"count": {"$gt": 0}}
        for field, rule in condition.items():
            value = item.get(field)
            if "$gt" in rule and not (value > rule["$gt"]):
                return False
            if "$gte" in rule and not (value >= rule["$gte"]):
                return False
            if "$eq" in rule and not (value == rule["$eq"]):
                return False
        return True
```

---

## Open Questions

1. **Cross-client resume policy**: Force original path, allow switch, or warn+restart?
<!--if we find client inbetween a group, we will just start a new branch right before
the group. i think bigger problem would be, could this cause issues when showing state
as we map state by index in workflow, but with this, when user go past group, the indexes
modules can be different from one one flattened workflow to another. -->

2. **Tag source**: Always from client, or can it come from state/config?
<!--it will be from client, for now, lets say its a client config. -->

3. **Validation timing**: Validate output_schema at workflow load or at runtime?
<!--we cant do validation at load time right? we are validating data at end of group, so
it will be at runtime. now, another question, how can we handle this if we flatten the workflow?-->

4. **Nested execution_groups**: Can a group contain another execution_groups? (Recommend: No, keep flat)
<!--lets say no for that for now. -->

5. **Default group**: Should there be a fallback group if no tags match?
<!--no, as i said earlier, everything has to be explicit. -->

---

## Recommendation

1. **Execution Groups**: Implement as meta-module (Option B) with path tracking for resume (from Option C)

2. **Schema Extension**: Use separate `input_fields` array for cleaner separation

3. **Server-side filtering**: Move `include_when` to server via `output_filter` config

4. **Output format**: Keep compatibility with existing `aesthetic_selections` structure

---

## Implementation Priority

1. `pipeline.execution_groups` - Core infrastructure (enables everything else)
2. `user.form` module - WebUI form interaction
3. Schema extension for `input_fields` - Reusable input definition
4. Transform module for form → existing format - Compatibility layer
