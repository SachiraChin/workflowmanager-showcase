# Workflow State Validation Proposal

## Status: REVISED - Aligned with Database Redesign

This document has been updated to align with `2025_12_11_server_client_redesign.md` and `2025_12_13_database_redesign_proposal.md`. Version tracking is now handled by the workflow versioning system, not custom fingerprinting.

---

## Problem Statement

When a workflow is modified (modules added/removed/reordered) between runs, resuming from a saved position can cause issues:

1. **Missing State Values**: New modules that populate state are skipped because execution resumes past them
2. **Silent Template Failures**: Jinja2 templates (display_format, module inputs) reference non-existent state keys and fail silently
3. **Broken Dependencies**: Modules depend on outputs from other modules that never ran

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ VERSION TRACKING (from database redesign)                       │
│                                                                 │
│  workflow_versions.content_hash  →  Detects workflow changes    │
│  workflow_runs.current_version_id →  Tracks active version      │
│  events.workflow_version_id      →  Per-event version tracking  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
              VERSION_MISMATCH on resume?
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STATE VALIDATION (this proposal)                                │
│                                                                 │
│  StateDependencyAnalyzer  →  What state keys are missing?       │
│  validate_resume_state()  →  Can we safely resume?              │
│  TemplateValidator        →  Will templates render correctly?   │
│  Graceful fallback        →  Better error messages              │
└─────────────────────────────────────────────────────────────────┘
```

**Division of Responsibility:**
- **Version Tracking**: Detects IF workflow changed (handled by database redesign)
- **State Validation**: Analyzes WHAT is broken/missing (this proposal)

---

## Version Tracking (From Database Redesign)

### Content Hash Handling

The `content_hash` in `workflow_versions` identifies workflow structure:

| Submission Type | Hash Source | Stored Content |
|-----------------|-------------|----------------|
| `.zip` file | Hash of entire zip file | Resolved JSON (all $ref expanded) |
| `.json` file | Hash of JSON file | JSON as-is |

```python
# workflow_versions table
{
    "workflow_version_id": "ver_xxxxxxxxxxxx",
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "content_hash": "sha256:abc123...",      # Hash of submitted zip/json
    "source_type": "zip",                     # "zip" | "json"
    "resolved_workflow": {...},               # Full resolved JSON
    "created_at": datetime
}

# workflow_runs table (renamed from workflows)
{
    "workflow_run_id": "run_xxxxxxxxxxxx",
    "initial_version_id": "ver_xxxxxxxxxxxx",   # Version that started this run
    "current_version_id": "ver_xxxxxxxxxxxx",   # Version currently in use
    ...
}

# events table
{
    "event_id": "evt_xxxxxxxxxxxx",
    "workflow_run_id": "run_xxxxxxxxxxxx",
    "workflow_version_id": "ver_xxxxxxxxxxxx",  # Version this event executed under
    ...
}
```

### Resume with Version Mismatch

When client submits workflow for resume:

```
CLIENT: POST /workflow/{run_id}/resume
Body: { workflow: <zip/json> }
                              ↓
SERVER:
1. Compute content_hash of submitted workflow
2. Compare with workflow_run.current_version_id
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
                                     ],
                                     state_validation: {...}  // NEW
                                   }
