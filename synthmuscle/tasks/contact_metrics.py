from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import numpy as np


class ContactMetricsError(RuntimeError):
    pass


def _finite_arr(x: np.ndarray, name: str) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    if not np.all(np.isfinite(a)):
        raise ContactMetricsError(f"{name} contains non-finite values.")
    return a


def _finite_pos(x: float, name: str) -> float:
    xf = float(x)
    if not np.isfinite(xf) or xf <= 0.0:
        raise ContactMetricsError(f"{name} must be finite and > 0.")
    return xf


@dataclass(frozen=True)
class ContactSummary:
    """
    Core contact realism KPIs for feasibility gating and robustness stats.
    """

    friction_margin_min: float          # min over time: mu*Fz - Ft
    friction_margin_mean: float         # mean over time
    slip_rate: float                    # fraction of timesteps with slip condition
    normal_force_peak_n: float          # peak normal force
    total_force_peak_n: float           # peak resultant contact force
    landing_impulse_n_s: float          # sum(Fz)*dt over selected landing window (or entire series)

    def as_metrics(self) -> Dict[str, float]:
        return {
            "friction_margin_min": float(self.friction_margin_min),
            "friction_margin_mean": float(self.friction_margin_mean),
            "slip_rate": float(self.slip_rate),
            "normal_force_peak_n": float(self.normal_force_peak_n),
            "total_force_peak_n": float(self.total_force_peak_n),
            "landing_impulse_n_s": float(self.landing_impulse_n_s),
        }


def _split_tangential_normal(forces_xyz: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Assumes Z is normal axis (up). If your sim uses a different convention,
    transform before calling.
    forces_xyz: (T, C, 3) or (T, 3) where C contacts aggregated.
    Returns:
      Ft: (T,) tangential magnitude
      Fz: (T,) normal (>=0 assumed after clamp)
    """
    f = _finite_arr(forces_xyz, "forces_xyz")
    if f.ndim == 2 and f.shape[1] == 3:
        f = f[:, None, :]
    if f.ndim != 3 or f.shape[2] != 3:
        raise ContactMetricsError("forces_xyz must have shape (T,3) or (T,C,3).")

    fs = np.sum(f, axis=1)  # (T,3)
    fx, fy, fz = fs[:, 0], fs[:, 1], fs[:, 2]
    ft = np.sqrt(fx * fx + fy * fy)
    fz = np.maximum(fz, 0.0)
    return ft, fz


def friction_cone_margin(
    forces_xyz: np.ndarray,
    *,
    mu: float,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Computes time-series friction margin:
      margin(t) = mu*Fz(t) - Ft(t)
    Returns:
      margin(t), Ft(t), Fz(t)
    Positive margin means inside cone; negative means slip demand.
    """
    mu = float(mu)
    if not np.isfinite(mu) or mu < 0.0:
        raise ContactMetricsError("mu must be finite and >= 0.")
    ft, fz = _split_tangential_normal(forces_xyz)
    margin = mu * fz - ft
    return _finite_arr(margin, "margin"), _finite_arr(ft, "Ft"), _finite_arr(fz, "Fz")


def slip_rate_from_margin(
    margin: np.ndarray,
    *,
    eps: float = 0.0,
) -> float:
    """
    Slip rate = fraction of timesteps where margin < -eps.
    eps is a safety buffer.
    """
    m = _finite_arr(np.asarray(margin, dtype=float).reshape(-1), "margin")
    e = float(eps)
    if not np.isfinite(e) or e < 0.0:
        raise ContactMetricsError("eps must be finite and >= 0.")
    if m.size == 0:
        return 0.0
    return float(np.mean(m < (-e)))


def contact_force_peaks(forces_xyz: np.ndarray) -> Tuple[float, float]:
    """
    Returns:
      normal_force_peak_n, total_force_peak_n
    """
    f = _finite_arr(forces_xyz, "forces_xyz")
    if f.ndim == 2 and f.shape[1] == 3:
        f = f[:, None, :]
    if f.ndim != 3 or f.shape[2] != 3:
        raise ContactMetricsError("forces_xyz must have shape (T,3) or (T,C,3).")

    fs = np.sum(f, axis=1)  # (T,3)
    fx, fy, fz = fs[:, 0], fs[:, 1], np.maximum(fs[:, 2], 0.0)
    total = np.sqrt(fx * fx + fy * fy + fz * fz)
    return float(np.max(fz) if fz.size else 0.0), float(np.max(total) if total.size else 0.0)


def landing_impulse(forces_xyz: np.ndarray, *, dt: float, window_mask: Optional[np.ndarray] = None) -> float:
    """
    Impulse proxy = sum(Fz)*dt over selected window (or entire series).
    """
    dt = _finite_pos(dt, "dt")
    f = _finite_arr(forces_xyz, "forces_xyz")
    if f.ndim == 2 and f.shape[1] == 3:
        f = f[:, None, :]
    if f.ndim != 3 or f.shape[2] != 3:
        raise ContactMetricsError("forces_xyz must have shape (T,3) or (T,C,3).")

    fs = np.sum(f, axis=1)  # (T,3)
    fz = np.maximum(fs[:, 2], 0.0)

    if window_mask is not None:
        m = np.asarray(window_mask, dtype=bool).reshape(-1)
        if m.shape[0] != fz.shape[0]:
            raise ContactMetricsError("window_mask length must match T.")
        fz = fz[m]

    return float(np.sum(fz) * dt) if fz.size else 0.0


def summarize_contact(
    *,
    forces_xyz: np.ndarray,
    mu: float,
    dt: float,
    slip_eps: float = 0.0,
    landing_window_mask: Optional[np.ndarray] = None,
) -> ContactSummary:
    """
    Produces ContactSummary. Assumes Z-up normal.
    """
    margin, _, _ = friction_cone_margin(forces_xyz, mu=mu)
    sr = slip_rate_from_margin(margin, eps=slip_eps)
    npeak, tpeak = contact_force_peaks(forces_xyz)
    imp = landing_impulse(forces_xyz, dt=dt, window_mask=landing_window_mask)

    return ContactSummary(
        friction_margin_min=float(np.min(margin) if margin.size else 0.0),
        friction_margin_mean=float(np.mean(margin) if margin.size else 0.0),
        slip_rate=float(sr),
        normal_force_peak_n=float(npeak),
        total_force_peak_n=float(tpeak),
        landing_impulse_n_s=float(imp),
    )
