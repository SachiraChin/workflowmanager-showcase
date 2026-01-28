#!/usr/bin/env python
"""
Workflow API Server - HTTP REST API for workflow execution.

Starts a FastAPI server that provides REST endpoints for workflow management.
All workflow state is stored in MongoDB as events (event sourcing pattern).

Usage:
    python -m backend.server.server --host HOST --port PORT --mongo URI --db DATABASE [options]

    Or use the start script:
    ./start_server.sh [options]

Arguments:
    --host          Server host (required, e.g., 0.0.0.0 or 127.0.0.1)
    --port          Server port (required, e.g., 8000)
    --mongo         MongoDB connection URI (required, e.g., mongodb://localhost:27017)
    --db            MongoDB database name (required, e.g., workflow_prod_db)
    -v, --verbose   Enable verbose logging

Endpoints:
    POST /workflow/start     - Start a new workflow
    POST /workflow/respond   - Respond to an interaction
    POST /workflow/retry     - Retry with feedback
    GET  /workflow/{id}/status - Get workflow status
    GET  /workflow/{id}/events - Get all workflow events
    GET  /health             - Health check
"""

import argparse
import logging
import os
import sys
import re

# Add paths


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


sys.path.insert(0, os.path.dirname(__file__))

script_dir = os.path.dirname(os.path.abspath(__file__))
server_path = os.path.join(script_dir, 'server')
if server_path not in sys.path:
    sys.path.insert(0, server_path)


def validate_host(value: str) -> str:
    """Validate host format"""
    # Accept IP addresses and hostnames
    ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
    hostname_pattern = r'^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?)*$'

    if re.match(ip_pattern, value) or re.match(hostname_pattern, value) or value == "0.0.0.0":
        return value
    raise argparse.ArgumentTypeError(
        f"Invalid host format: '{value}'. "
        f"Expected: IP address (e.g., 0.0.0.0, 127.0.0.1) or hostname (e.g., localhost)"
    )


def validate_port(value: str) -> int:
    """Validate port number"""
    try:
        port = int(value)
        if 1 <= port <= 65535:
            return port
        raise ValueError()
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Invalid port: '{value}'. Expected: integer between 1 and 65535 (e.g., 8000)"
        )


def validate_mongo_uri(value: str) -> str:
    """Validate MongoDB URI format"""
    if value.startswith("mongodb://") or value.startswith("mongodb+srv://"):
        return value
    raise argparse.ArgumentTypeError(
        f"Invalid MongoDB URI format: '{value}'. "
        f"Expected: mongodb://host:port or mongodb+srv://... (e.g., mongodb://localhost:27017)"
    )


def validate_db_name(value: str) -> str:
    """Validate database name format"""
    if re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', value) and len(value) <= 64:
        return value
    raise argparse.ArgumentTypeError(
        f"Invalid database name: '{value}'. "
        f"Expected: alphanumeric with underscores, starting with letter/underscore (e.g., workflow_prod_db)"
    )


