#!/bin/bash
# Docker entrypoint for virtual workflow server
# Passes environment variables as command line arguments

set -e

# Build command with required arguments
CMD=(python -m backend.virtual_server.server
    --host 0.0.0.0
    --port 9001
    --mongo "${MONGODB_URI:-mongodb://mongo:27017}"
    --db "${MONGODB_DATABASE:-workflow_db}"
    --mongo-virtual "${MONGODB_VIRTUAL_URI:-mongodb://mongo-virtual:27017}"
)

# Execute
exec "${CMD[@]}"
