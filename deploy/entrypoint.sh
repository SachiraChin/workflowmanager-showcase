#!/bin/bash
# Docker entrypoint for workflow manager server
# Passes environment variables as command line arguments

set -e

# Build command with required arguments
CMD=(python -m backend.server.server 
    --host 0.0.0.0 
    --port 9000 
    --mongo "${MONGODB_URI:-mongodb://mongo:27017}" 
    --db "${MONGODB_DATABASE:-workflow_db}"
)

# Add optional SSE/streaming arguments if set
[ -n "$PROGRESS_INTERVAL" ] && CMD+=(--progress-interval "$PROGRESS_INTERVAL")
[ -n "$POLL_INTERVAL" ] && CMD+=(--poll-interval "$POLL_INTERVAL")
[ -n "$CANCEL_CHECK_INTERVAL" ] && CMD+=(--cancel-check-interval "$CANCEL_CHECK_INTERVAL")

# Execute
exec "${CMD[@]}"
