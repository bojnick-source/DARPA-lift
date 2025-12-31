from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

import numpy as np

from synthmuscle.control.thermal_derate import CommandMap, apply_thermal_limits
from synthmuscle.control.qp_safety import QPSafetyConfig, QPSafetyFilter
from synthmuscle.control.qp_safety_contracts import Bounds, bounds_from_limits


class SafetyRuntimeError(RuntimeError):
    pass


def _finite_vec(x: np.ndarray, name: str) -> np.ndarray:
    v = np.asarray(x, dtype=float).reshape(-1)
    if not np.all(np.isfinite(v)):
        raise SafetyRuntimeError(f"{name} contains non-finite values.")
    return v


@dataclass(frozen=True)
class SafetyRuntimeConfig:
    """
    - hard_limit_abs: absolute command limits (per index), always enforced
    - use_qp: if True, run QP filter; else do hard clip only
    - qp: QP config
    - safe_stop_value: command value for safe-stop state (typically 0)
    """

    hard_limit_abs: np.ndarray
    use_qp: bool = True
    qp: QPSafetyConfig = QPSafetyConfig()
    safe_stop_value: float = 0.0

    def validate(self, n: int) -> None:
        lim = _finite_vec(self.hard_limit_abs, "hard_limit_abs")
        if lim.shape[0] != n:
            raise SafetyRuntimeError("hard_limit_abs length must match command dimension.")
        if np.any(lim < 0):
            raise SafetyRuntimeError("hard_limit_abs must be >= 0.")
        if not isinstance(self.use_qp, bool):
            raise SafetyRuntimeError("use_qp must be bool.")
        self.qp.validate()
        sv = float(self.safe_stop_value)
        if not np.isfinite(sv):
            raise SafetyRuntimeError("safe_stop_value must be finite.")


@dataclass(frozen=True)
class SafetyState:
    kill: bool = False
    reason: str = ""


@dataclass(frozen=True)
class SafetyStepResult:
    u_safe: np.ndarray
    u_des: np.ndarray
    used_qp: bool
    qp_status: str
    bounds_lb: np.ndarray
    bounds_ub: np.ndarray
    thermal_ok_any: bool
    thermal_ok_all: bool
    violations: Dict[str, float]
    info: Dict[str, Any]


class SafetyRuntime:
    """
    Safety runtime that combines thermal derating, hard limits, and optional QP projection.
    """

    def __init__(self, *, cfg: SafetyRuntimeConfig, cmd_map: CommandMap):
        self.cmd_map = cmd_map
        n = len(cmd_map.idx_to_actuator)
        cfg.validate(n)
        self.cfg = cfg
        self.qp_filter = QPSafetyFilter(cfg.qp)

    def safe_stop_command(self) -> np.ndarray:
        n = len(self.cmd_map.idx_to_actuator)
        return np.full((n,), float(self.cfg.safe_stop_value), dtype=float)

    def step(
        self,
        *,
        u_des: np.ndarray,
        thermal_limits: Mapping[str, Tuple[float, bool]],
        A: Optional[np.ndarray] = None,
        b: Optional[np.ndarray] = None,
        state: Optional[SafetyState] = None,
    ) -> SafetyStepResult:
        u_des = _finite_vec(u_des, "u_des")
        n = u_des.shape[0]
        if n != len(self.cmd_map.idx_to_actuator):
            raise SafetyRuntimeError("u_des length must match cmd_map length.")

        if state is not None and state.kill:
            u0 = self.safe_stop_command()
            lb = -_finite_vec(self.cfg.hard_limit_abs, "hard_limit_abs")
            ub = _finite_vec(self.cfg.hard_limit_abs, "hard_limit_abs")
            return SafetyStepResult(
                u_safe=u0,
                u_des=u_des,
                used_qp=False,
                qp_status="KILL_OVERRIDE",
                bounds_lb=lb,
                bounds_ub=ub,
                thermal_ok_any=False,
                thermal_ok_all=False,
                violations={"kill_override": 1.0},
                info={"reason": state.reason},
            )

        u_th, ok_flags = apply_thermal_limits(cmd=u_des, cmd_map=self.cmd_map, limits=thermal_limits)

        ok_vals = list(ok_flags.values())
        thermal_ok_any = bool(any(ok_vals)) if ok_vals else True
        thermal_ok_all = bool(all(ok_vals)) if ok_vals else True

        thermal_lim_abs = np.zeros((n,), dtype=float)
        for i, act_id in enumerate(self.cmd_map.idx_to_actuator):
            lim, _ok = thermal_limits[act_id]
            thermal_lim_abs[i] = float(lim)

        hard = _finite_vec(self.cfg.hard_limit_abs, "hard_limit_abs")
        final_lim = np.minimum(hard, thermal_lim_abs)
        bounds = bounds_from_limits(limit_abs_by_index=final_lim)
        bounds.validate()

        if not self.cfg.use_qp:
            u_clip = np.minimum(np.maximum(u_th, bounds.lb), bounds.ub)
            viol = _violation_report(u_des=u_des, u_safe=u_clip, lb=bounds.lb, ub=bounds.ub)
            return SafetyStepResult(
                u_safe=u_clip,
                u_des=u_des,
                used_qp=False,
                qp_status="QP_DISABLED",
                bounds_lb=bounds.lb,
                bounds_ub=bounds.ub,
                thermal_ok_any=thermal_ok_any,
                thermal_ok_all=thermal_ok_all,
                violations=viol,
                info={},
            )

        res = self.qp_filter.filter(u_des=u_des, lb=bounds.lb, ub=bounds.ub, A=A, b=b)
        viol = _violation_report(u_des=u_des, u_safe=res.u_safe, lb=bounds.lb, ub=bounds.ub)

        return SafetyStepResult(
            u_safe=res.u_safe,
            u_des=u_des,
            used_qp=bool(res.used_solver),
            qp_status=str(res.status),
            bounds_lb=bounds.lb,
            bounds_ub=bounds.ub,
            thermal_ok_any=thermal_ok_any,
            thermal_ok_all=thermal_ok_all,
            violations=viol,
            info={"qp_info": dict(res.info)},
        )


def _violation_report(*, u_des: np.ndarray, u_safe: np.ndarray, lb: np.ndarray, ub: np.ndarray) -> Dict[str, float]:
    u_des = np.asarray(u_des, dtype=float).reshape(-1)
    u_safe = np.asarray(u_safe, dtype=float).reshape(-1)
    lb = np.asarray(lb, dtype=float).reshape(-1)
    ub = np.asarray(ub, dtype=float).reshape(-1)

    clip = np.minimum(np.maximum(u_des, lb), ub)
    max_clip = float(np.max(np.abs(u_des - clip))) if u_des.size else 0.0
    max_delta = float(np.max(np.abs(u_des - u_safe))) if u_des.size else 0.0

    sat = (np.isclose(u_safe, lb) | np.isclose(u_safe, ub)).astype(float)
    frac_sat = float(np.mean(sat)) if sat.size else 0.0

    return {
        "max_clip_mag": max_clip,
        "max_delta_mag": max_delta,
        "frac_saturated": frac_sat,
    }
