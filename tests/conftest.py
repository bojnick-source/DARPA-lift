"""
Pytest configuration.

Ensures the repository root is on ``sys.path`` so test modules can import the
local packages and shims (including the lightweight ``numpy`` replacement)
regardless of where pytest starts execution.
"""

from __future__ import annotations

import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
