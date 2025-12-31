from __future__ import annotations

from typing import Dict, Sequence, Tuple
import math
import numpy as np


class RiskMetricsError(RuntimeError):
    pass


def quantiles(x: Sequence[float], qs: Sequence[float] = (0.1, 0.5, 0.9)) -> Dict[str, float]:
    arr = np.asarray(list(x), dtype=float)
    if arr.size == 0:
        return {f"q{int(q*100):02d}": 0.0 for q in qs}
    if not np.all(np.isfinite(arr)):
        raise RiskMetricsError("quantiles: non-finite values.")
    out: Dict[str, float] = {}
    for q in qs:
        if not (0.0 <= q <= 1.0):
            raise RiskMetricsError("quantiles: q must be in [0,1].")
        out[f"q{int(round(q*100)):02d}"] = float(np.quantile(arr, q))
    return out


def cvar_lower_tail(x: Sequence[float], alpha: float = 0.05) -> float:
    """
    CVaR of the lower tail (worst alpha fraction) for minimization-style risk.
    """
    arr = np.asarray(list(x), dtype=float)
    if arr.size == 0:
        return 0.0
    if not np.all(np.isfinite(arr)):
        raise RiskMetricsError("cvar_lower_tail: non-finite values.")
    if not (0.0 < alpha <= 0.5):
        raise RiskMetricsError("alpha must be in (0, 0.5].")
    k = int(max(1, math.floor(alpha * arr.size)))
    s = np.sort(arr)
    return float(np.mean(s[:k]))


def cvar_upper_tail(x: Sequence[float], alpha: float = 0.05) -> float:
    """
    CVaR of the upper tail (worst alpha fraction) for maximization-style risk (e.g., peak landing force).
    """
    arr = np.asarray(list(x), dtype=float)
    if arr.size == 0:
        return 0.0
    if not np.all(np.isfinite(arr)):
        raise RiskMetricsError("cvar_upper_tail: non-finite values.")
    if not (0.0 < alpha <= 0.5):
        raise RiskMetricsError("alpha must be in (0, 0.5].")
    k = int(max(1, math.floor(alpha * arr.size)))
    s = np.sort(arr)
    return float(np.mean(s[-k:]))


def wilson_ci(successes: int, n: int, z: float = 1.96) -> Tuple[float, float]:
    """
    Wilson score interval for binomial proportion.
    Default z=1.96 ~ 95% CI.
    """
    if n <= 0:
        return (0.0, 0.0)
    if successes < 0 or successes > n:
        raise RiskMetricsError("wilson_ci: successes must be in [0,n].")

    phat = successes / n
    denom = 1.0 + (z * z) / n
    center = (phat + (z * z) / (2.0 * n)) / denom
    half = (z / denom) * math.sqrt((phat * (1.0 - phat) / n) + (z * z) / (4.0 * n * n))
    lo = max(0.0, center - half)
    hi = min(1.0, center + half)
    return (float(lo), float(hi))
