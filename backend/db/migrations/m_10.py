"""
Migration 10: Add content generation tables for media workflow

This migration creates:
1. content_generation_metadata - Stores generation request metadata
   - Indexes: workflow_run_id, interaction_id, (workflow_run_id + prompt_id)
2. generated_content - Stores individual generated content items
   - Indexes: workflow_run_id, content_generation_metadata_id
"""

from pymongo.database import Database
from pymongo import ASCENDING
from . import backup_database

MIGRATION_ID = 10
DESCRIPTION = "Add content generation tables for media workflow"


def apply(db: Database) -> None:
    """Apply migration to create content generation collections."""

    # Create backup before making changes
    backup_database(db)
    print("  Database backup created")

    # Create indexes for content_generation_metadata
    db.content_generation_metadata.create_index(
        [("workflow_run_id", ASCENDING)],
        name="cgm_workflow_run_id"
    )
    print("  Created index: content_generation_metadata(workflow_run_id)")

    db.content_generation_metadata.create_index(
        [("interaction_id", ASCENDING)],
        name="cgm_interaction_id"
    )
    print("  Created index: content_generation_metadata(interaction_id)")

    db.content_generation_metadata.create_index(
        [
            ("workflow_run_id", ASCENDING),
            ("prompt_id", ASCENDING)
        ],
        name="cgm_workflow_prompt"
    )
    print("  Created index: content_generation_metadata(workflow_run_id, prompt_id)")

    # Create indexes for generated_content
    db.generated_content.create_index(
        [("workflow_run_id", ASCENDING)],
        name="gc_workflow_run_id"
    )
    print("  Created index: generated_content(workflow_run_id)")

    db.generated_content.create_index(
        [("content_generation_metadata_id", ASCENDING)],
        name="gc_metadata_id"
    )
    print("  Created index: generated_content(content_generation_metadata_id)")

    print("  Migration 10 complete: content generation tables created")
