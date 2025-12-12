# Dynamic Model Groups - Plan of Action

## Summary
Enable selective prompt generation by allowing users to choose which model groups to generate prompts for, reducing token waste by 50-80%.

## Implementation Plan

### Phase 1: Core Infrastructure ✅
- [x] Add `model_groups` config to `server/config.json`
  - Image generation: sora, phoenix, leonardo, midjourney, stable_diffusion
  - Video generation: motion_2_0, midjourney_animate
  - Each group has: models[], label, description, default=""

### Phase 2: User Selection Module
**File**: `server/modules/user/select_model_groups.py`

**Features**:
- Load groups from `config.json` based on category (image_generation | video_generation)
- Display numbered list with labels and descriptions
- Accept input: "1,2" or "1 2" or "1, 2" (flexible parsing)
- Minimum 1 selection required
- Output: selected_groups[], selected_models[], model_count

**Example UI**:
```
Select model groups for image generation (enter numbers separated by commas or spaces):

1. Sora (2.0 & 1.0) - Ultra-cinematic anime realism
2. Phoenix 1.0 - Filmic depth + hand-painted backgrounds
3. Leonardo Anime XL - Vivid anime illustrations
4. Midjourney (A & B) - Structured layered prompts
5. Stable Diffusion (3 variants) - Open-source generation

Enter selection (e.g., 1,3 or 1 3):
```

###Phase 3: Prompt Builder Module
**File**: `server/modules/prompt/build_grouped_prompt.py`

**Logic**:
1. Read shared instructions file (common rules for all models)
2. For each selected group:
   - Read group-specific instructions file
   - Append to shared instructions
3. Return merged prompt

**Example**:
```
Input:
  shared_instructions_path: "prompts/image_generation/_shared_instructions.txt"
  group_instructions: {
    "sora": "prompts/image_generation/sora_instructions.txt",
    "leonardo": "prompts/image_generation/leonardo_instructions.txt"
  }
  selected_groups: ["sora", "leonardo"]

Output:
  merged_prompt: """
    <_shared_instructions content>

    <sora_instructions content>

    <leonardo_instructions content>
  """
```

### Phase 4: Schema Builder Module
**File**: `server/modules/transform/build_dynamic_schema.py`

**Logic**:
1. Load schema files for each selected group
2. Merge into single schema with:
   - Combined properties (all selected models)
   - Combined required array (all selected models)
3. Return merged schema object

**Example**:
```
Input:
  group_schemas: {
    "sora": "schemas/image_generation/sora_schema.json",
    "leonardo": "schemas/image_generation/leonardo_schema.json"
  }
  selected_groups: ["sora", "leonardo"]

Sora schema:
{
  "properties": {
    "prompts": {
      "properties": {
        "SORA_2_A": {"type": "string"},
        "SORA_1_A": {"type": "string"}
      },
      "required": ["SORA_2_A", "SORA_1_A"]
    }
  }
}

Leonardo schema:
{
  "properties": {
    "prompts": {
      "properties": {
        "LEONARDO_ANIME_XL_A": {"type": "string"}
      },
      "required": ["LEONARDO_ANIME_XL_A"]
    }
  }
}

Output (merged):
{
  "type": "object",
  "properties": {
    "prompts": {
      "type": "object",
      "properties": {
        "SORA_2_A": {"type": "string"},
        "SORA_1_A": {"type": "string"},
        "LEONARDO_ANIME_XL_A": {"type": "string"}
      },
      "required": ["SORA_2_A", "SORA_1_A", "LEONARDO_ANIME_XL_A"],
      "additionalProperties": false
    }
  },
  "required": ["prompts"],
  "additionalProperties": false
}
```

### Phase 5: File Reorganization

#### Step 2 (Image Generation)

**Create shared instructions**:
`server/workflows/oms/prompts/image_generation/_shared_instructions.txt`
- Extract common rules from current `image_prompts_generation_system.txt`
- Global rules, aspect ratio, composition hierarchy, etc.

**Split group instructions**:
```
server/workflows/oms/prompts/image_generation/
├── _shared_instructions.txt
├── sora_instructions.txt          (SORA_2_A, SORA_1_A sections)
├── phoenix_instructions.txt       (PHOENIX_1_0_A section)
├── leonardo_instructions.txt      (LEONARDO_ANIME_XL_A section)
├── midjourney_instructions.txt    (MIDJOURNEY_A, MIDJOURNEY_B sections)
└── stable_diffusion_instructions.txt  (SD_A/B/C sections)
```

**Split group schemas**:
```
server/workflows/oms/schemas/image_generation/
├── sora_schema.json
├── phoenix_schema.json
├── leonardo_schema.json
├── midjourney_schema.json
└── stable_diffusion_schema.json
```

#### Step 3 (Video Generation)

**Create shared instructions**:
`server/workflows/oms/prompts/video_generation/_shared_instructions.txt`

**Split group instructions**:
```
server/workflows/oms/prompts/video_generation/
├── _shared_instructions.txt
├── motion_2_0_instructions.txt
└── midjourney_animate_instructions.txt
```

**Split group schemas**:
```
server/workflows/oms/schemas/video_generation/
├── motion_2_0_schema.json
└── midjourney_animate_schema.json
```

