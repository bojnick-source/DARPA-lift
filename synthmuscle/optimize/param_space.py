from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence, Tuple

import numpy as np


class ParamSpaceError(RuntimeError):
    pass


def _fs(x: float, name: str) -> float:
    v = float(x)
    if not np.isfinite(v):
        raise ParamSpaceError(f"{name} must be finite.")
    return v


@dataclass(frozen=True)
class ParamSpec:
    name: str
    low: float
    high: float
    init: float

    def validate(self) -> None:
        if not self.name:
            raise ParamSpaceError("ParamSpec.name must be non-empty.")
        lo = _fs(self.low, "low")
        hi = _fs(self.high, "high")
        if not (lo < hi):
            raise ParamSpaceError(f"ParamSpec '{self.name}' requires low < high.")
        x0 = _fs(self.init, "init")
        if not (lo <= x0 <= hi):
            raise ParamSpaceError(f"ParamSpec '{self.name}' init must be within [low, high].")


@dataclass(frozen=True)
class ParamSpace:
    specs: Tuple[ParamSpec, ...]

    def validate(self) -> None:
        if not self.specs:
            raise ParamSpaceError("ParamSpace.specs must be non-empty.")
        names = [s.name for s in self.specs]
        if len(set(names)) != len(names):
            raise ParamSpaceError("ParamSpace parameter names must be unique.")
        for s in self.specs:
            s.validate()

    @property
    def dim(self) -> int:
        return int(len(self.specs))

    def init_x(self) -> np.ndarray:
        self.validate()
        return np.array([float(s.init) for s in self.specs], dtype=float)

    def bounds(self) -> Tuple[np.ndarray, np.ndarray]:
        self.validate()
        lo = np.array([float(s.low) for s in self.specs], dtype=float)
        hi = np.array([float(s.high) for s in self.specs], dtype=float)
        return lo, hi
