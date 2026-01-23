"""
Interaction Handler - Re-export from contracts for backward compatibility.

The InteractionHandler ABC is now defined in contracts/handlers.py.
This file exists for backward compatibility with existing imports.

New code should import directly from contracts:
    from contracts import InteractionHandler
"""

import sys
import os

# Add parent directory to path for contracts import
_script_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _script_dir not in sys.path:
    sys.path.insert(0, _script_dir)

# Re-export from contracts
from contracts import InteractionHandler

__all__ = ['InteractionHandler']
