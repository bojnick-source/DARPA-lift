from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Any


@dataclass
class RunConfig:
    seed: int = 0
    notes: Dict[str, Any] = field(default_factory=dict)
