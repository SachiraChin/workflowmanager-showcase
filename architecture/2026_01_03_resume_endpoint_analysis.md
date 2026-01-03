# Resume Endpoint Analysis and Proposal

**Date:** 2026-01-03
**Status:** Draft - Pending Approval

## Executive Summary

WebUI's History tab resume functionality is broken because there is no dedicated `/resume` endpoint. The current workaround attempts to use `/status` endpoint which has a dormant bug and was never designed for this purpose. This document analyzes the gap and proposes a solution.

---

## 1. Current State Analysis

### 1.1 TUI Flow (Working)

TUI has full access to workflow data at startup:
- Workflow templates (JSON/ZIP files)
- AI configurations
- Project folder paths

**TUI Resume Flow:**
```
1. User selects "resume" option
2. TUI calls POST /workflow/start with:
   - project_name
   - workflow_content (or workflow_template_name)
   - ai_config
   - force_new=false
3. Server's start_workflow() checks for existing workflow
4. If pending_interaction exists → returns WorkflowResponse with interaction_request
5. TUI displays the interaction immediately
```

The key insight: **TUI resubmits the full workflow content on resume**, which allows the server to:
- Verify workflow version hasn't changed
- Rebuild services with proper configuration
- Return pending interaction via `WorkflowResponse`

### 1.2 WebUI Flows

WebUI has three modes in `WorkflowStartPage`:

#### Mode 1: Upload (Working)
```
User → Upload JSON/ZIP → Enter project name → POST /workflow/start
                                                   ↓
Server → Check existing → Return WorkflowResponse with interaction_request
                                                   ↓
WebUI → Navigate to /run/{id} → Display interaction
```

#### Mode 2: Template (Working)
```
User → Select template → Enter project name → POST /workflow/start
                                                   ↓
Server → Load template → Return WorkflowResponse with interaction_request
                                                   ↓
WebUI → Navigate to /run/{id} → Display interaction
```

#### Mode 3: History/Resume (BROKEN)
```
User → Click resume on workflow run → Has only workflow_run_id
                                                   ↓
WebUI → Calls resumeWorkflow(workflow_run_id, project_name)
                                                   ↓
Current: Connects to GET /{id}/stream (SSE)
         OR
Attempted Fix: Calls GET /{id}/status (has dormant bug)
                                                   ↓
Either fails or has race conditions
```

**The Problem:** WebUI only has `workflow_run_id` and `project_name` from the history list. It does NOT have:
- `workflow_content`
- `workflow_template_name`
- `ai_config`

Therefore, WebUI **cannot** call `/start` for resume like TUI does.

### 1.3 Current Endpoints Analysis

```
+---------------------+-----------------------------+-----------------------------+----------------------------------+
| Endpoint            | Purpose                     | Returns interaction_request | WebUI Can Use?                   |
+---------------------+-----------------------------+-----------------------------+----------------------------------+
| POST /start         | Start/Resume with content   | Yes (properly)              | No - needs workflow content      |
| GET /{id}/stream    | SSE streaming               | Yes (via events)            | Problematic - EventSource issues |
| GET /{id}/status    | Sidebar status polling      | Has bug (line 861)          | No - wrong purpose, has bug      |
| GET /{id}/state     | Get workflow state object   | No                          | No                               |
+---------------------+-----------------------------+-----------------------------+----------------------------------+
```

### 1.4 The `/status` Endpoint Bug

```python
# Line 861 in workflow_api.py
interaction_request = InteractionRequest(**interaction_data)
```

#### InteractionRequest vs ApiInteractionRequest

```
+------------------------+------------------------------+----------------------------------+
| Property               | InteractionRequest           | ApiInteractionRequest            |
|                        | (contracts/interactions.py)  | (server/api/models.py)           |
+------------------------+------------------------------+----------------------------------+
| Base Type              | Python @dataclass            | Pydantic BaseModel               |
| Purpose                | Internal engine, TUI         | API serialization, JSON          |
+------------------------+------------------------------+----------------------------------+
```

