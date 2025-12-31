import numpy as np

from synthmuscle.control.qp_safety import QPSafetyConfig, QPSafetyFilter


def test_qp_filter_respects_bounds_or_fallback():
    cfg = QPSafetyConfig(fallback="clip")
    qp = QPSafetyFilter(cfg)

    u_des = np.array([10.0, -10.0, 0.5], dtype=float)
    lb = np.array([-1.0, -2.0, -0.1], dtype=float)
    ub = np.array([1.0, 2.0, 0.1], dtype=float)

    res = qp.filter(u_des=u_des, lb=lb, ub=ub)

    assert res.u_safe.shape == u_des.shape
    assert np.all(res.u_safe >= lb - 1e-12)
    assert np.all(res.u_safe <= ub + 1e-12)

    clipped = np.minimum(np.maximum(u_des, lb), ub)
    if not res.used_solver:
        assert np.allclose(res.u_safe, clipped)
