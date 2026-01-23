"""
Worker entry point - Run with: python -m worker
"""

# Load .env file before other imports that might use env vars
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import argparse
import asyncio
import logging
import os
import signal
import sys


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="Task queue worker process")
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose (DEBUG) logging"
    )
    return parser.parse_args()


args = parse_args()

logging.basicConfig(
    level=logging.DEBUG if args.verbose else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("worker")

# Suppress noisy library loggers even in verbose mode
logging.getLogger("pymongo").setLevel(logging.WARNING)

# Track shutdown state for force-quit on second Ctrl+C
_shutdown_requested = False


def main():
    """Main entry point for the worker process."""
    from .loop import WorkerLoop

    global _shutdown_requested

    logger.info("Starting worker process...")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    worker = WorkerLoop()

    # Handle shutdown signals
    def shutdown(signum, frame):
        global _shutdown_requested
        signame = signal.Signals(signum).name

        if _shutdown_requested:
            # Second signal - force exit immediately
            logger.warning(f"Received {signame} again, forcing exit...")
            os._exit(1)

        _shutdown_requested = True
        logger.info(f"Received {signame}, shutting down... (press again to force quit)")
        worker.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        loop.run_until_complete(worker.run())
    except KeyboardInterrupt:
        if _shutdown_requested:
            logger.warning("Forcing exit...")
            os._exit(1)
        logger.info("Interrupted, shutting down...")
    finally:
        loop.close()
        logger.info("Worker stopped")


if __name__ == "__main__":
    main()
