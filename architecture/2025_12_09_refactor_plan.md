# TUI Interaction Handler Refactoring Plan

## Goal
Refactor `interaction_handler.py` (~2,700 lines) into Strategy Pattern with Mixins for better maintainability and testability.

## Current Structure
```
interaction_handler.py
├── Colors (class)
├── LEVEL_COLORS (dict)
├── EventRenderer (class)
├── run_workflow_cli() (standalone function ~100 lines)
├── CLIInteractionHandler (class ~2,000 lines)
│   ├── 8 interaction handlers (_handle_*)
│   ├── ~15 helper methods (rendering, formatting, retryable)
│   └── ~10 utility methods (colors, prompts)
└── APIInteractionHandler (class ~40 lines)
```

## Target Structure
```
tui/
├── __init__.py                    # Exports main classes
├── colors.py                      # Colors, LEVEL_COLORS, hex conversion
├── console.py                     # Console I/O mixin (log, prompt, etc.)
├── event_renderer.py              # EventRenderer class
├── workflow_runner.py             # run_workflow_cli() standalone
├── mixins/
│   ├── __init__.py
│   ├── retryable.py              # RetryableMixin (~150 lines)
│   ├── schema_renderer.py        # SchemaRendererMixin (~300 lines)
│   └── formatting.py             # FormattingMixin (time, display_string)
├── strategies/
│   ├── __init__.py
│   ├── base.py                   # InteractionStrategy base class
│   ├── text_input.py             # TextInputStrategy
│   ├── confirm.py                # ConfirmStrategy
│   ├── select_list.py            # SelectFromListStrategy
│   ├── select_structured.py      # SelectFromStructuredStrategy
│   ├── review_grouped.py         # ReviewGroupedStrategy
│   ├── resume_choice.py          # ResumeChoiceStrategy
│   ├── retry_options.py          # RetryOptionsStrategy
│   └── file_input.py             # FileInputStrategy
├── interaction_handler.py         # CLIInteractionHandler (thin orchestrator)
└── api_handler.py                 # APIInteractionHandler
```

## Mixins Design

### 1. ConsoleMixin (console.py)
Provides basic I/O:
```python
class ConsoleMixin:
    def _log(self, message: str): ...
    def _log_warning(self, message: str): ...
    def _prompt(self, prompt: str) -> str: ...
    def _prompt_multiline(self, prompt: str) -> str: ...
    def _get_multiline_input(self) -> str: ...
```

### 2. RetryableMixin (mixins/retryable.py)
Handles retryable options display and input:
```python
class RetryableMixin:
    def _display_retryable_options(self, retryable, group_names=None) -> tuple: ...
    def _display_retryable_numbered_options(self, numbered_options, start_num) -> dict: ...
    def _handle_retryable_input(self, user_input, retryable, shortcut_map, number_map, interaction_id) -> Optional[InteractionResponse]: ...
    def _create_retryable_response(self, option_key, option_config, interaction_id, ...) -> InteractionResponse: ...
    def _collect_retryable_feedback(self, option_config, feedback_config) -> dict: ...
    def _get_retry_feedback(self) -> str: ...
```

### 3. SchemaRendererMixin (mixins/schema_renderer.py)
Handles all schema-based rendering:
```python
class SchemaRendererMixin:
    def _display_schema_data(self, data, schema, multi_select=False) -> List[dict]: ...
    def _display_schema_fields(self, item, schema, indent=0) -> None: ...
    def _display_nested_selectable(self, parent_data, parent_schema, parent_indices, start_number) -> List[dict]: ...
    def _has_nested_selectable(self, schema) -> bool: ...
    def _render_schema_based(self, data, schema, indent=0) -> List[dict]: ...
    def _find_nested_selectable(self, data, schema, parent_indices, indent) -> List[dict]: ...
    def _render_schema_item(self, item, schema, indent) -> str: ...
    def _display_review_content(self, data, schema, indent=0) -> None: ...
    def _render_display_before(self, display_before) -> None: ...
    def _render_elevenlabs_prompts(self, data) -> None: ...
```

### 4. FormattingMixin (mixins/formatting.py)
Handles color and display formatting:
```python
class FormattingMixin:
    def _hex_to_ansi_fg(self, hex_color) -> str: ...
    def _hex_to_ansi_swatch(self, hex_color) -> str: ...
    def _get_time_based_color(self, timestamp_str) -> str: ...
    def _format_time_ago(self, timestamp_str) -> str: ...
    def _format_display_string(self, display_format, item) -> str: ...
    def _get_addon_display(self, item) -> tuple: ...
```

## Strategy Base Class

