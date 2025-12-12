# Server-Client Architecture Redesign - Full Analysis

## Overview

This document outlines the architectural changes needed to transform the current local-execution server into a true remote web server. The current implementation assumes client and server share the same filesystem, which won't work for remote deployments.

---

## 1. Workflow Template Uniqueness Problem

### Current State
- `workflow_template_name` comes from `workflow_id` field in workflow JSON
- This is user-provided (e.g., `"oms_video_generation"`)
- `keyword_history` and `option_usage` tables reference `workflow_template_id`
- Multiple workflow versions can share same template via `workflow_versions` table

### The Problem
- Client controls uniqueness via `workflow_id` in JSON
- Two different users could use same `workflow_id` for different workflows
- No server-side validation of template identity
- If client submits different workflow content with same `workflow_id`, history gets corrupted

### Proposed Solution: Content-Hash Based Identity

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
│  1. Resolve all $ref in workflow JSON                           │
│  2. Normalize JSON (sort keys, remove whitespace)               │
│  3. Hash the normalized content (SHA-256)                       │
│  4. Submit: {workflow_json, content_hash, display_name}         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ SERVER                                                          │
│  1. Verify content_hash matches submitted JSON                  │
│  2. Look up template by content_hash                            │
│  3. If not found: create new template                           │
│  4. If found: reuse existing template_id                        │
│  5. Store relationship: content_hash → template_id              │
└─────────────────────────────────────────────────────────────────┘
```

### New Schema

```python
# workflow_templates collection
{
    "workflow_template_id": "tpl_xxxxxxxxxxxx",     # Internal ID
    "content_hash": "sha256:abc123...",            # Primary identifier
    "display_name": "OMS Video Generation v3",     # Human-readable
    "workflow_id": "oms_video_generation",         # From JSON (informational)
    "schema_version": "3.0",                       # Workflow schema version
    "created_at": datetime,
    "last_used_at": datetime
}

# Unique index on content_hash
```

### Benefits
- Same content = same template (even across users)
- Different content = different template (even with same `workflow_id`)
- Server controls identity, not client
- Minor workflow changes create new template (preserving history integrity)

### What Gets Hashed
- Workflow structure (steps, modules, order)
- Step definitions (module_id, input/output mappings)
- **NOT:** prompt file contents (too volatile)
- **NOT:** schema file contents
- Just the skeleton/structure

---

## 2. File Output Handling for Multiple Client Types

### Analysis Results
- 8 `io.save_json` calls across workflow
- 7 are debug/archival outputs (never read back)
- 1 is temporary workaround (`.temp_music_options.json` - immediately loaded)
- 1 `io.write_text` for `workflow_summary.txt` (user deliverable)

### io.save_json Usage Details

| Step | File | Data | Read Back? | Category |
|------|------|------|------------|----------|
| 2 | generated_prompts.json | Image generation prompts | No | Debug |
| 3 | image_analysis.json | Motion/environment analysis | No | Debug |
| 4 | video_prompts.json | Video generation prompts | No | Debug |
| 5 | narrative_text_overlays.json | Text overlays + selection | No | Debug |
| 6 | titles_descriptions.json | Titles/descriptions options | No | Debug |
| 7 | text_color_combinations.json | Color combos + selection | No | Debug |
| 8 | .temp_music_options.json | Music options (temp) | YES | Internal |
| 8 | music_generation.json | Music + ElevenLabs prompts | No | Debug |

### Proposed Solution: Artifact System

```
┌─────────────────────────────────────────────────────────────────┐
│ ARTIFACT TYPES                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. DEBUG - For troubleshooting, optional                        │
│ 2. STATE - For workflow continuity (stored in DB)               │
│ 3. DELIVERABLE - Final outputs user wants                       │
└─────────────────────────────────────────────────────────────────┘
```

### New Module Behavior

```json
// Before
{
  "module_id": "io.save_json",
  "inputs": {
    "data": "$state.generated_prompts",
    "file_path": "generated_prompts.json"
  }
}

