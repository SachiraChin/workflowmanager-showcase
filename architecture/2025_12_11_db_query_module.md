# Database Query Module Design

## Overview

The `db.query` module provides a safe, flexible way to query database collections from workflow JSON without exposing raw MongoDB query capabilities that could be abused.

## Goals

1. **Flexibility** - Workflow authors can write custom queries without code changes
2. **Security** - Block dangerous operators, enforce data isolation between workflows
3. **Configurability** - Schema definitions stored in database, editable without deployment

## Architecture

### Config Table

A single `config` collection stores all configuration:

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Category of config (e.g., `db.query`, `db.table_schema`) |
| `name` | string | Unique name within type |
| `value` | object | Configuration data |
| `updated_at` | datetime | Last modification timestamp |

**Unique constraint:** `(type, name)`

### Config Records

#### Query Schema (`type: db.query`, `name: query_schema`)

Defines global query validation rules:

```json
{
  "type": "db.query",
  "name": "query_schema",
  "value": {
    "allowed_operators": [
      "$eq", "$ne",
      "$gt", "$gte", "$lt", "$lte",
      "$in", "$nin",
      "$exists",
      "$and", "$or", "$not"
    ],
    "blocked_operators": [
      "$where",
      "$function",
      "$accumulator",
      "$expr"
    ],
    "max_limit": 1000,
    "default_limit": 100
  }
}
```

**Operator Safety:**
- `allowed_operators` - Safe data filtering operators
- `blocked_operators` - Operators that execute arbitrary code (security risk)

#### Table Schemas (`type: db.table_schema`, `name: <collection_name>`)

Defines per-collection access rules:

```json
{
  "type": "db.table_schema",
  "name": "keyword_history",
  "value": {
    "collection": "keyword_history",
    "description": "Tracks keyword usage to prevent repetition",
    "context_filters": {
      "workflow_template_id": "$context.workflow_template_id"
    },
    "queryable_fields": [
      "keyword",
      "total_weight",
      "source",
      "category",
      "last_used",
      "expires"
    ],
    "filterable_fields": [
      "step_id",
      "module_name",
      "keyword",
      "source",
      "category",
      "expires",
      "total_weight"
    ]
  }
}
```

**Field Definitions:**

| Field | Purpose |
|-------|---------|
| `collection` | Actual MongoDB collection name |
| `description` | Human-readable description |
| `context_filters` | Filters automatically injected from context (cannot be overridden) |
| `queryable_fields` | Fields that can be returned in results |
| `filterable_fields` | Fields that can be used in filter conditions |

**Data Isolation:**

Fields in `context_filters` are:
- Automatically added to every query
- NOT allowed in `filterable_fields`
- Cannot be overridden by workflow JSON

This ensures queries are always scoped to the current workflow.

## Workflow JSON Usage

### Module Definition

```json
{
  "module_id": "db.query",
  "inputs": {
    "table_schema": "keyword_history",
    "query": {
      "filter": {
        "step_id": "user_input",
        "source": { "$in": ["selected", "generated"] },
        "expires": { "$gt": "$NOW" },
        "total_weight": { "$gte": 30 }
      },
      "fields": ["keyword", "category", "total_weight"],
      "sort": { "total_weight": -1 },
      "limit": 50
    }
  },
  "outputs_to_state": {
    "results": "keyword_query_results"
  }
}
```

### Query Structure

| Field | Required | Description |
|-------|----------|-------------|
| `filter` | No | MongoDB filter conditions (validated against schema) |
| `fields` | Yes | Fields to return (validated against `queryable_fields`) |
| `sort` | No | Sort order (fields validated against `queryable_fields`) |
| `limit` | No | Max results (capped by `max_limit` from query_schema) |

### Special Variables

Variables resolved at runtime:

| Variable | Resolves To |
|----------|-------------|
| `$NOW` | Current ISO timestamp |
| `$context.workflow_template_id` | Current workflow template ID |
| `$context.workflow_id` | Current workflow instance ID |
| `$context.step_id` | Current step ID |
| `$state.<field>` | Value from workflow state |
| `$input.<field>` | Value from module inputs |

### Using Results in Prompts

Results are stored in state and can be used with Jinja2:

```jinja2
DO NOT include aesthetics containing these keywords:
{% for row in state.keyword_query_results %}
- {{ row.keyword }} ({{ row.category }}, weight: {{ row.total_weight }})
{% endfor %}
```

Or as a simple list:

```jinja2
{{ state.keyword_query_results | map(attribute='keyword') | join(', ') }}
```

