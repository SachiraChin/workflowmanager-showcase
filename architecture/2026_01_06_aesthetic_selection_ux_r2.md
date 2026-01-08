# Aesthetic Selection UX Improvement - Revision 2

## Summary of R1 Feedback

- **Option B (extend user.select)**: Rejected - complicates already complex module
- **Option C (WebUI variant)**: Rejected - too targeted, not reusable
- **Option A & D**: Worth expanding with focus on generic, expandable design

Key concern: Any new module must add value beyond this single use case.

---

## Key Insight: Unified Control Model

After discussing future use cases (MJ param editing, platform integrations), we identified that **both scenarios use the same control types, just arranged differently**.

### Control Types Needed

| Control | Aesthetic Selection | MJ Params | Leonardo Params |
|---------|---------------------|-----------|-----------------|
| `number` | count (0-10) | niji, c, iw, s | guidance, steps |
| `select` | mode (q/w/e) | ar (2:3, 16:9) | model, preset |
| `toggle` | - | raw | tiling, nsfw |
| `text` | - | - | negative_prompt |

### Arrangement Modes

1. **Static fields**: Fields appear once, collect one value each (MJ params)
2. **Per-item fields**: Fields repeat for each item from a data source (aesthetic selection)

### Conclusion

Options A and D converge into a single `user.form` module with:
- Reusable control types
- Support for both static and per-item arrangements
- Platform-specific field schemas loaded dynamically

---

## Unified Proposal: `user.form`

### Core Concept

A form is a collection of **field groups**. Each group can be:
- **Static**: fields defined inline, values collected once
- **Generated**: fields repeat for each item from a data source

### Field Types (Shared Controls)

| Type | Description | Config |
|------|-------------|--------|
| `number` | Numeric with +/- controls | `min`, `max`, `step`, `default` |
| `select` | Single choice | `options[]`, `default` |
| `toggle` | Boolean on/off | `default`, `labels` |
| `text` | Free text input | `placeholder`, `max_length` |
| `ratio` | Aspect ratio picker | `options[]`, `default` |

---

## Example 1: Aesthetic Selection (Per-Item)

```json
{
  "module_id": "user.form",
  "inputs": {
    "groups": [
      {
        "id": "aesthetics",
        "title": "Select Aesthetics",
        "type": "per_item",
        <!-- use "data" for consistancy -->
        "items_from": { "$ref": "core_aesthetics.json" },
        <!--I dont think item_label is the right way to do this, we can add "schema" field as we used in all other 
            mechanisms, and will render data as per schema.-->
        "item_label": "{{ item.label }}",
        <!--I wonder if we can include fields in schema itself to streamline everything. we already have number of 
            components which can support this, if we add this support to schema, it will work in any use case. but 
            current schema format not gonna format as is (i think), I need to see multiple options which we can make
            work with schemas. -->
        "fields": [
          { "key": "count", "type": "number", "min": 0, "max": 10, "default": 0 },
          { "key": "mode", "type": "select", "options": [
            { "value": "q", "label": "Without Person" },
            { "value": "w", "label": "With Person" },
            { "value": "e", "label": "Either" }
          ], "default": "e" }
        ],
        <!--I wonder if we need this on client side, I understand why you add this, but this kind of adds business logic
            to client side, which we do not do so far. I want to see few options to make this work without client side
            filtering. -->
        "include_when": { "count": { "$gt": 0 } }
      }
    ]
  },
  "outputs_to_state": {
    "result": "aesthetic_selections"
  }
}
```

### Output

<!--right now we use 2 modules (get_aesthetic..., parse_aesthetic...) to generate final aesthetic data, I wonder we can merge 
these 2 into one rather than trying to comply existing format. I want to entertain that idea here. -->
```json
{
  "aesthetic_selections": [
    { "item": { "id": "futuristic", "label": "Futuristic", ... }, "index": 0, "count": 2, "mode": "w" },
    { "item": { "id": "mystical", "label": "Mystical", ... }, "index": 1, "count": 4, "mode": "e" }
  ]
}
```

### WebUI Rendering