**You're correct - the server has diverged from the original contracts.** Here's a complete field-by-field comparison:

```
+----------------------+----------------------------------------+----------------------------------------+-------------+
| Field                | InteractionRequest (contracts)         | ApiInteractionRequest (server)         | Status      |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| interaction_type     | InteractionType (Enum)                 | ApiInteractionType (str, Enum)         | DIFFERENT   |
| interaction_id       | str                                    | str                                    | Same        |
| title                | str = ""                               | str = ""                               | Same        |
| prompt               | str = ""                               | str = ""                               | Same        |
| description          | str = ""                               | str = ""                               | Same        |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| options              | List[SelectOption]                     | List[ApiSelectOption]                  | DIFFERENT   |
| min_selections       | int = 1                                | int = 1                                | Same        |
| max_selections       | int = 1                                | int = 1                                | Same        |
| allow_custom         | bool = False                           | bool = False                           | Same        |
| default_selection    | Optional[Union[int, List[int]]] = None | Optional[int] = None                   | UNUSED      |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| groups               | Dict[str, Any] = {}                    | Dict[str, Any] = {}                    | Same        |
| display_data         | Dict[str, Any] = {}                    | Dict[str, Any] = {}                    | Same        |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| multiline            | bool = False                           | bool = False                           | Same        |
| placeholder          | str = ""                               | str = ""                               | Same        |
| default_value        | str = ""                               | str = ""                               | Same        |
| allow_empty          | bool = False                           | bool = False                           | Same        |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| yes_label            | str = "Yes"                            | str = "Yes"                            | Same        |
| no_label             | str = "No"                             | str = "No"                             | Same        |
| default_confirm      | Optional[bool] = None                  | Optional[bool] = None                  | Same        |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| accepted_types       | List[str] = []                         | -- MISSING --                          | API MISSING |
| multiple_files       | bool = False                           | -- MISSING --                          | API MISSING |
| base_path            | str = ""                               | -- MISSING --                          | API MISSING |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| file_content         | Any = None                             | Optional[Any] = None                   | Same        |
| file_name            | str = ""                               | str = ""                               | Same        |
| file_content_type    | str = "text"                           | str = "text"                           | Same        |
| file_destination     | str = "root"                           | str = "root"                           | Same        |
+----------------------+----------------------------------------+----------------------------------------+-------------+
| context              | Dict[str, Any] = {}                    | Dict[str, Any] = {}                    | Same        |
| extra_options        | List[SelectOption] = []                | List[ApiSelectOption] = []             | DIFFERENT   |
| resolver_schema      | Optional[Dict[str, Any]] = None        | Optional[Dict[str, Any]] = None        | Same        |
+----------------------+----------------------------------------+----------------------------------------+-------------+
```

**InteractionType Enum Comparison:**

```
+------------------------+----------------------------------+----------------------------------+
| Value                  | InteractionType (contracts)      | ApiInteractionType (server)      |
+------------------------+----------------------------------+----------------------------------+
| TEXT_INPUT             | "text_input"                     | "text_input"                     |
| SELECT_FROM_STRUCTURED | "select_from_structured"         | "select_from_structured"         |
| REVIEW_GROUPED         | "review_grouped"                 | "review_grouped"                 |
| FILE_INPUT             | "file_input"                     | "file_input"                     |
| FILE_DOWNLOAD          | "file_download"                  | "file_download"                  |
| RESUME_CHOICE          | "resume_choice"                  | -- MISSING --                    |
| RETRY_OPTIONS          | "retry_options"                  | -- MISSING --                    |
+------------------------+----------------------------------+----------------------------------+
```

**SelectOption vs ApiSelectOption:**

```
+-------------+----------------------------------+----------------------------------+
| Field       | SelectOption (contracts)         | ApiSelectOption (server)         |
+-------------+----------------------------------+----------------------------------+
| id          | str                              | str                              |
| label       | str                              | str                              |
| description | str = ""                         | str = ""                         |
| metadata    | Dict[str, Any] = {}              | Dict[str, Any] = {}              |
+-------------+----------------------------------+----------------------------------+
```
(These are identical in structure)

