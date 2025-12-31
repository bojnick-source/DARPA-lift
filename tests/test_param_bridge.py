import copy
import pytest

from synthmuscle.optimize.param_bridge import BridgeSpec, ParamBinding, CandidateBridge


def test_bridge_apply_patches_without_mutating_base():
    base = {
        "morphology": {"leg": {"link_len_m": 0.50}},
        "routing": {"bend_radius_min_m": 0.02},
        "actuation": {"kpa_max": 600.0},
    }
    base0 = copy.deepcopy(base)

    spec = BridgeSpec(
        bindings=(
            ParamBinding(param_name="geom.leg.link_len_m", path="morphology.leg.link_len_m", dtype="float", clip_low=0.3, clip_high=1.0),
            ParamBinding(param_name="routing.bend_min", path="routing.bend_radius_min_m", dtype="float", clip_low=0.005, clip_high=0.2),
            ParamBinding(param_name="act.kpa_max", path="actuation.kpa_max", dtype="float", clip_low=100.0, clip_high=2000.0),
        ),
        geometry_prefixes=("geom.",),
    )

    bridge = CandidateBridge(spec=spec)
    cand = {"params": {"geom.leg.link_len_m": 0.9, "routing.bend_min": 0.03, "act.kpa_max": 800.0}}
    res = bridge.apply(base_config=base, candidate=cand)

    assert base == base0
    assert res.config["morphology"]["leg"]["link_len_m"] == 0.9
    assert res.config["routing"]["bend_radius_min_m"] == 0.03
    assert res.config["actuation"]["kpa_max"] == 800.0
    assert "geom.leg.link_len_m" in res.geometry_params
    assert "routing.bend_min" not in res.geometry_params
    assert "act.kpa_max" not in res.geometry_params


def test_bridge_fail_closed_on_missing_param_or_path():
    base = {"a": {"b": 1.0}}
    spec = BridgeSpec(bindings=(ParamBinding(param_name="x", path="a.b", dtype="float"),))
    bridge = CandidateBridge(spec=spec)

    with pytest.raises(Exception):
        bridge.apply(base_config=base, candidate={"params": {}})

    spec2 = BridgeSpec(bindings=(ParamBinding(param_name="x", path="a.missing", dtype="float"),))
    bridge2 = CandidateBridge(spec=spec2)

    with pytest.raises(Exception):
        bridge2.apply(base_config=base, candidate={"params": {"x": 2.0}})


def test_design_hash_changes_with_patch():
    base = {"a": {"b": 1.0}}
    spec = BridgeSpec(bindings=(ParamBinding(param_name="geom.x", path="a.b", dtype="float"),), geometry_prefixes=("geom.",))
    bridge = CandidateBridge(spec=spec)

    r1 = bridge.apply(base_config=base, candidate={"params": {"geom.x": 2.0}})
    r2 = bridge.apply(base_config=base, candidate={"params": {"geom.x": 3.0}})

    assert r1.design_hash != r2.design_hash
