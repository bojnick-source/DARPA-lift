from __future__ import annotations

import importlib
import inspect
from typing import Any, Callable, Optional, Sequence

import numpy as np


def _find_any_attr(mod, names: Sequence[str]) -> Optional[Any]:
    for n in names:
        if hasattr(mod, n):
            return getattr(mod, n)
    return None


def test_routing_module_imports():
    mod = importlib.import_module("synthmuscle.routing")
    assert mod is not None


def test_routing_has_planner_entrypoint():
    """
    We hard-fail if no routing entrypoint is present, because later fragments depend on it.
    Acceptable entrypoints (any one):
      - class: RoutingEngine / Router
      - function: route / plan_routes / compute_routes
    """
    routing = importlib.import_module("synthmuscle.routing")

    entry = _find_any_attr(
        routing,
        names=("RoutingEngine", "Router", "route", "plan_routes", "compute_routes", "build_routes"),
    )
    assert entry is not None, (
        "synthmuscle.routing missing a routing entrypoint. "
        "Expected RoutingEngine/Router class or route/plan_routes/compute_routes/build_routes function."
    )


def test_routing_has_bend_radius_hook():
    """
    Bend-radius checks are non-optional for tendon/fiber routing. We accept any of these:
      - min_bend_radius(...)
      - compute_min_bend_radius(...)
      - check_bend_radius(...)
      - bend_radius_ok(...)
    """
    routing = importlib.import_module("synthmuscle.routing")

    hook = _find_any_attr(
        routing,
        names=("min_bend_radius", "compute_min_bend_radius", "check_bend_radius", "bend_radius_ok"),
    )
    assert hook is not None, (
        "synthmuscle.routing missing bend-radius constraint hook. "
        "Expected one of: min_bend_radius / compute_min_bend_radius / check_bend_radius / bend_radius_ok."
    )


def test_bend_radius_hook_behaves_sanely_for_straight_line():
    """
    Straight polyline should have extremely large / infinite bend radius.
    This test is intentionally permissive (>= 1e6) to avoid overfitting implementation details.
    """
    routing = importlib.import_module("synthmuscle.routing")

    fn = _find_any_attr(routing, names=("min_bend_radius", "compute_min_bend_radius"))
    if fn is None:
        # If only boolean check exists, validate it returns True for straight line and reasonable min radius.
        ok_fn = _find_any_attr(routing, names=("bend_radius_ok", "check_bend_radius"))
        assert ok_fn is not None
        pts = np.array([[0.0, 0.0, 0.0],
                        [1.0, 0.0, 0.0],
                        [2.0, 0.0, 0.0]], dtype=float)
        sig = inspect.signature(ok_fn)
        kwargs = {}
        if "points" in sig.parameters:
            kwargs["points"] = pts
        else:
            # best-effort positional
            kwargs = {}
        # try common parameter name
        if "min_radius_m" in sig.parameters:
            kwargs["min_radius_m"] = 0.05
        elif "min_radius" in sig.parameters:
            kwargs["min_radius"] = 0.05

        res = ok_fn(**kwargs) if kwargs else ok_fn(pts, 0.05)  # type: ignore[misc]
        assert bool(res) is True
        return

    pts = np.array([[0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [2.0, 0.0, 0.0]], dtype=float)

    # Call with best-effort argument matching
    sig = inspect.signature(fn)
    if len(sig.parameters) == 1:
        r = fn(pts)  # type: ignore[misc]
    else:
        # common: (points, ...)
        r = fn(pts)  # type: ignore[misc]

    r = float(r)
    assert np.isfinite(r) or np.isinf(r)
    # accept inf, or huge value
    assert (np.isinf(r) or r >= 1e6), f"Straight line min bend radius should be huge/inf; got {r}"
