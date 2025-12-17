# Workflow State Validation Proposal

## Problem Statement

When a workflow is modified (modules added/removed/reordered) between runs, resuming from a saved position can cause issues:

1. **Missing State Values**: New modules that populate state are skipped because execution resumes past them
2. **Silent Template Failures**: Jinja2 templates (display_format, module inputs) reference non-existent state keys and fail silently
3. **Broken Dependencies**: Modules depend on outputs from other modules that never ran

## Proposed Solution: Multi-Layer Validation

### Layer 1: Workflow Structure Fingerprinting

**Concept**: Generate a fingerprint/hash of the workflow structure and compare on resume.

```python
# In workflow_processor.py
def _generate_workflow_fingerprint(self, workflow_def: Dict) -> str:
    """
    Generate a fingerprint of workflow structure.

    Captures:
    - Module sequence (module_id + name for each module)
    - outputs_to_state mappings
    - Step boundaries

    Does NOT capture:
    - Prompt text changes
    - Display schema changes
    - Non-structural config changes
    """
    import hashlib

    structure = []
    for step in workflow_def.get('steps', []):
        step_modules = []
        for module in step.get('modules', []):
            module_sig = {
                'module_id': module.get('module_id'),
                'name': module.get('name'),
                'outputs_to_state': module.get('outputs_to_state', {})
            }
            step_modules.append(module_sig)
        structure.append({
            'step_id': step.get('step_id'),
            'modules': step_modules
        })

    return hashlib.sha256(json.dumps(structure, sort_keys=True).encode()).hexdigest()[:16]
```

**Storage**: Store fingerprint in workflow document on creation.

**On Resume**: Compare fingerprints. If different, warn user and optionally:
- Show what changed
- Offer to start fresh
- Offer to continue with validation

### Layer 2: State Dependency Graph

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
                    {'type': 'display_format', 'location': 'step_2/midjourney_display_schema.json', 'template': '{{ state.selected_core_aesthetic.art_style_prefix }}'},
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
        # Match state.KEY or state.KEY.subkey patterns
        pattern = r'\{\{[^}]*state\.([a-zA-Z_][a-zA-Z0-9_]*)'
        matches = re.findall(pattern, template)
        return list(set(matches))
```

### Layer 3: Resume Validation

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
                    # Check if a future module will produce it
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

### Layer 4: Jinja2 Template Pre-Validation

**Concept**: Before rendering any Jinja2 template, validate all referenced variables exist.

```python
# In jinja2_resolver.py or a new template_validator.py

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
        from jinja2 import Environment, meta, UndefinedError

        env = Environment()
        try:
            ast = env.parse(template)
            # Get all referenced variables
            referenced = meta.find_undeclared_variables(ast)
        except Exception as e:
            return TemplateValidationResult(
                valid=False,
                error=f"Template parse error: {e}",
                location=location
            )

        # Check each referenced variable
        missing = []
        for var in referenced:
            if var not in context:
                missing.append(var)
            elif var == 'state':
                # Deep check state references
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
        matches = re.findall(pattern, template)
        return matches

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

### Layer 5: Graceful Fallback for Display Format

**Concept**: When display_format rendering fails, show useful error instead of raw data.

```python
# In mixins.py - update _format_display_string

def _format_display_string(self, display_format: str, item: Any) -> str:
    """Render display_format with graceful error handling."""
    from jinja2 import Template, UndefinedError

    # Build context
    context = {}
    if isinstance(item, dict):
        context.update(item)
    else:
        context['value'] = item

    # Add state to context
    try:
        from tui.state_manager import get_current_state
        context['state'] = get_current_state()
    except ImportError:
        context['state'] = {}

    # Validate before rendering
    validator = TemplateValidator()
    validation = validator.validate_template(display_format, context)

    if not validation.valid:
        # Return informative error instead of failing silently
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

## Implementation Phases

### Phase 1: Immediate Safeguards (Quick Win)
1. Add graceful fallback in display_format rendering (show error instead of raw data)
2. Add logging when Jinja2 template references missing state keys

### Phase 2: Workflow Fingerprinting
1. Generate and store workflow fingerprint on creation
2. Compare on resume and warn if changed
3. Add `--ignore-workflow-changes` flag to bypass warning

### Phase 3: State Dependency Analysis
1. Build dependency analyzer
2. Run validation on resume
3. Show detailed report of missing state keys and affected templates/modules

### Phase 4: Pre-Execution Validation
1. Validate all Jinja2 templates before workflow execution
2. Option to run in "dry-run" mode to check all templates
3. Add to workflow start response: `validation_warnings: []`

## Database Changes

Add to `workflows` collection:
```javascript
{
    // ... existing fields ...
    "workflow_fingerprint": "a1b2c3d4e5f6g7h8",  // Structure hash
    "workflow_version": {
        "template_path": "/path/to/workflow.json",
        "loaded_at": ISODate("..."),
        "fingerprint": "a1b2c3d4e5f6g7h8"
    }
}
```

## API Changes

### Resume Response Enhancement

```python
class WorkflowResponse:
    # ... existing fields ...
    validation_warnings: List[str] = []
    workflow_changed: bool = False
    missing_state_keys: List[str] = []
```

### New Endpoint: Validate Workflow Resume

```
GET /workflow/{id}/validate-resume
```

Returns detailed validation report before actually resuming.

## User Experience

### On Resume with Changes Detected

```
⚠️  Workflow structure changed since last run

Changes detected:
  + Added module: store_selected_concept (step_1, position 16)
  ~ Modified outputs_to_state in: select_concept

Missing state keys:
  - selected_core_aesthetic (needed by: display_format in step_2)
  - selected_aesthetic (needed by: display_format in step_2)

Options:
  [1] Continue anyway (may cause errors)
  [2] Start fresh workflow
  [3] Show detailed diff
```

### Template Error Display (Phase 1)

Instead of showing raw JSON:
```
Prompt A (Weighted):
  [TEMPLATE ERROR: Missing state.selected_core_aesthetic]
  Tip: This state key is produced by 'store_selected_concept' module.
  The module may not have run. Consider starting a fresh workflow.
```

## Configuration

```json
// In workflow config
{
    "validation": {
        "strict_mode": false,  // Fail on any validation error
        "warn_on_structure_change": true,
        "validate_templates_on_start": true,
        "allow_missing_state_keys": false
    }
}
```

## Summary

This proposal provides:

1. **Detection**: Know when workflow structure changed
2. **Analysis**: Understand what state is missing and why
3. **Prevention**: Validate templates before they fail
4. **Graceful Handling**: Show useful errors instead of broken output
5. **User Control**: Options to continue, restart, or investigate

The phased approach allows quick wins (Phase 1) while building toward comprehensive validation.