**Summary of Differences:**

```
+---------------------------------+-----------------------------------------------------------------+-------------+
| Issue                           | Impact                                                          | Severity    |
+---------------------------------+-----------------------------------------------------------------+-------------+
| default_selection type          | NONE - field is defined but never used anywhere in codebase     | None        |
| Missing accepted_types          | FILE_INPUT cannot specify allowed file extensions via API       | Enhancement |
| Missing multiple_files          | FILE_INPUT cannot enable multi-file selection via API           | Enhancement |
| Missing base_path               | FILE_INPUT cannot specify base directory via API                | Enhancement |
| Missing RESUME_CHOICE enum      | Resume choice interactions cannot be serialized via API         | Enhancement |
| Missing RETRY_OPTIONS enum      | Retry options interactions cannot be serialized via API         | Enhancement |
+---------------------------------+-----------------------------------------------------------------+-------------+
```

**`default_selection` Field Analysis:**

The type difference (`Optional[Union[int, List[int]]]` vs `Optional[int]`) has **zero practical impact**:

```
+----------------------+-----------------------------------------------------------------------+
| Location             | Status                                                                |
+----------------------+-----------------------------------------------------------------------+
| contracts/           | Defined: Optional[Union[int, List[int]]]                              |
| server/models.py     | Defined: Optional[int]                                                |
| webui/types.ts       | Defined: number | number[] (matches contracts)                        |
| TUI strategies/      | NOT USED - no strategy reads this field                               |
| WebUI components/    | NOT USED - no component reads this field                              |
| workflows/           | NOT SET - no workflow defines default_selection                       |
| server/modules/      | NOT SET - no module sets default_selection                            |
+----------------------+-----------------------------------------------------------------------+
```

This is placeholder code for a feature (pre-selecting options in selection UI) that was never implemented.

**Conclusion:** All differences between `ApiInteractionRequest` and `InteractionRequest` are **pure enhancements** with no breaking changes. The API models can be safely synced with contracts.

**Recommendation:** This divergence is a separate issue from the resume endpoint. Consider creating a follow-up task to sync API models with contracts (either generate from contracts or import/convert).

The `/status` endpoint returns `WorkflowStatusResponse` which expects:
```python
interaction_request: Optional[ApiInteractionRequest] = None
```

But line 861 tries to use `InteractionRequest` (dataclass) which:
1. Is not imported in `workflow_api.py`
2. Even if imported, is a dataclass - won't serialize properly to JSON

#### `/status` Behavior by Workflow Status

```
+-----------------+-------------------------------------+----------------------------------+
| Status          | Code Path                           | Bug Impact                       |
+-----------------+-------------------------------------+----------------------------------+
| created         | interaction_request = None          | No issue - code skipped          |
| processing      | interaction_request = None          | No issue - code skipped          |
| awaiting_input  | Tries InteractionRequest(**data)    | CRASHES - NameError              |
| completed       | interaction_request = None          | No issue - code skipped          |
| error           | interaction_request = None          | No issue - code skipped          |
+-----------------+-------------------------------------+----------------------------------+
```

**Why dormant:** TUI only polls `/status` during `processing` to check when status changes. Once status becomes `awaiting_input`, TUI already has the interaction from the previous response - it doesn't call `/status` again.

**Should we fix it?** Yes. Even though we're adding `/resume`, the `/status` endpoint should work correctly for all status types. The fix is simple: pass the raw dict instead of instantiating a class (Pydantic auto-coerces):
```python
if interaction_data:
    interaction_request = interaction_data  # Pydantic handles conversion
```

---

## 2. The Gap

**WebUI Resume needs an endpoint that:**
1. Accepts only `workflow_run_id` (no content required)
2. Returns `WorkflowResponse` (same as `/start`)
3. Includes `interaction_request` if workflow is awaiting input
4. Rebuilds services from stored workflow data

