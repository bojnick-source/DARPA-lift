from __future__ import annotations

import json
import hashlib
from typing import Any, Dict, Optional

from synthmuscle.config import RunConfig


def stable_hash(obj: Any) -> str:
    def _default(o: Any):
        if hasattr(o, "__dict__"):
            return o.__dict__
        return str(o)

    s = json.dumps(obj, sort_keys=True, default=_default, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def manifest_hash(manifest: Any) -> str:
    return stable_hash(manifest)


def build_manifest(*, seed: int = 0, run_name: Optional[str] = None, notes: Optional[Dict[str, Any]] = None, config: Optional[RunConfig] = None) -> Dict[str, Any]:
    cfg = config or RunConfig(seed=seed, notes=notes or {})
    manifest = {
        "seed": int(seed),
        "run_name": run_name or "run",
        "config": cfg.__dict__,
        "notes": notes or {},
    }
    manifest["hash"] = manifest_hash(manifest)
    return manifest


def create_manifest(**kwargs: Any) -> Dict[str, Any]:
    return build_manifest(**kwargs)


def make_manifest(**kwargs: Any) -> Dict[str, Any]:
    return build_manifest(**kwargs)
