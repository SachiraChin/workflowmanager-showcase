"""
Virtual Database using real MongoDB with sandboxed databases.

Provides the same interface as Database but creates isolated databases
for each virtual execution. State can be exported to a compressed string
and imported back, allowing the client to maintain state between requests.

Key differences from the main Database:
- Creates a unique database per virtual execution (virtual_<uuid>)
- Databases are automatically cleaned up after use
- Uses a separate MongoDB instance in production for isolation

Usage:
    # Create fresh virtual database
    vdb = VirtualDatabase()
    
    # Create from previous state
    vdb = VirtualDatabase(compressed_state="H4sIAAAA...")
    
    # Use like normal Database
    vdb.event_repo.store_event(...)
    
    # Export state for client
    compressed = vdb.export_state()
    
    # Clean up when done
    vdb.cleanup()
"""

import gzip
import base64
import json
import logging
import os
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone

from pymongo import MongoClient
from bson import ObjectId

from .repos import (
    UserRepository,
    EventRepository,
    WorkflowRepository,
    BranchRepository,
    FileRepository,
    StateRepository,
    TokenRepository,
    VersionRepository,
    ContentRepository,
)
from .mixins.config import DatabaseConfigMixin
from .mixins.history import DatabaseHistoryMixin
from .mixins.recovery import DatabaseRecoveryMixin

logger = logging.getLogger(__name__)

VIRTUAL_USER_ID = "virtual_user_001"

# Get virtual MongoDB URI from environment
# In dev: defaults to same as main MongoDB
# In prod: should point to separate mongo-virtual instance
def get_virtual_mongo_uri() -> str:
    """Get MongoDB URI for virtual execution."""
    virtual_uri = os.environ.get("MONGODB_VIRTUAL_URI")
    if virtual_uri:
        return virtual_uri
    # Fallback to main MongoDB URI
    return os.environ.get("MONGODB_URI", "mongodb://localhost:27017")


# Shared client for virtual databases (connection pooling)
_virtual_client: Optional[MongoClient] = None


def get_virtual_client() -> MongoClient:
    """Get or create the shared MongoDB client for virtual execution."""
    global _virtual_client
    if _virtual_client is None:
        uri = get_virtual_mongo_uri()
        logger.info(f"Creating virtual MongoDB client: {uri}")
        _virtual_client = MongoClient(uri)
    return _virtual_client


