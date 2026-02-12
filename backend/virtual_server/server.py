#!/usr/bin/env python
"""
Virtual Workflow API Server - HTTP REST API for virtual workflow execution.

Starts a FastAPI server that provides REST endpoints for virtual workflow
execution using mongomock. This server runs separately from the main server
to provide resource isolation and independent deployment.

Usage:
    python -m backend.virtual-server.server --host HOST --port PORT --mongo URI --db DATABASE [options]

Arguments:
    --host          Server host (required, e.g., 0.0.0.0 or 127.0.0.1)
    --port          Server port (required, e.g., 9001)
    --mongo         MongoDB connection URI for auth (required)
    --db            MongoDB database name for auth (required)
    -v, --verbose   Enable verbose logging

Note: The --mongo and --db arguments are used for user authentication only.
      Virtual workflow execution uses mongomock (in-memory) databases.

Endpoints:
    POST /workflow/start          - Start virtual module execution
    POST /workflow/respond        - Respond to virtual interaction
    POST /workflow/resume/confirm - Resume with updated workflow
    POST /workflow/state          - Get workflow state
    POST /workflow/sub-action     - Execute sub-action (SSE)
    GET  /health                  - Health check
"""

import argparse
import logging
import os
import re


def sanitize_base64(message: str, max_base64_len: int = 50) -> str:
    """Truncate base64 strings in messages to prevent huge outputs."""
    pattern = r'(data:[^;]+;base64,)?([A-Za-z0-9+/=]{100,})'

    def truncate(match):
        prefix = match.group(1) or ''
        data = match.group(2)
        if len(data) > max_base64_len:
            return f"{prefix}[base64 data, {len(data)} chars truncated]"
        return match.group(0)

    return re.sub(pattern, truncate, message)


class Base64SanitizingFilter(logging.Filter):
    """Logging filter that truncates base64 strings in all log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        if record.msg:
            record.msg = sanitize_base64(str(record.msg))
        if record.args:
            record.args = tuple(
                sanitize_base64(str(arg)) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True


script_dir = os.path.dirname(os.path.abspath(__file__))


def validate_host(value: str) -> str:
    """Validate host format."""
    ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
    hostname_pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$'

    if re.match(ip_pattern, value) or re.match(hostname_pattern, value) or value == "0.0.0.0":
        return value
    raise argparse.ArgumentTypeError(
        f"Invalid host format: '{value}'. "
        f"Expected: IP address (e.g., 0.0.0.0, 127.0.0.1) or hostname (e.g., localhost)"
    )


def validate_port(value: str) -> int:
    """Validate port number."""
    try:
        port = int(value)
        if 1 <= port <= 65535:
            return port
        raise ValueError()
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Invalid port: '{value}'. Expected: integer between 1 and 65535 (e.g., 9001)"
        )


def validate_mongo_uri(value: str) -> str:
    """Validate MongoDB URI format."""
    if value.startswith("mongodb://") or value.startswith("mongodb+srv://"):
        return value
    raise argparse.ArgumentTypeError(
        f"Invalid MongoDB URI format: '{value}'. "
        f"Expected: mongodb://host:port or mongodb+srv://... (e.g., mongodb://localhost:27017)"
    )


def validate_db_name(value: str) -> str:
    """Validate database name format."""
    if re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', value) and len(value) <= 64:
        return value
    raise argparse.ArgumentTypeError(
        f"Invalid database name: '{value}'. "
        f"Expected: alphanumeric with underscores, starting with letter/underscore"
    )


def main():
    parser = argparse.ArgumentParser(
        description="Start Virtual Workflow API Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python -m backend.virtual-server.server --host 0.0.0.0 --port 9001 --mongo mongodb://localhost:27017 --db workflow_db
    python -m backend.virtual-server.server --host 127.0.0.1 --port 9001 --mongo mongodb://localhost:27017 --db workflow_db -v
        """
    )

    parser.add_argument(
        "--host",
        required=True,
        type=validate_host,
        help="Server host (e.g., 0.0.0.0 or 127.0.0.1)"
    )
    parser.add_argument(
        "--port",
        required=True,
        type=validate_port,
        help="Server port (e.g., 9001)"
    )
    parser.add_argument(
        "--mongo",
        required=True,
        type=validate_mongo_uri,
        help="MongoDB connection URI for auth (e.g., mongodb://localhost:27017)"
    )
    parser.add_argument(
        "--db",
        required=True,
        type=validate_db_name,
        help="MongoDB database name for auth (e.g., workflow_db)"
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging (DEBUG level)"
    )

    args = parser.parse_args()

    # Configure logging
    from logging.handlers import RotatingFileHandler

    log_dir = os.environ.get('LOG_DIR', os.path.join(script_dir, 'logs'))
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, 'virtual-server.log')

    console_level = logging.DEBUG if args.verbose else logging.WARNING

    # File handler - always INFO level
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=5*1024*1024,  # 5MB
        backupCount=3,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    file_handler.addFilter(Base64SanitizingFilter())

    # Configure root logger
    logging.basicConfig(level=console_level)
    logging.getLogger().addFilter(Base64SanitizingFilter())

    # Add file handler to virtual logger
    virtual_logger = logging.getLogger('workflow.virtual')
    virtual_logger.setLevel(logging.INFO)
    virtual_logger.addHandler(file_handler)

    # Suppress chatty third-party loggers
    logging.getLogger('sse_starlette').setLevel(logging.WARNING)
    logging.getLogger('sse_starlette.sse').setLevel(logging.WARNING)
    logging.getLogger('pymongo').setLevel(logging.WARNING)

    print(f"Logs written to: {log_file}")

    # Set environment variables for the API
    os.environ["MONGODB_URI"] = args.mongo
    os.environ["MONGODB_DATABASE"] = args.db

    # Import uvicorn
    import uvicorn

    print("=" * 60)
    print("Virtual Workflow API Server")
    print("=" * 60)
    print(f"  Host: {args.host}")
    print(f"  Port: {args.port}")
    print(f"  Auth MongoDB: {args.mongo}")
    print(f"  Auth Database: {args.db}")
    print()
    print("Note: Virtual execution uses mongomock (in-memory)")
    print()
    print("Endpoints:")
    print(f"  POST http://{args.host}:{args.port}/workflow/start")
    print(f"  POST http://{args.host}:{args.port}/workflow/respond")
    print(f"  POST http://{args.host}:{args.port}/workflow/resume/confirm")
    print(f"  POST http://{args.host}:{args.port}/workflow/state")
    print(f"  POST http://{args.host}:{args.port}/workflow/sub-action")
    print(f"  GET  http://{args.host}:{args.port}/health")
    print()
    print("Press Ctrl+C to stop")
    print("=" * 60)
    print()

    # Import and run the FastAPI app
    from .api.app import app

    log_level = "debug" if args.verbose else "info"
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level=log_level,
        timeout_keep_alive=300
    )


if __name__ == "__main__":
    main()
