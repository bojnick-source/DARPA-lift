import numpy as np

from synthmuscle.optimize.opt_driver import DriverConfig, evaluate_candidate_mc
from synthmuscle.optimize.mc_batch_runner import MCBatchConfig
from synthmuscle.monte_carlo_gating import MCConfig
from synthmuscle.optimize.selection import SelectionConfig


def propose(seed: int):
    rng = np.random.default_rng(seed)
    return {"x": float(rng.normal()), "seed": int(seed)}


def eval_one(*, candidate, seed: int, sample=None):
    x = float(candidate["x"])
    sp = 200.0 + 10.0 * x + 0.01 * float(seed)

    return {
        "objective": float(-sp),
        "metrics": {
            "specific_power_w_per_kg": float(sp),
            "slip_rate": 0.0,
            "friction_margin_min": 10.0,
            "total_force_peak_n": 100.0,
            "normal_force_peak_n": 80.0,
            "temp_max_c": 40.0,
        },
        "constraints": {"ok": True},
    }


def test_evaluate_candidate_mc_is_deterministic():
    cand = propose(123)

    cfg = DriverConfig(
        mc=MCBatchConfig(n_rollouts=16, base_seed=1000),
        gating=MCConfig(quantile_set=(0.10, 0.50, 0.90), cvar_alpha=0.95),
        selection=SelectionConfig(metric_key="specific_power_w_per_kg_q50"),
    )

    r1 = evaluate_candidate_mc(cfg=cfg, candidate=cand, eval_one=eval_one, sample_fn=None)
    r2 = evaluate_candidate_mc(cfg=cfg, candidate=cand, eval_one=eval_one, sample_fn=None)

    assert r1["mc_n"] == 16
    assert r1["seeds"] == r2["seeds"]
    assert r1["score"] == r2["score"]
    assert r1["agg"]["metrics"] == r2["agg"]["metrics"]
    assert r1["feasible"] == r2["feasible"]
