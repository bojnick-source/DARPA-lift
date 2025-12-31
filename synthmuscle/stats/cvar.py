from __future__ import annotations

from typing import Dict, Sequence
import numpy as np


class CVARError(RuntimeError):
    pass


def _finite_1d(x: Sequence[float], name: str) -> np.ndarray:
    a = np.asarray(list(x), dtype=float).reshape(-1)
    if a.size == 0:
        raise CVARError(f"{name} must be non-empty.")
    if not np.all(np.isfinite(a)):
        raise CVARError(f"{name} contains non-finite values.")
    return a


def quantiles(x: Sequence[float], qs: Sequence[float]) -> Dict[str, float]:
    a = _finite_1d(x, "x")
    out: Dict[str, float] = {}
    for q in qs:
        qq = float(q)
        if not np.isfinite(qq) or not (0.0 <= qq <= 1.0):
            raise CVARError("Quantiles qs must be in [0,1].")
        out[f"q{int(round(qq*100)):02d}"] = float(np.quantile(a, qq))
    return out


def cvar_upper(x: Sequence[float], alpha: float = 0.95) -> float:
    """
    Upper-tail CVaR (risk of large values).
    """
    a = _finite_1d(x, "x")
    al = float(alpha)
    if not np.isfinite(al) or not (0.0 < al < 1.0):
        raise CVARError("alpha must be in (0,1).")
    var = float(np.quantile(a, al))
    tail = a[a >= var]
    if tail.size == 0:
        return float(var)
    return float(np.mean(tail))


def cvar_lower(x: Sequence[float], alpha: float = 0.05) -> float:
    """
    Lower-tail CVaR (risk of small values).
    """
    a = _finite_1d(x, "x")
    al = float(alpha)
    if not np.isfinite(al) or not (0.0 < al < 1.0):
        raise CVARError("alpha must be in (0,1).")
    var = float(np.quantile(a, al))
    tail = a[a <= var]
    if tail.size == 0:
        return float(var)
    return float(np.mean(tail))