```
┌─────────────────────────────────────────────────────────┐
│ SELECT AESTHETICS                                       │
├─────────────────────────────────────────────────────────┤
│ Futuristic                    [-] 2 [+]   [q] [w] [e]  │
│ Mystical                      [-] 0 [+]   [q] [w] [e]  │
│ Real World                    [-] 0 [+]   [q] [w] [e]  │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
                                              [Submit]
```

---

## Example 2: MJ Parameter Editing (Static)

<!--given feedback on example 1, please add examples for each for core aesthetics and mj use cases for each proposal. -->

```json
{
  "module_id": "user.form",
  "inputs": {
    "groups": [
      {
        "id": "mj_params",
        "title": "Midjourney Parameters",
        "type": "static",
        "fields": [
          { "key": "niji", "type": "select", "label": "Model", "options": [5, 6], "default": 6 },
          { "key": "ar", "type": "ratio", "label": "Aspect Ratio", "options": ["2:3", "16:9", "1:1", "3:2", "9:16"], "default": "2:3" },
          { "key": "c", "type": "number", "label": "Chaos", "min": 0, "max": 100, "default": 0 },
          { "key": "raw", "type": "toggle", "label": "Raw Mode", "default": true },
          { "key": "iw", "type": "number", "label": "Image Weight", "min": 0, "max": 2, "step": 0.1, "default": 2 },
          { "key": "s", "type": "number", "label": "Stylize", "min": 0, "max": 1000, "step": 25, "default": 150 }
        ]
      }
    ]
  },
  "outputs_to_state": {
    "result": "mj_params"
  }
}
```

### Output

```json
{
  "mj_params": {
    "niji": 6,
    "ar": "2:3",
    "c": 0,
    "raw": true,
    "iw": 2,
    "s": 150
  }
}
```

### WebUI Rendering

```
┌─────────────────────────────────────────────────────────┐
│ MIDJOURNEY PARAMETERS                                   │
├─────────────────────────────────────────────────────────┤
│ Model:        [5] [6]                                   │
│ Aspect Ratio: [2:3] [16:9] [1:1] [3:2] [9:16]          │
│ Chaos:        [----○----] 0                             │
│ Raw Mode:     [ON]                                      │
│ Image Weight: [----○----] 2.0                           │
│ Stylize:      [----○----] 150                           │
└─────────────────────────────────────────────────────────┘
```

---

## Example 3: Mixed Form (Both Static + Per-Item)

For a more complex scenario - configuring multiple prompts with shared and per-prompt params:

```json
{
  "module_id": "user.form",
  "inputs": {
    "groups": [
      {
        "id": "global_params",
        "title": "Global Settings",
        "type": "static",
        "fields": [
          { "key": "ar", "type": "ratio", "options": ["2:3", "16:9"], "default": "2:3" },
          { "key": "raw", "type": "toggle", "default": true }
        ]
      },
      {
        "id": "prompt_params",
        "title": "Per-Prompt Settings",
        "type": "per_item",
        "items_from": { "$ref": "generated_prompts" },
        "item_label": "{{ item.name }}",
        "fields": [
          { "key": "s", "type": "number", "label": "Stylize", "min": 0, "max": 1000, "default": "{{ item.default_stylize }}" },
          { "key": "enabled", "type": "toggle", "label": "Generate", "default": true }
        ]
      }
    ]
  }
}
```

---

## TUI Compatibility

<!-- I think this is one of sticky issues we are going to see continuesly. I think its time to add mechanism to add mechanism 
to support different clients (tui/webui) natively in the workflow. It would be new kind of module which can have sub modules,
it can have sets of modules which results same output in after completion of each path.

