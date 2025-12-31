from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import numpy as np


class RateLimiterError(RuntimeError):
    pass


def _finite_vec(x: np.ndarray, name: str) -> np.ndarray:
    v = np.asarray(x, dtype=float).reshape(-1)
    if not np.all(np.isfinite(v)):
        raise RateLimiterError(f"{name} contains non-finite values.")
    return v


@dataclass(frozen=True)
class RateLimit:
    """
    du_max_abs: per-index absolute max delta per step.
    """

    du_max_abs: np.ndarray

    def validate(self, n: int) -> None:
        du = _finite_vec(self.du_max_abs, "du_max_abs")
        if du.shape[0] != n:
            raise RateLimiterError("du_max_abs length must match command dimension.")
        if np.any(du < 0):
            raise RateLimiterError("du_max_abs must be >= 0.")


def rate_limit_bounds(
    *,
    u_prev: np.ndarray,
    du_max_abs: np.ndarray,
) -> Tuple[np.ndarray, np.ndarray]:
    u0 = _finite_vec(u_prev, "u_prev")
    du = _finite_vec(du_max_abs, "du_max_abs")
    if u0.shape != du.shape:
        raise RateLimiterError("u_prev and du_max_abs must have same shape.")
    lb = u0 - du
    ub = u0 + du
    return lb, ub


def apply_rate_limit(
    *,
    u_des: np.ndarray,
    u_prev: np.ndarray,
    du_max_abs: np.ndarray,
) -> np.ndarray:
    u = _finite_vec(u_des, "u_des")
    lb, ub = rate_limit_bounds(u_prev=u_prev, du_max_abs=du_max_abs)
    return np.minimum(np.maximum(u, lb), ub)
