# Workflow Versions Schema

## Overview

Complete schema for workflow version tracking. Enables detection of workflow changes between runs and supports remote server architecture where TUI submits workflow content to server.

## Collections

### `workflow_templates`

Stable identity for a workflow type (e.g., "oms_video_generation"). One template can have many versions.

```python
{
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "workflow_template_name": "oms_video_generation",  # From workflow JSON workflow_id field
    "created_at": datetime
}
```

### `workflow_versions`

Each unique workflow content gets a version record. Identified by content hash.

```python
{
    "workflow_version_id": "ver_xxxxxxxxxxxx",
    "workflow_template_id": "tpl_xxxxxxxxxxxx",   # Links to template

    # Content identification
    "content_hash": "sha256:abc123def456...",     # Hash of submitted content
    "source_type": "zip" | "json",                 # What was submitted

    # Stored content
    "resolved_workflow": {                         # Full resolved JSON
        "workflow_id": "oms_video_generation",
        "config": {...},
        "steps": [...]                             # All $ref expanded
    },

    "created_at": datetime
}
```

**Hash computation:**
- `zip`: SHA256 of the entire zip file bytes
- `json`: SHA256 of the JSON file bytes (before parsing)

**Indexes:**
```python
workflow_versions.create_index("workflow_version_id", unique=True)
workflow_versions.create_index("content_hash", unique=True)  # Same content = same version
workflow_versions.create_index("workflow_template_id")
```

### `workflow_runs` (renamed from `workflows`)

A single execution of a workflow. Tracks which version it started with and current version.

```python
{
    "workflow_run_id": "run_xxxxxxxxxxxx",

    # Version tracking
    "initial_version_id": "ver_xxxxxxxxxxxx",     # Version that started this run
    "current_version_id": "ver_xxxxxxxxxxxx",     # Version currently in use
    "workflow_template_id": "tpl_xxxxxxxxxxxx",   # For quick template lookup

    # Execution state
    "status": "created" | "running" | "paused" | "completed" | "error",
    "current_branch_id": "br_xxxxxxxxxxxx",
    "current_step": "step_3",
    "current_step_name": "Image Analysis",
    "current_module": "analyze_image",

    # Timestamps
    "created_at": datetime,
    "updated_at": datetime,
    "completed_at": datetime | null
}
```

### `events`

Each event now includes the version it executed under.

```python
{
    "event_id": "evt_xxxxxxxxxxxx",
    "workflow_run_id": "run_xxxxxxxxxxxx",
    "workflow_version_id": "ver_xxxxxxxxxxxx",    # NEW: Version this event ran under
    "branch_id": "br_xxxxxxxxxxxx",
    "event_type": "module_completed",
    "step_id": "step_1",
    "module_name": "aesthetic_concepts_api",
    "data": {...},
    "timestamp": datetime
}
```

---

## TUI Workflow Submission

TUI reads the workflow folder and creates a ZIP to submit to server.

### Workflow Folder Structure

```
workflows/oms/
├── workflow_v3.json          # Main workflow file
└── steps/
    ├── 1_user_input/
    │   ├── step.json
    │   ├── prompts/
    │   └── schemas/
    ├── 2_prompt_generation/
    │   └── ...
    └── ...
```

### ZIP Creation

```python
import zipfile
from io import BytesIO

def create_workflow_zip(workflow_folder: str) -> bytes:
    """
    Create a ZIP of the workflow folder.

    Returns:
        zip_bytes - TUI just sends this to server, server handles hashing
    """
    buffer = BytesIO()

    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(workflow_folder):
            for file in files:
                filepath = os.path.join(root, file)
                arcname = os.path.relpath(filepath, workflow_folder)
                zf.write(filepath, arcname)

    return buffer.getvalue()
```

**Note:** TUI doesn't compute the hash - just sends content. Server computes hash and manages versions.

### Submission API

```
POST /workflow/start
Content-Type: multipart/form-data

Fields:
  - workflow: <zip file or json file>
  - source_type: "zip" | "json"

Response:
{
    "workflow_run_id": "run_xxxxxxxxxxxx",
    "workflow_version_id": "ver_xxxxxxxxxxxx",
    "is_new_version": true,
    "status": "created"
}
```

```
POST /workflow/{run_id}/resume
Content-Type: multipart/form-data

Fields:
  - workflow: <zip file or json file>
  - source_type: "zip" | "json"

Response (if version matches):
{
    "workflow_run_id": "run_xxxxxxxxxxxx",
    "status": "resumed"
}

Response (if version mismatch):
{
    "status": "version_mismatch",
    "current_version_id": "ver_xxx",
    "submitted_version_id": "ver_yyy",
    "options": ["continue_with_new", "continue_with_original", "start_fresh"]
}
```

