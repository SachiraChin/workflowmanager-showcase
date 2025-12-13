# Aesthetic Similarity Detection - Bug Fix

## Issue Summary

The aesthetic history similarity detection stopped working correctly after switching to GPT-5.1, allowing duplicate or highly similar aesthetics to be generated even though they were in the exclusion list.

## Root Cause

The `config` section in `server/workflows/oms/history/aesthetic_history.json` had incorrect similarity thresholds:

```json
"config": {
  "similarity_threshold_title": 0.85,
  "similarity_threshold_description": 1,      ← PROBLEM: Required 100% match
  "similarity_threshold_emotion": 1           ← PROBLEM: Required 100% match
}
```

### How Similarity Detection Works

The system uses a **cascading similarity check** (see `server/modules/history/aesthetic_history.py:628-715`):

1. **Title similarity** must pass threshold (0.85 = 85% similar)
2. **Description similarity** must pass threshold (should be 0.6 = 60% similar)
3. **Emotion similarity** must pass threshold (should be 0.6 = 60% similar)
4. **Only if ALL THREE pass** is an aesthetic flagged as a duplicate

With thresholds set to 1.0 for description and emotion, only **exact duplicates** would be detected, which is nearly impossible with AI-generated text.

## Fix Applied

Updated the thresholds in `aesthetic_history.json` to match the code defaults:

```json
"config": {
  "similarity_threshold_title": 0.85,
  "similarity_threshold_description": 0.6,    ✓ FIXED: 60% similarity
  "similarity_threshold_emotion": 0.6         ✓ FIXED: 60% similarity
}
```

## Verification

Ran test script `test_aesthetic_similarity.py` which confirmed:
- ✓ Fix is working correctly
- ✓ Found 1 match in last 20 aesthetics that should have been flagged:
  - "Auric Canal of Gentle Currents" vs "Auric Canal of Quiet Currents"
  - Title: 0.901, Description: 0.955, Emotion: 0.661
  - All three scores exceed their respective thresholds

## How the Issue Occurred

The thresholds were likely:
1. Manually edited at some point for testing/debugging
2. Never reverted back to the correct values
3. The issue became noticeable after switching to GPT-5.1 because the model generates more varied content

## Prevention

The similarity thresholds are stored in `aesthetic_history.json` config section. The code has default values:
- `similarity_threshold_title`: 0.85 (module default)
- `similarity_threshold_description`: 0.6 (module default)
- `similarity_threshold_emotion`: 0.6 (module default)

**If you need to tune these values**, edit them in the config section of the history file, but remember:
- **Higher values** = stricter matching = fewer duplicates detected
- **Lower values** = looser matching = more duplicates detected
- Setting to **1.0** effectively disables that check
- Recommended range: **0.5 to 0.9**

## Related Files

- **Module**: `server/modules/history/aesthetic_history.py`
- **Config**: `server/workflows/oms/history/aesthetic_history.json` (config section at end)
- **Embeddings**: `server/workflows/oms/history/aesthetic_history_embeddings.pkl`
- **Test Script**: `test_aesthetic_similarity.py`
- **Workflow**: `server/workflows/oms/workflow_v2.json` (loads history at step 1)

## Testing

To verify similarity detection is working:

```bash
python test_aesthetic_similarity.py
```

This checks the last 20 aesthetics against all previous ones and reports any matches.
