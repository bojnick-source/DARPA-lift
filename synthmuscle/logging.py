from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
import json
import hashlib
import time
from pathlib import Path

import numpy as np


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_json(obj: Any) -> str:
    return sha256_bytes(_json_dumps(obj).encode("utf-8"))


@dataclass(frozen=True)
class RunMeta:
    project: str
    run_id: str
    created_unix_s: float
    git_commit: Optional[str] = None
    schema_version: str = "0.1.0"


@dataclass
class StepLog:
    t: float
    obs: List[float]
    action: List[float]
    reward: float
    done: bool
    info: Dict[str, Any]


@dataclass
class EpisodeLog:
    steps: List[StepLog]


@dataclass
class RunLog:
    meta: RunMeta
    config: Dict[str, Any]
    episodes: List[EpisodeLog]
    notes: Dict[str, str]


class JsonlWriter:
    """
    Efficient replay log.
    Writes one JSON per step. Stores header separately.
    """

    def __init__(self, out_dir: str | Path, run_id: str) -> None:
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.run_id = str(run_id)
        self.path_steps = self.out_dir / f"{self.run_id}.steps.jsonl"
        self.path_header = self.out_dir / f"{self.run_id}.header.json"
        self._f = open(self.path_steps, "w", encoding="utf-8")

    def write_header(self, header: Dict[str, Any]) -> None:
        self.path_header.write_text(_json_dumps(header), encoding="utf-8")

    def write_step(self, step: StepLog) -> None:
        self._f.write(_json_dumps(asdict(step)) + "\n")

    def close(self) -> None:
        try:
            self._f.flush()
        finally:
            self._f.close()


def make_run_id(prefix: str = "run") -> str:
    # Stable enough locally without external deps
    ts = int(time.time() * 1000)
    rnd = sha256_bytes(f"{ts}-{time.time_ns()}".encode("utf-8"))[:10]
    return f"{prefix}_{ts}_{rnd}"


def save_runlog_json(out_path: str | Path, runlog: RunLog) -> str:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = asdict(runlog)
    text = _json_dumps(payload)
    out_path.write_text(text, encoding="utf-8")
    return sha256_bytes(text.encode("utf-8"))


def load_jsonl_steps(path: str | Path) -> List[StepLog]:
    path = Path(path)
    steps: List[StepLog] = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            d = json.loads(line)
            steps.append(
                StepLog(
                    t=float(d["t"]),
                    obs=list(map(float, d["obs"])),
                    action=list(map(float, d["action"])),
                    reward=float(d["reward"]),
                    done=bool(d["done"]),
                    info=dict(d.get("info", {})),
                )
            )
    return steps


def to_float_list(x: Any) -> List[float]:
    a = np.asarray(x, dtype=float).ravel()
    return [float(v) for v in a.tolist()]


# Optimizer logging helper (append-only)
def make_log_fn(logger):
    """
    Returns a function log_fn(event_dict) that calls logger.log_event(event_dict)
    if present, else logger.write(event_dict) if present.
    """

    def _log(ev):
        if hasattr(logger, "log_event"):
            return logger.log_event(ev)
        if hasattr(logger, "write"):
            return logger.write(ev)
        raise AttributeError("Logger must implement log_event(...) or write(...).")

    return _log
