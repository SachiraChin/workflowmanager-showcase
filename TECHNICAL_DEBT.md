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

## [DONE] 7. WorkflowResolver Path Traversal Security Risk

**Date Identified:** 2026-01-07
**Severity:** Critical
**Status:** Resolved

**Resolution Date:** 2026-02-04

### Resolution

Added path traversal detection to `_normalize_path()` in `workflow_resolver.py`.

**Changes made:**
1. Track depth as path is traversed, recording minimum depth reached
2. Reject paths where minimum depth goes negative (attempted root escape)
3. Still allows valid `..` usage within bounds (e.g., `a/b/../c.txt` → `a/c.txt`)

**Test cases verified:**
- `../etc/passwd` - Rejected (escape from root)
- `a/../../etc/passwd` - Rejected (escape from subdir)
- `a/b/../c.txt` - Allowed (stays within bounds)
- `a/../x.txt` - Allowed (back to root level, not above)

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

## 10. Media Preview Provider/Model Identification is Path-Dependent

**Date Identified:** 2026-01-20
**Severity:** Medium
**Status:** Open

### Problem

The `MediaPromptPanel` component extracts `provider` and `model_id` (prompt_id) from the schema path by convention:
- Path: `["prompts", "leonardo", "phoenix_1_0"]`
- Provider extracted as: `path[path.length - 2]` → `"leonardo"`
- Model/prompt_id extracted as: `path[path.length - 1]` → `"phoenix_1_0"`

This relies on an implicit path structure convention that is not enforced or documented. If the schema structure changes or a different nesting is used, the extraction breaks silently.

### Impact

1. **Fragile convention**: Path structure must follow exact pattern for extraction to work
2. **Silent failures**: Wrong provider/model causes incorrect pricing API calls (isPhoenix, isSDXL flags)
3. **Not documented**: Convention exists only in code, easy to violate when creating new schemas
4. **Tight coupling**: Frontend path parsing must match backend model mapping (PROMPT_MODEL_MAP)

### Files Affected

**Frontend:**
- `webui/src/components/workflow/interactions/media-generation/MediaPromptPanel.tsx` - Path extraction logic (lines 128-132)

**Backend:**
- `server/modules/media/leonardo/provider.py` - `PROMPT_MODEL_MAP` (lines 79-84), `_calculate_credits()` uses model to determine `isPhoenix`/`isSDXL` flags

**Schemas:**
- `workflows/cc/steps/3_image_prompts/schemas/cc_image_prompts_display_schema.json`
- `workflows/oms/steps/2_prompt_generation/schemas/leonardo_display_schema.json`

### Suggested Fix Options

**Option A: UX Config Metadata**
Add explicit `_ux.provider` and `_ux.model_id` to each prompt's schema:
```json
"phoenix_1_0": {
  "_ux": {
    "provider": "leonardo",
    "model_id": "phoenix_1_0",
    "display_label": "Phoenix 1.0"
  }
}
```
Frontend reads from UX config instead of parsing path.

**Option B: Pass from Parent Context**
MediaGeneration component knows full structure. Pass provider/model_id through context rather than having MediaPromptPanel extract from path.

**Option C: Schema Property**
Add a `$meta` property at schema level defining provider/model explicitly.

**Option D: SubActionConfig Enhancement**
Include provider and model info in the sub-action configuration from workflow module config.

### Current Workaround

Continue using path-based extraction with the implicit convention. Document the required path structure in schema comments.

---

## 11. Nested _ux Inside input_schema Properties

**Date Identified:** 2026-01-21
**Severity:** Low
**Status:** Open

### Problem

The display schema for media generation uses `_ux` properties nested inside `input_schema.properties`. For example:

```json
"prompt": {
  "_ux": {
    "input_schema": {
      "properties": {
        "sampler_combo": {
          "type": "string",
          "title": "Sampler",
          "_ux": {
            "input_type": "select"
          }
        }
      }
    }
  }
}
```

This creates a nested `_ux` structure: `prompt._ux.input_schema.properties.sampler_combo._ux`. While this technically works (because `getUx()` is called on each property individually), it violates the intended design pattern where `_ux` should not be nested within another `_ux`.

### Impact

1. **Design inconsistency**: Breaks the convention that `_ux` is a top-level enhancement on schema properties
2. **Confusing structure**: Developers may not realize `_ux` inside `input_schema` is processed differently
3. **Potential bugs**: Future schema processing changes might not account for this nesting pattern

### Files Affected

- `workflows/cc/steps/3_image_prompts/schemas/cc_image_prompts_display_schema.json` - SD prompt input_schema with nested `_ux`
- `webui/src/components/workflow/interactions/media-generation/MediaPromptPanel.tsx` - Processes nested `_ux` in ParameterField

