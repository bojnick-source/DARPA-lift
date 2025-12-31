from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

import numpy as np

from synthmuscle.tasks.power_metrics import joint_power_series, summarize_power, specific_power


class PowerObjectiveError(RuntimeError):
    pass


@dataclass(frozen=True)
class PowerObjectiveConfig:
    dt: float
    window_s: float = 0.10
    mass_key: str = "m_actuation_kg"

    # Contact/friction assumptions (used for metrics and/or gating)
    mu: float = 0.8
    slip_eps: float = 0.0

    # Hard feasibility limits (constraints)
    max_temp_c: Optional[float] = None
    max_slip_rate: Optional[float] = None
    max_total_force_peak_n: Optional[float] = None
    max_normal_force_peak_n: Optional[float] = None
    min_friction_margin: Optional[float] = None  # require mu*Fz - Ft >= this

    def validate(self) -> None:
        if not np.isfinite(self.dt) or self.dt <= 0:
            raise PowerObjectiveError("dt must be finite and > 0.")
        if not np.isfinite(self.window_s) or self.window_s <= 0:
            raise PowerObjectiveError("window_s must be finite and > 0.")
        if not self.mass_key:
            raise PowerObjectiveError("mass_key must be non-empty.")
        if not np.isfinite(self.mu) or self.mu < 0:
            raise PowerObjectiveError("mu must be finite and >= 0.")
        if not np.isfinite(self.slip_eps) or self.slip_eps < 0:
            raise PowerObjectiveError("slip_eps must be finite and >= 0.")


def compute_power_objective(
    *,
    cfg: PowerObjectiveConfig,
    tau: np.ndarray,
    omega: np.ndarray,
    phase_mask: Optional[np.ndarray],
    masses: Mapping[str, float],
    extra_metrics: Optional[Mapping[str, float]] = None,
) -> Mapping[str, Any]:
    """
    Returns:
      {
        "objective": float,   # lower is better (-specific_power)
        "metrics": {...},     # power KPIs + specific power + any extra metrics you pass in
        "constraints": {...}  # feasibility gates
      }

    Standard extra metric keys expected (if you provide them):
      - temp_max_c
      - slip_rate
      - friction_margin_min
      - total_force_peak_n
      - normal_force_peak_n
    """
    cfg.validate()
    extra_metrics = dict(extra_metrics or {})

    p_total, p_pos, p_neg = joint_power_series(tau=tau, omega=omega)
    ps = summarize_power(p_pos=p_pos, dt=cfg.dt, phase_mask=phase_mask, window_s=cfg.window_s)

    if cfg.mass_key not in masses:
        raise PowerObjectiveError(f"Missing masses['{cfg.mass_key}'] for specific power.")
    m = float(masses[cfg.mass_key])
    if not np.isfinite(m) or m <= 0:
        raise PowerObjectiveError(f"Mass '{cfg.mass_key}' must be finite and > 0.")

    spr = specific_power(ps.p_pos_windowed_peak_w, m)
    objective = -spr  # minimize -SPR

    metrics: Dict[str, float] = {}
    metrics.update(ps.as_metrics())
    metrics["specific_power_w_per_kg"] = float(spr)

    for k, v in extra_metrics.items():
        fv = float(v)
        if np.isfinite(fv):
            metrics[str(k)] = fv

    constraints: Dict[str, bool] = {}

    if cfg.max_temp_c is not None and "temp_max_c" in metrics:
        constraints["thermal_ok"] = bool(metrics["temp_max_c"] <= float(cfg.max_temp_c))

    if cfg.max_slip_rate is not None and "slip_rate" in metrics:
        constraints["slip_ok"] = bool(metrics["slip_rate"] <= float(cfg.max_slip_rate))

    if cfg.max_total_force_peak_n is not None and "total_force_peak_n" in metrics:
        constraints["total_force_ok"] = bool(metrics["total_force_peak_n"] <= float(cfg.max_total_force_peak_n))
    if cfg.max_normal_force_peak_n is not None and "normal_force_peak_n" in metrics:
        constraints["normal_force_ok"] = bool(metrics["normal_force_peak_n"] <= float(cfg.max_normal_force_peak_n))

    if cfg.min_friction_margin is not None and "friction_margin_min" in metrics:
        constraints["friction_margin_ok"] = bool(metrics["friction_margin_min"] >= float(cfg.min_friction_margin))

    return {
        "objective": float(objective),
        "metrics": metrics,
        "constraints": constraints,
    }
