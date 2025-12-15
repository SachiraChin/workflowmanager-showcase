# Project: Modular Workflow Engine (mod_vnext)

A modular workflow execution engine for orchestrating AI-powered content generation pipelines. Uses FastAPI REST API with SSE streaming, MongoDB event sourcing, and pluggable LLM providers.

## Critical Claude Tooling Instructions

**IMPORTANT: These instructions address known tool behavior issues that MUST be followed to avoid failures.**

### File Editing - Read and Edit in Same Message

When editing files, the Read and Edit tools MUST be called together in the same message block. Calling them in separate messages causes state loss and results in:
- Edit failing with "File has been unexpectedly modified"
- Write failing with "File has not been read yet"

**CORRECT - Both tools in same message:**
```
Message 1:
  [Read file_path="/path/to/file"]
  [Edit file_path="/path/to/file" old_string="..." new_string="..."]
```

**INCORRECT - Tools in separate messages:**
```
Message 1:
  [Read file_path="/path/to/file"]

Message 2:
  [Edit file_path="/path/to/file" ...]  <- WILL FAIL
```

This applies to both Edit and Write tools. Always read and modify files in a single response.

## Critical Rules For Project

- When operator (developer) ask you a question, carefully understand what operator trying to convey, if question is unclear, do not jump to conclusions, always ask followback questions.
- Unless operator specifically asked you to make code change, do not make any change to code. Operator asking question, and having clear answer does not mean you can proceed with changes in your answer. Always ask for confirmation before making changes to code.
- This codebase has lots of pieces which works together carefully, when you want to make any change to content in any folder in project struture, look through all other places for references or references getting broken. 
- When operator approves changes for one file, that does not mean your task end at editing file. Remember what I said earlier, if you made any change, there's good chance that it could impact other places.
- Always honor the current folder structure, places new files in correct place. If you are unsure of where a new file belong, ask operator what to do.
- When you are making a significant alteration to any logic, ask operator if backwards compatibility has to be maintained. Do not assume one way or another, always ask.
- When running migration script or making any change to the databases (workflow_db, workflow_prod_db), always create a backup of original database. Before running any database migration script or run inline script which contains database changes, show operator what you are going to do and ask for confirmation.
- **Commit frequently and proactively.** Do NOT wait for operator to remind you. Commit at these checkpoints:
  - After completing a bug fix (even if operator might test it next)
  - After adding a new feature or capability
  - After refactoring or restructuring files
  - After updating configuration or prompts
  - Before moving on to a different task or file
  - When you've made 3+ related file changes
  - If you're about to ask operator to test something, commit first
  When you see "[REMINDER] Uncommitted changes detected" from the Stop hook, immediately commit before continuing. Use meaningful commit messages describing what was changed and why.
- Never create modules that are specific to a single workflow. Modules must be generic, reusable, and workflow-agnostic. All workflow-specific logic should be handled through module configuration (inputs), not hardcoded in module code. If a complex scenario requires new functionality, design a generic module that can handle similar patterns across different workflows.

## Project Structure

