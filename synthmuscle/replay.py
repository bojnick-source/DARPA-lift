from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence, Tuple
from pathlib import Path
import numpy as np

from .logging import load_jsonl_steps
from .sim.base import SimEnv, StepResult


@dataclass(frozen=True)
class ReplayResult:
    steps: int
    total_reward: float
    mismatch_l2: float


def replay_episode(
    env: SimEnv,
    steps_path: str | Path,
    seed: Optional[int] = None,
    atol: float = 1e-6,
) -> ReplayResult:
    """
    Replays recorded actions and compares observations.

    mismatch_l2 is the RMS difference between recorded obs and replayed obs.
    Determinism requires fixed seeds and deterministic simulator settings.
    """
    rec = load_jsonl_steps(steps_path)
    obs = env.reset(seed=seed)

    total_reward = 0.0
    err_acc = 0.0
    count = 0

    for s in rec:
        a = np.asarray(s.action, dtype=float)
        r: StepResult = env.step(a)
        total_reward += float(r.reward)

        obs_rec = np.asarray(s.obs, dtype=float)
        obs_now = np.asarray(r.obs, dtype=float)
        if obs_rec.shape == obs_now.shape:
            d = obs_now - obs_rec
            err_acc += float(np.dot(d, d))
            count += d.size

        if bool(r.done):
            break

    mismatch = float(np.sqrt(err_acc / max(1, count)))
    return ReplayResult(steps=len(rec), total_reward=float(total_reward), mismatch_l2=mismatch)


# ==========================================
# Patchset P1 (HARDENED)
# Add required determinism/mismatch entrypoints as aliases (no behavior change).
# ==========================================
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple


def _pick_existing(name_candidates: Sequence[str]):
    g = globals()
    for n in name_candidates:
        if n in g and callable(g[n]):
            return g[n]
    return None


_existing_compare = _pick_existing(
    ("compare", "compare_runs", "compare_replay", "compare_replays", "mismatch_metrics", "compute_mismatch")
)
_existing_replay = _pick_existing(("replay", "run", "run_replay", "replay_run"))


if "mismatch_metrics" not in globals():
    def mismatch_metrics(*args: Any, **kwargs: Any) -> Any:
        fn = _existing_compare
        if fn is None:
            raise RuntimeError("No replay mismatch function found. Expected compare_replays/mismatch_metrics/compute_mismatch.")
        return fn(*args, **kwargs)


if "compute_mismatch" not in globals():
    def compute_mismatch(*args: Any, **kwargs: Any) -> Any:
        return mismatch_metrics(*args, **kwargs)


if "compare_replays" not in globals():
    def compare_replays(*args: Any, **kwargs: Any) -> Any:
        return mismatch_metrics(*args, **kwargs)


if "run_replay" not in globals():
    def run_replay(*args: Any, **kwargs: Any) -> Any:
        fn = _existing_replay
        if fn is None:
            raise RuntimeError("No replay runner found. Expected replay_run/run_replay.")
        return fn(*args, **kwargs)


if "replay_run" not in globals():
    def replay_run(*args: Any, **kwargs: Any) -> Any:
        return run_replay(*args, **kwargs)
