from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional, Tuple

import numpy as np

from synthmuscle.control.rate_limiter import RateLimit, rate_limit_bounds
from synthmuscle.control.safety_context import SafetyContext
from synthmuscle.control.safety_runtime import SafetyRuntime, SafetyRuntimeConfig, SafetyState, SafetyStepResult
from synthmuscle.control.thermal_derate import CommandMap


class SafetyRuntimePlusError(RuntimeError):
    pass


def _finite_vec(x: np.ndarray, name: str) -> np.ndarray:
    v = np.asarray(x, dtype=float).reshape(-1)
    if not np.all(np.isfinite(v)):
        raise SafetyRuntimePlusError(f"{name} contains non-finite values.")
    return v


@dataclass(frozen=True)
class SafetyRuntimePlusConfig:
    base: SafetyRuntimeConfig
    rate_limit: Optional[RateLimit] = None


class SafetyRuntimePlus:
    """
    SafetyRuntime with optional per-step rate limiting.
    """

    def __init__(self, *, cfg: SafetyRuntimePlusConfig, cmd_map: CommandMap, ctx: SafetyContext):
        self.cfg = cfg
        self.cmd_map = cmd_map
        self.ctx = ctx
        self.base = SafetyRuntime(cfg=cfg.base, cmd_map=cmd_map)

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

        if self.ctx.kill_latched:
            state = SafetyState(kill=True, reason=self.ctx.kill_reason)

        res = self.base.step(u_des=u_des, thermal_limits=thermal_limits, A=A, b=b, state=state)

        if self.cfg.rate_limit is None or res.qp_status == "KILL_OVERRIDE":
            self.ctx.set_prev(res.u_safe)
            return res

        rl = self.cfg.rate_limit
        rl.validate(n)
        u_prev = self.ctx.get_prev(n)
        rl_lb, rl_ub = rate_limit_bounds(u_prev=u_prev, du_max_abs=rl.du_max_abs)

        lb = np.maximum(res.bounds_lb, rl_lb)
        ub = np.minimum(res.bounds_ub, rl_ub)
        if np.any(lb > ub):
            self.ctx.latch_kill("rate_limit_bounds_inconsistent")
            return self.base.step(
                u_des=u_des,
                thermal_limits=thermal_limits,
                A=A,
                b=b,
                state=SafetyState(kill=True, reason=self.ctx.kill_reason),
            )

        if not self.base.cfg.use_qp:
            u_safe = np.minimum(np.maximum(res.u_safe, lb), ub)
            res2 = SafetyStepResult(
                u_safe=u_safe,
                u_des=res.u_des,
                used_qp=False,
                qp_status="QP_DISABLED_RATE_LIMITED",
                bounds_lb=lb,
                bounds_ub=ub,
                thermal_ok_any=res.thermal_ok_any,
                thermal_ok_all=res.thermal_ok_all,
                violations=dict(res.violations),
                info=dict(res.info),
            )
            self.ctx.set_prev(res2.u_safe)
            return res2

        qp_res = self.base.qp_filter.filter(u_des=u_des, lb=lb, ub=ub, A=A, b=b)
        res2 = SafetyStepResult(
            u_safe=qp_res.u_safe,
            u_des=res.u_des,
            used_qp=bool(qp_res.used_solver),
            qp_status=str(qp_res.status) + "_RATE_LIMITED",
            bounds_lb=lb,
            bounds_ub=ub,
            thermal_ok_any=res.thermal_ok_any,
            thermal_ok_all=res.thermal_ok_all,
            violations=dict(res.violations),
            info={**dict(res.info), "qp_info_rate_limited": dict(qp_res.info)},
        )
        self.ctx.set_prev(res2.u_safe)
        return res2