**Current options are inadequate:**
- `/start` - Requires content WebUI doesn't have
- `/stream` - Has EventSource reliability issues
- `/status` - Wrong response model, has bug, designed for polling

---

## 3. Proposed Solution: `/resume` Endpoint

### 3.1 Endpoint Specification

```
POST /workflow/{workflow_run_id}/resume
```

**Request:**
- Path: `workflow_run_id`
- Body (optional):
  ```json
  {
    "ai_config": { ... }  // Optional override for AI configuration
  }
  ```
- Auth: User ID from access token

**Response:** `WorkflowResponse` (same as `/start`)
```json
{
  "workflow_run_id": "wf_xxx",
  "status": "awaiting_input",
  "message": "Pending interaction",
  "progress": { ... },
  "interaction_request": { ... }  // If awaiting_input
}
```

### 3.2 Request Model

```python
class ResumeWorkflowRequest(BaseModel):
    """Optional request body for resume endpoint"""
    ai_config: Optional[Dict[str, Any]] = None
```

### 3.3 Server Implementation Logic

```python
@router.post("/{workflow_run_id}/resume", response_model=WorkflowResponse)
async def resume_workflow(
    workflow_run_id: str,
    request: Optional[ResumeWorkflowRequest] = None,
    user_id: str = Depends(get_current_user_id)
):
    """
    Resume an existing workflow by ID.

    Unlike /start, this doesn't require workflow content -
    it loads the stored workflow definition from workflow_versions.

    Optionally accepts ai_config override in request body.
    """
    if not processor or not db:
        raise HTTPException(status_code=503, detail="Service not initialized")

    # 1. Get workflow from database
    workflow = db.get_workflow(workflow_run_id)
    if not workflow:
        raise HTTPException(404, "Workflow not found")

    # 2. Verify user owns this workflow
    if workflow.get("user_id") != user_id:
        raise HTTPException(403, "Access denied")

    # 3. Get stored workflow definition from workflow_versions
    template_id = workflow.get("workflow_template_id")
    version = db.get_workflow_version_by_id(template_id)
    if not version:
        raise HTTPException(500, "Workflow version not found")
    resolved_workflow = version.get("resolved_workflow")

    # 4. Get ai_config - use request override or stored config
    ai_config = (request.ai_config if request and request.ai_config
                 else workflow.get("ai_config", {}))

    # 5. Check for pending interaction
    position = db.get_workflow_position(workflow_run_id)
    if position.get('pending_interaction'):
        # Return pending interaction without re-executing
        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=WorkflowStatus.AWAITING_INPUT,
            message="Pending interaction",
            interaction_request=convert_interaction(position['pending_interaction']),
            progress=build_progress(resolved_workflow, position)
        )

    # 6. Check current status for completed/error workflows
    current_status = WorkflowStatus(workflow.get("status", "created"))
    if current_status == WorkflowStatus.COMPLETED:
        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=WorkflowStatus.COMPLETED,
            message="Workflow already completed",
            progress=build_progress(resolved_workflow, position)
        )
    if current_status == WorkflowStatus.ERROR:
        return WorkflowResponse(
            workflow_run_id=workflow_run_id,
            status=WorkflowStatus.ERROR,
            message="Workflow in error state",
            error=workflow.get("error_message"),
            progress=build_progress(resolved_workflow, position)
        )

    # 7. If processing, return status (client should connect to SSE)
    return WorkflowResponse(
        workflow_run_id=workflow_run_id,
        status=WorkflowStatus.PROCESSING,
        message="Workflow is processing",
        progress=build_progress(resolved_workflow, position)
    )
```

### 3.4 WebUI Changes