// After
{
  "module_id": "artifact.store",
  "inputs": {
    "data": "$state.generated_prompts",
    "artifact_name": "generated_prompts",
    "artifact_type": "debug",
    "format": "json"
  }
}
```

### Server Storage

```python
# artifacts collection
{
    "artifact_id": "art_xxxxxxxxxxxx",
    "workflow_id": "wf_xxxxxxxxxxxx",
    "artifact_name": "generated_prompts",
    "artifact_type": "debug",  # debug | state | deliverable
    "format": "json",          # json | text | binary
    "content": {...},          # Stored inline for small content
    "content_ref": "gridfs:xxx", # GridFS ref for large content
    "size_bytes": 12345,
    "created_at": datetime
}
```

### Client Retrieval API

```
GET /workflow/{workflow_id}/artifacts
→ Returns list: [{artifact_id, name, type, format, size}]

GET /workflow/{workflow_id}/artifacts/{artifact_id}
→ Returns content (JSON response or file download)

GET /workflow/{workflow_id}/artifacts?type=deliverable
→ Returns only user deliverables
```

### Client-Type Handling

| Client Type | Debug | State | Deliverable |
|------------|-------|-------|-------------|
| TUI (Local) | Write to disk | DB only | Write to disk |
| TUI (Remote) | Download on-demand | DB only | Download at end |
| Web | View in UI | DB only | Download button |
| API | Fetch via endpoint | DB only | Fetch via endpoint |

---

## 3. Image Storage Across Workflow Steps

### Current Flow
```
Step 3: user.file_input → $state.image_path (local path)
Step 3: api.llm (analyze_image) → reads from path, encodes base64
Step 4: api.llm (video_prompts) → reads from path, encodes base64
Step 7: api.llm (text_colors) → reads from path, encodes base64
```

### Problems
- Image read from disk 3 times
- Path must remain valid throughout workflow
- Can't work with remote server

### Proposed Solution: Media Storage Service

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
│  1. User selects image file                                     │
│  2. Client reads file, encodes to base64                        │
│  3. Client uploads: POST /media/upload                          │
│  4. Server returns: {media_id, url, metadata}                   │
│  5. Client stores media_id in workflow state                    │
└─────────────────────────────────────────────────────────────────┘
```

### Server Storage Options

```python
# Option A: GridFS (MongoDB)
{
    "media_id": "media_xxxxxxxxxxxx",
    "workflow_id": "wf_xxxxxxxxxxxx",
    "filename": "image.png",
    "content_type": "image/png",
    "size_bytes": 2048576,
    "gridfs_id": ObjectId("..."),  # Reference to GridFS
    "created_at": datetime,
    "expires_at": datetime  # Auto-cleanup
}

# Option B: Cloud Storage (S3/GCS)
{
    "media_id": "media_xxxxxxxxxxxx",
    "workflow_id": "wf_xxxxxxxxxxxx",
    "filename": "image.png",
    "content_type": "image/png",
    "size_bytes": 2048576,
    "storage_url": "s3://bucket/workflow/media_xxx.png",
    "created_at": datetime,
    "expires_at": datetime
}
```

### Workflow Changes

```json
// Before (step 3)
{
  "module_id": "user.file_input",
  "outputs_to_state": {
    "value": "image_path"
  }
}

// After (step 3)
{
  "module_id": "user.media_upload",
  "inputs": {
    "accepted_types": ["image/png", "image/jpeg", "image/webp"],
    "max_size_mb": 10
  },
  "outputs_to_state": {
    "media_id": "image_media_id",
    "media_url": "image_url"
  }
}
```

### LLM Module Changes

```json
// Before
{
  "content": "$state.image_path",
  "type": "image"
}

// After
{
  "content": "$state.image_media_id",
  "type": "media_ref"
}
```

### Provider Image Handling

```python
# In openai/provider.py
def _format_message_content(self, content: MessageContent, context):
    if content.content_type == ContentType.MEDIA_REF:
        # Fetch from media storage
        media = media_service.get_media(content.content)
        base64_data = media_service.get_base64(media.media_id)
        return {
            "type": "image_url",
            "image_url": {
                "url": f"data:{media.content_type};base64,{base64_data}"
            }
        }
```

### Benefits
- Image uploaded once, stored server-side
- Same media_id used across all steps
- No repeated disk reads
- Works with remote server
- Auto-cleanup with TTL
- Can cache base64 encoding

---

## 4. History Modules Status

### keyword_history.py - ALREADY DB-ONLY ✓

**Database Operations:**
- `db.get_keyword_history()` - Loads from MongoDB
- `db.update_keyword()` - Updates/inserts keyword
- `db.update_keyword_to_selected()` - Changes status