```
architecture/               # All architectural documents for any module (contracts/tui/server/analysis) 
                            # goes here. Do not create any markdown inside module folder, create here instead.
                            # When creating new document here, always prefix creation date in yyyy_MM_dd format 
                            # to filename.

scripts/                    # All scripts which are directly not part of a given module goes here. Ex: database 
                            # migration scripts, test script written to test change you made, find and replace 
                            # scripts, folder structure change scripts, etc. Simply, if the file you create is 
                            # not a runtime requirement of any module, it goes here. When creating new script 
                            # here, always prefix creation date in yyyy_MM_dd format to filename.

contracts/                  # Shared interfaces and DTOs
├── __init__.py                 # Package exports
├── interactions.py             # InteractionType, SelectOption, InteractionRequest/Response
├── events.py                   # EventType, MessageLevel, WorkflowEvent
└── handlers.py                 # InteractionHandler interface

tui/                        # Terminal User Interface (CLI client)
├── workflow_runner.py          # CLI and HTTP workflow runners
├── handler.py                  # CLIInteractionHandler (Strategy pattern)
├── api_handler.py              # HTTP API interaction handler
├── event_renderer.py           # Event rendering for console
├── colors.py                   # Color definitions and MessageLevel colors
├── console_router.py           # Console output routing
└── strategies/                 # Interaction strategy implementations
    ├── base.py                     # Base strategy class
    ├── text_input.py               # Text input handling
    ├── confirm.py                  # Yes/No confirmation
    ├── select_list.py              # List selection
    ├── select_structured.py        # Nested/structured selection
    ├── review_grouped.py           # Grouped prompt review
    ├── file_input.py               # File path input
    ├── resume_choice.py            # Resume workflow choice
    ├── retry_options.py            # Retry/jump options
    └── mixins.py                   # Shared functionality (InputMixin, ColorMixin, etc.)

status/                     # Status Server (multi-project monitoring)
├── status_server_textual.py    # Textual TUI status dashboard
├── status_protocol.py          # TCP socket protocol messages
├── run_status_server.py        # Status server entry point
├── check_server.py             # Server health check
└── diagnose.py                 # Diagnostic utilities

analysis/                   # Codebase Analysis Tools
├── analyzer.py                 # Class relationship analyzer (AST-based)
├── server.py                   # D3.js visualization web server
└── check_tui_deps.py           # TUI dependency checker

server/                     # Main server code (renamed from modular/)
├── api/                    # Core API and database components
│   ├── workflow_api.py         # FastAPI REST endpoints
│   ├── workflow_processor.py   # Main workflow execution engine
│   ├── workflow_streaming.py   # SSE streaming support
│   ├── workflow_context.py     # Execution context for modules
│   ├── models.py               # Pydantic models (requests, responses, SSE events)
│   ├── database_provider.py    # MongoDB event store (main provider)
│   ├── database_history.py     # History operations mixin (keywords, options)
│   ├── database_config.py      # Config/schema operations mixin
│   └── database_migrations.py  # Migration operations mixin
├── engine/                 # Engine components
│   ├── jinja2_resolver.py      # Jinja2 template resolution for parameters
│   ├── module_interface.py     # Base ExecutableModule interface
│   ├── module_registry.py      # Module discovery and registration
│   ├── state_manager.py        # Workflow state management
│   ├── context_utils.py        # Context helper functions
│   └── interaction_handler.py  # User interaction handling
├── modules/                # Executable modules
│   ├── api/                    # LLM API modules
│   │   ├── llm_call.py             # api.llm - unified LLM interface
│   │   ├── base.py                 # LLMProviderBase, Message classes
│   │   ├── registry.py             # Provider registration (@register decorator)
│   │   ├── call_logger.py          # API call logging
│   │   └── providers/              # Provider implementations
│   │       ├── openai/provider.py      # OpenAI (GPT-4, GPT-5, O1, O3)
│   │       └── anthropic/provider.py   # Anthropic (Claude)
│   ├── db/                     # Database modules
│   │   └── query.py                # db.query - secure MongoDB queries
│   ├── history/                # History tracking
│   │   └── keyword_history.py      # history.keyword_history
│   ├── user/                   # User interaction modules
│   │   ├── select.py               # user.select - structured selection
│   │   ├── pause.py                # user.pause - pause execution
│   │   ├── text_input.py           # user.text_input
│   │   └── file_input.py           # user.file_input
│   ├── io/                     # File I/O modules
│   │   ├── load_json.py            # io.load_json
│   │   ├── save_json.py            # io.save_json
│   │   ├── write_text.py           # io.write_text
│   │   └── render_template.py      # io.render_template
│   ├── transform/              # Data transformation modules
│   │   ├── concat_arrays.py        # transform.concat_arrays
│   │   ├── conditional_text.py     # transform.conditional_text
│   │   └── build_dynamic_schema.py # transform.build_dynamic_schema
│   ├── prompt/                 # Prompt building
│   │   └── build_grouped_prompt.py # prompt.build_grouped_prompt
│   └── addons/                 # Optional addons
│       └── usage_history.py        # Usage tracking
└── tests/                  # Unit tests
    └── unit/

workflows/              # Workflow definitions
└── oms/                    # OMS Video Generation workflow
    ├── workflow_v3.json        # Main workflow (config, status_display, steps)
    └── steps/                  # Step definitions
        ├── 1_user_input/           # User preferences, aesthetic generation
        ├── 2_prompt_generation/    # Image prompt generation
        ├── 3_image_analysis/       # Analyze generated images
        ├── 4_video_prompt_generation/  # Video/motion prompts
        ├── 5_text_overlays/        # Text overlay generation
        ├── 6_titles_descriptions/  # Titles and descriptions
        ├── 7_text_colors/          # Color scheme generation
        ├── 8_music_generation/     # Music prompt generation
        └── 9_workflow_summary/     # Final summary
```

## Database (MongoDB)

**Event Sourcing Architecture:**
- All state changes stored as immutable events
- Current state derived by replaying events
- Full audit trail for debugging

**Databases:**
- `workflow_db` - Development
- `workflow_prod_db` - Production

