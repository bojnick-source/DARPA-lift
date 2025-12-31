from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import numpy as np


class ThermalError(RuntimeError):
    pass


def _fs(x: float, name: str) -> float:
    xf = float(x)
    if not np.isfinite(xf):
        raise ThermalError(f"{name} must be finite.")
    return xf


@dataclass(frozen=True)
class ThermalRCParams:
    """
    First-order thermal model:
      dT/dt = (P_loss / C_th) - (T - T_amb)/(R_th * C_th)

    Units:
      C_th: J/°C
      R_th: °C/W
    """

    C_th_j_per_c: float
    R_th_c_per_w: float
    T_amb_c: float = 25.0

    def validate(self) -> None:
        C = _fs(self.C_th_j_per_c, "C_th_j_per_c")
        R = _fs(self.R_th_c_per_w, "R_th_c_per_w")
        _fs(self.T_amb_c, "T_amb_c")
        if C <= 0:
            raise ThermalError("C_th_j_per_c must be > 0.")
        if R <= 0:
            raise ThermalError("R_th_c_per_w must be > 0.")


@dataclass
class ThermalState:
    """
    Mutable thermal state for stepping.
    """

    T_c: float = 25.0

    def validate(self) -> None:
        _fs(self.T_c, "T_c")


def step_thermal(
    *,
    params: ThermalRCParams,
    state: ThermalState,
    p_loss_w: float,
    dt_s: float,
) -> float:
    """
    Euler step thermal state forward by dt_s.
    Returns new temperature.
    """

    params.validate()
    state.validate()

    P = _fs(p_loss_w, "p_loss_w")
    dt = _fs(dt_s, "dt_s")
    if dt <= 0:
        raise ThermalError("dt_s must be > 0.")
    if P < 0:
        raise ThermalError("p_loss_w must be >= 0.")

    C = float(params.C_th_j_per_c)
    R = float(params.R_th_c_per_w)
    Ta = float(params.T_amb_c)
    T = float(state.T_c)

    dTdt = (P / C) - ((T - Ta) / (R * C))
    Tnew = T + dTdt * dt
    if not np.isfinite(Tnew):
        raise ThermalError("Thermal integration produced non-finite temperature.")
    state.T_c = float(Tnew)
    return float(Tnew)


@dataclass(frozen=True)
class DeratingPolicy:
    """
    Generic derating policy for any actuator:
    - continuous_limit: safe indefinitely at/below this output
    - peak_limit: allowed transiently at cool temps
    - max_temp: hard ceiling
    - start_derate_temp: temperature where peak begins to reduce toward continuous
    - end_derate_temp: temperature where peak==continuous
    """

    continuous_limit: float
    peak_limit: float
    max_temp_c: float = 120.0
    start_derate_temp_c: float = 60.0
    end_derate_temp_c: float = 100.0

    def validate(self) -> None:
        cont = _fs(self.continuous_limit, "continuous_limit")
        peak = _fs(self.peak_limit, "peak_limit")
        Tmax = _fs(self.max_temp_c, "max_temp_c")
        Ts = _fs(self.start_derate_temp_c, "start_derate_temp_c")
        Te = _fs(self.end_derate_temp_c, "end_derate_temp_c")

        if cont < 0 or peak < 0:
            raise ThermalError("Limits must be >= 0.")
        if peak < cont:
            raise ThermalError("peak_limit must be >= continuous_limit.")
        if not (0.0 < Ts < Te < Tmax):
            raise ThermalError("Require 0 < start_derate < end_derate < max_temp.")


def derated_limit(
    *,
    policy: DeratingPolicy,
    temp_c: float,
) -> Tuple[float, bool]:
    """
    Returns (available_limit, thermal_ok).
    - available_limit is the current allowed output limit based on temperature.
    - thermal_ok is False if temp exceeds max_temp.
    """

    policy.validate()
    T = _fs(temp_c, "temp_c")

    if T >= policy.max_temp_c:
        return (0.0, False)

    if T <= policy.start_derate_temp_c:
        return (float(policy.peak_limit), True)

    if T >= policy.end_derate_temp_c:
        return (float(policy.continuous_limit), True)

    # linear interpolation
    a = (T - policy.start_derate_temp_c) / (policy.end_derate_temp_c - policy.start_derate_temp_c)
    lim = float(policy.peak_limit + a * (policy.continuous_limit - policy.peak_limit))
    lim = max(float(policy.continuous_limit), min(float(policy.peak_limit), lim))
    return (lim, True)


def i2r_losses_w(current_a: float, resistance_ohm: float) -> float:
    """
    Electrical copper losses approximation: P = I^2 * R
    """
    I = _fs(current_a, "current_a")
    R = _fs(resistance_ohm, "resistance_ohm")
    if I < 0:
        I = abs(I)
    if R < 0:
        raise ThermalError("resistance_ohm must be >= 0.")
    return float((I * I) * R)