### Why It Works Currently

The code path extracts `input_schema` as a standalone schema object, then iterates its properties calling `getUx(propSchema)` on each. So the inner `_ux` is processed in isolation, not as nested within the outer `_ux`.

### Suggested Fix

Consider alternative approaches for controlled field hints:

**Option A: Schema-level property**
Put `input_type` at schema level instead of in `_ux`:
```json
"sampler_combo": {
  "type": "string",
  "title": "Sampler",
  "input_type": "select"
}
```

**Option B: Infer from context**
Fields that receive dynamic options from a controller should automatically render as selects without needing explicit hints.

**Option C: Accept the pattern**
Document this as an acceptable exception where `input_schema` is treated as an independent sub-schema that can have its own `_ux` properties.

---

## 12. Alternative Input: Custom Option on Toggle Back

**Date Identified:** 2026-01-25
**Severity:** Low
**Status:** Open

### Problem

When a user is in alternative input mode (e.g., custom width/height for resolution) and toggles back to primary mode (dropdown), if the composed value doesn't match any dropdown option, the field resets to the default option.

This loses the user's custom value unexpectedly.

### Impact

1. **Data loss**: User's custom input is discarded when switching modes
2. **Confusing UX**: User expects their custom value to persist
3. **Workaround required**: Users must remember to not toggle back, or re-enter values

### Files Affected

- `webui/src/components/workflow/interactions/schema-interaction/renderers/AlternativeInputWrapper.tsx` (to be created)
- `webui/src/components/workflow/interactions/schema-interaction/renderers/SelectInputRenderer.tsx`

### Suggested Fix

When toggling from alternative to primary mode with a non-matching value:
1. Add a virtual "Custom" option to the dropdown
2. Show the composed value as the "Custom" option's label (e.g., "Custom (640x768)")
3. Keep the custom value selected
4. Allow user to switch to a preset option if desired

Implementation approach:
- Track whether current value is "custom" (not in options list)
- Inject synthetic option at render time when custom
- Store custom value separately to preserve it

### Related

- Architecture document: `architecture/2026_01_25_alternative_input/r5.md`

---

## 13. TerminalRenderer Cleanup After InputRenderer Extraction

**Date Identified:** 2026-01-25
**Severity:** Low
**Status:** Open

### Problem

As part of the alternative input feature (architecture doc: `2026_01_25_alternative_input/r5.md`), input routing is being extracted from `TerminalRenderer` into a new `InputRenderer` component.

After this extraction, `TerminalRenderer` should be audited for:
1. Leftover input-related code that should have been moved
2. Unnecessary complexity from supporting both display and input modes
3. Dead code paths that only existed for input handling
4. Naming/structure improvements now that it's purely for display

### Impact

1. **Code cleanliness**: Extracted code may leave artifacts behind
2. **Maintenance**: Easier to maintain when fully separated
3. **Future work**: Clean TerminalRenderer makes future display enhancements easier

### Files Affected

- `webui/src/components/workflow/interactions/schema-interaction/renderers/TerminalRenderer.tsx`

### Suggested Fix

After InputRenderer is implemented:
1. Audit TerminalRenderer for any remaining input-related logic
2. Remove unused imports/dependencies
3. Simplify any conditionals that were only for input vs display branching
4. Consider renaming to `DisplayRenderer` if appropriate
5. Update comments/documentation to reflect new scope

### Related

- Architecture document: `architecture/2026_01_25_alternative_input/r5.md`
- Blocked by: InputRenderer implementation (in progress)

---

## 14. Sub-Actions Lack Proper Event Storage

**Date Identified:** 2026-01-26
**Severity:** Medium
**Status:** Open

### Problem

Sub-actions (img2vid, txt2img, img2img) execute through the task queue worker
but do not emit proper workflow events to the event store. The sub-action flow:
1. Client triggers sub-action via `POST /workflow/{id}/sub-action`
2. Task is enqueued to worker
3. Worker executes provider method and streams SSE progress
4. Results stored in `content_generation_metadata` and `generated_content` tables

However, no events are stored in the workflow event system for:
- Sub-action started
- Sub-action progress
- Sub-action completed/failed

This means:
- Sub-action history is not queryable via the event system
- Workflow replay/debugging cannot show sub-action execution
- No unified audit trail for all workflow operations

### Impact

1. **Incomplete audit trail**: Sub-action executions are not recorded as events
2. **Debugging difficulty**: Cannot replay or inspect sub-action execution history
3. **Inconsistent architecture**: Regular module execution emits events, but
   sub-actions bypass this system