{
  "module_id": "pipeline.execution_groups",
  "name": "xyz_pipeline",
  "groups": [
    {
        "name": "tui path",
        "tags": ["tui"],
        "modules": [
            {
              "module_id": "user.select",
              "inputs": {
                "resolver_schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "resolver": "server"
                    },
                    "prompt": {
                      "resolver": "server"
                    }
                  }
                },
                "prompt": "Select video duration",
                "data": [
                  {
                    "id": 1,
                    "label": "15 seconds",
                    "description": "3 sentences per paragraph, 20s soundtrack",
                    "video_duration": 15,
                    "paragraph_line_count": 3,
                    "sound_track_duration": 20
                  },
                  
                ],
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "selectable": true,
                    "display": true,
                    "display_format": "{{ label }} - {{ description }}",
                    "properties": {
                      "id": {
                        "type": "number"
                      },
                    }
                  }
                },
                "multi_select": false,
                "mode": "select"
              },
              "outputs_to_state": {
                "selected_indices": "duration_selection_indices",
                "selected_data": "duration_selection"
              },
              "name": "select_duration"
            } 
        ]
    }, 
    {
        "name": "webui path",
        "tags": ["webui"],
        "modules": [
            {
              "module_id": "user.select",
              "inputs": {
                "resolver_schema": {
                  "type": "object",
                  "properties": {
                    "data": {
                      "resolver": "server"
                    },
                    "prompt": {
                      "resolver": "server"
                    }
                  }
                },
                "prompt": "Select video duration",
                "data": [
                  {
                    "id": 1,
                    "label": "15 seconds",
                    "description": "3 sentences per paragraph, 20s soundtrack",
                    "video_duration": 15,
                    "paragraph_line_count": 3,
                    "sound_track_duration": 20
                  },
                  
                ],
                "schema": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "selectable": true,
                    "display": true,
                    "display_format": "{{ label }} - {{ description }}",
                    "properties": {
                      "id": {
                        "type": "number"
                      },
                    }
                  }
                },
                "multi_select": false,
                "mode": "select"
              },
              "outputs_to_state": {
                "selected_indices": "duration_selection_indices",
                "selected_data": "duration_selection"
              },
              "name": "select_duration"
            } 
        ]
    }, 
  ],
  "output_schema": {
    "type": "object",
    "properties": {
      "duration": {
        "type": "string"
      }
    }
  }
}

none of these examples are fixed, lets explore into this, and let me complexity of this implementation.
-->

### Option 1: Fallback to Text Input

```
Enter selections (format: {index}{mode}{count}, e.g., "1w2 5e4"):
> _
```

- Zero TUI implementation effort
- Keep `transform.parse_pattern` for TUI path only
- WebUI outputs structured data directly

### Option 2: Implement TUI Form Renderer

```
Select aesthetics (↑↓ navigate, ←→ adjust count, q/w/e mode, Enter submit):

  1. Futuristic      [2] [w]
  2. Mystical        [0] [e]
  3. Vintage         [0] [e]
  ...
```

- Better UX consistency across clients
- More implementation work
- Reusable for future form-based modules

---

## Future Use Cases

This unified `user.form` module covers:

| Use Case | Group Type | Fields |
|----------|------------|--------|
| Aesthetic selection | per_item | count, mode |
| MJ params editing | static | niji, ar, c, raw, iw, s |
| Leonardo params | static | model, guidance, steps |
| Color palette builder | per_item | weight |
| Feature toggles | per_item | enabled |
| Mixed config | static + per_item | global settings + per-item overrides |

---

## Implementation Scope

### Server
- New module type `user.form`
- Form schema validation
- Group processing (static vs per_item)
- Output structuring based on group type

### WebUI
- `FormInteraction` component
- Field renderers: `NumberField`, `SelectField`, `ToggleField`, `TextField`, `RatioField`
- Per-item row generation
- Form state management and submission

### TUI
- Option 1: Fallback to text_input (minimal effort)
- Option 2: Form renderer with keyboard navigation

---

## Open Questions

1. **TUI approach**: Fallback to text input, or implement visual form?

2. **Output structure for per_item groups**: Flatten fields or nest under `attributes`?
   ```json
   // Flat (simpler to consume)
   { "item": {...}, "count": 2, "mode": "w" }

   // Nested (clearer separation)
   { "item": {...}, "attributes": { "count": 2, "mode": "w" } }
   ```

3. **Defaults from state**: Should `default` support Jinja templates like `{{ item.mj.s }}`?

4. **Validation**: Do we need field-level validation (required, regex, custom)?

---

## Recommendation

<!-- Your thoughts on the unified proposal? -->