---

## Server Processing

### On Start

```python
def start_workflow(workflow_content: bytes, source_type: str) -> WorkflowRun:
    # 1. Compute hash
    content_hash = f"sha256:{hashlib.sha256(workflow_content).hexdigest()}"

    # 2. Check if version exists
    existing_version = db.workflow_versions.find_one({"content_hash": content_hash})

    if existing_version:
        version_id = existing_version["workflow_version_id"]
        template_id = existing_version["workflow_template_id"]
        resolved = existing_version["resolved_workflow"]
    else:
        # 3. Resolve workflow (expand $refs)
        resolved = resolve_workflow(workflow_content, source_type)
        template_name = resolved["workflow_id"]

        # 4. Get or create template
        template_id = get_or_create_template(template_name)

        # 5. Create version record
        version_id = f"ver_{uuid7_str()}"
        db.workflow_versions.insert_one({
            "workflow_version_id": version_id,
            "workflow_template_id": template_id,
            "content_hash": content_hash,
            "source_type": source_type,
            "resolved_workflow": resolved,
            "created_at": datetime.utcnow()
        })

    # 6. Create run
    run_id = f"run_{uuid7_str()}"
    db.workflow_runs.insert_one({
        "workflow_run_id": run_id,
        "initial_version_id": version_id,
        "current_version_id": version_id,
        "workflow_template_id": template_id,
        "status": "created",
        "created_at": datetime.utcnow()
    })

    return run_id, version_id
```

### On Resume

```python
def resume_workflow(run_id: str, workflow_content: bytes, source_type: str):
    # 1. Get current run
    run = db.workflow_runs.find_one({"workflow_run_id": run_id})
    current_version_id = run["current_version_id"]

    # 2. Compute hash of submitted workflow
    content_hash = f"sha256:{hashlib.sha256(workflow_content).hexdigest()}"

    # 3. Get current version
    current_version = db.workflow_versions.find_one(
        {"workflow_version_id": current_version_id}
    )

    # 4. Compare hashes
    if current_version["content_hash"] == content_hash:
        # Same version - resume normally
        return {"status": "resumed", "workflow_run_id": run_id}

    # 5. Version mismatch - check if submitted version exists
    submitted_version = db.workflow_versions.find_one({"content_hash": content_hash})

    if not submitted_version:
        # Create new version record
        resolved = resolve_workflow(workflow_content, source_type)
        submitted_version_id = f"ver_{uuid7_str()}"
        db.workflow_versions.insert_one({
            "workflow_version_id": submitted_version_id,
            "workflow_template_id": run["workflow_template_id"],
            "content_hash": content_hash,
            "source_type": source_type,
            "resolved_workflow": resolved,
            "created_at": datetime.utcnow()
        })
    else:
        submitted_version_id = submitted_version["workflow_version_id"]

    # 6. Return mismatch for client to decide
    return {
        "status": "version_mismatch",
        "current_version_id": current_version_id,
        "submitted_version_id": submitted_version_id,
        "options": ["continue_with_new", "continue_with_original", "start_fresh"]
    }
```

### Confirm Resume Choice

```
POST /workflow/{run_id}/resume/confirm
{
    "choice": "continue_with_new",
    "version_id": "ver_yyy"  // Only needed for continue_with_new
}
```

```python
def confirm_resume(run_id: str, choice: str, version_id: str = None):
    if choice == "continue_with_new":
        # Update current version to new one
        db.workflow_runs.update_one(
            {"workflow_run_id": run_id},
            {"$set": {"current_version_id": version_id}}
        )
        # Continue execution with new workflow definition

    elif choice == "continue_with_original":
        # Keep current version, continue execution
        pass

    elif choice == "start_fresh":
        # Create new run with submitted version
        return start_workflow(...)
```

---

## Storing Events with Version

When storing events, include the current version:

```python
def store_event(workflow_run_id: str, event_type: str, data: dict):
    run = db.workflow_runs.find_one({"workflow_run_id": workflow_run_id})

    db.events.insert_one({
        "event_id": f"evt_{uuid7_str()}",
        "workflow_run_id": workflow_run_id,
        "workflow_version_id": run["current_version_id"],  # Track version
        "branch_id": run["current_branch_id"],
        "event_type": event_type,
        "data": data,
        "timestamp": datetime.utcnow()
    })
```

This allows us to know exactly which workflow definition each event executed under, even if the workflow was updated mid-run.
