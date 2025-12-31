from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple, Union

import numpy as np


class ImpedanceError(RuntimeError):
    """Raised for invalid inputs/config in impedance control."""


def _to_1d_float_array(x: Any, name: str) -> np.ndarray:
    try:
        arr = np.asarray(x, dtype=float).reshape(-1)
    except Exception as e:
        raise ImpedanceError(f"{name}: cannot convert to float array: {e}") from e
    if arr.ndim != 1:
        raise ImpedanceError(f"{name}: must be 1D.")
    if not np.all(np.isfinite(arr)):
        raise ImpedanceError(f"{name}: contains NaN/Inf.")
    return arr


def _require_keys(d: Mapping[str, Any], keys: Tuple[str, ...], ctx: str) -> None:
    missing = [k for k in keys if k not in d]
    if missing:
        raise ImpedanceError(f"{ctx}: missing required key(s): {missing}")


@dataclass(frozen=True)
class ImpedanceGains:
    """
    Joint-space impedance gains.
    All arrays must be shape (n,).
    """

    kp: np.ndarray  # stiffness
    kd: np.ndarray  # damping

    def validate(self) -> int:
        kp = _to_1d_float_array(self.kp, "gains.kp")
        kd = _to_1d_float_array(self.kd, "gains.kd")
        if kp.shape != kd.shape:
            raise ImpedanceError(f"gains: kp and kd shapes differ: {kp.shape} vs {kd.shape}")
        if np.any(kp < 0) or np.any(kd < 0):
            raise ImpedanceError("gains: kp and kd must be >= 0.")
        return int(kp.shape[0])


@dataclass(frozen=True)
class ActuatorLimits:
    """
    Actuator torque limits (absolute).
    tau_max: (n,) absolute max torque per joint.
    """

    tau_max: np.ndarray

    def validate(self, n: int) -> None:
        tau_max = _to_1d_float_array(self.tau_max, "limits.tau_max")
        if tau_max.shape != (n,):
            raise ImpedanceError(f"limits.tau_max must be shape ({n},), got {tau_max.shape}")
        if np.any(tau_max <= 0):
            raise ImpedanceError("limits.tau_max must be > 0 for all joints.")


@dataclass(frozen=True)
class SlewRateLimit:
    """
    Optional torque slew rate limit to prevent unrealistic step torques.
    max_delta_tau_per_s: (n,) max change per second in absolute torque.
    """

    max_delta_tau_per_s: np.ndarray

    def validate(self, n: int) -> None:
        r = _to_1d_float_array(self.max_delta_tau_per_s, "slew.max_delta_tau_per_s")
        if r.shape != (n,):
            raise ImpedanceError(f"slew.max_delta_tau_per_s must be shape ({n},), got {r.shape}")
        if np.any(r <= 0):
            raise ImpedanceError("slew.max_delta_tau_per_s must be > 0 for all joints.")


@dataclass(frozen=True)
class ImpedanceConfig:
    """
    Deterministic impedance controller configuration.
    """

    gains: ImpedanceGains
    limits: Optional[ActuatorLimits] = None
    slew: Optional[SlewRateLimit] = None

    # If True, controller will fail-closed when dt <= 0 or non-finite.
    strict_dt: bool = True

    def validate(self) -> int:
        n = self.gains.validate()
        if self.limits is not None:
            self.limits.validate(n)
        if self.slew is not None:
            self.slew.validate(n)
        return n


class ImpedanceController:
    """
    Joint-space impedance controller (PD + optional feedforward torque).

    Contract (strict; fail-closed):
      - obs must include: q (n,), qd (n,)
      - ref must include: q_des (n,), qd_des (n,)
      - ref may include: tau_ff (n,) feedforward torque (defaults to zeros)
      - step requires dt > 0 and finite (unless strict_dt=False, then dt is clamped to tiny epsilon)

    Output:
      - {"tau": (n,)} torque command (float array)
    """

    def __init__(self, cfg: ImpedanceConfig):
        self.cfg = cfg
        self.n = cfg.validate()
        self._tau_prev: Optional[np.ndarray] = None

        # Cache arrays (ensure float, contiguous)
        self._kp = _to_1d_float_array(cfg.gains.kp, "gains.kp").copy()
        self._kd = _to_1d_float_array(cfg.gains.kd, "gains.kd").copy()

        self._tau_max: Optional[np.ndarray] = None
        if cfg.limits is not None:
            self._tau_max = _to_1d_float_array(cfg.limits.tau_max, "limits.tau_max").copy()

        self._slew: Optional[np.ndarray] = None
        if cfg.slew is not None:
            self._slew = _to_1d_float_array(cfg.slew.max_delta_tau_per_s, "slew.max_delta_tau_per_s").copy()

    def reset(self) -> None:
        """Resets internal state (slew limiter history)."""
        self._tau_prev = None

    def step(
        self,
        *,
        obs: Mapping[str, Any],
        ref: Mapping[str, Any],
        dt: float,
    ) -> Dict[str, np.ndarray]:
        _require_keys(obs, ("q", "qd"), "obs")
        _require_keys(ref, ("q_des", "qd_des"), "ref")

        if not np.isfinite(dt):
            raise ImpedanceError(f"dt must be finite, got {dt}")
        if dt <= 0:
            if self.cfg.strict_dt:
                raise ImpedanceError(f"dt must be > 0, got {dt}")
            dt = 1e-6  # deterministic clamp

        q = _to_1d_float_array(obs["q"], "obs.q")
        qd = _to_1d_float_array(obs["qd"], "obs.qd")
        q_des = _to_1d_float_array(ref["q_des"], "ref.q_des")
        qd_des = _to_1d_float_array(ref["qd_des"], "ref.qd_des")

        if q.shape != (self.n,) or qd.shape != (self.n,) or q_des.shape != (self.n,) or qd_des.shape != (self.n,):
            raise ImpedanceError(
                f"Shape mismatch: expected (n,) with n={self.n}; "
                f"got q{q.shape}, qd{qd.shape}, q_des{q_des.shape}, qd_des{qd_des.shape}"
            )

        tau_ff = np.zeros((self.n,), dtype=float)
        if "tau_ff" in ref and ref["tau_ff"] is not None:
            tau_ff = _to_1d_float_array(ref["tau_ff"], "ref.tau_ff")
            if tau_ff.shape != (self.n,):
                raise ImpedanceError(f"ref.tau_ff must be shape ({self.n},), got {tau_ff.shape}")

        # PD in joint space
        e = q_des - q
        ed = qd_des - qd
        tau = (self._kp * e) + (self._kd * ed) + tau_ff

        if not np.all(np.isfinite(tau)):
            raise ImpedanceError("Computed torque contains NaN/Inf (check inputs/gains).")

        # Optional slew limiting (deterministic)
        if self._slew is not None:
            if self._tau_prev is None:
                self._tau_prev = tau.copy()
            max_delta = self._slew * float(dt)
            delta = tau - self._tau_prev
            delta = np.clip(delta, -max_delta, max_delta)
            tau = self._tau_prev + delta
            self._tau_prev = tau.copy()

        # Optional torque clamp
        if self._tau_max is not None:
            tau = np.clip(tau, -self._tau_max, self._tau_max)

        return {"tau": tau}
