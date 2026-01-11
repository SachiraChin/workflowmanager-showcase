# Technical Debt Tracker

This file tracks known design issues and technical debt that need to be addressed in future refactoring sessions.

---

## 0. Hardcoded Workflow Field in workflow_processor.py

**Date Identified:** 2026-01-07
**Severity:** Critical
**Status:** Open

### Problem

The `workflow_processor.py` has hardcoded debug logging that specifically checks for `aesthetic_selections` state key:

```python
# Line 1215-1221
if state_key == 'aesthetic_selections':
    self.logger.info(f"[STORE_OUTPUT] Storing {state_key}: type={type(value).__name__}, len={len(value) if isinstance(value, list) else 'N/A'}")
    if isinstance(value, list) and len(value) > 0:
        first = value[0]
        self.logger.info(f"[STORE_OUTPUT] First item type={type(first).__name__}, keys={list(first.keys()) if isinstance(first, dict) else 'N/A'}")
        if isinstance(first, dict) and 'aesthetic' in first:
            self.logger.info(f"[STORE_OUTPUT] First item aesthetic: {first['aesthetic']}")
```

This is workflow-specific logic embedded in the generic workflow engine.

### Impact

1. **Engine contamination**: Workflow-specific code in generic engine violates separation of concerns
2. **Hidden dependency**: Engine has implicit knowledge of OMS workflow structure
3. **Unknown scope**: Unclear if there are other hardcoded workflow references elsewhere in the engine
4. **Maintenance risk**: Changes to aesthetic_selections structure could silently break or require engine changes

### Files Affected

- `server/api/workflow_processor.py` - Lines 1215-1221

### Suggested Fix

1. **Immediate**: Remove the hardcoded debug logging or make it generic (log all outputs, not just aesthetic_selections)
2. **Audit**: Search entire `server/` codebase for other hardcoded workflow field names
3. **Prevention**: Add linting rule or code review checklist item to prevent workflow-specific code in engine

---

## 1. InteractionRequest Flat Structure Problem

**Date Identified:** 2024-12-24
**Severity:** Medium
**Status:** Open

### Problem

The `InteractionRequest` in `contracts/interactions.py` is a flat dataclass containing fields for ALL interaction types:

```python
@dataclass
class InteractionRequest:
    # Common fields
    interaction_type: InteractionType
    interaction_id: str
    title: str = ""
    prompt: str = ""

    # SELECT_FROM_LIST specific
    options: List[SelectOption] = ...
    min_selections: int = 1
    max_selections: int = 1

    # TEXT_INPUT specific
    multiline: bool = False
    placeholder: str = ""

    # CONFIRM specific
    yes_label: str = "Yes"
    no_label: str = "No"

    # FILE_DOWNLOAD specific
    file_content: Any = None
    file_name: str = ""
    ...
```

### Impact

1. **Redundant Data in API Calls**: Every interaction request serializes ALL fields, even irrelevant ones. A simple CONFIRM interaction still sends `file_content`, `multiline`, `options`, etc. with default values.

2. **Maintenance Burden**: Multiple places must stay in sync when adding new interaction types:
   - `contracts/interactions.py` - `InteractionRequest` and `InteractionResponse` dataclasses
   - `server/api/models.py` - `ApiInteractionRequest`, `InteractionResponseData` Pydantic models, `ApiInteractionType` enum
   - `server/api/workflow_processor.py` - `_serialize_interaction_request()` method
   - `server/api/workflow_processor.py` - `EngineInteractionResponse` construction (line ~878)
   - `tui/workflow_runner.py` - `_convert_dict_to_engine_request()` function

3. **Easy to Miss Fields**: The FILE_DOWNLOAD bugs occurred because fields were added to `contracts/interactions.py` but not propagated to:
   - `_serialize_interaction_request()` - caused request fields not to be sent via SSE
   - `ApiInteractionType` enum - caused serialization error
   - `_convert_dict_to_engine_request()` type_map - caused wrong strategy selection
   - `EngineInteractionResponse` construction - caused response fields (file_written, file_path, file_error) not passed to module

### Files Affected

- `contracts/interactions.py` - Line 39-97
- `server/api/models.py` - `ApiInteractionRequest` class, `ApiInteractionType` enum
- `server/api/workflow_processor.py` - `_serialize_interaction_request()` method
- `tui/workflow_runner.py` - `_convert_dict_to_engine_request()` function

### Suggested Fix

Consider one of these approaches:

