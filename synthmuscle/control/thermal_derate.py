from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Mapping, Tuple

import numpy as np


class ThermalDerateError(RuntimeError):
    pass


@dataclass(frozen=True)
class CommandMap:
    """
    Maps command indices to actuator identifiers.
    """

    idx_to_actuator: Tuple[str, ...]

    def validate(self, n: int) -> None:
        if len(self.idx_to_actuator) != n:
            raise ThermalDerateError("idx_to_actuator length must match command dimension.")
        if len(set(self.idx_to_actuator)) != len(self.idx_to_actuator):
            raise ThermalDerateError("idx_to_actuator must be unique.")


def apply_thermal_limits(
    *,
    cmd: np.ndarray,
    cmd_map: CommandMap,
    limits: Mapping[str, Tuple[float, bool]],
) -> Tuple[np.ndarray, Dict[str, bool]]:
    """
    Applies per-actuator thermal limits (absolute). Missing actuators -> error (fail-closed).
    limits: actuator_id -> (limit_abs, thermal_ok)
    Returns (clipped_cmd, ok_flags)
    """

    u = np.asarray(cmd, dtype=float).reshape(-1)
    cmd_map.validate(u.shape[0])

    clipped = np.zeros_like(u)
    ok_flags: Dict[str, bool] = {}

    for i, act_id in enumerate(cmd_map.idx_to_actuator):
        if act_id not in limits:
            raise ThermalDerateError(f"Missing thermal limit for actuator: {act_id}")
        lim, ok = limits[act_id]
        lim = float(lim)
        if not np.isfinite(lim) or lim < 0:
            raise ThermalDerateError(f"Invalid limit for actuator {act_id}: {lim}")
        clipped[i] = np.clip(u[i], -lim, lim)
        ok_flags[act_id] = bool(ok)

    return clipped, ok_flags