```typescript
// useWorkflowExecution.ts
const resumeWorkflow = useCallback(
  async (resumeWorkflowRunId: string, resumeProjectName: string) => {
    disconnect();
    actions.startWorkflow(resumeWorkflowRunId, resumeProjectName);
    actions.setStatus("processing");

    try {
      // Call new /resume endpoint
      const response = await fetch(`${API_URL}/workflow/${resumeWorkflowRunId}/resume`, {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      actions.setStatus(data.status);

      if (data.progress) {
        actions.setProgress(data.progress);
      }

      // If awaiting input, set interaction directly (same as /start response handling)
      if (data.status === "awaiting_input" && data.interaction_request) {
        actions.setCurrentInteraction(data.interaction_request);
        actions.addToInteractionHistory(data.interaction_request);
      } else if (data.status === "processing") {
        // Connect to SSE for ongoing processing
        connectToStream(resumeWorkflowRunId);
      } else if (data.status === "completed") {
        // Handle completed workflow
        if (data.result) {
          actions.setModuleOutputs(data.result);
        }
      } else if (data.status === "error") {
        actions.setError(data.error || "Workflow failed");
      }
    } catch (error) {
      actions.setError((error as Error).message);
    }
  },
  [actions, disconnect, connectToStream]
);
```

---

## 4. Why This Approach?

### 4.1 Consistency with `/start`

The `/resume` endpoint returns `WorkflowResponse`, the same model as `/start`. This means:
- WebUI handles both responses identically
- No special cases for resume vs start
- `interaction_request` handling is consistent

### 4.2 No EventSource Dependency for Initial State

The current SSE approach (`/stream`) has issues:
- EventSource auto-reconnect behavior
- `onerror` firing on normal connection close
- Race conditions with `abortController`

With `/resume`:
- Initial state is fetched via simple POST request
- SSE is only used for ongoing processing (if needed)
- Same pattern as TUI's `/start` + SSE approach

**SSE Streaming After Resume:**

```
+-------------------+------------------------------------------------------------------------+
| /resume Status    | WebUI Action                                                           |
+-------------------+------------------------------------------------------------------------+
| awaiting_input    | Display interaction immediately. No SSE needed - user submits          |
|                   | response via /stream/respond which starts new SSE stream               |
+-------------------+------------------------------------------------------------------------+
| processing        | Connect to SSE stream to receive progress/completion events            |
+-------------------+------------------------------------------------------------------------+
| completed         | Display completion. No SSE needed                                      |
+-------------------+------------------------------------------------------------------------+
| error             | Display error. No SSE needed                                           |
+-------------------+------------------------------------------------------------------------+
```

So yes, WebUI will start SSE streaming after resume **only if status is `processing`**. For `awaiting_input`, the interaction is returned directly in the response - no streaming required until user submits their response.

### 4.3 Server-side State Reconstruction

The `/resume` endpoint loads workflow definition from `workflow_versions` collection, which already stores `resolved_workflow`. No need for client to resubmit content.

---

## 5. Implementation Plan

### Phase 1: Server Changes

1. Add `ResumeWorkflowRequest` model to `models.py`
2. Add `POST /{workflow_run_id}/resume` endpoint to `workflow_api.py`
3. Implement logic as specified in section 3.3:
   - Load workflow from database
   - Verify user ownership
   - Load resolved_workflow from workflow_versions
   - Check pending_interaction → return it
   - Handle completed/error states
   - Return processing status for active workflows
4. Fix `/status` endpoint bug (section 1.4):
   - Change line 861 from `InteractionRequest(**interaction_data)` to just `interaction_data`

### Phase 2: WebUI Changes

1. Update `resumeWorkflow` in `useWorkflowExecution.ts` to call `/resume`
2. Handle response same way as `/start` response
3. Only connect to SSE if status is `processing`

### Phase 3: Cleanup & Revert

