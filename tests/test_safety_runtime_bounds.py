import numpy as np

from synthmuscle.control.thermal_derate import CommandMap
from synthmuscle.control.safety_runtime import SafetyRuntime, SafetyRuntimeConfig, SafetyState


def test_safety_runtime_min_bounds_enforced():
    cmd_map = CommandMap(idx_to_actuator=("a0", "a1", "a2"))
    hard = np.array([5.0, 5.0, 5.0], dtype=float)

    rt = SafetyRuntime(cfg=SafetyRuntimeConfig(hard_limit_abs=hard, use_qp=False), cmd_map=cmd_map)

    thermal_limits = {
        "a0": (3.0, True),
        "a1": (1.0, True),
        "a2": (10.0, True),
    }

    u_des = np.array([4.0, 4.0, 4.0], dtype=float)
    res = rt.step(u_des=u_des, thermal_limits=thermal_limits)

    assert np.all(res.u_safe <= np.array([3.0, 1.0, 5.0]) + 1e-12)
    assert np.all(res.u_safe >= -np.array([3.0, 1.0, 5.0]) - 1e-12)


def test_safety_runtime_kill_override():
    cmd_map = CommandMap(idx_to_actuator=("a0", "a1"))
    hard = np.array([5.0, 5.0], dtype=float)

    rt = SafetyRuntime(cfg=SafetyRuntimeConfig(hard_limit_abs=hard, use_qp=True, safe_stop_value=0.0), cmd_map=cmd_map)

    thermal_limits = {"a0": (5.0, True), "a1": (5.0, True)}
    u_des = np.array([2.0, -2.0], dtype=float)

    res = rt.step(u_des=u_des, thermal_limits=thermal_limits, state=SafetyState(kill=True, reason="test"))
    assert res.qp_status == "KILL_OVERRIDE"
    assert np.allclose(res.u_safe, np.zeros_like(u_des))
    assert res.violations.get("kill_override", 0.0) == 1.0