**NO file system operations.** No changes needed.

### usage_history.py - ALREADY DB-ONLY ✓

**Database Operations:**
- `db.get_option_usage()` - Loads from MongoDB
- `db.update_option_usage()` - Updates timestamp

**NO file system operations.** No changes needed.

---

## 5. Server Logging Solution

### Current State
- `server-logs/server.log` - Rotating file logs (5MB × 4 files)
- `{project}/ws/api_calls/` - Per-request file storage
- MongoDB events - Workflow state events

### Problems
- File logs on server filesystem (not accessible to remote clients)
- API call logs in project folder (assumes shared filesystem)
- No centralized view across workflows
- No log retention policy for API calls

### Proposed Solution: Database-Backed Logging

```python
# logs collection (capped or TTL-indexed)
{
    "log_id": "log_xxxxxxxxxxxx",
    "workflow_id": "wf_xxxxxxxxxxxx",  # Optional
    "level": "INFO",
    "logger": "workflow.processor",
    "message": "[AI REQUEST] OpenAI responses - model=gpt-5-mini",
    "timestamp": datetime,
    "context": {
        "step_id": "prompt_generation",
        "module_name": "api.llm",
        "correlation_id": "corr_xxxxxxxxxxxx"
    }
}

# api_calls collection
{
    "call_id": "call_xxxxxxxxxxxx",
    "workflow_id": "wf_xxxxxxxxxxxx",
    "correlation_id": "corr_xxxxxxxxxxxx",
    "step_id": "prompt_generation",
    "provider": "openai",
    "model": "gpt-5-mini",
    "request": {
        "messages": [...],  # With large content extracted
        "extracted_content": {
            "system_prompt": "gridfs:xxx"  # Large content in GridFS
        }
    },
    "response": {
        "content": "...",
        "usage": {
            "prompt_tokens": 1500,
            "completion_tokens": 500
        }
    },
    "timing": {
        "started_at": datetime,
        "completed_at": datetime,
        "duration_ms": 2500
    },
    "created_at": datetime
}
```

### Log Levels & Retention

| Collection | Index | Retention |
|------------|-------|-----------|
| logs | TTL on timestamp | 7 days |
| api_calls | TTL on created_at | 30 days |
| api_calls (errors) | No TTL | Permanent |

### API Endpoints

```
GET /workflow/{workflow_id}/logs
→ Paginated logs for workflow

GET /workflow/{workflow_id}/api-calls
→ List of API calls with summary

GET /workflow/{workflow_id}/api-calls/{call_id}
→ Full request/response details

GET /logs?level=ERROR&since=2024-01-01
→ Global log search (admin)
```

### Streaming Logs (for TUI)

```
GET /workflow/{workflow_id}/logs/stream
→ SSE stream of real-time logs
```

---

## 6. Additional Issues Found

### 6.1 Parameter Resolver File References

**Problem:** `$ref` in workflow JSON loads files from server filesystem

**Solution:** Client pre-resolves all `$ref` before sending:

```python
# Client-side preprocessing
def resolve_workflow(workflow_path):
    workflow = load_json(workflow_path)
    workflow_dir = os.path.dirname(workflow_path)

    def resolve_refs(obj, base_dir):
        if isinstance(obj, dict):
            if '$ref' in obj:
                ref_path = os.path.join(base_dir, obj['$ref'])
                ref_type = obj.get('type', 'text')
                if ref_type == 'json':
                    return load_json(ref_path)
                else:
                    return load_text(ref_path)
            return {k: resolve_refs(v, base_dir) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [resolve_refs(item, base_dir) for item in obj]
        return obj

    return resolve_refs(workflow, workflow_dir)
```

### 6.2 AI Config Handling

**Problem:** `ai_config_path` points to local file

**Solution:**
- Server manages API keys (environment variables or secure storage)
- Client sends model preferences, not credentials
- AI config becomes part of server configuration, not workflow

```json
// Client request
{
  "workflow": {...},
  "model_preferences": {
    "default_provider": "openai",
    "default_model": "gpt-5-mini"
  }
}
```

### 6.3 Temporary File Workaround

**Problem:** `.temp_music_options.json` save/load cycle in step 8

**Solution:** Fix the state access issue directly - this is a workaround that shouldn't be needed. The module should access `$state.music_options_response.dynamic_options` directly.

---

## 7. Modules Requiring Changes

