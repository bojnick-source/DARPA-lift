from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping, Optional, Tuple

from synthmuscle.monte_carlo_gating import MCConfig, aggregate_payloads
from synthmuscle.optimize.selection import SelectionConfig, selection_score
from synthmuscle.optimize.mc_batch_runner import MCBatchConfig, run_mc_batch


class OptDriverError(RuntimeError):
    pass


EvalOne = Callable[..., Mapping[str, Any]]
SampleFn = Callable[[int], Mapping[str, Any]]


@dataclass(frozen=True)
class DriverConfig:
    mc: MCBatchConfig
    gating: MCConfig
    selection: SelectionConfig
    metric_keys: Tuple[str, ...] = (
        "specific_power_w_per_kg",
        "slip_rate",
        "friction_margin_min",
        "total_force_peak_n",
        "normal_force_peak_n",
        "temp_max_c",
    )

    def validate(self) -> None:
        self.mc.validate()
        self.gating.validate()
        self.selection.validate()
        if not self.metric_keys:
            raise OptDriverError("metric_keys must be non-empty.")


def evaluate_candidate_mc(
    *,
    cfg: DriverConfig,
    candidate: Any,
    eval_one: EvalOne,
    sample_fn: Optional[SampleFn] = None,
) -> Mapping[str, Any]:
    cfg.validate()

    payloads, seeds = run_mc_batch(cfg=cfg.mc, candidate=candidate, eval_one=eval_one, sample_fn=sample_fn)

    agg = aggregate_payloads(cfg=cfg.gating, payloads=payloads, metric_keys=list(cfg.metric_keys))
    score = selection_score(agg, cfg=cfg.selection)

    return {
        "score": float(score),
        "feasible": bool(agg.get("feasible", False)),
        "seeds": list(seeds),
        "agg": agg,
        "mc_n": int(len(seeds)),
    }
