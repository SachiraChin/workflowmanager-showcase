# Aesthetic Selection UX Improvement

## Problem Statement

Module 8 (`get_aesthetic_selection`) currently uses `user.text_input` requiring users to enter a compact format:
```
{number}[q/w/e]{count}
Example: 1w2 5e4
```

This works for TUI but provides poor UX in WebUI where we have richer interaction capabilities.

## Current Flow

1. `user.text_input` shows prompt with aesthetic list as text
2. User types compact format (e.g., "1w2 5e4")
3. `transform.parse_pattern` parses the input into structured data
4. Output: `aesthetic_selections` array with parsed items

## Desired WebUI Experience

- Display list of core aesthetics visually
- Each aesthetic has a number picker: `[-] {count} [+]`
- Each aesthetic has person mode selector: `q/w/e` (without/with/either)
- Submit button sends structured data directly

## Options to Consider

### Option A: New Module Type (`user.quantity_select`)

Create a new module type specifically for quantity selection.

```json
{
  "module_id": "user.quantity_select",
  "inputs": {
    "options": { "$ref": "core_aesthetics.json" },
    "display_schema": { ... },
    "min_per_item": 0,
    "max_per_item": 10,
    "modes": ["without_person", "with_person", "both"],
    "mode_labels": { "without_person": "q", "with_person": "w", "both": "e" }
  },
  "outputs_to_state": {
    "selections": "aesthetic_selections"  // Direct structured output
  }
}
```

<!--I feel like this is closest to what we need, but still this feel like fully targetted to this usecase and adds no additional value, for example, if user only select number, yes it make sense, and could be used if needed. but here we select a count AND mode. now it become more of special module which will work only for this use case. I think we should think more about expandability of the module where it adds value for any future uses case.-->

**Pros:**
- Clean, purpose-built solution
- Direct structured output (skip parse_pattern)
- Good separation of concerns

**Cons:**
- New module to implement (server + TUI + WebUI)
- May be too specific to this use case

---

### Option B: Extend `user.select` with Quantity Mode

Add a `quantity_mode` option to existing `user.select`.

```json
{
  "module_id": "user.select",
  "inputs": {
    "options": { "$ref": "core_aesthetics.json" },
    "quantity_mode": {
      "enabled": true,
      "min": 0,
      "max": 10,
      "modes": ["q", "w", "e"],
      "mode_field": "person_mode"
    }
  }
}
```

<!--yea this is not going to work. expanding user.select only can make things more complicated than needed.-->
**Pros:**
- Extends existing module
- Reuses selection infrastructure

**Cons:**
- Complicates `user.select` which is already complex
- Mixing selection and quantity concepts

---

### Option C: Hybrid - Keep `text_input` but Add WebUI Variant

Keep the module as `text_input` but add a WebUI-specific rendering variant that provides the visual picker. The variant outputs the same format string.

```json
{
  "module_id": "user.text_input",
  "inputs": {
    "prompt": "...",
    "webui_variant": "aesthetic_quantity_picker",
    "variant_config": {
      "options": { "$ref": "core_aesthetics.json" }
    }
  }
}
```

<!--again, this is very targetted change for this specific module, and adds no other value. I am okay with modules having different configs for tui and webui as long as its expandable and adds value for others. example for something like this is, render_as and nudges, where it can be used anywhere and adds lots of value.-->

**Pros:**
- TUI unchanged (still text input)
- WebUI gets better UX
- Output format unchanged (parse_pattern still works)

**Cons:**
- Workflow-specific variant (not generic)
- text_input becomes overloaded

---

### Option D: New Generic `user.form` Module

Create a form-based module that can handle multiple input types.

```json
{
  "module_id": "user.form",
  "inputs": {
    "fields": [
      {
        "name": "aesthetic_1",
        "type": "quantity_with_mode",
        "label": "Futuristic",
        "modes": ["q", "w", "e"]
      },
      // ... more fields
    ]
  }
}
```

<!--I understand the base of this, and I see the value when it comes to usability. question is, how can we make this generic, how can we map fields to existing core aesthetics, having single field type called "quantity_with_mode" is not going to work, it will have to be seperate types, so in that case, how can we connect these to aesthetic config we have.-->

**Pros:**
- Generic, reusable for other forms
- Flexible field types

**Cons:**
- Complex to implement
- May be overkill for this case

---

## TUI Compatibility Considerations

Whatever solution we choose, TUI needs to work with minimal effort:

1. **Option A/B/D**: Need TUI implementation for new interaction type
   - Could fall back to text input in TUI
   - Or implement simple list with quantity input

2. **Option C**: TUI unchanged, uses existing text_input

## Questions to Discuss

1. How important is keeping TUI experience identical vs. allowing different UX per client?
2. Should the output be structured data (skip parse_pattern) or maintain text format?
3. Is this a one-off need or will we have similar quantity-picking use cases?
4. What's the acceptable implementation effort?

## Recommendation

<!-- lets expand A and D, others we can ignore -->
[To be discussed]

---

## Data Structure Reference

### Current Output (from parse_pattern)
```json
{
  "aesthetic_selections": [
    {
      "index": 1,
      "mode": "with_person",
      "count": 2,
      "aesthetic": { "name": "Futuristic", ... },
      "with_count": 2,
      "without_count": 0
    }
  ]
}
```

### Core Aesthetics Reference
```json
[
  { "name": "Futuristic", "description": "..." },
  { "name": "Mystical", "description": "..." },
  // ...
]
```