```

---

## State Validation Layers

### Layer 1: State Dependency Graph

**Concept**: Build a graph of what state keys each module produces and consumes.

```python
class StateDependencyAnalyzer:
    """
    Analyzes workflow to build state dependency graph.
    """

    def analyze_workflow(self, workflow_def: Dict) -> Dict:
        """
        Returns:
        {
            'producers': {
                'selected_aesthetic': {'step': 'step_1', 'module': 'store_selected_concept', 'index': 15},
                'aesthetic_concepts_response': {'step': 'step_1', 'module': 'aesthetic_concepts_api', 'index': 12},
                ...
            },
            'consumers': {
                'selected_core_aesthetic': [
                    {'type': 'display_format', 'location': 'step_2/display_schema', 'template': '{{ state.selected_core_aesthetic.art_style_prefix }}'},
                    {'type': 'module_input', 'step': 'step_3', 'module': 'some_module', 'input': 'aesthetic'},
                ]
            },
            'module_order': [
                {'step': 'step_1', 'module': 'load_preferences', 'index': 0, 'produces': ['user_preferences'], 'consumes': []},
                {'step': 'step_1', 'module': 'store_selected_concept', 'index': 15, 'produces': ['selected_aesthetic', 'selected_core_aesthetic'], 'consumes': ['aesthetic_concepts_response', 'selected_concept_indices']},
                ...
            ]
        }
        """
        pass

    def extract_jinja2_state_refs(self, template: str) -> List[str]:
        """
        Extract state.* references from Jinja2 template.

        Examples:
            '{{ state.selected_core_aesthetic.art_style_prefix }}' -> ['selected_core_aesthetic']
            '{{ state.foo }} and {{ state.bar.baz }}' -> ['foo', 'bar']
        """
        import re
        pattern = r'\{\{[^}]*state\.([a-zA-Z_][a-zA-Z0-9_]*)'
        matches = re.findall(pattern, template)
        return list(set(matches))
```

### Layer 2: Resume State Validation

**Concept**: On resume, validate that required state exists for remaining modules.

```python
def validate_resume_state(
    self,
    workflow_def: Dict,
    current_position: Dict,  # {step_index, module_index}
    current_state: Dict[str, Any]
) -> ValidationResult:
    """
    Validate that current state supports resuming from current position.

    Returns:
        ValidationResult with:
        - is_valid: bool
        - missing_keys: List of state keys that should exist but don't
        - warnings: List of potential issues
        - suggestions: List of remediation options
    """
    analyzer = StateDependencyAnalyzer()
    deps = analyzer.analyze_workflow(workflow_def)

    missing_keys = []
    warnings = []

    # Find all modules that should have run by current position
    for module_info in deps['module_order']:
        if self._is_before_position(module_info, current_position):
            # This module should have run
            for key in module_info['produces']:
                if key not in current_state:
                    missing_keys.append({
                        'key': key,
                        'producer': module_info,
                        'consumers': deps['consumers'].get(key, [])
                    })

    # Check Jinja2 templates in remaining steps for missing dependencies
    for module_info in deps['module_order']:
        if not self._is_before_position(module_info, current_position):
            for consumed_key in module_info['consumes']:
                if consumed_key not in current_state and consumed_key not in [m['key'] for m in missing_keys]:
                    producer = deps['producers'].get(consumed_key)
                    if not producer or self._is_before_position(producer, module_info):
                        warnings.append(f"Module {module_info['module']} needs '{consumed_key}' which may not exist")

    return ValidationResult(
        is_valid=len(missing_keys) == 0,
        missing_keys=missing_keys,
        warnings=warnings,
        suggestions=self._generate_suggestions(missing_keys)
    )