1. Revert the failed `resumeWorkflow` change that used `/status` endpoint
2. Remove the `disconnect()` addition in handleSSEEvent `interaction` case (no longer needed - we won't use SSE for initial state)
3. Test all three WebUI modes (Upload, Template, History)

---

## 6. Testing Checklist

- [ ] Resume workflow that is `awaiting_input` - shows interaction immediately
- [ ] Resume workflow that is `processing` - connects to SSE
- [ ] Resume workflow that is `completed` - shows completion state
- [ ] Resume workflow that is `error` - shows error state
- [ ] Resume after server restart - state preserved
- [ ] Resume by URL navigation (`/run/{id}`) - works correctly
- [ ] Retry interaction after resume - no infinite loops
- [ ] User cannot resume another user's workflow

---

## 7. Resolved Questions

1. **Should `/resume` accept optional `ai_config` override?**

   **Yes.** For consistency with `/start`, the `/resume` endpoint will accept optional `ai_config` in the request body. If not provided, uses stored `ai_config` from workflow document.

2. **Should we add a `resumeWithUpdate` variant?**

   **No, not needed.** The History page's "Resume with Update" feature already works correctly - it calls `/start` with the new `workflow_content`. This triggers version change detection and the full start flow. See `handleResumeWithUpdate` in `WorkflowStartPage.tsx` (lines 161-198).

3. **Do we need to fix the `/status` endpoint bug?**

   **Yes.** As documented in section 1.4, the bug causes crashes when status is `awaiting_input`. Even though `/resume` is the primary fix, `/status` should work correctly for all status types. Simple one-line fix.

---

## 8. Plan of Action (POA)

### Overview

Two parallel workstreams:
1. **Resume Endpoint** - Add `/resume` endpoint to fix WebUI History tab
2. **Model Sync** - Sync `ApiInteractionRequest` with `InteractionRequest` from contracts

These can be done together or separately. Model sync is optional but recommended since we're touching the same files.

### POA: Resume Endpoint

```
+------+------------------------------------------------------------------------+---------------------------+
| Step | Task                                                                   | Files                     |
+------+------------------------------------------------------------------------+---------------------------+
| 1    | Add ResumeWorkflowRequest model                                        | server/api/models.py      |
|      | - Optional ai_config field only                                        |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 2    | Add POST /{workflow_run_id}/resume endpoint                            | server/api/workflow_api.py|
|      | - Load workflow from database                                          |                           |
|      | - Verify user ownership                                                |                           |
|      | - Load resolved_workflow from workflow_versions                        |                           |
|      | - Check pending_interaction -> return it                               |                           |
|      | - Handle completed/error/processing states                             |                           |
|      | - Return WorkflowResponse (same as /start)                             |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 3    | Fix /status endpoint bug (line 861)                                    | server/api/workflow_api.py|
|      | - Change InteractionRequest(**data) to just data                       |                           |
|      | - Pydantic auto-coerces dict to ApiInteractionRequest                  |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 4    | Update resumeWorkflow function                                         | webui/src/hooks/          |
|      | - Call POST /resume instead of GET /status                             |   useWorkflowExecution.ts |
|      | - Handle response same as /start response                              |                           |
|      | - Connect to SSE only if status is "processing"                        |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 5    | Test all WebUI modes                                                   | Manual testing            |
|      | - Upload: Start new workflow with JSON/ZIP                             |                           |
|      | - Template: Start workflow from stored template                        |                           |
|      | - History: Resume existing workflow (the fix)                          |                           |
+------+------------------------------------------------------------------------+---------------------------+
```

**Q: Why not just use `InteractionRequest` from contracts and remove `ApiInteractionRequest`?**

The `/status` bug fix (Step 3) does NOT require importing `InteractionRequest`. Here's why:

```python
# The bug (line 861):
interaction_request = InteractionRequest(**interaction_data)  # NameError - not imported

# The fix - just pass the dict:
interaction_request = interaction_data  # Pydantic auto-coerces to ApiInteractionRequest
```

The `interaction_data` comes from the database as a dict. When assigned to a Pydantic model field
(`interaction_request: Optional[ApiInteractionRequest]`), Pydantic automatically converts the dict
to the model. No class instantiation needed.

### POA: Model Sync (InteractionRequest)

**Q: Can we just delete `ApiInteractionRequest` and use `InteractionRequest` from contracts?**

No, because they serve different purposes:

```
+---------------------------+-------------------------------+-------------------------------+
| Aspect                    | InteractionRequest            | ApiInteractionRequest         |
|                           | (contracts - @dataclass)      | (server - Pydantic BaseModel) |
+---------------------------+-------------------------------+-------------------------------+
| OpenAPI/Swagger Schema    | Not generated                 | Auto-generated                |
| FastAPI Response Model    | Limited support               | Full support                  |
| JSON Serialization        | Needs manual conversion       | Built-in                      |
| Field Validation          | None                          | Automatic                     |
| Used By                   | TUI, internal engine          | REST API responses            |
+---------------------------+-------------------------------+-------------------------------+
```

FastAPI response models (`WorkflowResponse`, `WorkflowStatusResponse`) require Pydantic models for:
- Automatic OpenAPI documentation generation
- Response validation before sending to client
- Proper JSON serialization with type coercion

**Alternative approaches (not recommended for this task):**
1. Convert `InteractionRequest` to Pydantic dataclass (`from pydantic.dataclasses import dataclass`)
   - Requires changing contracts package, affects TUI
2. Use `Optional[dict]` instead of `Optional[ApiInteractionRequest]`
   - Loses type safety and API documentation

**Current approach (sync models):** Keep both, ensure `ApiInteractionRequest` has all fields from `InteractionRequest`.

```
+------+------------------------------------------------------------------------+---------------------------+
| Step | Task                                                                   | Files                     |
+------+------------------------------------------------------------------------+---------------------------+
| 1    | Add missing enum values to ApiInteractionType                          | server/api/models.py      |
|      | - RESUME_CHOICE = "resume_choice"                                      |                           |
|      | - RETRY_OPTIONS = "retry_options"                                      |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 2    | Add missing fields to ApiInteractionRequest                            | server/api/models.py      |
|      | - accepted_types: List[str] = Field(default_factory=list)              |                           |
|      | - multiple_files: bool = False                                         |                           |
|      | - base_path: str = ""                                                  |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 3    | Update default_selection type (optional, field is unused)              | server/api/models.py      |
|      | - Change Optional[int] to Optional[Union[int, List[int]]]              |                           |
|      | - Matches contracts and webui/types.ts                                 |                           |
+------+------------------------------------------------------------------------+---------------------------+
| 4    | Verify WebUI types match                                               | webui/src/lib/types.ts    |
|      | - Already has: accepted_types, multiple_files, base_path (check)       |                           |
|      | - Add if missing                                                       |                           |
+------+------------------------------------------------------------------------+---------------------------+
```

### Execution Order

```
+-------+------------------------------------------+----------+--------------------------------+
| Order | Task                                     | Priority | Dependencies                   |
+-------+------------------------------------------+----------+--------------------------------+
| 1     | Fix /status endpoint bug                 | High     | None                           |
| 2     | Add ResumeWorkflowRequest model          | High     | None                           |
| 3     | Add /resume endpoint                     | High     | Step 2                         |
| 4     | Update WebUI resumeWorkflow              | High     | Step 3                         |
| 5     | Test Resume functionality                | High     | Step 4                         |
+-------+------------------------------------------+----------+--------------------------------+
| 6     | Add missing enum values                  | Low      | None (can be done in parallel) |
| 7     | Add missing fields to ApiInteractionReq  | Low      | None (can be done in parallel) |
| 8     | Update default_selection type            | Low      | None (can be done in parallel) |
| 9     | Verify/update WebUI types                | Low      | Steps 6-8                      |
+-------+------------------------------------------+----------+--------------------------------+
```

Steps 1-5 are required to fix the WebUI resume bug.
Steps 6-9 are optional enhancements to sync models with contracts.

### Rollback Plan

If issues arise after deployment:
1. WebUI can fall back to SSE-only approach (revert useWorkflowExecution.ts)
2. /resume endpoint can be disabled without breaking existing functionality
3. Model sync changes are additive - no rollback needed

---

## Approval

- [ ] Operator reviewed and approved
- [ ] Ready for implementation
- [ ] Model sync included (optional)
