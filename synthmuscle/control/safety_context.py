from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


class SafetyContextError(RuntimeError):
    pass


def _finite_vec(x: np.ndarray, name: str) -> np.ndarray:
    v = np.asarray(x, dtype=float).reshape(-1)
    if not np.all(np.isfinite(v)):
        raise SafetyContextError(f"{name} contains non-finite values.")
    return v


@dataclass
class SafetyContext:
    """
    Persistent safety context across timesteps.
    """

    u_prev: Optional[np.ndarray] = None
    kill_latched: bool = False
    kill_reason: str = ""

    def init_prev(self, n: int, value: float = 0.0) -> None:
        if not np.isfinite(float(value)):
            raise SafetyContextError("init value must be finite.")
        self.u_prev = np.full((n,), float(value), dtype=float)

    def get_prev(self, n: int) -> np.ndarray:
        if self.u_prev is None:
            self.init_prev(n=n, value=0.0)
        u = _finite_vec(self.u_prev, "u_prev")
        if u.shape[0] != n:
            self.init_prev(n=n, value=0.0)
            u = _finite_vec(self.u_prev, "u_prev")
        return u

    def set_prev(self, u: np.ndarray) -> None:
        self.u_prev = _finite_vec(u, "u")

    def latch_kill(self, reason: str) -> None:
        self.kill_latched = True
        self.kill_reason = str(reason or "kill_latched")

    def clear_kill(self) -> None:
        self.kill_latched = False
        self.kill_reason = ""