**Option A: Union/Discriminated Types**
```python
@dataclass
class TextInputRequest:
    interaction_type: Literal[InteractionType.TEXT_INPUT]
    multiline: bool = False
    placeholder: str = ""
    ...

@dataclass
class FileDownloadRequest:
    interaction_type: Literal[InteractionType.FILE_DOWNLOAD]
    file_content: Any
    file_name: str
    ...

InteractionRequest = Union[TextInputRequest, ConfirmRequest, ...]
```

**Option B: Nested Type-Specific Data**
```python
@dataclass
class InteractionRequest:
    interaction_type: InteractionType
    interaction_id: str
    # Common fields only
    title: str = ""
    prompt: str = ""
    # Type-specific data in a dict/TypedDict
    type_data: Dict[str, Any] = field(default_factory=dict)
```

**Option C: Auto-serialization from dataclass**
Use `dataclasses.asdict()` or similar to automatically serialize all fields, eliminating the manual `_serialize_interaction_request()` method.

---

## 2. WebUI ux_nudge Not Yet Implemented

**Date Identified:** 2024-12-31
**Severity:** Low
**Status:** Open

### Problem

The `ux_nudge` schema property is defined in types but not used for view selection in WebUI structured select components. Currently:
- `UxNudge` type exists with values: `"list" | "table" | "cards" | "compact" | "dropdown"`
- `ux_nudge` property exists in `SchemaProperty` type
- Schema files can specify `ux_nudge: "table"` (e.g., `music_options_display_schema.json`)
- But WebUI ignores it - users manually pick between cards/list variants

### Impact

1. **No table view**: When `ux_nudge: "table"` is specified, data still renders as list/cards instead of a proper table
2. **Manual variant selection**: Users must choose view variant instead of schema driving the optimal display
3. **Inconsistent with TUI**: TUI may handle ux_nudge differently, causing UX disparity

### Files Affected

- `webui/src/components/workflow/interactions/structured-select/types.ts` - `UxNudge` type defined
- `webui/src/components/workflow/interactions/structured-select/index.ts` - Variant selection logic
- `webui/src/components/workflow/interactions/StructuredSelectInteraction.tsx` - Component that uses variants

### Suggested Fix

1. **Add table view component**: Create `StructuredSelectTableControlled.tsx` that renders items in an HTML table using `display_components` as column headers
2. **Auto-select variant from ux_nudge**: When `ux_nudge` is specified in schema, use it to auto-select the appropriate variant:
   - `"table"` → StructuredSelectTableControlled
   - `"cards"` → StructuredSelectCardsControlled
   - `"list"` → StructuredSelectListControlled
   - `"compact"` / `"dropdown"` → Future components
3. **Allow override**: Let users override the auto-selected variant if needed

---

## 3. Templates Tab Should Show Workflow Versions

**Date Identified:** 2026-01-03
**Severity:** Low
**Status:** Open

### Problem

The Templates tab on the landing page (`WorkflowStartPage.tsx`) currently shows only workflow template names. Users cannot see or select from different versions of the same template.

### Desired Behavior

1. Show workflow versions instead of just templates in the dropdown
2. Format: `{template_name}-{created_at:yyyy-MM-dd'T'HH:mm:ss}` (local timezone)
3. Increase dropdown width to fit the longer format
4. Allow starting a workflow from a specific version (not just latest)

### Impact

1. Users can only start from the latest version of a template
2. No visibility into version history from the UI
3. Cannot reproduce runs from older versions

### Files Affected

- `webui/src/components/workflow/start/TemplateSelector.tsx` - Currently shows template names only
- `webui/src/lib/api.ts` - Needs `listWorkflowVersions()` method
- `server/api/workflow_api.py` - Needs `/workflow-versions` endpoint
- `server/api/workflow_api.py` - Start endpoint needs to accept `workflow_version_id` parameter

### Suggested Fix

1. Add `/workflow-versions` endpoint that joins `workflow_versions` with `workflow_templates` to get version list with template names
2. Modify `/workflow/start` endpoint to accept optional `workflow_version_id` - if provided, use that specific version instead of latest
3. Update `TemplateSelector` to fetch versions and display with new format
4. Widen the Select dropdown to accommodate longer version strings

---

## 4. WebUI ui/ Folder Uses Kebab-Case File Names

**Date Identified:** 2026-01-05
**Severity:** Low
**Status:** Open

### Problem

The `webui/src/components/ui/` folder uses kebab-case file naming (e.g., `button.tsx`, `scroll-area.tsx`) because these are shadcn/ui components copied from the shadcn library. However, all other component folders in the project use PascalCase (e.g., `WorkflowSidebar.tsx`, `InteractionPanel.tsx`).

