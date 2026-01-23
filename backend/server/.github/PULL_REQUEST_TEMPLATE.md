# Pull Request

## Description
<!-- Describe your changes here -->

---

## 🚨 CRITICAL: Generic Design Verification 🚨

**BEFORE SUBMITTING, VERIFY ALL ITEMS BELOW:**

### Hardcoded Values Check
- [ ] ✅ **NO** hardcoded field names in `engine/` or `modules/` code
- [ ] ✅ **NO** hardcoded groups, categories, or classification names
- [ ] ✅ **NO** hardcoded data structure assumptions (e.g., expecting specific keys)
- [ ] ✅ **NO** workflow-specific logic in core code
- [ ] ✅ **ALL** workflow-specific values are in workflow JSON configuration

### Module Design Check (if adding/modifying modules)
- [ ] ✅ Module name is generic (e.g., `SelectFromStructured`, not `SelectAestheticConcept`)
- [ ] ✅ Module can work with at least 3 different theoretical workflows
- [ ] ✅ Field names/keys are configurable via module inputs
- [ ] ✅ Module docstring doesn't mention specific workflows
- [ ] ✅ Error messages use dynamic values, not hardcoded workflow terms

### Code Examples

**If you wrote code like this, STOP and refactor:**
```python
# ❌ WRONG
concepts = data['aesthetic_concepts']
groups = ['sora', 'leonardo', 'midjourney']
if field == 'aesthetic_title':
    ...
```

**Instead, write it like this:**
```python
# ✅ CORRECT
array_key = inputs['array_key']  # From workflow JSON
items = data.get(array_key, [])
groups = inputs.get('groups', {})
display_fields = inputs['display_fields']
for field in display_fields:
    value = item.get(field, '')
```

---

## Changes Made

### Files Modified
<!-- List the files you changed -->

### New Modules (if any)
<!-- Describe new modules and confirm they are generic -->

### Configuration Changes (if any)
<!-- Describe workflow JSON changes -->

---

## Testing

### Manual Testing
<!-- Describe how you tested your changes -->

### Generic Design Test
**Can your module work with these workflows?**
- [ ] ✅ Video generation workflow
- [ ] ✅ E-commerce product catalog
- [ ] ✅ Blog post generation
- [ ] ✅ Recipe creation
- [ ] ✅ Real estate listings

If you answered NO to any of these, your module is **TOO SPECIFIC** and needs refactoring.

---

## Documentation

- [ ] ✅ Read [DESIGN_PRINCIPLES.md](../DESIGN_PRINCIPLES.md)
- [ ] ✅ Updated module docstrings (if applicable)
- [ ] ✅ Updated workflow JSON examples (if applicable)
- [ ] ✅ Added comments explaining configurable design choices

---

## Reviewer Notes

**For reviewers:**
- [ ] Verify ZERO hardcoded workflow-specific values in `engine/` or `modules/`
- [ ] Confirm all workflow logic is in JSON configuration
- [ ] Check module names are generic
- [ ] Verify error messages don't mention workflow-specific terms
- [ ] Test mental exercise: "Could this work for an e-commerce workflow?"

---

## Related Issues
<!-- Link to related issues if any -->

Closes #

---

**By submitting this PR, I confirm that:**
- ✅ I have read and followed [DESIGN_PRINCIPLES.md](../DESIGN_PRINCIPLES.md)
- ✅ My code is 100% generic and reusable
- ✅ All workflow-specific logic is in JSON configuration, not Python code
- ✅ I have not hardcoded any field names, groups, or data structures