### Phase 6: Workflow Integration

#### Step 2 Update (Image Prompts)

**Before** (current):
```json
{
  "step_id": "prompt_generation",
  "modules": [
    {
      "module_id": "prompt.template",
      "inputs": {
        "template": {"$ref": "prompts/image_prompts_generation_system.txt"}
      }
    },
    {
      "module_id": "api.openai",
      "inputs": {
        "system_message": "$state.system_prompt",
        "output_schema": {"$ref": "schemas/prompt_generation_schema.json"}
      }
    }
  ]
}
```

**After** (dynamic):
```json
{
  "step_id": "prompt_generation",
  "modules": [
    // 1. User selects groups
    {
      "module_id": "user.select_model_groups",
      "inputs": {
        "group_category": "image_generation",
        "previous_selection": "$state.selected_image_groups"
      },
      "outputs_to_state": {
        "selected_groups": "selected_image_groups",
        "selected_models": "selected_image_models",
        "model_count": "image_model_count"
      }
    },

    // 2. Build dynamic system prompt
    {
      "module_id": "prompt.build_grouped_prompt",
      "inputs": {
        "shared_instructions_path": "prompts/image_generation/_shared_instructions.txt",
        "group_instructions": {
          "sora": "prompts/image_generation/sora_instructions.txt",
          "phoenix": "prompts/image_generation/phoenix_instructions.txt",
          "leonardo": "prompts/image_generation/leonardo_instructions.txt",
          "midjourney": "prompts/image_generation/midjourney_instructions.txt",
          "stable_diffusion": "prompts/image_generation/stable_diffusion_instructions.txt"
        },
        "selected_groups": "$state.selected_image_groups"
      },
      "outputs_to_state": {
        "merged_prompt": "dynamic_image_system_prompt"
      }
    },

    // 3. Build dynamic schema
    {
      "module_id": "transform.build_dynamic_schema",
      "inputs": {
        "group_schemas": {
          "sora": "schemas/image_generation/sora_schema.json",
          "phoenix": "schemas/image_generation/phoenix_schema.json",
          "leonardo": "schemas/image_generation/leonardo_schema.json",
          "midjourney": "schemas/image_generation/midjourney_schema.json",
          "stable_diffusion": "schemas/image_generation/stable_diffusion_schema.json"
        },
        "selected_groups": "$state.selected_image_groups"
      },
      "outputs_to_state": {
        "merged_schema": "dynamic_image_schema"
      }
    },

    // 4. Generate user prompt (same as before)
    {
      "module_id": "prompt.template",
      "inputs": {
        "template": {"$ref": "prompts/image_prompts_generation_user.txt"},
        "variables": { ... }
      },
      "outputs_to_state": {
        "rendered": "user_prompt_text"
      }
    },

    // 5. API call with dynamic prompt and schema
    {
      "module_id": "api.openai",
      "inputs": {
        "system_message": "$state.dynamic_image_system_prompt",
        "user_message": "$state.user_prompt_text",
        "output_schema": "$state.dynamic_image_schema"
      },
      "outputs_to_state": {
        "response": "image_prompts"
      }
    }
  ]
}
```

#### Step 3 Update (Video Prompts)
Same pattern, but with `video_generation` groups.

### Phase 7: Testing

**Test Cases**:
1. Select single group (e.g., sora only) → verify 2 prompts generated
2. Select multiple groups (e.g., sora + leonardo) → verify 3 prompts generated
3. Select all groups → verify 9 prompts generated (same as before)
4. Invalid input handling (empty, invalid numbers, etc.)
5. Retry with different group selection
6. Token counting: verify actual savings

**Expected Token Savings**:
- All 9 models: ~4,500 tokens
- Sora only (2 models): ~1,000 tokens (78% savings)
- Sora + Leonardo (3 models): ~1,500 tokens (67% savings)
- Typical use (2-3 groups): 50-70% savings

### Phase 8: Documentation

Create `DYNAMIC_MODEL_GROUPS.md` with:
- Feature overview
- How to add new model groups
- How to add new models to existing groups
- Workflow integration guide
- Token savings analysis

## Implementation Order

1. ✅ Phase 1: Config added
2. **Phase 2**: Create `select_model_groups` module
3. **Phase 3**: Create `build_grouped_prompt` module
4. **Phase 4**: Create `build_dynamic_schema` module
5. **Phase 5**: Split files for Step 2
6. **Phase 5**: Split files for Step 3
7. **Phase 6**: Update Step 2 workflow JSON
8. **Phase 6**: Update Step 3 workflow JSON
9. **Phase 7**: Test end-to-end
10. **Phase 8**: Documentation

## Questions Resolved

1. Group names: ✅ sora, phoenix, leonardo, midjourney, stable_diffusion
2. Default selection: ✅ No default (`"default": ""`)
3. Minimum selection: ✅ At least 1 required, multi-select via "1,2" or "1 2"
4. Persistence: ✅ No persistence for now
5. Step 3 groups: ✅ motion_2_0, midjourney_animate

## Next Steps

Ready to implement? I'll start with Phase 2 (select_model_groups module) and work through each phase systematically.