```

### Layer 3: Jinja2 Template Pre-Validation

**Concept**: Before rendering any Jinja2 template, validate all referenced variables exist.

```python
class TemplateValidator:
    """
    Validates Jinja2 templates against available context.
    """

    def validate_template(
        self,
        template: str,
        context: Dict[str, Any],
        location: str = "unknown"
    ) -> TemplateValidationResult:
        """
        Check if template can be rendered with given context.
        Returns details about missing variables rather than failing silently.
        """
        from jinja2 import Environment, meta

        env = Environment()
        try:
            ast = env.parse(template)
            referenced = meta.find_undeclared_variables(ast)
        except Exception as e:
            return TemplateValidationResult(
                valid=False,
                error=f"Template parse error: {e}",
                location=location
            )

        missing = []
        for var in referenced:
            if var not in context:
                missing.append(var)
            elif var == 'state':
                state_refs = self._extract_deep_refs(template, 'state')
                for ref in state_refs:
                    if not self._resolve_path(context.get('state', {}), ref):
                        missing.append(f"state.{ref}")

        return TemplateValidationResult(
            valid=len(missing) == 0,
            missing_variables=missing,
            location=location
        )

    def _extract_deep_refs(self, template: str, root: str) -> List[str]:
        """Extract deep references like 'state.foo.bar.baz'"""
        import re
        pattern = rf'{root}\.([a-zA-Z_][a-zA-Z0-9_.]*)'
        return re.findall(pattern, template)

    def _resolve_path(self, obj: Any, path: str) -> bool:
        """Check if path exists in object"""
        parts = path.split('.')
        current = obj
        for part in parts:
            if isinstance(current, dict) and part in current:
                current = current[part]
            elif hasattr(current, part):
                current = getattr(current, part)
            else:
                return False
        return True
```

### Layer 4: Graceful Fallback for Display Format

**Concept**: When display_format rendering fails, show useful error instead of raw data.

```python
def _format_display_string(self, display_format: str, item: Any) -> str:
    """Render display_format with graceful error handling."""
    from jinja2 import Template, UndefinedError

    context = {}
    if isinstance(item, dict):
        context.update(item)
    else:
        context['value'] = item

    # Add state to context
    context['state'] = self._get_current_state()

    # Validate before rendering
    validator = TemplateValidator()
    validation = validator.validate_template(display_format, context)

    if not validation.valid:
        missing = ', '.join(validation.missing_variables)
        return f"[TEMPLATE ERROR: Missing {missing}] Raw: {item}"

    try:
        template = Template(display_format)
        return template.render(**context)
    except UndefinedError as e:
        return f"[RENDER ERROR: {e}] Raw: {item}"
    except Exception as e:
        return f"[ERROR: {e}] Raw: {item}"
```

---

## Implementation Phases

Each phase leaves the system in a stable, usable state.

### Phase 1: Graceful Template Fallback (Quick Win)

**Goal**: Stop silent failures, show useful errors.

**Changes**:
1. Update `_format_display_string` in mixins.py with graceful error handling
2. Add logging when Jinja2 template references missing state keys
3. Show `[TEMPLATE ERROR: Missing X]` instead of raw JSON or silent failure

**Stable State**: System works as before, but shows helpful errors instead of failing silently.

**No database changes required.**

---

### Phase 2: Workflow Version Tracking

**Goal**: Detect when workflow changed between runs.

**Changes**:
1. Add `workflow_versions` collection with `content_hash` and `resolved_workflow`
2. Add `workflow_version_id` to `workflow_runs` (initial + current)
3. Add `workflow_version_id` to events
4. On start: create version record, link to run
5. On resume: compare submitted hash with current version hash

**Stable State**: System detects version changes on resume. Existing workflows continue to work (backfill version records on first access).

**Database Changes**:
```python
# New collection: workflow_versions
{
    "workflow_version_id": "ver_xxxxxxxxxxxx",
    "workflow_template_id": "tpl_xxxxxxxxxxxx",
    "content_hash": "sha256:...",
    "source_type": "zip" | "json",
    "resolved_workflow": {...},
    "created_at": datetime
}

# Modified: workflow_runs (add fields)
{
    "initial_version_id": "ver_xxxxxxxxxxxx",
    "current_version_id": "ver_xxxxxxxxxxxx"
}

