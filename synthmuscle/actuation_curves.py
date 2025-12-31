from __future__ import annotations

# Guarded imports so this file still loads even if you refactor later.
try:
    from synthmuscle.actuation_thermal import DeratingPolicy, derated_limit, ThermalRCParams, ThermalState, step_thermal
except Exception:  # pragma: no cover
    DeratingPolicy = None  # type: ignore
    derated_limit = None  # type: ignore
    ThermalRCParams = None  # type: ignore
    ThermalState = None  # type: ignore
    step_thermal = None  # type: ignore


def thermal_derate_limit(policy, temp_c):
    """
    Compatibility hook used by optimizers/constraints.
    Returns (limit, thermal_ok).
    """
    if derated_limit is None:
        raise RuntimeError("Thermal derating backend unavailable. Ensure synthmuscle/actuation_thermal.py exists.")
    return derated_limit(policy=policy, temp_c=temp_c)
