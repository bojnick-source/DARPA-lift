from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict, Mapping, Optional

import numpy as np

from synthmuscle.optimize.param_space import ParamSpace
from synthmuscle.optimize.candidate_codec import CandidateCodec, BoxTransform
from synthmuscle.optimize.diag_cmaes import DiagCMAES, DiagCMAESConfig
from synthmuscle.optimize.opt_driver import DriverConfig, evaluate_candidate_mc


class CMAESLoopError(RuntimeError):
    pass


EvalOne = Callable[..., Mapping[str, Any]]
SampleFn = Callable[[int], Mapping[str, Any]]
LogFn = Callable[[Mapping[str, Any]], None]


@dataclass(frozen=True)
class CMAESLoopConfig:
    n_gens: int = 50
    stop_if_feasible_score_ge: Optional[float] = None

    def validate(self) -> None:
        g = int(self.n_gens)
        if g <= 0:
            raise CMAESLoopError("n_gens must be > 0.")
        if self.stop_if_feasible_score_ge is not None:
            th = float(self.stop_if_feasible_score_ge)
            if not np.isfinite(th):
                raise CMAESLoopError("stop_if_feasible_score_ge must be finite.")


def run_cmaes(
    *,
    loop_cfg: CMAESLoopConfig,
    driver_cfg: DriverConfig,
    space: ParamSpace,
    cma_cfg: DiagCMAESConfig,
    eval_one: EvalOne,
    sample_fn: Optional[SampleFn] = None,
    log_fn: Optional[LogFn] = None,
) -> Mapping[str, Any]:
    loop_cfg.validate()
    driver_cfg.validate()
    space.validate()
    cma_cfg.validate()

    lo, hi = space.bounds()
    transform = BoxTransform(lo=lo, hi=hi)
    codec = CandidateCodec(space=space, transform=transform, candidate_key="params")

    y0 = codec.y0()
    if y0.shape[0] != int(cma_cfg.n):
        raise CMAESLoopError("cma_cfg.n must match ParamSpace.dim")

    es = DiagCMAES(cfg=cma_cfg, m0=y0)

    best_score = -float("inf")
    best: Optional[Dict[str, Any]] = None
    history: list[Mapping[str, Any]] = []

    for gen in range(int(loop_cfg.n_gens)):
        Y = es.ask()
        losses = np.zeros((Y.shape[0],), dtype=float)

        gen_best = {"score": -float("inf"), "feasible": False, "record": None, "candidate": None}

        for i in range(Y.shape[0]):
            cand = codec.y_to_candidate(Y[i, :])

            rec = evaluate_candidate_mc(
                cfg=driver_cfg,
                candidate=cand,
                eval_one=eval_one,
                sample_fn=sample_fn,
            )
            score = float(rec["score"])
            feasible = bool(rec["feasible"])

            losses[i] = float(-score)

            if feasible and score > best_score:
                best_score = score
                best = {"candidate": cand, "record": rec}

            if feasible and score > float(gen_best["score"]):
                gen_best = {"score": score, "feasible": True, "record": rec, "candidate": cand}

            if log_fn is not None:
                log_fn(
                    {
                        "event": "cma_eval",
                        "gen": int(gen),
                        "i": int(i),
                        "score": float(score),
                        "feasible": bool(feasible),
                        "mc_n": int(rec.get("mc_n", 0)),
                        "seeds": list(rec.get("seeds", [])),
                    }
                )

        upd = es.tell(Y, losses)

        summary = {
            "event": "cma_gen",
            "gen": int(gen),
            "sigma": float(upd["sigma"]),
            "best_score_global": float(best_score),
            "best_score_gen": float(gen_best["score"]),
            "best_feasible_gen": bool(gen_best["feasible"]),
            "diagC_min": float(np.min(es.state.diagC)),
            "diagC_max": float(np.max(es.state.diagC)),
            **{k: float(v) for k, v in upd.items() if k != "gen"},
        }
        history.append(summary)
        if log_fn is not None:
            log_fn(summary)

        if loop_cfg.stop_if_feasible_score_ge is not None and best is not None:
            if float(best["record"]["score"]) >= float(loop_cfg.stop_if_feasible_score_ge):
                if log_fn is not None:
                    log_fn({"event": "cma_stop", "reason": "score_threshold", "gen": int(gen)})
                break

    if best is None:
        best_i = int(np.argmin(losses))
        cand = codec.y_to_candidate(Y[best_i, :])
        rec = evaluate_candidate_mc(cfg=driver_cfg, candidate=cand, eval_one=eval_one, sample_fn=sample_fn)
        best = {"candidate": cand, "record": rec}

    return {
        "best": best,
        "history": history,
        "final": {
            "gen": int(es.state.gen),
            "sigma": float(es.state.sigma),
            "diagC_min": float(np.min(es.state.diagC)),
            "diagC_max": float(np.max(es.state.diagC)),
        },
    }