4. **Analytics gap**: Cannot query sub-action patterns/failures via event store

### Files Affected

- `backend/server/api/routes/streaming.py` - `execute_sub_action()` creates
  task but no events
- `backend/server/modules/media/sub_action.py` - Yields domain events but
  doesn't store to event repo
- `backend/worker/actors/media.py` - Processes sub-action, no event storage

### Suggested Fix

1. **Add event storage in sub_action.py**:
   ```python
   async def execute_media_sub_action(...):
       # Store sub-action started event
       db.event_repo.store_event(
           workflow_run_id=workflow_run_id,
           event_type=DbEventType.SUB_ACTION_STARTED,
           data={
               "action_id": action_id,
               "interaction_id": request.interaction_id,
               "provider": request.provider,
               "action_type": request.action_type,
               "prompt_id": request.prompt_id
           }
       )

       # ... execution ...

       # Store sub-action completed event
       db.event_repo.store_event(
           workflow_run_id=workflow_run_id,
           event_type=DbEventType.SUB_ACTION_COMPLETED,
           data={
               "action_id": action_id,
               "metadata_id": metadata_id,
               "content_ids": content_ids
           }
       )
   ```

2. **Add new event types**:
   ```python
   class DbEventType(Enum):
       # ... existing ...
       SUB_ACTION_STARTED = "sub_action_started"
       SUB_ACTION_PROGRESS = "sub_action_progress"  # Optional
       SUB_ACTION_COMPLETED = "sub_action_completed"
       SUB_ACTION_FAILED = "sub_action_failed"
   ```

3. **Consider worker-side storage**: If sub-action runs in worker process,
   ensure worker has access to event storage (it already has db access)

---

## 15. Authentication Rate Limiting and Account Lockout

**Date Identified:** 2026-01-27
**Severity:** Medium
**Status:** Open

### Problem

The authentication system lacks rate limiting and account lockout mechanisms.
Currently:
- No limit on login attempts per IP or email
- No account lockout after failed attempts
- No logging of failed attempts for security monitoring

The password handling itself follows industry standards (HTTPS transport +
bcrypt hashing), but brute force attacks are not mitigated.

### Impact

1. **Brute force vulnerability**: Attackers can attempt unlimited passwords
2. **Credential stuffing**: No protection against automated attacks
3. **No security audit trail**: Failed attempts not logged for monitoring
4. **Compliance**: May not meet security requirements for some use cases

### Files Affected

- `backend/server/api/routes/auth.py` - Login endpoint needs rate limiting
- `backend/server/api/auth.py` - May need failed attempt tracking
- `backend/db/` - May need collection for tracking attempts

### Suggested Fix

1. **Rate limiting** (5-10 attempts per minute per IP):
   - Use in-memory store (Redis) or database collection
   - Return 429 Too Many Requests when exceeded
   - Consider sliding window algorithm

2. **Account lockout** (after 5-10 consecutive failures):
   - Track failed attempts per email
   - Temporary lockout (15-30 min) vs permanent until admin unlock
   - Clear counter on successful login

3. **Security logging**:
   - Log failed attempts with IP, email, timestamp, user agent
   - Enable alerting on suspicious patterns

4. **Consider middleware approach**:
   - FastAPI middleware or dependency for rate limiting
   - Reusable across other sensitive endpoints

---

## 16. Interaction Response Access: Per-Provider Hardcoded Patterns

**Date Identified:** 2026-02-03
**Severity:** Critical
**Status:** Open

### Problem

The interaction architecture lacks a generic mechanism to access current response
data before submission time. Each interaction type implements its own response
shape via a provider pattern, but this data is only accessible when the user
clicks an action button.

**Current Architecture:**

1. **Provider Registration Pattern** (`interaction-context.tsx`):
   - Child interaction components (e.g., `MediaGenerationHost`, `StructuredSelect`)
     call `updateProvider()` with a `ProviderConfig` object
   - `ProviderConfig` contains:
     - `getState(): ProviderState` - Returns `{isValid, selectedCount,
       selectedGroupIds}`
     - `getResponse(params): InteractionResponseData` - Builds the response

2. **Response Built Only at Submit Time** (`interaction-context.tsx:217-239`):
   ```typescript
   const handleAction = useCallback((action, options) => {
     if (providerRef.current) {
       const response = providerRef.current.getResponse({
         action,
         feedbackByGroup,
         globalFeedback,
       });
       onSubmit(response);
     }
   }, [...]);
   ```

