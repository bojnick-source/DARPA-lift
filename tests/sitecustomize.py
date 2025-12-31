"""
Test-time path adjustments.

Pytest may collect modules from within the ``tests`` directory, which makes
the current working directory ``tests/``. That removes the repository root
from ``sys.path`` and prevents our local shims (notably the lightweight
``numpy`` implementation) from being importable. Adding the parent directory
back onto ``sys.path`` ensures imports behave consistently regardless of
where the interpreter starts.
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
