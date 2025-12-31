from __future__ import annotations

import importlib
import inspect
from typing import Any, Callable, Dict, Mapping, Optional, Sequence, Tuple

import numpy as np


def _find_any(mod, names: Sequence[str]) -> Optional[Any]:
    for n in names:
        if hasattr(mod, n):
            return getattr(mod, n)
    return None


def test_versioning_module_imports():
    v = importlib.import_module("synthmuscle.versioning")
    assert v is not None


def test_manifest_builder_exists():
    """
    Require a manifest builder and a deterministic hash function.
    Acceptable names:
      - build_manifest / create_manifest / make_manifest
      - manifest_hash / hash_manifest / stable_hash
    """
    v = importlib.import_module("synthmuscle.versioning")

    builder = _find_any(v, ("build_manifest", "create_manifest", "make_manifest"))
    hasher = _find_any(v, ("manifest_hash", "hash_manifest", "stable_hash"))

    assert builder is not None, (
        "synthmuscle.versioning missing manifest builder. "
        "Expected build_manifest/create_manifest/make_manifest."
    )
    assert hasher is not None, (
        "synthmuscle.versioning missing deterministic manifest hash. "
        "Expected manifest_hash/hash_manifest/stable_hash."
    )


def test_manifest_is_deterministic_for_same_inputs():
    """
    Same config/seed should produce identical manifest hash.
    If your builder requires different arguments, adjust this test to match the locked API.
    """
    v = importlib.import_module("synthmuscle.versioning")

    builder = _find_any(v, ("build_manifest", "create_manifest", "make_manifest"))
    hasher = _find_any(v, ("manifest_hash", "hash_manifest", "stable_hash"))
    assert builder is not None and hasher is not None

    # Best-effort invocation with common kwargs.
    def _call_builder(seed: int) -> Mapping[str, Any]:
        sig = inspect.signature(builder)
        kwargs: Dict[str, Any] = {}
        if "seed" in sig.parameters:
            kwargs["seed"] = int(seed)
        if "run_name" in sig.parameters:
            kwargs["run_name"] = "pytest_determinism"
        if "notes" in sig.parameters:
            kwargs["notes"] = {"why": "determinism_test"}
        if "config" in sig.parameters:
            # Try to use RunConfig if present, else pass None and let builder fail loudly.
            cfg_mod = importlib.import_module("synthmuscle.config")
            RunConfig = getattr(cfg_mod, "RunConfig", None)
            if RunConfig is None:
                raise AssertionError("synthmuscle.config.RunConfig missing; cannot build manifest deterministically.")
            # Construct minimal config (best-effort; expects defaults in RunConfig)
            cfg = RunConfig()  # type: ignore[call-arg]
            kwargs["config"] = cfg

        if kwargs:
            return builder(**kwargs)  # type: ignore[misc]
        # If builder takes no args, call directly
        return builder()  # type: ignore[misc]

    m1 = _call_builder(seed=123)
    m2 = _call_builder(seed=123)

    h1 = hasher(m1)  # type: ignore[misc]
    h2 = hasher(m2)  # type: ignore[misc]

    assert h1 == h2, "Manifest hash must be deterministic for identical inputs."


def test_replay_module_present_and_has_determinism_entrypoint():
    """
    Replay determinism is mandatory for this system.
    Expected synthmuscle.replay to provide one of:
      - replay_run / run_replay
      - compare_replays / mismatch_metrics / compute_mismatch
    """
    r = importlib.import_module("synthmuscle.replay")

    entry = _find_any(
        r,
        ("replay_run", "run_replay", "compare_replays", "mismatch_metrics", "compute_mismatch"),
    )
    assert entry is not None, (
        "synthmuscle.replay missing determinism/mismatch entrypoint. "
        "Expected replay_run/run_replay or compare_replays/mismatch_metrics/compute_mismatch."
    )


def test_picogk_topology_determinism_helper_exists():
    """
    Verification must include PicoGK geometry invariance check under replay.
    We require determinism_check(...) helper in synthmuscle.topology.picogk_hook.
    """
    topo = importlib.import_module("synthmuscle.topology.picogk_hook")
    det = getattr(topo, "determinism_check", None)
    assert callable(det), "Expected synthmuscle.topology.picogk_hook.determinism_check to exist."


def test_picogk_determinism_check_passes_with_dummy_backend():
    """
    Uses a deterministic dummy backend to verify the determinism gate itself works.
    """
    topo = importlib.import_module("synthmuscle.topology.picogk_hook")

    MaterialSpec = topo.MaterialSpec
    ManufacturingSpec = topo.ManufacturingSpec
    TopologySolveSpec = topo.TopologySolveSpec
    LoadCase = topo.LoadCase
    GeometryEnvelope = topo.GeometryEnvelope
    TopologyRequest = topo.TopologyRequest
    TopologyResult = topo.TopologyResult
    TopologyBackend = topo.TopologyBackend
    determinism_check = topo.determinism_check

    class DummyBackend(TopologyBackend):
        def run(self, request: topo.TopologyRequest) -> topo.TopologyResult:
            # Deterministic geometry params based solely on request hash
            h = request.request_hash()
            geom = {
                "part_id": request.envelope.part_id,
                "hash_prefix": h[:16],
                "bbox": {"min": list(request.envelope.bbox_min_m), "max": list(request.envelope.bbox_max_m)},
                "ports": dict(request.envelope.ports),
            }
            return TopologyResult(
                request_hash=h,
                seed=request.seed,
                geometry_params=geom,
                mass_kg_est=1.0,
                compliance_est=0.1,
                stress_peak_pa_est=1e6,
            )

    req = TopologyRequest(
        seed=7,
        envelope=GeometryEnvelope(
            part_id="test_part",
            bbox_min_m=(0.0, 0.0, 0.0),
            bbox_max_m=(0.1, 0.1, 0.1),
            ports={"A": {"pos_m": [0.02, 0.02, 0.02], "radius_m": 0.005}},
        ),
        material=MaterialSpec(name="Al7075", density_kg_m3=2810.0, E_pa=71e9, nu=0.33, yield_pa=500e6),
        manufacturing=ManufacturingSpec(process="additive", min_feature_m=0.001, min_thickness_m=0.001, max_overhang_deg=45.0),
        solve=TopologySolveSpec(volume_fraction=0.3, penalization=3.0, filter_radius_m=0.01, max_iters=10, convergence_tol=1e-3),
        loadcases=[LoadCase(name="lc1", fixed_nodes=["N0"], forces={"N1": [0.0, 0.0, -10.0]})],
        extra={"note": "pytest"},
    )

    out = determinism_check(request=req, backend=DummyBackend())
    assert out["ok"] is True
    assert isinstance(out["geometry_hash"], str) and len(out["geometry_hash"]) > 0