# Modified: events (add field)
{
    "workflow_version_id": "ver_xxxxxxxxxxxx"
}
```

**Migration**: Existing workflows get version record created on next access. Events without version_id are assumed to be from initial version.

---

### Phase 3: Version Mismatch Handling

**Goal**: Give user options when workflow changed.

**Changes**:
1. Detect VERSION_MISMATCH on resume
2. Return options: continue_with_new, continue_with_original, start_fresh
3. Client UI shows options to user
4. Server updates current_version_id based on choice

**Stable State**: Users can safely resume with modified workflows by choosing how to proceed.

**No additional database changes.**

---

### Phase 4: State Dependency Analysis

**Goal**: Know exactly what state is missing and why.

**Changes**:
1. Implement `StateDependencyAnalyzer`
2. Implement `validate_resume_state()`
3. Include `state_validation` in VERSION_MISMATCH response
4. Show detailed report: missing keys, affected modules/templates

**Stable State**: On version mismatch, user sees exactly what state is missing and what will break.

**No database changes.**

---

### Phase 5: Pre-Execution Template Validation

**Goal**: Catch all template errors before workflow runs.

**Changes**:
1. Implement `TemplateValidator`
2. Validate all Jinja2 templates at workflow start
3. Add "dry-run" mode to check templates without executing
4. Return `validation_warnings` in start/resume response

**Stable State**: All template issues caught upfront, not mid-execution.

**No database changes.**

---

## API Changes

### Resume Response Enhancement

```python
# VERSION_MISMATCH response
{
    "status": "version_mismatch",
    "current_version": {
        "version_id": "ver_xxx",
        "content_hash": "sha256:...",
        "created_at": "..."
    },
    "submitted_version": {
        "version_id": "ver_yyy",  # May be new
        "content_hash": "sha256:...",
        "is_new": true
    },
    "options": [
        "continue_with_new",
        "continue_with_original",
        "start_fresh"
    ],
    "state_validation": {  # Phase 4+
        "is_valid": false,
        "missing_keys": [
            {
                "key": "selected_core_aesthetic",
                "producer": {"step": "step_1", "module": "store_selected_concept"},
                "consumers": [{"type": "display_format", "step": "step_2"}]
            }
        ],
        "warnings": ["Module X needs 'Y' which may not exist"]
    }
}
```

### Confirm Resume Choice

```
POST /workflow/{run_id}/resume/confirm
Body: { "choice": "continue_with_new" }
```

---

## User Experience

### On Resume with Version Mismatch (Phase 3+)

```
⚠️  Workflow has changed since last run

Current version:  ver_abc123 (created 2024-01-01)
Submitted version: ver_def456 (new)

Options:
  [1] Continue with NEW version
      - New modules will run from current position
      - May have missing state from skipped modules
  [2] Continue with ORIGINAL version
      - Use the version from when workflow started
      - Ignores your local changes
  [3] Start FRESH
      - Create new workflow run from beginning
```

### With State Validation (Phase 4+)

```
⚠️  Workflow has changed since last run

Missing state keys (will cause errors):
  - selected_core_aesthetic
    Producer: store_selected_concept (step_1)
    Needed by: display_format in step_2, step_3
  - selected_aesthetic
    Producer: store_selected_concept (step_1)
    Needed by: module input in step_4

Recommendation: Start fresh to ensure all state is populated.

Options:
  [1] Continue anyway (errors likely)
  [2] Start fresh (recommended)
```

---

## Configuration

```json
{
    "validation": {
        "strict_mode": false,
        "warn_on_version_change": true,
        "validate_templates_on_start": true,
        "allow_missing_state_keys": false
    }
}
```

---

## Summary

| Phase | Deliverable | Stable After? |
|-------|-------------|---------------|
| 1 | Graceful template errors | Yes |
| 2 | Version tracking in DB | Yes |
| 3 | Version mismatch UI flow | Yes |
| 4 | State dependency analysis | Yes |
| 5 | Pre-execution validation | Yes |

**Key Principle**: Version tracking (Phases 2-3) handles "did it change?". State validation (Phases 4-5) handles "what's broken?".

---

## Related Documents

- `2025_12_11_server_client_redesign.md` - Full remote server architecture
- `2025_12_13_database_redesign_proposal.md` - Multi-tenant database schema
