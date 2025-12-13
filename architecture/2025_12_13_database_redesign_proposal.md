# Database Redesign Proposal - Multi-tenant Remote Server

## Status: DRAFT - In Discussion

This document captures the ongoing discussion about database changes needed for multi-tenant remote server support. Continues from `2025_12_11_server_client_redesign.md`.

---

## Key Decisions Made

1. **Multi-tenant from the start** - Assume multi-tenant even if initially single-user
2. **User scoping** - Add users table, link workflow_template to user
3. **Template name uniqueness** - `workflow_template_name` unique per user (not globally)
4. **Submission format** - Allow zip file (current structure) or single JSON
5. **Version tracking** - Hash of submitted file (zip/json), store resolved JSON in workflow_version
6. **Version lookup** - user + workflow_template_name + content_hash
7. **Resume with version mismatch** - User choice: continue with new, continue with original, or start fresh
8. **Event-level versioning** - Each event stores `workflow_version_id` it was executed under

---

## Proposed Schema

### Entity Relationships

```
users
  └── workflow_templates (1:many, unique template_name per user)
        └── workflow_versions (1:many, unique content_hash per template)
        └── keyword_history (many, shared across versions)
        └── option_usage (many, shared across versions)
        └── workflow_runs (1:many)
              └── branches (1:many)
              └── events (1:many, each event has version_id)
              └── artifacts (1:many)
              └── tokens (1:many)
```

### Table Definitions

**users** (NEW)
```python
{
    "user_id": "usr_xxxxxxxxxxxx",
    "username": "sachira",
    "email": "...",
    "created_at": datetime,
    "updated_at": datetime
}
# Index: unique on username, unique on email
```

**workflow_templates** (MODIFIED)
```python
{
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "user_id": "usr_xxxxxxxxxxxx",           # NEW - FK to users
    "workflow_template_name": "oms_video_generation",
    "display_name": "OMS Video Generation",  # Optional human-readable
    "created_at": datetime,
    "updated_at": datetime
}
# Index: unique on (user_id, workflow_template_name)
```

**workflow_versions** (MODIFIED)
```python
{
    "workflow_version_id": "ver_xxxxxxxxxxxx",
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "content_hash": "sha256:abc123...",       # Hash of submitted zip/json
    "source_type": "zip",                      # "zip" | "json"
    "resolved_workflow": {...},                # Full resolved JSON (inline or GridFS ref)
    "resolved_workflow_ref": "gridfs:xxx",     # If too large for inline
    "created_at": datetime
}
# Index: unique on (workflow_template_id, content_hash)
```

**workflow_runs** (RENAMED from workflows)
```python
{
    "workflow_run_id": "run_xxxxxxxxxxxx",     # Or keep "wf_" prefix for compatibility
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "user_id": "usr_xxxxxxxxxxxx",             # Denormalized for convenience
    "initial_version_id": "ver_xxxxxxxxxxxx",  # Version that started this run
    "current_version_id": "ver_xxxxxxxxxxxx",  # Version currently in use (can change on resume)
    "project_name": "my_video_project",        # Replaces project_folder for remote
    "status": "awaiting_input",                # running | awaiting_input | completed | error
    "current_step": "prompt_generation",
    "created_at": datetime,
    "updated_at": datetime
}
# Index: on user_id, on workflow_template_id, on status
```

**events** (MODIFIED)
```python
{
    "event_id": "evt_xxxxxxxxxxxx",
    "workflow_run_id": "run_xxxxxxxxxxxx",     # RENAMED from workflow_id
    "workflow_version_id": "ver_xxxxxxxxxxxx", # NEW - version this event executed under
    "branch_id": "br_xxxxxxxxxxxx",
    "event_type": "module_completed",
    "data": {...},
    "timestamp": datetime,
    "correlation_id": "corr_xxxxxxxxxxxx"
}
# Index: on workflow_run_id, on (workflow_run_id, branch_id)
```

**branches** (MODIFIED)
```python
{
    "branch_id": "br_xxxxxxxxxxxx",
    "workflow_run_id": "run_xxxxxxxxxxxx",     # RENAMED from workflow_id
    "parent_branch_id": "br_xxxxxxxxxxxx",
    "branch_point_event_id": "evt_xxxxxxxxxxxx",
    "status": "active",
    "created_at": datetime
}
```

**keyword_history** (UNCHANGED - references template, not version)
```python
{
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "step_id": "prompt_generation",
    "module_name": "history.keyword_history",
    "keyword": "cinematic",
    "total_weight": 150,
    "last_used": datetime,
    "expires": datetime,
    "source": "selected",
    "category": "style"
}
```

**option_usage** (UNCHANGED - references template, not version)
```python
{
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "step_id": "user_input",
    "module_name": "user.select",
    "option": "aesthetic:dark_moody",
    "updated_at": datetime,
    "created_at": datetime
}
```

---

## Resume Flow with Version Mismatch

```
CLIENT: POST /workflow/{run_id}/resume
Body: { workflow: <zip/json>, workflow_template_name: "..." }
                              ↓
SERVER:
1. Resolve workflow → compute content_hash
2. Lookup version by (template_id, content_hash)
   - If exists: use existing version_id
   - If not: create new version_id
3. Get workflow_run.current_version_id
4. Compare submitted version vs current version
                              ↓
              ┌───────────────┴───────────────┐
              │                               │
        SAME VERSION                   DIFFERENT VERSION
              │                               │
              ↓                               ↓
    Continue normally              Return: VERSION_MISMATCH
                                   {
                                     current_version: "ver_xxx",
                                     submitted_version: "ver_yyy",
                                     options: [
                                       "continue_with_new",
                                       "continue_with_original",
                                       "start_fresh"
                                     ]
                                   }
                                              ↓
                               CLIENT: POST /workflow/{run_id}/resume/confirm
                               Body: { choice: "continue_with_new" }
                                              ↓
                               SERVER:
                               - Update current_version_id if "continue_with_new"
                               - New events get new version_id
                               - OR start fresh run
```

---

## Migration Considerations

1. **Rename `workflows` → `workflow_runs`** - update all references
2. **Add `workflow_version_id` to events** - backfill existing events
3. **Add `user_id` to workflow_templates** - create default user for existing data
4. **Rename `workflow_id` → `workflow_run_id` in events/branches** - or keep as alias

---

## Open Items / TODO

- [ ] Review and finalize schema (operator indicated changes needed)
- [ ] Discuss artifacts system (from server_client_redesign.md)
- [ ] Discuss media storage (from server_client_redesign.md)
- [ ] Discuss logging changes (from server_client_redesign.md)
- [ ] Plan migration path

---

## Related Documents

- `2025_12_11_server_client_redesign.md` - Full analysis of remote server changes
