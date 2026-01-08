# Aesthetic Selection UX - Plan of Action

Based on architecture revision R11 (final).

---

## Overview

This POA implements:
1. **`pipeline.execution_groups`** - Meta-module for client-specific workflow paths
2. **`user.form`** - Rich form interaction module for WebUI
3. **`io.validate`** - Schema validation module
4. **`transform.reshape`** - Generic data transformation module
5. **Database schema** - New collections for workflow resolutions
6. **Version switch logic** - Resume with new workflow version support

---

## Phase 1: Database Schema Changes

### 1.1 New Collection: `workflow_resolutions`

**File**: `server/api/database_provider.py`

```python
# Add to DatabaseProvider class

async def create_workflow_resolution(self, resolution: dict) -> str:
    """Create a workflow resolution record."""
    resolution["workflow_resolution_id"] = self._generate_id("res")
    resolution["created_at"] = datetime.utcnow()
    await self.db.workflow_resolutions.insert_one(resolution)
    return resolution["workflow_resolution_id"]

async def get_workflow_resolutions_for_template(
    self,
    workflow_template_id: str,
    source_workflow_version_id: str = None
) -> list[dict]:
    """Get all resolutions for a template, optionally filtered by source version."""
    query = {"workflow_template_id": workflow_template_id}
    if source_workflow_version_id:
        query["source_workflow_version_id"] = source_workflow_version_id
    return await self.db.workflow_resolutions.find(query).to_list(None)

async def find_matching_resolution(
    self,
    source_workflow_version_id: str,
    client_capabilities: list[str]
) -> dict | None:
    """Find resolution matching client capabilities with highest priority score."""
    # Implementation uses aggregation from R11
    pass
```

**Schema**:
```javascript
{
    workflow_resolution_id: String,
    workflow_template_id: String,
    source_workflow_version_id: String,
    resolved_workflow_version_id: String,
    requires: [{ capability: String, priority: Number }],
    selected_paths: { [group_name]: path_name },
    created_at: Date
}
```

**Indexes**:
```javascript
db.workflow_resolutions.createIndex({ workflow_template_id: 1, source_workflow_version_id: 1 })
db.workflow_resolutions.createIndex({ source_workflow_version_id: 1 })
```

### 1.2 New Collection: `workflow_run_resolutions`

**File**: `server/api/database_provider.py`

```python
async def create_workflow_run_resolution(self, run_resolution: dict) -> str:
    """Create a workflow run resolution record."""
    run_resolution["workflow_run_resolution_id"] = self._generate_id("runres")
    run_resolution["created_at"] = datetime.utcnow()
    run_resolution["is_active"] = True
    await self.db.workflow_run_resolutions.insert_one(run_resolution)
    return run_resolution["workflow_run_resolution_id"]

async def get_active_run_resolution(self, workflow_run_id: str) -> dict | None:
    """Get active resolution for a workflow run."""
    return await self.db.workflow_run_resolutions.find_one({
        "workflow_run_id": workflow_run_id,
        "is_active": True
    })

async def switch_run_resolution(
    self,
    workflow_run_id: str,
    new_resolution_id: str,
    client_capabilities: list[str],
    source_workflow_version_id: str
) -> str:
    """Switch active resolution for a run (deactivate old, create new)."""
    # Deactivate current
    await self.db.workflow_run_resolutions.update_many(
        {"workflow_run_id": workflow_run_id, "is_active": True},
        {"$set": {"is_active": False}}
    )
    # Create new
    return await self.create_workflow_run_resolution({
        "workflow_run_id": workflow_run_id,
        "workflow_resolution_id": new_resolution_id,
        "source_workflow_version_id": source_workflow_version_id,
        "client_capabilities": client_capabilities
    })
```

**Schema**:
```javascript
{
    workflow_run_resolution_id: String,
    workflow_run_id: String,
    workflow_resolution_id: String,
    source_workflow_version_id: String,
    client_capabilities: [String],
    is_active: Boolean,
    created_at: Date
}
```

**Indexes**:
```javascript
db.workflow_run_resolutions.createIndex(
    { workflow_run_id: 1, is_active: 1 },
    { unique: true, partialFilterExpression: { is_active: true } }
)
```

