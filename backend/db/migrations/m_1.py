"""
Migration 1: Baseline Schema

This migration creates the complete database schema:
1. Creates all collections (if not exist)
2. Creates all indexes (uses ensure_index - handles conflicts)

Collections:
- users: User accounts
- access_keys: API keys for users
- refresh_tokens: Web session tokens
- workflow_runs: Workflow execution instances
- workflow_templates: Workflow type definitions (scoped by user)
- workflow_versions: Content-hashed workflow definitions
- workflow_files: Stored files from workflow execution
- branches: Branch metadata for retry/jump
- events: Immutable event log
- tokens: Token usage per API call
- option_usage: Option selection history
- keyword_history: Keyword usage tracking
- config: Application configuration
"""

import logging
from pymongo import ASCENDING, DESCENDING
from pymongo.database import Database

from . import ensure_index

MIGRATION_ID = 1
DESCRIPTION = "Create baseline schema (collections and indexes)"

logger = logging.getLogger("workflow.db.migrations")

# All collections that should exist in the schema
COLLECTIONS = [
    "users",
    "access_keys",
    "refresh_tokens",
    "workflow_runs",
    "workflow_templates",
    "workflow_versions",
    "workflow_files",
    "branches",
    "events",
    "tokens",
    "option_usage",
    "keyword_history",
    "config",
]


def apply(db: Database) -> None:
    """
    Create all collections and indexes.
    """
    # =========================================================================
    # Step 1: Create collections (if not exist)
    # =========================================================================
    existing_collections = set(db.list_collection_names())

    for coll_name in COLLECTIONS:
        if coll_name not in existing_collections:
            logger.info(f"Creating collection: {coll_name}")
            db.create_collection(coll_name)
        else:
            logger.debug(f"Collection already exists: {coll_name}")

    # =========================================================================
    # Step 2: Create indexes
    # =========================================================================

    # Users collection
    ensure_index(db.users, "user_id", unique=True)
    ensure_index(db.users, "username", unique=True)
    ensure_index(db.users, "email", unique=True, sparse=True)

    # Access keys collection
    ensure_index(db.access_keys, "access_key_id", unique=True)
    ensure_index(db.access_keys, "access_key", unique=True)
    ensure_index(db.access_keys, "user_id")
    ensure_index(db.access_keys, [
        ("user_id", ASCENDING),
        ("is_active", ASCENDING)
    ])

    # Refresh tokens collection
    ensure_index(db.refresh_tokens, "token_id", unique=True)
    ensure_index(db.refresh_tokens, "user_id")
    ensure_index(db.refresh_tokens, "token_hash")
    ensure_index(db.refresh_tokens, "expires_at", expireAfterSeconds=0)

    # Workflow runs collection
    ensure_index(db.workflow_runs, "workflow_run_id", unique=True)
    ensure_index(db.workflow_runs, "workflow_template_id")
    ensure_index(db.workflow_runs, "current_version_id")
    ensure_index(db.workflow_runs, "user_id")

    # Branches collection
    ensure_index(db.branches, "branch_id", unique=True)
    ensure_index(db.branches, [
        ("workflow_run_id", ASCENDING),
        ("branch_id", ASCENDING)
    ])
    ensure_index(db.branches, "parent_branch_id")

    # Events collection
    ensure_index(db.events, [
        ("workflow_run_id", ASCENDING),
        ("branch_id", ASCENDING),
        ("event_id", ASCENDING)
    ])
    ensure_index(db.events, [
        ("workflow_run_id", ASCENDING),
        ("event_type", ASCENDING)
    ])
    ensure_index(db.events, [
        ("workflow_run_id", ASCENDING),
        ("module_name", ASCENDING),
        ("event_id", DESCENDING)
    ])
    ensure_index(db.events, [
        ("workflow_run_id", ASCENDING),
        ("timestamp", ASCENDING)
    ])
    ensure_index(db.events, "workflow_version_id")

    # Tokens collection
    ensure_index(db.tokens, [
        ("workflow_run_id", ASCENDING),
        ("timestamp", ASCENDING)
    ])

    # Workflow templates
    ensure_index(db.workflow_templates, "workflow_template_id", unique=True)
    ensure_index(db.workflow_templates, [
        ("user_id", ASCENDING),
        ("workflow_template_name", ASCENDING)
    ], unique=True)
    ensure_index(db.workflow_templates, "user_id")

    # Workflow versions
    ensure_index(db.workflow_versions, "workflow_version_id", unique=True)
    ensure_index(db.workflow_versions, [
        ("workflow_template_id", ASCENDING),
        ("content_hash", ASCENDING)
    ], unique=True)
    ensure_index(db.workflow_versions, "workflow_template_id")

    # Workflow files
    ensure_index(db.workflow_files, "file_id", unique=True)
    ensure_index(db.workflow_files, "workflow_run_id")
    ensure_index(db.workflow_files, "branch_id")
    ensure_index(db.workflow_files, [
        ("workflow_run_id", ASCENDING),
        ("branch_id", ASCENDING),
        ("category", ASCENDING),
        ("group_id", ASCENDING)
    ])
    ensure_index(db.workflow_files, [
        ("workflow_run_id", ASCENDING),
        ("branch_id", ASCENDING),
        ("category", ASCENDING),
        ("filename", ASCENDING)
    ])
    ensure_index(db.workflow_files, [
        ("workflow_run_id", ASCENDING),
        ("metadata.step_id", ASCENDING)
    ])

    # Option usage
    ensure_index(db.option_usage, [
        ("workflow_template_id", ASCENDING),
        ("step_id", ASCENDING),
        ("module_name", ASCENDING),
        ("option", ASCENDING)
    ], unique=True)

    # Keyword history
    ensure_index(db.keyword_history, [
        ("workflow_template_id", ASCENDING),
        ("step_id", ASCENDING),
        ("module_name", ASCENDING),
        ("keyword", ASCENDING)
    ], unique=True)
    ensure_index(db.keyword_history, "expires")

    # Config collection
    ensure_index(db.config, [
        ("type", ASCENDING),
        ("name", ASCENDING)
    ], unique=True)

    logger.info(f"Baseline schema complete: {len(COLLECTIONS)} collections")
