import numpy as np

from synthmuscle.monte_carlo_gating import MCConfig, GateSpec, aggregate_payloads


def _payload(sp, slip, fmin, tf, nf, tmax, constraints_ok=True):
    return {
        "objective": float(-sp),
        "metrics": {
            "specific_power_w_per_kg": float(sp),
            "slip_rate": float(slip),
            "friction_margin_min": float(fmin),
            "total_force_peak_n": float(tf),
            "normal_force_peak_n": float(nf),
            "temp_max_c": float(tmax),
        },
        "constraints": {"ok": bool(constraints_ok)},
    }


def test_aggregate_payloads_keys_present():
    payloads = [
        _payload(200, 0.0, 10, 100, 80, 40, True),
        _payload(210, 0.01, 9, 110, 85, 45, True),
        _payload(190, 0.02, 8, 120, 90, 50, True),
    ]

    cfg = MCConfig(quantile_set=(0.10, 0.50, 0.90), cvar_alpha=0.95, dist_gates=(), require_all_constraints_true=True)

    agg = aggregate_payloads(
        cfg=cfg,
        payloads=payloads,
        metric_keys=[
            "specific_power_w_per_kg",
            "slip_rate",
            "friction_margin_min",
            "total_force_peak_n",
            "normal_force_peak_n",
            "temp_max_c",
        ],
    )

    assert agg["n"] == 3
    assert "specific_power_w_per_kg_q50" in agg["metrics"]
    assert "slip_rate_cvar_upper_95" in agg["metrics"]
    assert "temp_max_c_mean" in agg["metrics"]
    assert isinstance(agg["feasible"], bool)


def test_distribution_gate_example():
    payloads = [
        _payload(200, 0.0, 10, 100, 80, 40, True),
        _payload(210, 0.00, 9, 110, 85, 45, True),
        _payload(190, 0.00, 8, 120, 90, 50, True),
    ]

    gates = (
        GateSpec(metric="specific_power_w_per_kg", kind="quantile", op=">=", threshold=180.0, q=0.10),
    )
    cfg = MCConfig(quantile_set=(0.10, 0.50, 0.90), cvar_alpha=0.95, dist_gates=gates, require_all_constraints_true=True)

    agg = aggregate_payloads(
        cfg=cfg,
        payloads=payloads,
        metric_keys=["specific_power_w_per_kg"],
    )

    assert agg["constraints"]["dist_gates_ok"] is True
    assert agg["feasible"] is True