def main():
    parser = argparse.ArgumentParser(
        description="Start Workflow API Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    python server.py --host 0.0.0.0 --port 8000 --mongo mongodb://localhost:27017 --db workflow_prod_db
    python server.py --host 127.0.0.1 --port 8080 --mongo mongodb://localhost:27017 --db workflow_dev_db -v
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
        help="Server port (e.g., 8000)"
    )
    parser.add_argument(
        "--mongo",
        required=True,
        type=validate_mongo_uri,
        help="MongoDB connection URI (e.g., mongodb://localhost:27017)"
    )
    parser.add_argument(
        "--db",
        required=True,
        type=validate_db_name,
        help="MongoDB database name (e.g., workflow_prod_db)"
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging (DEBUG level)"
    )
    parser.add_argument(
        "--trace",
        action="store_true",
        help="Enable trace logging (very verbose, includes SSE chunks and pymongo)"
    )
    parser.add_argument(
        "--progress-interval",
        type=float,
        default=0.1,
        help="SSE progress event interval in seconds (default: 0.1)"
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=0.05,
        help="SSE loop poll/sleep interval in seconds (default: 0.05)"
    )
    parser.add_argument(
        "--cancel-check-interval",
        type=float,
        default=0.1,
        help="AI provider cancel check interval in seconds (default: 0.1)"
    )

    args = parser.parse_args()

    # Configure logging - always write to rotating file
    from logging.handlers import RotatingFileHandler

    # TRACE level = 5 (below DEBUG = 10)
    TRACE = 5
    logging.addLevelName(TRACE, "TRACE")

    log_dir = os.environ.get('LOG_DIR', os.path.join(script_dir, 'logs'))
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, 'server.log')

    # Console log level depends on -v/--trace flags
    if args.trace:
        console_level = TRACE
    elif args.verbose:
        console_level = logging.DEBUG
    else:
        console_level = logging.WARNING

    # File always gets INFO level (includes timing logs)
    file_handler = RotatingFileHandler(
        log_file,
        maxBytes=5*1024*1024,  # 5MB
        backupCount=3,
        encoding='utf-8'
    )
    file_handler.setLevel(logging.INFO)  # Always log INFO to file
    file_handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    file_handler.addFilter(Base64SanitizingFilter())

    # Configure root logger
    logging.basicConfig(level=console_level)

    # Add base64 sanitizing filter to root logger (applies to all handlers)
    logging.getLogger().addFilter(Base64SanitizingFilter())

    # Add file handler to workflow logger - always INFO level
    workflow_logger = logging.getLogger('workflow')
    workflow_logger.setLevel(logging.INFO)
    workflow_logger.addHandler(file_handler)

    # Also add to processor logger
    processor_logger = logging.getLogger('workflow.processor')
    processor_logger.setLevel(logging.INFO)
    processor_logger.addHandler(file_handler)

    # Configure verbose third-party loggers
    # These use DEBUG level but are very chatty - only show with --trace
    # Without --trace, suppress to WARNING even if -v is used
    if args.trace:
        # Let them through at DEBUG (their native level)
        logging.getLogger('sse_starlette').setLevel(logging.DEBUG)
        logging.getLogger('sse_starlette.sse').setLevel(logging.DEBUG)
        logging.getLogger('pymongo').setLevel(logging.DEBUG)
        logging.getLogger('pymongo.topology').setLevel(logging.DEBUG)
        logging.getLogger('pymongo.connection').setLevel(logging.DEBUG)
        logging.getLogger('pymongo.serverSelection').setLevel(logging.DEBUG)
    else:
        # Suppress chatty loggers even with -v
        logging.getLogger('sse_starlette').setLevel(logging.WARNING)
        logging.getLogger('sse_starlette.sse').setLevel(logging.WARNING)
        logging.getLogger('pymongo').setLevel(logging.WARNING)
        logging.getLogger('pymongo.topology').setLevel(logging.WARNING)
        logging.getLogger('pymongo.connection').setLevel(logging.WARNING)
        logging.getLogger('pymongo.serverSelection').setLevel(logging.WARNING)

    print(f"Logs written to: {log_file}")

    # Set environment variables for the API
    os.environ["MONGODB_URI"] = args.mongo
    os.environ["MONGODB_DATABASE"] = args.db
    os.environ["PROGRESS_INTERVAL"] = str(args.progress_interval)
    os.environ["POLL_INTERVAL"] = str(args.poll_interval)
    os.environ["CANCEL_CHECK_INTERVAL"] = str(args.cancel_check_interval)

    # Import uvicorn
    import uvicorn

    print("=" * 60)
    print("Workflow API Server")
    print("=" * 60)
    print(f"  Host: {args.host}")
    print(f"  Port: {args.port}")
    print(f"  MongoDB: {args.mongo}")
    print(f"  Database: {args.db}")
    print()
    print("Intervals:")
    print(f"  PROGRESS_INTERVAL:     {args.progress_interval}s")
    print(f"  POLL_INTERVAL:         {args.poll_interval}s")
    print(f"  CANCEL_CHECK_INTERVAL: {args.cancel_check_interval}s")
    print()
    print("Endpoints:")
    print(f"  POST http://{args.host}:{args.port}/workflow/start")
    print(f"  POST http://{args.host}:{args.port}/workflow/respond")
    print(f"  POST http://{args.host}:{args.port}/workflow/retry")
    print(f"  GET  http://{args.host}:{args.port}/workflow/{{id}}/status")
    print(f"  GET  http://{args.host}:{args.port}/workflow/{{id}}/events")
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
        timeout_keep_alive=300  # Keep connections alive for 5 minutes (prevents ~2s reconnect delay)
    )


if __name__ == "__main__":
    main()