This creates ambiguity when adding new components:
- Generic UI components belong in `ui/` but the naming convention doesn't match the rest of the project
- Developers must remember different conventions for different folders
- New components that aren't from shadcn don't fit cleanly into the kebab-case convention

### Impact

1. **Inconsistent naming**: Two different naming conventions in the same project
2. **Decision fatigue**: Unclear where new generic components should go and what naming to use
3. **Import confusion**: Some imports use kebab-case paths, others use PascalCase

### Files Affected

All files in `webui/src/components/ui/`:
- `accordion.tsx` → `Accordion.tsx`
- `alert.tsx` → `Alert.tsx`
- `badge.tsx` → `Badge.tsx`
- `button.tsx` → `Button.tsx`
- `card.tsx` → `Card.tsx`
- `checkbox.tsx` → `Checkbox.tsx`
- `collapsible.tsx` → `Collapsible.tsx`
- `dialog.tsx` → `Dialog.tsx`
- `dropdown-menu.tsx` → `DropdownMenu.tsx`
- `input.tsx` → `Input.tsx`
- `json-tree-view.tsx` → `JsonTreeView.tsx`
- `label.tsx` → `Label.tsx`
- `popover.tsx` → `Popover.tsx`
- `progress.tsx` → `Progress.tsx`
- `radio-group.tsx` → `RadioGroup.tsx`
- `scroll-area.tsx` → `ScrollArea.tsx`
- `select.tsx` → `Select.tsx`
- (and any other files in this folder)

### Suggested Fix

1. Rename all files in `ui/` folder to PascalCase
2. Update all imports across the codebase (use find/replace)
3. Update `components.json` if shadcn CLI uses it for file paths
4. Document that all components use PascalCase regardless of origin

---

## 5. Addon System - Server Consolidation and Client Rendering

**Date Identified:** 2026-01-06
**Severity:** Low
**Status:** Open

### Problem

The addon system currently works as follows:
1. Multiple addons (`addons.usage_history`, `addons.compatibility`) run on the server
2. Each addon returns `{index: {color, score, last_used, ...}}` data
3. Server consolidates all addon results into a single `_addon` object on each item
4. Client (`SelectableItem.tsx`) has hardcoded rendering for specific addon fields

This creates several issues:
- **Hardcoded client rendering**: `SelectableItem.tsx` specifically renders `color`, `score`, and `last_used` fields. Adding new addon data requires client code changes.
- **No schema-driven addon display**: Unlike the main data which uses JSON Schema for display hints, addon data has no schema describing how to render it.
- **Height inconsistency**: Items with `last_used` are taller than items without, causing visual inconsistency in lists.
- **Space utilization**: Current padding/spacing doesn't optimize for long lists where users focus on visible items.

### Impact

1. **Tight coupling**: Client must know about specific addon fields
2. **Maintenance burden**: New addon types require both server and client changes
3. **Inconsistent UX**: List items have different heights based on addon data presence
4. **Not extensible**: Can't easily add new addon visualizations without code changes

### Files Affected

**Server:**
- `server/modules/addons/base.py` - Addon base class
- `server/modules/addons/compatibility.py` - Compatibility addon
- `server/modules/addons/usage_history.py` - Usage history addon
- `server/modules/user/select.py` - `_embed_addon_data()` method

**Client:**
- `webui/src/components/workflow/interactions/schema-interaction/SelectableItem.tsx` - Hardcoded addon rendering (lines 84-120, 139-181)
- `webui/src/components/workflow/interactions/schema-interaction/schema-utils.ts` - `getItemAddon()` helper
- `webui/src/lib/interaction-utils.ts` - Addon display utilities

### Suggested Fix

**Option A: Schema-driven addon rendering**
- Add `addon_schema` to interaction request that describes how to render addon data
- Client uses schema to dynamically render addon fields
- Example: `{fields: [{key: "score", type: "badge"}, {key: "last_used", type: "timestamp"}]}`

**Option B: Standardize addon display format**
- Define a standard addon display format with fixed slots (e.g., `primary_badge`, `secondary_text`, `color_indicator`)
- Addons map their data to these slots on the server
- Client renders the slots without knowing about specific addon types

**Option C: Reserve consistent space**
- Always reserve space for addon data even when absent (fixes height inconsistency)
- Use CSS grid or flexbox to create consistent item heights
- Doesn't fix extensibility but improves UX

---

## 6. State Keying Strategy for Workflow Updates

