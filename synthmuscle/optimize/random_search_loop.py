from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional

import numpy as np

from synthmuscle.optimize.opt_driver import DriverConfig, evaluate_candidate_mc


class RandomSearchError(RuntimeError):
    pass


ProposeFn = Callable[[int], Any]
EvalOne = Callable[..., Mapping[str, Any]]
SampleFn = Callable[[int], Mapping[str, Any]]
LogFn = Callable[[Mapping[str, Any]], None]


@dataclass(frozen=True)
class RandomSearchConfig:
    n_candidates: int = 50
    base_seed: int = 0

    def validate(self) -> None:
        n = int(self.n_candidates)
        if n <= 0:
            raise RandomSearchError("n_candidates must be > 0.")
        s = int(self.base_seed)
        if s < 0:
            raise RandomSearchError("base_seed must be >= 0.")


def random_search(
    *,
    cfg: RandomSearchConfig,
    driver_cfg: DriverConfig,
    propose: ProposeFn,
    eval_one: EvalOne,
    sample_fn: Optional[SampleFn] = None,
    log_fn: Optional[LogFn] = None,
) -> Mapping[str, Any]:
    cfg.validate()
    driver_cfg.validate()

    best_score = -float("inf")
    best: Optional[Dict[str, Any]] = None
    history: List[Mapping[str, Any]] = []

    for i in range(int(cfg.n_candidates)):
        cand_seed = int(cfg.base_seed) + i
        candidate = propose(cand_seed)

        rec = dict(
            evaluate_candidate_mc(
                cfg=driver_cfg,
                candidate=candidate,
                eval_one=eval_one,
                sample_fn=sample_fn,
            )
        )
        rec["candidate_seed"] = int(cand_seed)
        rec["candidate_index"] = int(i)

        history.append(rec)

        if log_fn is not None:
            log_fn({"event": "candidate_eval", **rec})

        feasible = bool(rec.get("feasible", False))
        score = float(rec.get("score", -float("inf")))
        if feasible and score > best_score:
            best_score = score
            best = {"candidate": candidate, "record": rec}
            if log_fn is not None:
                log_fn({"event": "best_update", "score": best_score, "candidate_seed": cand_seed, "candidate_index": i})

    if best is None:
        top = max(history, key=lambda r: float(r.get("score", -float("inf"))))
        best = {"candidate": propose(int(top["candidate_seed"])), "record": top}

    return {"best": best, "history": history}
