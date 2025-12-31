from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, List, Mapping, Optional, Tuple

import numpy as np


class MCBatchRunnerError(RuntimeError):
    pass


def _finite_int(x: int, name: str) -> int:
    xi = int(x)
    if xi <= 0:
        raise MCBatchRunnerError(f"{name} must be > 0.")
    return xi


def _finite_seed(x: int, name: str) -> int:
    xi = int(x)
    if xi < 0:
        raise MCBatchRunnerError(f"{name} must be >= 0.")
    return xi


@dataclass(frozen=True)
class MCBatchConfig:
    n_rollouts: int = 64
    base_seed: int = 0

    def validate(self) -> None:
        _finite_int(self.n_rollouts, "n_rollouts")
        _finite_seed(self.base_seed, "base_seed")


EvalOne = Callable[..., Mapping[str, Any]]
SampleFn = Callable[[int], Mapping[str, Any]]


def run_mc_batch(
    *,
    cfg: MCBatchConfig,
    candidate: Any,
    eval_one: EvalOne,
    sample_fn: Optional[SampleFn] = None,
) -> Tuple[List[Mapping[str, Any]], List[int]]:
    cfg.validate()

    payloads: List[Mapping[str, Any]] = []
    seeds: List[int] = []

    for i in range(int(cfg.n_rollouts)):
        seed = int(cfg.base_seed) + i
        seeds.append(seed)

        sample = dict(sample_fn(seed)) if sample_fn is not None else None

        p = eval_one(candidate=candidate, seed=seed, sample=sample)
        if not isinstance(p, Mapping):
            raise MCBatchRunnerError("eval_one must return a mapping payload.")
        if "metrics" not in p or "constraints" not in p or "objective" not in p:
            raise MCBatchRunnerError("payload missing required keys: objective/metrics/constraints.")

        payloads.append(p)

    return payloads, seeds
