import numpy as np

from synthmuscle.tasks.contact_metrics import (
    friction_cone_margin,
    slip_rate_from_margin,
    contact_force_peaks,
    landing_impulse,
    summarize_contact,
)


def test_friction_margin_and_slip_rate_basic():
    T = 10
    forces = np.zeros((T, 1, 3), dtype=float)
    forces[:, 0, 2] = 100.0  # Fz
    forces[:, 0, 0] = 30.0   # Fx => Ft=30

    mu = 0.5  # mu*Fz = 50, margin = 20 -> no slip
    margin, ft, fz = friction_cone_margin(forces, mu=mu)
    assert margin.shape == (T,)
    assert np.allclose(ft, 30.0)
    assert np.allclose(fz, 100.0)
    assert np.all(margin > 0)
    assert slip_rate_from_margin(margin) == 0.0

    forces[:, 0, 0] = 80.0  # mu*Fz=50 margin=-30 => slip
    margin2, _, _ = friction_cone_margin(forces, mu=mu)
    assert np.all(margin2 < 0)
    assert slip_rate_from_margin(margin2) == 1.0


def test_force_peaks_and_impulse():
    T = 5
    forces = np.zeros((T, 1, 3), dtype=float)
    forces[:, 0, 2] = np.array([0, 10, 20, 10, 0], dtype=float)  # Fz profile
    forces[:, 0, 0] = 3.0
    forces[:, 0, 1] = 4.0  # Ft=5

    npeak, tpeak = contact_force_peaks(forces)
    assert npeak == 20.0
    assert np.isclose(tpeak, np.sqrt(425.0))

    dt = 0.01
    imp = landing_impulse(forces, dt=dt)
    assert np.isclose(imp, 0.4)


def test_summarize_contact_outputs_finite():
    T = 20
    forces = np.zeros((T, 1, 3), dtype=float)
    forces[:, 0, 2] = 50.0
    forces[:, 0, 0] = np.linspace(0, 20, T)

    cs = summarize_contact(forces_xyz=forces, mu=0.6, dt=0.01, slip_eps=0.0)
    m = cs.as_metrics()
    for k, v in m.items():
        assert np.isfinite(v), f"{k} must be finite"
    assert 0.0 <= m["slip_rate"] <= 1.0
