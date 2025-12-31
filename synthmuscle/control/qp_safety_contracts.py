from __future__ import annotations

from dataclasses import dataclass
import numpy as np


class QPContractsError(RuntimeError):
    pass


@dataclass(frozen=True)
class Bounds:
    lb: np.ndarray
    ub: np.ndarray

    def validate(self) -> None:
        lb = np.asarray(self.lb, dtype=float).reshape(-1)
        ub = np.asarray(self.ub, dtype=float).reshape(-1)
        if lb.shape != ub.shape:
            raise QPContractsError("lb and ub shapes must match.")
        if not np.all(np.isfinite(lb)) or not np.all(np.isfinite(ub)):
            raise QPContractsError("lb/ub must be finite.")
        if np.any(lb > ub):
            raise QPContractsError("lb must be <= ub elementwise.")


def bounds_from_limits(*, limit_abs_by_index: np.ndarray) -> Bounds:
    lim = np.asarray(limit_abs_by_index, dtype=float).reshape(-1)
    if not np.all(np.isfinite(lim)):
        raise QPContractsError("limit_abs_by_index must be finite.")
    if np.any(lim < 0):
        raise QPContractsError("limit_abs_by_index must be >= 0.")
    lb = -lim
    ub = lim
    b = Bounds(lb=lb, ub=ub)
    b.validate()
    return b
