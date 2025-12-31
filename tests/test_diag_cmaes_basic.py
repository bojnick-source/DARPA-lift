import numpy as np

from synthmuscle.optimize.diag_cmaes import DiagCMAES, DiagCMAESConfig


def test_diag_cmaes_deterministic_improves_quadratic():
    n = 4
    cfg = DiagCMAESConfig(n=n, seed=123, sigma0=0.8, popsize=12)
    m0 = np.zeros((n,), dtype=float)

    es1 = DiagCMAES(cfg=cfg, m0=m0)
    es2 = DiagCMAES(cfg=cfg, m0=m0)

    def loss_fn(y):
        t = np.array([1.0, -2.0, 0.5, 0.0], dtype=float)
        d = y - t
        return float(np.dot(d, d))

    best1 = float("inf")
    best2 = float("inf")

    for _ in range(10):
        Y1 = es1.ask()
        L1 = np.array([loss_fn(y) for y in Y1], dtype=float)
        es1.tell(Y1, L1)
        best1 = min(best1, float(np.min(L1)))

        Y2 = es2.ask()
        L2 = np.array([loss_fn(y) for y in Y2], dtype=float)
        es2.tell(Y2, L2)
        best2 = min(best2, float(np.min(L2)))

        assert np.allclose(Y1, Y2)
        assert np.allclose(L1, L2)

    assert best1 < 5.0
