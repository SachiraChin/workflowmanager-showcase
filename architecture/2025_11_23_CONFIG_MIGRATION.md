# Aesthetic History Configuration Migration

## Summary

Moved aesthetic history configuration from per-workflow JSON file to centralized `server/config.json` with per-model settings support.

## Changes Made

### 1. Config Location
**Before:** Configuration stored in `server/workflows/oms/history/aesthetic_history.json`
```json
{
  "aesthetics": [...],
  "config": {
    "selected_exclusion_days": 10,
    "similarity_threshold_title": 0.85,
    ...
  }
}
```

**After:** Configuration centralized in `server/config.json`
```json
{
  "aesthetic_history": {
    "default": { ... },
    "gpt-4o": { ... },
    "gpt-5.1": { ... }
  }
}
```

### 2. Per-Model Configuration

The new system supports different similarity thresholds per AI model:

- **`default`**: Used for any model not explicitly configured
  - `similarity_threshold_description`: 0 (title-only matching)
  - `similarity_threshold_emotion`: 0

- **`gpt-4o`**: Shorter outputs, can use stricter matching
  - `similarity_threshold_description`: 0.6 (60% similarity)
  - `similarity_threshold_emotion`: 0.6

- **`gpt-5.1`**: Longer outputs, use title-only matching
  - `similarity_threshold_description`: 0 (disabled)
  - `similarity_threshold_emotion`: 0 (disabled)

### 3. Module Updates

Updated `server/modules/history/aesthetic_history.py`:
- Added `_load_global_config()` method to read from `server/config.json`
- Detects current AI model from `context.services['ai_config']['model']`
- Falls back to "default" config if model not found
- Overrides any config in history JSON file with global config

## Configuration Format

### Full Config Schema (`server/config.json`)

```json
{
  "aesthetic_history": {
    "<model_name>": {
      "selected_exclusion_days": 10,      // Days to exclude selected aesthetics
      "generated_exclusion_days": 5,      // Days to exclude generated-only aesthetics
      "max_entries": 100,                 // Max aesthetics to keep in history
      "similarity_threshold_title": 0.85, // Title similarity (0-1)
      "similarity_threshold_description": 0.6,  // Description similarity (0-1), 0=disabled
      "similarity_threshold_emotion": 0.6       // Emotion similarity (0-1), 0=disabled
    }
  }
}
```

### Adding New Model Configs

To add configuration for a new model (e.g., `gpt-4o-mini`):

```json
{
  "aesthetic_history": {
    "default": { ... },
    "gpt-4o-mini": {
      "selected_exclusion_days": 10,
      "generated_exclusion_days": 5,
      "max_entries": 100,
      "similarity_threshold_title": 0.85,
      "similarity_threshold_description": 0.6,
      "similarity_threshold_emotion": 0.6
    }
  }
}
```

The model name must match the `model` field in `ai_config.json`.

## Migration Notes

1. **History JSON files** no longer need a `config` section
   - Old files with config section will have it ignored/overridden
   - New files created will still have a config section (populated from global config)

2. **Backward compatibility**: If `server/config.json` is missing or has no `aesthetic_history` section, the module falls back to hardcoded defaults

3. **Model detection**: The system reads the current model from `services.ai_config.model`, which comes from `ai_config.json`

## Testing

Run the test suite to verify configuration loading:

```bash
python test_config_loading.py
```

Expected output:
- ✓ GPT-5.1 uses description=0, emotion=0
- ✓ GPT-4o uses description=0.6, emotion=0.6
- ✓ Unknown models fall back to default config

## Files Modified

1. `server/config.json` - Added `aesthetic_history` section
2. `server/modules/history/aesthetic_history.py` - Updated to load from global config
3. `server/workflows/oms/history/aesthetic_history.json` - Removed config section
4. Created `test_config_loading.py` - Test script for config loading

## Benefits

1. **Centralized configuration**: All model-specific settings in one place
2. **No workflow duplication**: Don't need to copy config across multiple workflows
3. **Model-specific tuning**: Each AI model can have optimized similarity thresholds
4. **Easier maintenance**: Change one config file instead of many history files