## Validation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     db.query Module Execution                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load Schemas                                                  │
│    - Load query_schema (type: db.query, name: query_schema)     │
│    - Load table_schema (type: db.table_schema, name: <table>)   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Validate Operators                                            │
│    - Recursively check all operators in filter                   │
│    - Reject if operator in blocked_operators                     │
│    - Reject if operator not in allowed_operators                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Validate Filter Fields                                        │
│    - Check all fields in filter against filterable_fields        │
│    - Reject if field in context_filters (not overridable)        │
│    - Reject if field not in filterable_fields                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Validate Output Fields                                        │
│    - Check all fields in query.fields against queryable_fields   │
│    - Reject if field not in queryable_fields                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Validate Sort Fields                                          │
│    - Check all fields in query.sort against queryable_fields     │
│    - Reject if field not in queryable_fields                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Build Final Query                                             │
│    - Inject context_filters (workflow_template_id, etc.)         │
│    - Resolve variables ($NOW, $state.*, $input.*)                │
│    - Apply limit cap from query_schema.max_limit                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Execute Query                                                 │
│    - Run against MongoDB collection                              │
│    - Return results with only queryable_fields                   │
└─────────────────────────────────────────────────────────────────┘
```

## Error Messages

Clear, actionable error messages:

```
# Blocked operator
ModuleExecutionError: Operator '$where' is blocked for security reasons.
Allowed operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $and, $or, $not

# Unknown operator
ModuleExecutionError: Unknown operator '$regex' in filter.
Allowed operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $exists, $and, $or, $not

# Invalid filter field
ModuleExecutionError: Field 'workflow_template_id' cannot be used in filter.
This field is automatically injected from context.

# Invalid filter field (not in schema)
ModuleExecutionError: Field 'password' is not filterable in table 'keyword_history'.
Filterable fields: step_id, module_name, keyword, source, category, expires, total_weight

# Invalid output field
ModuleExecutionError: Field 'internal_id' is not queryable in table 'keyword_history'.
Queryable fields: keyword, total_weight, source, category, last_used, expires

# Unknown table
ModuleExecutionError: Table schema 'users' not found.
Available tables: keyword_history, option_usage
```

## Example Queries

### Basic: Get keywords by source

```json
{
  "module_id": "db.query",
  "inputs": {
    "table_schema": "keyword_history",
    "query": {
      "filter": {
        "source": "selected"
      },
      "fields": ["keyword", "category"],
      "limit": 100
    }
  }
}
```

### With expiry check

```json
{
  "module_id": "db.query",
  "inputs": {
    "table_schema": "keyword_history",
    "query": {
      "filter": {
        "source": { "$in": ["selected", "generated"] },
        "expires": { "$gt": "$NOW" }
      },
      "fields": ["keyword", "category", "total_weight"],
      "sort": { "total_weight": -1 },
      "limit": 50
    }
  }
}
```

### Complex: OR conditions with weight threshold

```json
{
  "module_id": "db.query",
  "inputs": {
    "table_schema": "keyword_history",
    "query": {
      "filter": {
        "$or": [
          { "source": "selected", "total_weight": { "$gte": 50 } },
          { "source": "generated", "total_weight": { "$gte": 80 } }
        ],
        "expires": { "$gt": "$NOW" }
      },
      "fields": ["keyword", "source", "total_weight"],
      "sort": { "total_weight": -1 },
      "limit": 30
    }
  }
}
```

### Using state variables

```json
{
  "module_id": "db.query",
  "inputs": {
    "table_schema": "keyword_history",
    "query": {
      "filter": {
        "category": { "$in": "$state.selected_categories" },
        "expires": { "$gt": "$NOW" }
      },
      "fields": ["keyword", "category"],
      "limit": "$input.max_keywords"
    },
    "max_keywords": 50,
    "selected_categories": ["setting", "object"]
  }
}
```

## Initial Table Schemas

### keyword_history

```json
{
  "type": "db.table_schema",
  "name": "keyword_history",
  "value": {
    "collection": "keyword_history",
    "description": "Tracks keyword usage to prevent repetition",
    "context_filters": {
      "workflow_template_id": "$context.workflow_template_id"
    },
    "queryable_fields": [
      "keyword",
      "total_weight",
      "source",
      "category",
      "last_used",
      "expires"
    ],
    "filterable_fields": [
      "step_id",
      "module_name",
      "keyword",
      "source",
      "category",
      "expires",
      "total_weight"
    ]
  }
}
```

### option_usage

```json
{
  "type": "db.table_schema",
  "name": "option_usage",
  "value": {
    "collection": "option_usage",
    "description": "Tracks which options users select",
    "context_filters": {
      "workflow_template_id": "$context.workflow_template_id"
    },
    "queryable_fields": [
      "option_value",
      "use_count",
      "last_used",
      "field_name"
    ],
    "filterable_fields": [
      "step_id",
      "field_name",
      "option_value",
      "use_count"
    ]
  }
}
```

## Security Summary

| Threat | Mitigation |
|--------|------------|
| Code injection via `$where` | Blocked operators list |
| Accessing other workflow's data | `context_filters` auto-injection |
| Exposing sensitive fields | `queryable_fields` whitelist |
| Arbitrary collection access | `table_schema` must exist in config |
| DoS via large queries | `max_limit` cap |
| Unknown operators | `allowed_operators` whitelist |

## Implementation Files

1. `server/api/database_provider.py` - Add config collection methods
2. `server/modules/db/query.py` - New db.query module
3. `server/scripts/seed_config.py` - Seed initial config values