### 1.3 Migration Script

**File**: `server/api/database_migrations/m_6.py`

- Create new collections
- Create indexes
- No data migration needed (new feature)

---

## Phase 2: Workflow Flattening Engine

### 2.1 Execution Groups Parser

**File**: `server/engine/execution_groups.py` (new)

```python
class ExecutionGroupsProcessor:
    """Handles pipeline.execution_groups meta-module processing."""

    def find_execution_groups(self, workflow: dict) -> list[dict]:
        """Find all execution_groups modules in workflow."""
        pass

    def generate_combinations(self, groups: list[dict]) -> list[tuple]:
        """Generate all path combinations using itertools.product."""
        pass

    def select_group(self, groups: list[dict], capabilities: set[str]) -> dict:
        """Select first group whose requires is subset of capabilities."""
        pass

    def flatten_workflow(
        self,
        workflow: dict,
        selected_paths: dict[str, str]
    ) -> tuple[dict, list[dict], dict[str, str]]:
        """
        Flatten workflow by inlining selected paths.

        Returns:
            - Flattened workflow
            - Merged requires list
            - Selected paths mapping
        """
        pass

    def add_group_origin_metadata(self, module: dict, group_info: dict) -> dict:
        """Add _group_origin metadata to inlined module."""
        pass

    def create_validator_module(self, group_name: str, output_schema: dict) -> dict:
        """Create io.validate module for group exit."""
        pass
```

### 2.2 Integration with Workflow Resolver

**File**: `server/api/workflow_resolver.py`

Modify `resolve_workflow()` to:
1. After $ref resolution, scan for `pipeline.execution_groups`
2. If found, generate all combinations
3. Create flattened workflow_versions for each combination
4. Create workflow_resolutions linking source to flattened versions

```python
async def resolve_and_flatten_workflow(
    self,
    workflow: dict,
    workflow_template_id: str
) -> tuple[str, list[str]]:
    """
    Resolve $refs and generate flattened versions.

    Returns:
        - source_workflow_version_id
        - list of resolution_ids created
    """
    pass
```

---

## Phase 3: New Modules

### 3.1 `user.form` Module

**Server**: `server/modules/user/form.py` (new)

```python
class FormModule(InteractiveModule):
    """Rich form interaction with multiple field types."""

    module_id = "user.form"

    def create_interaction_request(self, inputs: dict, context: WorkflowContext) -> InteractionRequest:
        """Create form interaction request."""
        pass

    def process_response(self, response: InteractionResponse, inputs: dict) -> dict:
        """Process form response, apply filters, return structured output."""
        pass
```

**Interaction Request Schema**:
```python
{
    "interaction_type": "form",
    "title": str,
    "groups": [
        {
            "id": str,
            "type": "per_item" | "static",
            "data": list | None,  # For per_item
            "schema": dict,  # Display + input schema
            "filter_output": dict | None
        }
    ]
}
```

**TUI**: `tui/strategies/form.py` (new)
- Fallback to text-based form rendering
- Support keyboard navigation for fields

**WebUI**: `webui/src/components/workflow/interactions/form/` (new)
- `FormInteractionHost.tsx` - Main form component
- `PerItemGroup.tsx` - Render per-item fields
- `StaticGroup.tsx` - Render static fields
- `fields/NumberField.tsx`
- `fields/SelectField.tsx`
- `fields/ToggleField.tsx`
- `fields/TextField.tsx`

### 3.2 `io.validate` Module

**File**: `server/modules/io/validate.py` (new)

```python
class ValidateModule(ExecutableModule):
    """Validate state values against JSON schema."""

    module_id = "io.validate"

    def execute(self, inputs: dict, context: WorkflowContext) -> dict:
        """Validate state keys against schema, raise on failure."""
        schema = inputs["schema"]
        state_keys = inputs["state_keys"]

        data = {key: context.state.get(key) for key in state_keys}
        jsonschema.validate(data, schema)

        return {}  # No outputs
```

### 3.3 `transform.reshape` Module

**File**: `server/modules/transform/reshape.py` (new)

