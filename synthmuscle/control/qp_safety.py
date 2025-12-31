from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np

from synthmuscle.control.qp_safety_contracts import Bounds


class QPSafetyError(RuntimeError):
    pass


@dataclass(frozen=True)
class QPSafetyConfig:
    """
    Minimal config for a deterministic safety QP surrogate.

    fallback:
      - "clip": always clip to bounds (deterministic fallback used in tests)
      - "solver": placeholder for future OSQP integration (currently clips)
    """

    use_solver: bool = False  # kept for backward compatibility (ignored)
    fallback: str = "clip"

    def validate(self) -> None:
        if not isinstance(self.use_solver, bool):
            raise QPSafetyError("use_solver must be bool.")
        fb = str(self.fallback).strip().lower()
        if fb not in ("clip", "solver"):
            raise QPSafetyError("fallback must be 'clip' or 'solver'.")


@dataclass(frozen=True)
class QPResult:
    u_safe: np.ndarray
    used_solver: bool
    status: str
    info: Dict[str, object]


class QPSafetyFilter:
    """
    Simplified QP safety filter.
    - Clips to bounds and checks linear constraints A u <= b if provided.
    - If constraints are violated after clipping, marks status as INFEASIBLE.
    - Deterministic: no stochastic solver paths.
    """

    def __init__(self, cfg: QPSafetyConfig):
        cfg.validate()
        self.cfg = cfg

    def filter(
        self,
        *,
        u_des: np.ndarray,
        lb: np.ndarray,
        ub: np.ndarray,
        A: Optional[np.ndarray] = None,
        b: Optional[np.ndarray] = None,
    ) -> QPResult:
        u = np.asarray(u_des, dtype=float).reshape(-1)
        lb = np.asarray(lb, dtype=float).reshape(-1)
        ub = np.asarray(ub, dtype=float).reshape(-1)

        if u.shape != lb.shape or u.shape != ub.shape:
            raise QPSafetyError("u_des, lb, ub must have the same shape.")
        if not (np.all(np.isfinite(u)) and np.all(np.isfinite(lb)) and np.all(np.isfinite(ub))):
            raise QPSafetyError("u_des/lb/ub must be finite.")

        bounds = Bounds(lb=lb, ub=ub)
        bounds.validate()

        # Start with hard clip (fallback is clip for now)
        u_safe = np.minimum(np.maximum(u, lb), ub)
        status = "CLIPPED"
        used_solver = False

        if A is not None and b is not None:
            A = np.asarray(A, dtype=float)
            b = np.asarray(b, dtype=float).reshape(-1)
            if A.shape[1] != u.shape[0]:
                raise QPSafetyError("A columns must match command dimension.")
            if b.shape[0] != A.shape[0]:
                raise QPSafetyError("b length must match rows of A.")
            if not (np.all(np.isfinite(A)) and np.all(np.isfinite(b))):
                raise QPSafetyError("A and b must be finite.")

            viol = A @ u_safe - b
            if np.any(viol > 1e-9):
                status = "INFEASIBLE_CONSTRAINTS"
            else:
                status = "FEASIBLE"
        else:
            status = "FEASIBLE"

        return QPResult(u_safe=u_safe, used_solver=used_solver, status=status, info={"status": status})
