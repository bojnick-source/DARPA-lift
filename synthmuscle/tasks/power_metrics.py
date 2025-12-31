from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Mapping, Optional, Sequence, Tuple

import numpy as np


class PowerMetricsError(RuntimeError):
    pass


def _finite(x: np.ndarray, name: str) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    if not np.all(np.isfinite(x)):
        raise PowerMetricsError(f"{name} contains non-finite values.")
    return x


def joint_power_series(tau: np.ndarray, omega: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute joint mechanical power:
      P = sum_i tau_i * omega_i

    Returns:
      P_total(t), P_pos(t) (positive output only), P_neg(t) (absorbed/braking only)
    Shapes:
      tau:   (T, J) or (J, T) accepted
      omega: (T, J) or (J, T) accepted
    """
    tau = _finite(np.asarray(tau, dtype=float), "tau")
    omega = _finite(np.asarray(omega, dtype=float), "omega")

    if tau.ndim != 2 or omega.ndim != 2:
        raise PowerMetricsError("tau and omega must be 2D arrays.")
    if tau.shape != omega.shape:
        # allow transpose match
        if tau.T.shape == omega.shape:
            tau = tau.T
        elif omega.T.shape == tau.shape:
            omega = omega.T
        else:
            raise PowerMetricsError(f"tau shape {tau.shape} not compatible with omega shape {omega.shape}.")

    p_joint = tau * omega
    p_total = np.sum(p_joint, axis=1)  # (T,)
    p_pos = np.sum(np.maximum(p_joint, 0.0), axis=1)
    p_neg = np.sum(np.maximum(-p_joint, 0.0), axis=1)

    return p_total, p_pos, p_neg


def tendon_power_series(force: np.ndarray, vel: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Compute tendon/actuator endpoint power:
      P = sum_k F_k * v_k

    Returns:
      P_total(t), P_pos(t), P_neg(t)
    """
    force = _finite(np.asarray(force, dtype=float), "force")
    vel = _finite(np.asarray(vel, dtype=float), "vel")

    if force.ndim != 2 or vel.ndim != 2:
        raise PowerMetricsError("force and vel must be 2D arrays.")
    if force.shape != vel.shape:
        if force.T.shape == vel.shape:
            force = force.T
        elif vel.T.shape == force.shape:
            vel = vel.T
        else:
            raise PowerMetricsError(f"force shape {force.shape} not compatible with vel shape {vel.shape}.")

    p = force * vel
    p_total = np.sum(p, axis=1)
    p_pos = np.sum(np.maximum(p, 0.0), axis=1)
    p_neg = np.sum(np.maximum(-p, 0.0), axis=1)
    return p_total, p_pos, p_neg


def windowed_peak(series: np.ndarray, dt: float, window_s: float) -> float:
    """
    Max mean value over a sliding window.
    For explosive power, this avoids single-timestep spikes.
    """
    s = _finite(np.asarray(series, dtype=float).reshape(-1), "series")
    if not np.isfinite(dt) or dt <= 0:
        raise PowerMetricsError("dt must be finite and > 0.")
    if not np.isfinite(window_s) or window_s <= 0:
        raise PowerMetricsError("window_s must be finite and > 0.")

    w = int(max(1, round(window_s / dt)))
    if s.size < w:
        return float(np.mean(s))

    c = np.cumsum(np.insert(s, 0, 0.0))
    means = (c[w:] - c[:-w]) / float(w)
    return float(np.max(means))


def rms_over_mask(series: np.ndarray, mask: np.ndarray) -> float:
    """
    RMS over a boolean mask (phase aligned).
    """
    s = _finite(np.asarray(series, dtype=float).reshape(-1), "series")
    m = np.asarray(mask, dtype=bool).reshape(-1)
    if m.shape[0] != s.shape[0]:
        raise PowerMetricsError("mask length must match series length.")
    sel = s[m]
    if sel.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(sel * sel)))


def integrate_positive_energy(p_pos: np.ndarray, dt: float) -> float:
    """
    E_pos = ∫ P_pos dt
    """
    p = _finite(np.asarray(p_pos, dtype=float).reshape(-1), "p_pos")
    if not np.isfinite(dt) or dt <= 0:
        raise PowerMetricsError("dt must be finite and > 0.")
    return float(np.sum(p) * float(dt))


@dataclass(frozen=True)
class PowerSummary:
    """
    Core power KPIs.
    """

    p_pos_peak_w: float
    p_pos_windowed_peak_w: float
    p_pos_rms_w: float
    e_pos_j: float

    def as_metrics(self) -> Dict[str, float]:
        return {
            "p_pos_peak_w": float(self.p_pos_peak_w),
            "p_pos_windowed_peak_w": float(self.p_pos_windowed_peak_w),
            "p_pos_rms_w": float(self.p_pos_rms_w),
            "e_pos_j": float(self.e_pos_j),
        }


def summarize_power(
    *,
    p_pos: np.ndarray,
    dt: float,
    phase_mask: Optional[np.ndarray] = None,
    window_s: float = 0.10,
) -> PowerSummary:
    """
    Summarize positive mechanical power.
    - phase_mask: optional boolean array selecting stance/extension phase
    - window_s: sliding-window mean duration for peak power
    """
    p_pos = _finite(np.asarray(p_pos, dtype=float).reshape(-1), "p_pos")
    peak = float(np.max(p_pos)) if p_pos.size else 0.0
    wpeak = windowed_peak(p_pos, dt=dt, window_s=window_s) if p_pos.size else 0.0
    if phase_mask is None:
        rms = float(np.sqrt(np.mean(p_pos * p_pos))) if p_pos.size else 0.0
    else:
        rms = rms_over_mask(p_pos, phase_mask)
    epos = integrate_positive_energy(p_pos, dt=dt) if p_pos.size else 0.0
    return PowerSummary(
        p_pos_peak_w=peak,
        p_pos_windowed_peak_w=wpeak,
        p_pos_rms_w=rms,
        e_pos_j=epos,
    )


def specific_power(power_w: float, mass_kg: float) -> float:
    """
    Specific mechanical power: W/kg
    """
    if not np.isfinite(power_w):
        raise PowerMetricsError("power_w must be finite.")
    if not np.isfinite(mass_kg) or mass_kg <= 0:
        raise PowerMetricsError("mass_kg must be finite and > 0.")
    return float(power_w) / float(mass_kg)
