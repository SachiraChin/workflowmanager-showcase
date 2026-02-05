#!/bin/bash
# Docker entrypoint for workflow manager worker
# Passes environment variables to the worker

set -e

# Export media paths if MEDIA_BASE_PATH is set
if [ -n "$MEDIA_BASE_PATH" ]; then
    export MEDIA_IMAGES_PATH="${MEDIA_BASE_PATH}/images"
    export MEDIA_VIDEOS_PATH="${MEDIA_BASE_PATH}/videos"
    export MEDIA_AUDIO_PATH="${MEDIA_BASE_PATH}/audio"
fi

# Build command
CMD=(python -m backend.worker)

# Add verbose flag if set
[ "$WORKER_VERBOSE" = "true" ] && CMD+=(-v)

# Execute
exec "${CMD[@]}"