**Collections:**
| Collection | Purpose |
|------------|---------|
| `workflows` | Workflow metadata (id, project_path, status) |
| `branches` | Branch metadata for retry/jump |
| `events` | Immutable event log |
| `tokens` | Token usage per API call |
| `workflow_templates` | Workflow template definitions |
| `workflow_versions` | Workflow version tracking |
| `keyword_history` | Keyword usage tracking |
| `option_usage` | Option/selection history |
| `table_schemas` | Schema definitions for db.query validation |
| `config` | Application configuration |

**DbEventType enum:**
- Workflow: `workflow_created`, `workflow_resumed`, `workflow_completed`, `workflow_error`
- Execution: `step_started`, `step_completed`, `module_started`, `module_completed`, `module_error`
- Interaction: `interaction_requested`, `interaction_response`
- Navigation: `retry_requested`, `jump_requested`
- Data: `output_stored`

## Contracts Package

Shared interfaces and DTOs that both server and TUI depend on. Enables clean separation - both depend on contracts, not on each other.

**Key Types:**
```python
from contracts import (
    # Interactions
    InteractionType,      # Enum: TEXT_INPUT, CONFIRM, SELECT_FROM_LIST, etc.
    SelectOption,         # Option in selection list
    InteractionRequest,   # Request for user input
    InteractionResponse,  # User's response

    # Events
    EventType,            # Enum: STEP_STARTED, MODULE_COMPLETED, etc.
    MessageLevel,         # Enum: INFO, WARNING, ERROR, SUCCESS, DEBUG
    WorkflowEvent,        # Event from workflow execution

    # Handlers
    InteractionHandler,   # Abstract interface for handling interactions
)
```

## TUI (Terminal User Interface)

CLI client for running workflows with interactive prompts.

**Architecture:**
- Uses **Strategy pattern** for interaction handling
- Each interaction type has its own strategy class
- Mixins provide shared functionality (input, colors, schema rendering)

**Running workflows:**
```python
from tui.workflow_runner import run_workflow_cli, run_workflow_http

# Direct CLI execution
run_workflow_cli(
    workflow_path="server/workflows/oms/workflow_v3.json",
    project_folder="./output",
    ai_config_path="server/ai_config.json",
    status_port=9000  # Optional: connect to status server
)

# Via HTTP API
run_workflow_http(
    server_url="http://localhost:8000",
    workflow_path="server/workflows/oms/workflow_v3.json",
    project_folder="./output"
)
```

**Interaction Strategies:**
| Strategy | Handles |
|----------|---------|
| `TextInputStrategy` | Free text input |
| `ConfirmStrategy` | Yes/No confirmation |
| `SelectFromListStrategy` | Simple list selection |
| `SelectFromStructuredStrategy` | Nested selection (aesthetics/ideas) |
| `ReviewGroupedStrategy` | Grouped prompt review with retry |
| `FileInputStrategy` | File path input with validation |
| `ResumeChoiceStrategy` | Resume existing workflow |
| `RetryOptionsStrategy` | Retry/jump options |

**Mixins:**
- `InputMixin` - Input handling utilities
- `ColorMixin` - Colored output
- `SchemaRenderMixin` - Render data from display schemas
- `RetryableMixin` - Retry/jump option handling

## Status Server

Multi-project status monitoring dashboard using Textual TUI.

**Features:**
- Polls workflow API for status updates
- Displays multiple workflows in unified dashboard
- Shows dynamic status fields from workflow config
- Tracks token usage per API call

**Running:**
```bash
python status/run_status_server.py --server-url http://localhost:8000
```

**Protocol (TCP socket, JSON newline-delimited):**
| Message | Direction | Purpose |
|---------|-----------|---------|
| `register` | Client → Server | Register new project |
| `registered` | Server → Client | Registration successful |
| `update` | Client → Server | Status update |
| `ping/pong` | Bidirectional | Keep-alive |
| `disconnect` | Client → Server | Client disconnecting |

**ProjectState fields:**
- `workflow_id`, `project_folder`, `workflow_name`
- `status`, `current_step`
- `display_fields` - Dynamic fields from workflow config
- `token_records` - Per-call token usage

## Analysis Tools

Codebase analysis and visualization utilities.

**Class Relationship Analyzer (`analyzer.py`):**
- AST-based Python class analysis
- Detects static relationships (inheritance, type hints)
- Detects dynamic patterns (factories, singletons, registries)
- Groups classes by module/package

**Visualization Server (`server.py`):**
```bash
python analysis/server.py --port 8080
# Open http://localhost:8080 for D3.js visualization
```

Features:
- Interactive force-directed graph
- Classes grouped by package with auto-resizing boxes
- Click to highlight relationships
- Real-time codebase analysis on refresh