**Date Identified:** 2026-01-07
**Severity:** Medium
**Status:** Open

### Problem

The workflow engine currently keys module state by `(step_id, module_index)`. This creates issues when:
1. User updates a workflow (adds/removes/reorders modules)
2. Different clients flatten the same workflow differently (execution groups)
3. Attempting to resume a workflow after structural changes

### Current State Storage

```json
{
  "_module_states": {
    "user_input": {
      "0": { "status": "completed", "outputs": {...} },
      "1": { "status": "pending" }
    }
  }
}
```

The index-based keying is fragile:
- Adding a module shifts all subsequent indices
- Removing a module orphans state for that index
- Reordering modules causes state mismatch

### Explored Options

**Option A: Module Name Keying**
```json
{
  "_module_states": {
    "user_input": {
      "select_aesthetics_form": { "status": "completed", "outputs": {...} }
    }
  }
}
```
- Problem: Module names are user-provided, error-prone
- Renames break state

**Option B: Server-Assigned Stable IDs**
```json
{
  "module_id": "user.form",
  "name": "aesthetic_form",
  "_stable_id": "m_8a7b6c5d"  // Assigned at upload
}
```
- Problem: Complex matching algorithm needed ("is this the same module?")
- Migration required for existing workflows

**Option C: Content Hash with Version Check**
```json
{
  "_module_states": { ... },
  "_workflow_hash": "sha256:abc123"
}
```
- Problem: Any workflow change invalidates entire state
- May lose progress unnecessarily

**Option D: Version-Scoped State (Current Direction)**
- State tied to specific workflow_resolution
- Workflow updates create NEW resolutions
- Existing runs frozen to their original resolution
- No cross-version state migration

### Impact

1. **Breaking existing state**: Any change to state keying affects all existing workflow runs
2. **Complexity**: Supporting multiple keying strategies increases code complexity
3. **User experience**: Users may lose progress when workflows are updated

### Files Affected

- `server/api/database_provider.py` - `get_module_outputs()`, `get_module_outputs_hierarchical()`
- `server/api/workflow_processor.py` - State storage and retrieval logic
- Event storage uses `module_name` but state reconstruction uses indices

### Current Recommendation

Continue with **Option D (Version-Scoped State)** for now:
- Each workflow run uses a frozen workflow version (resolution)
- Workflow updates create new resolutions, don't affect existing runs
- Simple to implement, no migration needed
- Trade-off: Can't "upgrade" running workflows to new versions

### Future Consideration