```python
# strategies/base.py
from abc import ABC, abstractmethod
from contracts import InteractionRequest, InteractionResponse

class InteractionStrategy(ABC):
    """Base class for all interaction strategies."""

    def __init__(self, console: ConsoleMixin):
        self.console = console

    @abstractmethod
    def handle(self, request: InteractionRequest) -> InteractionResponse:
        """Handle the interaction and return response."""
        pass
```

## Strategy Classes

### Simple Strategies (no mixins needed)
- `TextInputStrategy` - ~50 lines
- `ConfirmStrategy` - ~50 lines
- `ResumeChoiceStrategy` - ~40 lines
- `FileInputStrategy` - ~55 lines

### Complex Strategies (with mixins)
- `SelectFromListStrategy(RetryableMixin, FormattingMixin)` - ~120 lines
- `SelectFromStructuredStrategy(RetryableMixin, SchemaRendererMixin, FormattingMixin)` - ~80 lines (delegates to schema)
- `ReviewGroupedStrategy(RetryableMixin, SchemaRendererMixin)` - ~150 lines
- `RetryOptionsStrategy` - ~80 lines

## New CLIInteractionHandler

```python
# interaction_handler.py
from .console import ConsoleMixin
from .strategies import (
    TextInputStrategy, ConfirmStrategy, SelectFromListStrategy,
    SelectFromStructuredStrategy, ReviewGroupedStrategy,
    ResumeChoiceStrategy, RetryOptionsStrategy, FileInputStrategy
)
from contracts import InteractionType, InteractionHandler

class CLIInteractionHandler(ConsoleMixin, InteractionHandler):
    """Routes interactions to appropriate strategy."""

    def __init__(self, context=None):
        self.context = context
        self._init_strategies()

    def _init_strategies(self):
        self.strategies = {
            InteractionType.TEXT_INPUT: TextInputStrategy(self),
            InteractionType.CONFIRM: ConfirmStrategy(self),
            InteractionType.SELECT_FROM_LIST: SelectFromListStrategy(self),
            InteractionType.SELECT_FROM_STRUCTURED: SelectFromStructuredStrategy(self),
            InteractionType.REVIEW_GROUPED: ReviewGroupedStrategy(self),
            InteractionType.RESUME_CHOICE: ResumeChoiceStrategy(self),
            InteractionType.RETRY_OPTIONS: RetryOptionsStrategy(self),
            InteractionType.FILE_INPUT: FileInputStrategy(self),
        }

    def handle(self, request: InteractionRequest) -> InteractionResponse:
        strategy = self.strategies.get(request.interaction_type)
        if strategy:
            return strategy.handle(request)
        return InteractionResponse(interaction_id=request.interaction_id, cancelled=True)
```

## Implementation Order

### Phase 1: Extract Utilities (no behavior change)
1. Create `tui/colors.py` - move Colors class, LEVEL_COLORS, hex functions
2. Create `tui/event_renderer.py` - move EventRenderer class
3. Create `tui/workflow_runner.py` - move run_workflow_cli()
4. Create `tui/api_handler.py` - move APIInteractionHandler
5. Update imports in `interaction_handler.py`

### Phase 2: Create Mixins
1. Create `tui/console.py` - extract ConsoleMixin
2. Create `tui/mixins/formatting.py` - extract FormattingMixin
3. Create `tui/mixins/retryable.py` - extract RetryableMixin
4. Create `tui/mixins/schema_renderer.py` - extract SchemaRendererMixin

### Phase 3: Create Strategies (one at a time)
1. Create `tui/strategies/base.py`
2. Create simple strategies first:
   - `text_input.py`
   - `confirm.py`
   - `resume_choice.py`
   - `file_input.py`
3. Create complex strategies:
   - `select_list.py`
   - `select_structured.py`
   - `review_grouped.py`
   - `retry_options.py`

### Phase 4: Wire Up
1. Update `CLIInteractionHandler` to use strategies
2. Update `tui/__init__.py` exports
3. Test each interaction type
4. Remove old methods from `CLIInteractionHandler`

## Testing Strategy
- Each strategy can be unit tested in isolation
- Mixins can be tested with mock console
- Integration test: full workflow through CLIInteractionHandler

## Estimated Line Counts After Refactor
- `colors.py`: ~50 lines
- `console.py`: ~80 lines
- `event_renderer.py`: ~150 lines
- `workflow_runner.py`: ~120 lines
- `api_handler.py`: ~50 lines
- `mixins/formatting.py`: ~100 lines
- `mixins/retryable.py`: ~200 lines
- `mixins/schema_renderer.py`: ~350 lines
- `strategies/*.py`: ~50-150 lines each (8 files)
- `interaction_handler.py`: ~50 lines (orchestrator only)

**Total**: Similar line count, but organized by feature with clear boundaries.