class VirtualDatabase(DatabaseHistoryMixin, DatabaseConfigMixin, DatabaseRecoveryMixin):
    """
    Database using real MongoDB with sandboxed databases for virtual execution.
    
    Creates a unique database per instance (virtual_<uuid>) that is isolated
    from production data. The database is dropped when cleanup() is called.
    
    Inherits from the same mixins as Database for interface compatibility.
    """
    
    def __init__(self, compressed_state: Optional[str] = None):
        """
        Initialize virtual database.
        
        Args:
            compressed_state: Optional base64-encoded gzip of JSON state.
                             If provided, decompresses and imports.
        """
        self.client = get_virtual_client()
        
        # Generate unique database name
        self.db_name = f"virtual_{uuid.uuid4().hex[:12]}"
        self.db = self.client[self.db_name]
        
        logger.debug(f"Created virtual database: {self.db_name}")
        
        # Import initial state if provided
        if compressed_state:
            state = self._decompress_state(compressed_state)
            self._import_state(state)
        
        # Ensure virtual user exists
        self._ensure_virtual_user()
        
        # Initialize repositories (same as real Database)
        self.user_repo = UserRepository(self.db)
        self.event_repo = EventRepository(self.db)
        self.workflow_repo = WorkflowRepository(self.db)
        self.branch_repo = BranchRepository(self.db)
        self.file_repo = FileRepository(self.db)
        self.state_repo = StateRepository(self.db)
        self.token_repo = TokenRepository(self.db)
        self.version_repo = VersionRepository(self.db)
        self.content_repo = ContentRepository(self.db)
        
        # Direct collection access (for compatibility with Database interface)
        self.users = self.db.users
        self.access_keys = self.db.access_keys
        self.refresh_tokens = self.db.refresh_tokens
        self.invitation_codes = self.db.invitation_codes
        self.workflow_runs = self.db.workflow_runs
        self.branches = self.db.branches
        self.events = self.db.events
        self.tokens = self.db.tokens
        self.workflow_templates = self.db.workflow_templates
        self.workflow_versions = self.db.workflow_versions
        self.workflow_files = self.db.workflow_files
        self.workflow_run_version_history = self.db.workflow_run_version_history
        self.option_usage = self.db.option_usage
        self.weighted_keywords = self.db.weighted_keywords
        self.config = self.db.config
        self.content_generation_metadata = self.db.content_generation_metadata
        self.generated_content = self.db.generated_content
    
    def _ensure_virtual_user(self):
        """Ensure the virtual user exists in the database."""
        if not self.db.users.find_one({"_id": VIRTUAL_USER_ID}):
            self.db.users.insert_one({
                "_id": VIRTUAL_USER_ID,
                "user_id": VIRTUAL_USER_ID,
                "username": "virtual_user",
                "email": "virtual@example.com",
                "created_at": datetime.now(timezone.utc),
                "is_virtual": True
            })
    
    def _import_state(self, state: Dict[str, Any]):
        """Import state from JSON dict into database."""
        for collection_name, documents in state.items():
            if documents:
                # Deep copy to avoid modifying original
                docs_copy = []
                for doc in documents:
                    docs_copy.append(self._deserialize_doc(doc))
                self.db[collection_name].insert_many(docs_copy)
    
    def _deserialize_doc(self, doc: Dict) -> Dict:
        """Convert JSON document back to MongoDB format."""
        result = {}
        for key, value in doc.items():
            if isinstance(value, dict):
                result[key] = self._deserialize_doc(value)
            elif isinstance(value, list):
                result[key] = [
                    self._deserialize_doc(v) if isinstance(v, dict) else v
                    for v in value
                ]
            else:
                result[key] = value
        return result
    
    def _decompress_state(self, compressed: str) -> Dict[str, Any]:
        """Decompress base64-encoded gzip JSON state."""
        gzip_bytes = base64.b64decode(compressed)
        json_bytes = gzip.decompress(gzip_bytes)
        return json.loads(json_bytes.decode('utf-8'))
    
    def _compress_state(self, state: Dict[str, Any]) -> str:
        """Compress state to base64-encoded gzip JSON."""
        json_bytes = json.dumps(state).encode('utf-8')
        gzip_bytes = gzip.compress(json_bytes)
        return base64.b64encode(gzip_bytes).decode('ascii')
    
    def export_state(self) -> str:
        """Export all collections to compressed string."""
        result = {}
        for collection_name in self.db.list_collection_names():
            docs = list(self.db[collection_name].find())
            serialized_docs = []
            for doc in docs:
                serialized_docs.append(self._serialize_doc(doc))
            result[collection_name] = serialized_docs
        return self._compress_state(result)
    
    def _serialize_doc(self, doc: Dict) -> Dict:
        """Convert document to JSON-serializable format."""
        result = {}
        for key, value in doc.items():
            if isinstance(value, ObjectId):
                result[key] = str(value)
            elif isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = self._serialize_doc(value)
            elif isinstance(value, list):
                result[key] = [
                    self._serialize_doc(v) if isinstance(v, dict) else
                    str(v) if isinstance(v, ObjectId) else
                    v.isoformat() if isinstance(v, datetime) else v
                    for v in value
                ]
            else:
                result[key] = value
        return result
    
    def cleanup(self):
        """Drop the virtual database to free resources."""
        logger.debug(f"Dropping virtual database: {self.db_name}")
        self.client.drop_database(self.db_name)
    
    def close(self):
        """Clean up the virtual database."""
        self.cleanup()
    
    def __del__(self):
        """Ensure cleanup on garbage collection."""
        try:
            self.cleanup()
        except Exception:
            # Ignore errors during cleanup (connection may already be closed)
            pass