### Critical (Must Fix for Remote Server)

| Module | File | Issue | Solution |
|--------|------|-------|----------|
| Image encoding | `api/providers/openai/provider.py` | Reads from local path | Use media_ref |
| Image encoding | `api/providers/anthropic/provider.py` | Reads from local path | Use media_ref |
| File input | `modules/user/file_input.py` | Validates local files | Replace with media_upload |
| Save JSON | `modules/io/save_json.py` | Writes to local FS | Replace with artifact.store |
| Write text | `modules/io/write_text.py` | Writes to local FS | Replace with artifact.store |
| Load JSON | `modules/io/load_json.py` | Reads from local FS | Accept content input |

### High Priority

| Module | File | Issue | Solution |
|--------|------|-------|----------|
| Parameter resolver | `engine/parameter_resolver.py` | Loads $ref files | Client-side resolution |
| Build grouped prompt | `modules/prompt/build_grouped_prompt.py` | Reads prompt files | Pre-resolved in workflow |
| Build dynamic schema | `modules/transform/build_dynamic_schema.py` | Reads schema files | Pre-resolved in workflow |
| Workflow processor | `api/workflow_processor.py` | Loads from path | Accept workflow object |

### Medium Priority

| Module | File | Issue | Solution |
|--------|------|-------|----------|
| Call logger | `modules/api/call_logger.py` | Writes to project FS | Database logging |
| Workflow API | `api/workflow_api.py` | Loads ai_config from path | Server-managed config |

---

## 8. New API Design

### Start Workflow (Revised)

```python
# POST /workflow/start
{
    "workflow": {
        # Full resolved workflow JSON
        # All $ref expanded inline
        # All step definitions included
    },
    "display_name": "My Video Project",  # Human-readable
    "model_preferences": {
        "default_provider": "openai",
        "default_model": "gpt-5-mini"
    }
}

# Response
{
    "workflow_id": "wf_xxxxxxxxxxxx",
    "template_id": "tpl_xxxxxxxxxxxx",
    "status": "awaiting_input",
    ...
}
```

### Media Upload

```python
# POST /media/upload
# Content-Type: multipart/form-data
# - file: binary
# - workflow_id: string (optional, for association)
# - ttl_hours: int (default: 24)

# Response
{
    "media_id": "media_xxxxxxxxxxxx",
    "filename": "image.png",
    "content_type": "image/png",
    "size_bytes": 2048576,
    "expires_at": "2024-01-02T00:00:00Z"
}
```

### Artifact Retrieval

```python
# GET /workflow/{workflow_id}/artifacts
{
    "artifacts": [
        {
            "artifact_id": "art_xxxxxxxxxxxx",
            "name": "generated_prompts",
            "type": "debug",
            "format": "json",
            "size_bytes": 12345,
            "created_at": "2024-01-01T12:00:00Z"
        }
    ]
}

# GET /workflow/{workflow_id}/artifacts/{artifact_id}
# Returns content directly (JSON or file download)
```

---

## 9. Migration Path

### Phase 1: Add New Infrastructure
1. Create media storage service (GridFS)
2. Create artifact storage service
3. Add database logging collections
4. Implement new API endpoints

### Phase 2: Create New Modules
1. `user.media_upload` - Replaces `user.file_input`
2. `artifact.store` - Replaces `io.save_json` / `io.write_text`
3. `artifact.load` - Replaces `io.load_json` (if needed)

### Phase 3: Update Providers
1. Add `ContentType.MEDIA_REF` support
2. Implement media fetching in image encoding
3. Remove `IMAGE_PATH` handling

### Phase 4: Client Updates
1. Implement workflow pre-resolution
2. Implement media upload flow
3. Implement artifact download

### Phase 5: Cleanup
1. Remove legacy file-based modules
2. Remove path-based workflow loading
3. Update documentation

---

## 10. Summary: Required Changes

| Component | Change Type | Priority |
|-----------|-------------|----------|
| Workflow Templates | Content-hash identity | HIGH |
| Media Storage | New service + GridFS/S3 | HIGH |
| Artifact System | Replace io.save_json | HIGH |
| Parameter Resolver | Client-side resolution | HIGH |
| API Config | Server-managed keys | HIGH |
| Logging | Database-backed | MEDIUM |
| Image Encoding | Use media_ref | MEDIUM |
| Temp File Workaround | Remove | LOW |