```python
class ReshapeModule(ExecutableModule):
    """Generic data transformation using templates."""

    module_id = "transform.reshape"

    def execute(self, inputs: dict, context: WorkflowContext) -> dict:
        """Transform source data using template."""
        source = inputs["source"]
        template = inputs["template"]

        if "_for_each" in template:
            # Array transformation
            return self._transform_array(source, template)
        else:
            # Object transformation
            return self._transform_object(source, template)
```

---

## Phase 4: API Changes

### 4.1 Workflow Start Endpoint

**File**: `server/api/workflow_api.py`

Modify `/workflow/start`:
1. Accept `capabilities` in request body
2. Use aggregation query to find matching resolution
3. Create `workflow_run_resolution` record
4. Return flattened workflow

```python
class StartWorkflowRequest(BaseModel):
    workflow_template_name: str = None
    project_name: str
    capabilities: list[str] = []  # NEW
    # ... existing fields
```

### 4.2 Workflow Resume Endpoint

**File**: `server/api/workflow_api.py`

Modify resume logic:
1. Check for new workflow version
2. Detect changes (before/after current step)
3. Return `confirm_required` if needed
4. Handle user confirmation

New endpoint:
```python
@app.post("/workflow/{workflow_run_id}/confirm-version")
async def confirm_version_switch(
    workflow_run_id: str,
    choice: Literal["switch", "keep_current"],
    capabilities: list[str]
):
    """Handle user decision on version switch."""
    pass
```

### 4.3 New Response Types

**File**: `server/api/models.py`

```python
class VersionChangeInfo(BaseModel):
    changes_before_current: list[dict]
    changes_at_current: list[dict]
    changes_after_current: list[dict]

class WorkflowResponse(BaseModel):
    # ... existing fields
    version_change: VersionChangeInfo | None = None
    confirm_required: bool = False
```

---

## Phase 5: Version Change Detection

### 5.1 Workflow Diff Utility

**File**: `server/api/workflow_diff.py` (extend existing)

```python
def detect_workflow_changes(
    old_workflow: dict,
    new_workflow: dict,
    current_step_id: str,
    current_module_name: str
) -> dict:
    """
    Compare workflows and categorize changes.

    Returns:
        {
            "changes_before_current": [...],
            "changes_at_current": [...],
            "changes_after_current": [...],
            "can_proceed_safely": bool
        }
    """
    pass

def compare_steps(old_step: dict, new_step: dict) -> list[dict]:
    """Compare two steps and return list of changes."""
    pass

def compare_modules(old_module: dict, new_module: dict) -> dict | None:
    """Compare two modules, return change info or None if identical."""
    pass
```

---

## Phase 6: WebUI Changes

### 6.1 Types

**File**: `webui/src/lib/types.ts`

```typescript
// New interaction type
type InteractionType =
  | "text_input"
  | "select_from_structured"
  | "review_grouped"
  | "file_input"
  | "file_download"
  | "form"  // NEW
  | "resume_choice"
  | "retry_options";

// Form interaction types
interface FormGroup {
  id: string;
  type: "per_item" | "static";
  data?: unknown[];
  schema: FormSchema;
  filter_output?: { exclude_when: Record<string, unknown> };
}

interface FormInteractionRequest {
  interaction_type: "form";
  title: string;
  groups: FormGroup[];
}

// Version change types
interface VersionChangeInfo {
  changes_before_current: WorkflowChange[];
  changes_at_current: WorkflowChange[];
  changes_after_current: WorkflowChange[];
}

interface WorkflowChange {
  type: "step_added" | "step_removed" | "module_added" | "module_removed" | "module_modified";
  step_id: string;
  module_name?: string;
}
```

### 6.2 Form Interaction Component

**File**: `webui/src/components/workflow/interactions/form/FormInteractionHost.tsx`

- Render form groups
- Handle field state
- Submit form response

### 6.3 Version Confirmation Dialog

**File**: `webui/src/components/workflow/VersionConfirmDialog.tsx`

- Show when `confirm_required: true`
- Display changes categorized by position
- Let user choose "switch" or "keep_current"

---

## Phase 7: TUI Changes

### 7.1 Form Strategy

