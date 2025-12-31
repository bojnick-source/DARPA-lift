from synthmuscle.pipeline.power_rollout_glue import merge_extra_metrics
import numpy as np


def test_merge_extra_metrics_filters_nonfinite():
    a = {"temp_max_c": 50.0, "x": float("inf")}
    b = {"y": "nope", "z": -3.0}
    out = merge_extra_metrics(a, b)

    assert out["temp_max_c"] == 50.0
    assert "x" not in out
    assert out["z"] == -3.0
    assert "y" not in out
