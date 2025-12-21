# Workflow Files Collection Schema

## Overview

Single MongoDB collection to store all files from the `ws/` folder. Replaces filesystem storage for remote server architecture.

## Collection: `workflow_files`

```python
{
    # Identity
    "file_id": "wsf_xxxxxxxxxxxx",           # Unique file ID
    "workflow_run_id": "run_xxxxxxxxxxxx",   # Links to workflow run

    # File location (reconstructs path: ws/{category}/{group_id}/{filename})
    "category": "api_calls",                  # "api_calls" | "outputs" | "root"
    "group_id": "image_analysis_openai_20251220_144020_594802",  # For api_calls: call directory name
    "filename": "request.json",               # Original filename

    # Content
    "content_type": "json",                   # "json" | "text"
    "content": {...} or "string content",     # Actual content (parsed JSON or text string)

    # Metadata (for efficient querying)
    "metadata": {
        # For API calls
        "step_id": "image_analysis",
        "provider": "openai",
        "model": "gpt-4o",
        "file_role": "request",               # "request" | "response" | "schema" | "metadata" | "input" | "output"

        # For outputs
        "module_name": "aesthetic_concepts_api",
    },

    # Timestamps
    "created_at": datetime,
}
```

## Indexes

```python
# Primary lookup
workflow_files.create_index("file_id", unique=True)

# Query by workflow
workflow_files.create_index("workflow_run_id")

# Query API calls for a workflow
workflow_files.create_index([
    ("workflow_run_id", ASCENDING),
    ("category", ASCENDING),
    ("group_id", ASCENDING)
])

# Query by step/module
workflow_files.create_index([
    ("workflow_run_id", ASCENDING),
    ("metadata.step_id", ASCENDING)
])
```

## File Categories

| Category | group_id | Example Path |
|----------|----------|--------------|
| `api_calls` | Call directory name | `api_calls/image_analysis_openai_20251220_144020_594802/request.json` |
| `outputs` | Module name | `outputs/aesthetic_concepts.json` |
| `root` | null | `state_snapshot.json` |

## API Call File Roles

| file_role | Description |
|-----------|-------------|
| `request` | API request parameters |
| `response` | API response |
| `schema` | Output JSON schema |
| `metadata` | Call metadata (step, provider, model, timestamp) |
| `input` | Extracted input content (prompts, messages) |
| `output` | Extracted output content (responses) |

## Example Documents

### API Call Request
```json
{
    "file_id": "wsf_abc123",
    "workflow_run_id": "run_xyz789",
    "category": "api_calls",
    "group_id": "image_analysis_openai_20251220_144020_594802",
    "filename": "request.json",
    "content_type": "json",
    "content": {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": {"$ref": "input_0_content_0.txt"}}]
    },
    "metadata": {
        "step_id": "image_analysis",
        "provider": "openai",
        "model": "gpt-4o",
        "file_role": "request"
    },
    "created_at": "2024-12-20T14:40:20.594Z"
}
```

### Extracted Input Content
```json
{
    "file_id": "wsf_abc124",
    "workflow_run_id": "run_xyz789",
    "category": "api_calls",
    "group_id": "image_analysis_openai_20251220_144020_594802",
    "filename": "input_0_content_0.txt",
    "content_type": "text",
    "content": "You are an image analysis assistant...",
    "metadata": {
        "step_id": "image_analysis",
        "provider": "openai",
        "file_role": "input"
    },
    "created_at": "2024-12-20T14:40:20.594Z"
}
```

### Workflow Output
```json
{
    "file_id": "wsf_def456",
    "workflow_run_id": "run_xyz789",
    "category": "outputs",
    "group_id": "aesthetic_concepts_api",
    "filename": "aesthetic_concepts.json",
    "content_type": "json",
    "content": {"concepts": [...]},
    "metadata": {
        "step_id": "user_input",
        "module_name": "aesthetic_concepts_api"
    },
    "created_at": "2024-12-20T14:00:47.995Z"
}
```

## TUI Debug Mode

When running in debug mode, TUI queries this collection and writes files to local `ws/` folder:

```python
class WorkflowFileWriter:
    """Writes workflow_files collection data to local filesystem for debugging."""

    def __init__(self, project_folder: str, enabled: bool = False):
        self.ws_folder = os.path.join(project_folder, 'ws')
        self.enabled = enabled

    def write_all(self, workflow_run_id: str, files: List[Dict]):
        """Write all files for a workflow run to local ws folder."""
        if not self.enabled:
            return

        for file_doc in files:
            self.write_file(file_doc)

    def write_file(self, file_doc: Dict):
        """Write a single file document to filesystem."""
        if not self.enabled:
            return

        # Reconstruct path
        category = file_doc.get('category', 'root')
        group_id = file_doc.get('group_id')
        filename = file_doc['filename']

        if category == 'root':
            path = os.path.join(self.ws_folder, filename)
        elif group_id:
            path = os.path.join(self.ws_folder, category, group_id, filename)
        else:
            path = os.path.join(self.ws_folder, category, filename)

        os.makedirs(os.path.dirname(path), exist_ok=True)

        content = file_doc['content']
        content_type = file_doc.get('content_type', 'text')

        with open(path, 'w', encoding='utf-8') as f:
            if content_type == 'json':
                json.dump(content, f, indent=2)
            else:
                f.write(content)
```

## API Endpoints

```
GET /workflow/{run_id}/files
    - List all files for a workflow run
    - Query params: category, step_id

GET /workflow/{run_id}/files/{file_id}
    - Get specific file content

GET /workflow/{run_id}/api-calls
    - List API calls (grouped by group_id)

GET /workflow/{run_id}/api-calls/{group_id}
    - Get all files for a specific API call
```