3. **Each Interaction Returns Different Response Shape**:

   **MediaGenerationHost** (`MediaGenerationHost.tsx:82-85`):
   ```typescript
   getResponse: () => ({
     selected_content_id: selectedContentIdRef.current ?? undefined,
     generations: generationsRef.current,
   })
   ```

   **StructuredSelect** (would return):
   ```typescript
   getResponse: () => ({
     selected_indices: [...],
     selected_data: {...},
   })
   ```

   **FormInput** (would return):
   ```typescript
   getResponse: () => ({
     fields: {...},
   })
   ```

### Why This Matters for Validation

The server-side validation system we're implementing needs to validate response
data BEFORE submission. Validation rules in step.json specify field names:

```json
{
  "validations": [
    {
      "rule": "response_field_required",
      "field": "selected_content_id",
      "severity": "error"
    },
    {
      "rule": "response_field_not_empty", 
      "field": "generations",
      "severity": "warning"
    }
  ]
}
```

The validation system must:
1. Access the current response state (whatever shape it has)
2. Check the configured fields against that data
3. Enable/disable buttons based on errors
4. Show confirmation popup for warnings

**The Problem:** There is no generic way to access the current response data
outside of the `handleAction` callback. The `ProviderState` only exposes:
- `isValid: boolean`
- `selectedCount: number`
- `selectedGroupIds: string[]`

This is insufficient for field-based validation rules that need to check
arbitrary fields like `selected_content_id`, `generations`, `fields`, etc.

### Current Workaround

The current `InteractionHost.tsx` implementation (lines 336-357) attempts to
derive response state inline:

```typescript
const getCurrentResponse = React.useCallback((): Record<string, unknown> => {
  return {
    selected_content_id: providerState.selectedCount > 0 
      ? "has_selection" : undefined,
    selected_indices: providerState.selectedGroupIds,
    generations: request.display_data?.data ? 
      // ... complex extraction logic specific to media generation
  };
}, [providerState, request.display_data]);
```

This is problematic because:
1. It hardcodes knowledge of specific response fields (`selected_content_id`,
   `generations`)
2. It derives response shape from `providerState` + `display_data` rather than
   getting the actual response
3. Different interaction types would need different derivation logic
4. The derivation may not match what `getResponse()` actually returns

### Impact

1. **Validation coupling**: Validation logic must know about each interaction
   type's response shape
2. **No single source of truth**: Response data exists in provider refs but
   isn't accessible generically
3. **Fragile workarounds**: Inline derivation logic can get out of sync with
   actual `getResponse()` implementations
4. **Blocks generic validation**: Cannot implement truly generic field-based
   validation without response access

### Files Affected

**Core Architecture:**
- `ui/webui/src/state/interaction-context.tsx` - `InteractionProvider`,
  `ProviderConfig`, `ProviderState` interfaces
- `ui/webui/src/interactions/InteractionHost.tsx` - Footer validation logic

**Per-Interaction Providers:**
- `ui/webui/src/interactions/types/media-generation/MediaGenerationHost.tsx`
- `ui/webui/src/interactions/types/structured-select/index.tsx` (or similar)
- `ui/webui/src/interactions/types/form-input/index.tsx` (or similar)

### Suggested Fix

**Option A: Extend ProviderConfig with getCurrentResponse()**

Add a method to get current response without submitting:

```typescript
interface ProviderConfig {
  getState: () => ProviderState;
  getResponse: (params: ResponseParams) => InteractionResponseData;
  getCurrentResponse?: () => InteractionResponseData;  // New
}
```

Each interaction provider implements `getCurrentResponse()` to return the
current response snapshot. `InteractionProvider` exposes this via context
for validation to consume.

**Option B: Store response state reactively**

Instead of building response on-demand in `getResponse()`, providers store
response state that updates reactively:

```typescript
interface ProviderConfig {
  getState: () => ProviderState;
  getResponse: (params: ResponseParams) => InteractionResponseData;
  responseState: InteractionResponseData;  // Live response data
}
```

The `updateProvider()` call would include current response state, making it
available for validation without calling `getResponse()`.

**Option C: Validation-specific state interface**

Define a validation-friendly state interface that providers populate:

```typescript
interface ValidationState {
  fields: Record<string, unknown>;  // Field values for validation
}

interface ProviderConfig {
  getState: () => ProviderState;
  getResponse: (params: ResponseParams) => InteractionResponseData;
  getValidationState?: () => ValidationState;  // For validation only
}
```

This separates validation concerns from submission concerns.

### Related

- Architecture document: `architecture/2026_02_03_server_side_validation/r3.md`
- Current validation implementation uses inline workaround in
  `InteractionHost.tsx:336-357`

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
