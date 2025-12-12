# Prompt Caching Configuration

## Overview

Added model-based prompt caching configuration to `server/config.json`, allowing you to enable/disable caching per AI model without modifying workflow JSON files.

## Configuration

### Config Location: `server/config.json`

```json
{
  "prompt_caching": {
    "default": {
      "enabled": false,
      "cache_system_message": false,
      "cache_user_prefix": false
    },
    "gpt-4o": {
      "enabled": false,
      "cache_system_message": false,
      "cache_user_prefix": false
    },
    "gpt-5.1": {
      "enabled": true,
      "cache_system_message": true,
      "cache_user_prefix": true
    },
    "gpt-5-mini": {
      "enabled": true,
      "cache_system_message": true,
      "cache_user_prefix": true
    }
  }
}
```

### Configuration Fields

- **`enabled`**: Master switch for caching (informational, not enforced)
- **`cache_system_message`**: Cache the system/developer message (24h retention for GPT-5)
- **`cache_user_prefix`**: Cache the first user message (24h retention for GPT-5)

## How It Works

### 1. Automatic Model Detection

The system automatically reads the current AI model from `ai_config.json`:

```python
# Example ai_config.json
{
  "provider": "openai",
  "model": "gpt-5.1",  // ← This is used to select caching config
  "api_key_file": "../OPENAI_API_KEY.txt"
}
```

### 2. Config Selection Priority

1. **Check if model has specific config** (e.g., `gpt-5.1`)
2. **Fall back to `default`** if model not found
3. **Use hardcoded defaults** if config file missing

### 3. Input Override

Workflow JSON can still override config values:

```json
{
  "module_id": "api.openai",
  "inputs": {
    "cache_system_message": true,  // ← Overrides config
    "cache_user_prefix": false     // ← Overrides config
  }
}
```

**Priority**: Input parameters > Config file > Hardcoded defaults

## Current Configuration

### Models with Caching Enabled

- **GPT-5.1**: Full caching (system + user prefix)
- **GPT-5-mini**: Full caching (system + user prefix)

**Reason**: These models support 24h prompt caching and benefit from it due to long prompts.

### Models with Caching Disabled

- **GPT-4o**: No caching
- **Default**: No caching (for safety)

**Reason**: Older models or unknown models default to no caching to avoid unexpected behavior.

## Adding New Models

To configure caching for a new model:

```json
{
  "prompt_caching": {
    "gpt-6": {
      "enabled": true,
      "cache_system_message": true,
      "cache_user_prefix": true
    }
  }
}
```

The model name must match the `model` field in your `ai_config.json`.

## Benefits

1. **Centralized control**: Change caching behavior without modifying workflows
2. **Model-specific optimization**: Enable caching only for models that support it
3. **Easy experimentation**: Toggle caching on/off per model
4. **Override capability**: Workflows can still override if needed

## Implementation Details

### Modified Files

1. **`server/config.json`**: Added `prompt_caching` section
2. **`server/modules/api/openai_call.py`**:
   - Added `_load_caching_config()` method
   - Updated `execute()` to read from config
   - Maintains backward compatibility with input parameters

### Logging

When caching is enabled, you'll see:
```
[INFO] Prompt caching enabled for model 'gpt-5.1': system=True, user_prefix=True
```

When using config values:
```
[DEBUG] Using prompt caching config for model: gpt-5.1
```

## Testing

Run the test suite:

```bash
python test_caching_config.py
```

Expected results:
- ✓ GPT-5.1: Caching enabled
- ✓ GPT-5-mini: Caching enabled
- ✓ GPT-4o: Caching disabled
- ✓ Unknown models: Fall back to default (disabled)

## Cost Implications

**With caching enabled (GPT-5.1):**
- First request: Normal pricing
- Cached requests (within 24h): 50% discount on cached tokens
- Typical savings: 30-50% on multi-turn conversations

**Example:**
- System message: 1000 tokens (cached)
- User messages: 500 tokens each
- Request 1: 1000 + 500 = 1500 tokens (full price)
- Request 2: 500 cached + 500 new = 1000 tokens (50% on 500)
- Savings: ~25% per subsequent request

## Migration Notes

### Before
```json
{
  "module_id": "api.openai",
  "inputs": {
    "cache_system_message": true,
    "cache_user_prefix": true
  }
}
```

### After
- Remove explicit cache parameters from workflow JSON (optional)
- Configure once in `server/config.json`
- All workflows using that model automatically get the config

### Backward Compatibility

✓ Existing workflows with explicit cache parameters still work
✓ No changes required to existing workflows
✓ Config provides defaults, inputs provide overrides

## Future Enhancements

Potential additions to caching config:

```json
{
  "prompt_caching": {
    "gpt-5.1": {
      "enabled": true,
      "cache_system_message": true,
      "cache_user_prefix": true,
      "cache_retention": "24h",           // Future: configurable retention
      "cache_threshold_tokens": 1000,     // Future: only cache if > N tokens
      "auto_detect_cacheable": true       // Future: smart caching
    }
  }
}
```
