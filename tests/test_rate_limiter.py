import numpy as np

from synthmuscle.control.rate_limiter import rate_limit_bounds, apply_rate_limit


def test_rate_limit_bounds_and_apply():
    u_prev = np.array([0.0, 1.0], dtype=float)
    du = np.array([0.5, 0.25], dtype=float)

    lb, ub = rate_limit_bounds(u_prev=u_prev, du_max_abs=du)
    assert np.allclose(lb, np.array([-0.5, 0.75]))
    assert np.allclose(ub, np.array([0.5, 1.25]))

    u_des = np.array([10.0, 0.0], dtype=float)
    u = apply_rate_limit(u_des=u_des, u_prev=u_prev, du_max_abs=du)
    assert np.allclose(u, np.array([0.5, 0.75]))