If cross-version state compatibility becomes necessary:
1. Implement module matching heuristics (step_id + name + module_id → stable_id)
2. Add migration path for existing workflows
3. Consider allowing partial state preservation (keep what matches, reset what doesn't)

---

## 7. WorkflowResolver Path Traversal Security Risk

**Date Identified:** 2026-01-07
**Severity:** Critical
**Status:** Open

### Problem

The `WorkflowResolver` in `server/engine/workflow_resolver.py` resolves `$ref` paths relative to the current file's directory. While the `_normalize_path()` method handles `..` segments, there is no explicit sandboxing to prevent path traversal attacks.

An attacker who can upload a malicious workflow zip could potentially craft `$ref` paths like:
```json
{"$ref": "../../../../../../etc/passwd", "type": "text"}
```

If the path normalization or virtual filesystem lookup has any edge cases, this could:
1. Access files outside the workflow directory on the server filesystem
2. Leak sensitive system files or configuration
3. Include malicious content in workflow definitions

### Current Mitigations

1. `virtual_fs` is an in-memory dict from the extracted zip - paths should only exist within the zip
2. `_normalize_path()` collapses `..` segments but doesn't enforce boundaries
3. No explicit check that resolved paths stay within workflow root

### Impact

1. **Potential data exfiltration**: Malicious workflows could read server files
2. **Trust boundary violation**: Workflow authors shouldn't access server filesystem
3. **Supply chain risk**: If workflow zips are shared, a compromised zip could attack the server

### Files Affected

- `server/engine/workflow_resolver.py` - `_resolve_ref()` method (lines 117-202)
- `server/engine/workflow_resolver.py` - `_normalize_path()` method (lines 204-229)

### Suggested Fix

1. **Add explicit path sandboxing**:
```python
def _resolve_ref(self, ref_node, base_dir):
    # ... existing code ...

    # SECURITY: Ensure resolved path doesn't escape workflow root
    normalized = self._normalize_path(full_path)
    if normalized.startswith('..') or normalized.startswith('/'):
        raise ValueError(f"Path traversal attempt detected: {ref_path}")

    # Additional check: verify path is in virtual_fs (already provides some protection)
    if normalized not in self.virtual_fs:
        raise FileNotFoundError(...)
```

2. **Add path boundary validation**:
```python
def _is_safe_path(self, path: str, root: str = "") -> bool:
    """Verify path doesn't escape the root directory."""
    # Resolve to absolute within virtual root
    # Check no components are '..'
    # Check path starts with root prefix
```

3. **Audit test coverage**: Add security-focused tests for path traversal attempts

4. **Consider allowlist**: Only allow $ref to specific file types (.json, .txt, .j2)

---

## 8. WebUI Schema Type Fragmentation

**Date Identified:** 2026-01-08
**Severity:** Medium
**Status:** Open

### Problem

The WebUI has multiple schema type definitions that are similar but not unified:

1. `SchemaProperty` in `schema-interaction/types.ts` - Used for display schemas
2. `InputPropertySchema` in `form-input.tsx` - Used for form input schemas
3. Various inline type casts throughout components

These types have overlapping but incompatible fields:
- `SchemaProperty.type` doesn't include `"integer"`
- `InputPropertySchema` duplicates many fields from `SchemaProperty`
- Schema extraction uses inconsistent patterns (`display_data.schema`, `form_schema`, etc.)

### Impact

1. **Code duplication**: Similar interfaces defined in multiple places
2. **Type incompatibility**: Can't easily share schema data between components
3. **Maintenance burden**: Changes to schema structure require updates in multiple places
4. **Confusing API**: Server sends both `form_schema` and `display_data.schema.input_schema`

### Files Affected

- `webui/src/components/workflow/interactions/schema-interaction/types.ts` - `SchemaProperty`
- `webui/src/components/workflow/interactions/form-input.tsx` - `InputPropertySchema`
- `server/modules/user/form.py` - Sends redundant `form_schema`

### Suggested Fix

1. **Unify schema types**: Create a comprehensive `SchemaProperty` that includes all JSON Schema fields:
   - Add `"integer"` to type union
   - Add `title`, `minimum`, `maximum`, `enumLabels`, etc.
   - Add `input_schema` as nested property type

2. **Standardize extraction pattern**: All components should extract schema from `display_data.schema`

3. **Remove redundancy**: Server should not send both `form_schema` and `display_data.schema.input_schema`

4. **Consider shared types**: Create `@/lib/schema-types.ts` for schema interfaces used across components

---

## 9. Keyword History Module Uses OMS-Specific Data Structure

**Date Identified:** 2026-01-10
**Severity:** Medium
**Status:** Resolved

**Resolution Date:** 2026-01-10

### Resolution

Replaced `history.keyword_history` module with new generic `io.weighted_keywords` module.

**Changes made:**
1. Created `server/modules/io/weighted_keywords.py` - Generic weighted keyword storage
   - Simple `save`/`load` modes
   - Accepts flat `weighted_keywords` array
   - Scoped by `workflow_template_id` only
   - Stage-whitelisted MongoDB pipeline for secure filtering
2. Removed `server/modules/history/keyword_history.py` and entire `history/` folder
3. Removed keyword-related methods from `server/api/database_history.py`
4. Added migration `m_9.py` to drop `keyword_history` and create `weighted_keywords` collection
5. Updated CC workflow step 2 to use `io.weighted_keywords`
6. Updated OMS workflow step 1 to use `io.weighted_keywords` with `transform.query` for flattening
7. Removed `config.keyword_history` from both workflow configs

**Architecture document:** `architecture/2026_01_10_keyword_history_refactor/r5.md`

---

### Original Problem

The `history.keyword_history` module was designed specifically for the OMS workflow's data structure. It expected:

- `aesthetics` array with `aesthetic_keywords` and nested `ideas` with `idea_keywords`
- `aesthetic` and `idea` objects for save_selected mode

### Original Impact

1. **Workflow coupling**: New workflows had to adapt their data to OMS format using awkward Jinja2 transforms
2. **Confusing API**: Workflows that don't use "aesthetic/idea" terminology had to pretend they do
3. **Limited reusability**: Module wasn't truly generic despite being in the generic `modules/history/` folder

---

## Template for New Issues

```markdown
## [NUMBER]. [TITLE]

**Date Identified:** YYYY-MM-DD
**Severity:** Critical/High/Medium/Low
**Status:** Open/In Progress/Resolved

### Problem
[Describe the issue]

### Impact
[List consequences]

### Files Affected
[List specific files and line numbers]

### Suggested Fix
[Propose solutions]
```
