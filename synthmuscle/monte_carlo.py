from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Sequence

import numpy as np

from synthmuscle.stats.risk_metrics import quantiles, cvar_upper_tail, wilson_ci


class MonteCarloError(RuntimeError):
    pass


@dataclass(frozen=True)
class AggregatedStats:
    n: int
    success_rate: float
    success_ci_lo: float
    success_ci_hi: float
    metrics: Dict[str, float]          # includes quantiles + cvars
    constraint_fail_rates: Dict[str, float]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "n": int(self.n),
            "success_rate": float(self.success_rate),
            "success_ci": [float(self.success_ci_lo), float(self.success_ci_hi)],
            "metrics": dict(self.metrics),
            "constraint_fail_rates": dict(self.constraint_fail_rates),
        }


def _require_mapping(x: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(x, Mapping):
        raise MonteCarloError(f"{name} must be a mapping.")
    return x


def aggregate_runs(
    runs: Sequence[Mapping[str, Any]],
    *,
    metric_keys: Sequence[str],
    success_key: str = "success",
    constraints_key: str = "constraints",
    cvar_alpha: float = 0.05,
) -> AggregatedStats:
    """
    Each run is expected to contain:
      - success (bool) OR omitted (treated as True)
      - metrics: dict[str, float] OR metrics flattened at top-level (we read from run["metrics"] if present)
      - constraints: dict[str,bool] (True pass, False violate) OR omitted
    """
    if not runs:
        raise MonteCarloError("aggregate_runs: runs must be non-empty.")

    n = len(runs)
    succ = 0

    # collect metrics vectors
    vecs: Dict[str, List[float]] = {k: [] for k in metric_keys}
    constraint_fails: Dict[str, int] = {}

    for r in runs:
        r = _require_mapping(r, "run")
        ok = bool(r.get(success_key, True))
        succ += 1 if ok else 0

        metrics = r.get("metrics", r)
        metrics = _require_mapping(metrics, "metrics")

        for k in metric_keys:
            if k not in metrics:
                raise MonteCarloError(f"aggregate_runs: missing metric '{k}' in a run.")
            v = float(metrics[k])
            if not np.isfinite(v):
                raise MonteCarloError(f"aggregate_runs: metric '{k}' non-finite.")
            vecs[k].append(v)

        cons = r.get(constraints_key, {}) or {}
        cons = _require_mapping(cons, "constraints")
        for ck, cv in cons.items():
            if not isinstance(cv, (bool, np.bool_)):
                raise MonteCarloError(f"constraint '{ck}' must be bool.")
            if not bool(cv):
                constraint_fails[ck] = constraint_fails.get(ck, 0) + 1

    success_rate = succ / n
    ci_lo, ci_hi = wilson_ci(succ, n)

    out_metrics: Dict[str, float] = {}
    for k, xs in vecs.items():
        qs = quantiles(xs, qs=(0.1, 0.5, 0.9))
        out_metrics[f"{k}_q10"] = qs["q10"]
        out_metrics[f"{k}_q50"] = qs["q50"]
        out_metrics[f"{k}_q90"] = qs["q90"]
        # upper-tail CVaR for “bad when large” metrics; caller should choose metric sign accordingly
        out_metrics[f"{k}_cvar95"] = cvar_upper_tail(xs, alpha=cvar_alpha)

    fail_rates = {k: v / n for k, v in constraint_fails.items()}

    return AggregatedStats(
        n=n,
        success_rate=float(success_rate),
        success_ci_lo=float(ci_lo),
        success_ci_hi=float(ci_hi),
        metrics=out_metrics,
        constraint_fail_rates=fail_rates,
    )


def run_monte_carlo(
    *,
    evaluate_once: Callable[[int], Mapping[str, Any]],
    seeds: Sequence[int],
) -> List[Mapping[str, Any]]:
    """
    Deterministic batch runner. evaluate_once(seed) must be deterministic given seed.
    """
    out: List[Mapping[str, Any]] = []
    for s in seeds:
        payload = evaluate_once(int(s))
        if not isinstance(payload, Mapping):
            raise MonteCarloError("evaluate_once must return a mapping.")
        out.append(payload)
    return out
