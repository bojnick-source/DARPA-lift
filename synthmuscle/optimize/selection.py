from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

import numpy as np


class SelectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class SelectionConfig:
    metric_key: str = "specific_power_w_per_kg_q50"
    infeasible_penalty: float = 1e9

    def validate(self) -> None:
        if not self.metric_key:
            raise SelectionError("metric_key must be non-empty.")
        p = float(self.infeasible_penalty)
        if not np.isfinite(p) or p <= 0:
            raise SelectionError("infeasible_penalty must be finite and > 0.")


def selection_score(agg: Mapping[str, Any], cfg: SelectionConfig = SelectionConfig()) -> float:
    cfg.validate()
    feasible = bool(agg.get("feasible", False))
    metrics = dict(agg.get("metrics", {}) or {})
    if (not feasible) or (cfg.metric_key not in metrics):
        return float(-cfg.infeasible_penalty)
    v = float(metrics[cfg.metric_key])
    if not np.isfinite(v):
        return float(-cfg.infeasible_penalty)
    return float(v)