**File**: `tui/strategies/form.py` (new)

```python
class FormStrategy(InteractionStrategy):
    """Handle form interactions in TUI."""

    def handle(self, request: InteractionRequest) -> InteractionResponse:
        """Render form fields and collect input."""
        # For per_item: show list with field inputs per row
        # For static: show fields vertically
        pass
```

### 7.2 Register New Strategy

**File**: `tui/handler.py`

```python
self._strategies = {
    # ... existing
    InteractionType.FORM: FormStrategy(self),
}
```

---

## Phase 8: Contracts Update

### 8.1 InteractionType Enum

**File**: `contracts/interaction.py`

```python
class InteractionType(str, Enum):
    # ... existing
    FORM = "form"
```

---

## Implementation Order

### Stage 1: Foundation (Database + Core Logic)
1. Database migrations (new collections + indexes)
2. `ExecutionGroupsProcessor` class
3. `io.validate` module
4. `transform.reshape` module

### Stage 2: Flattening Pipeline
1. Modify workflow resolver to handle execution_groups
2. Generate flattened versions on upload
3. Create workflow_resolutions records

### Stage 3: Resolution Selection
1. Aggregation query for finding matching resolution
2. Modify `/workflow/start` to use capabilities
3. Create `workflow_run_resolution` on start

### Stage 4: user.form Module
1. Server module implementation
2. WebUI component
3. TUI fallback strategy

### Stage 5: Version Switch
1. Change detection logic
2. Resume flow modifications
3. Confirmation endpoint
4. WebUI confirmation dialog

### Stage 6: Testing
1. Unit tests for flattening logic
2. Unit tests for resolution selection
3. Integration tests for full flow
4. Manual testing with OMS workflow

---

## Files to Create/Modify

### New Files
- `server/engine/execution_groups.py`
- `server/modules/io/validate.py`
- `server/modules/transform/reshape.py`
- `server/modules/user/form.py`
- `server/api/database_migrations/m_6.py`
- `tui/strategies/form.py`
- `webui/src/components/workflow/interactions/form/FormInteractionHost.tsx`
- `webui/src/components/workflow/interactions/form/PerItemGroup.tsx`
- `webui/src/components/workflow/interactions/form/StaticGroup.tsx`
- `webui/src/components/workflow/interactions/form/fields/*.tsx`
- `webui/src/components/workflow/VersionConfirmDialog.tsx`

### Modified Files
- `server/api/database_provider.py` - New collection methods
- `server/api/workflow_resolver.py` - Flattening integration
- `server/api/workflow_api.py` - Start/resume changes
- `server/api/workflow_diff.py` - Change detection
- `server/api/models.py` - New request/response types
- `server/engine/module_registry.py` - Register new modules
- `contracts/interaction.py` - New interaction type
- `tui/handler.py` - Register form strategy
- `webui/src/lib/types.ts` - New types
- `webui/src/components/workflow/interactions/InteractionHost.tsx` - Handle form type

---

## Estimated Complexity

| Component | Complexity | Notes |
|-----------|------------|-------|
| Database schema | Low | New collections, straightforward |
| Flattening engine | Medium | Core logic, needs thorough testing |
| Resolution selection | Medium | Aggregation query, priority scoring |
| user.form server | Medium | Multiple group types, filtering |
| user.form WebUI | High | Rich UI, multiple field types |
| user.form TUI | Low | Fallback text-based rendering |
| io.validate | Low | Simple schema validation |
| transform.reshape | Medium | Template processing |
| Version switch | Medium | Change detection, confirmation flow |

---

## Risk Areas

1. **Flattening correctness** - Must preserve all module properties, handle nested $refs
2. **Priority scoring edge cases** - Same score scenarios
3. **State compatibility on version switch** - Orphaned state, missing state
4. **WebUI form complexity** - Schema-driven rendering with inputs

---

## Success Criteria

1. WebUI can render form interactions with per-item and static groups
2. TUI falls back gracefully to text-based input
3. Workflow upload generates correct flattened versions
4. Client capabilities correctly select appropriate resolution
5. Resume with new version prompts user when changes affect past steps
6. All existing workflows continue to work (no execution_groups = single resolution)
