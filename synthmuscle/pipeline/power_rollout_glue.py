from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

import numpy as np

from synthmuscle.tasks.contact_metrics import summarize_contact
from synthmuscle.tasks.power_objective import PowerObjectiveConfig, compute_power_objective


class RolloutGlueError(RuntimeError):
    pass


def merge_extra_metrics(*dicts: Mapping[str, Any]) -> Dict[str, float]:
    """
    Merge dictionaries, keeping only finite scalar values.
    Later dicts override earlier ones.
    """
    out: Dict[str, float] = {}
    for d in dicts:
        if d is None:
            continue
        for k, v in d.items():
            try:
                fv = float(v)
            except Exception:
                continue
            if np.isfinite(fv):
                out[str(k)] = fv
    return out


@dataclass(frozen=True)
class RolloutGlueConfig:
    objective: PowerObjectiveConfig
    landing_window_mask: Optional[np.ndarray] = None

    def validate(self) -> None:
        self.objective.validate()
        if self.landing_window_mask is not None:
            m = np.asarray(self.landing_window_mask, dtype=bool).reshape(-1)
            if m.size == 0:
                raise RolloutGlueError("landing_window_mask must be non-empty if provided.")


def build_payload_from_traces(
    *,
    cfg: RolloutGlueConfig,
    tau: np.ndarray,
    omega: np.ndarray,
    contact_forces_xyz: np.ndarray,
    phase_mask: Optional[np.ndarray],
    masses: Mapping[str, float],
    extra_metrics: Optional[Mapping[str, float]] = None,
) -> Mapping[str, Any]:
    cfg.validate()

    T = int(np.asarray(tau).shape[0])
    if cfg.landing_window_mask is not None:
        m = np.asarray(cfg.landing_window_mask, dtype=bool).reshape(-1)
        if m.shape[0] != T:
            raise RolloutGlueError("landing_window_mask length must match T.")

    cs = summarize_contact(
        forces_xyz=contact_forces_xyz,
        mu=cfg.objective.mu,
        dt=cfg.objective.dt,
        slip_eps=cfg.objective.slip_eps,
        landing_window_mask=cfg.landing_window_mask,
    )

    merged = merge_extra_metrics(extra_metrics or {}, cs.as_metrics())

    payload = compute_power_objective(
        cfg=cfg.objective,
        tau=tau,
        omega=omega,
        phase_mask=phase_mask,
        masses=masses,
        extra_metrics=merged,
    )
    return payload
