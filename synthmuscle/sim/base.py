from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Protocol, runtime_checkable
import numpy as np


@dataclass(frozen=True)
class TaskSpec:
    name: str
    horizon_s: float
    dt: float


@dataclass
class StepResult:
    obs: np.ndarray
    reward: float
    done: bool
    info: Dict[str, Any]


@runtime_checkable
class SimEnv(Protocol):
    def reset(self, seed: int | None = None) -> np.ndarray: ...
    def step(self, action: np.ndarray) -> StepResult: ...
    def render(self) -> None: ...
