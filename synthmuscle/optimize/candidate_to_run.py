from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional

from synthmuscle.optimize.param_bridge import BridgeResult, CandidateBridge, BridgeSpec


class CandidateToRunError(RuntimeError):
    pass


@dataclass(frozen=True)
class RunBundle:
    run_config: Dict[str, Any]
    geometry_params: Dict[str, float]
    meta: Dict[str, Any]


class CandidateToRun:
    def __init__(self, *, bridge_spec: BridgeSpec, base_config: Mapping[str, Any]):
        self.bridge = CandidateBridge(spec=bridge_spec)
        self.base_config = dict(base_config)

    def build(self, *, candidate: Mapping[str, Any], tag: Optional[str] = None) -> RunBundle:
        res: BridgeResult = self.bridge.apply(base_config=self.base_config, candidate=candidate)

        meta = {
            "design_hash": res.design_hash,
            "patched": res.patched,
            "tag": str(tag or ""),
        }

        return RunBundle(
            run_config=res.config,
            geometry_params=res.geometry_params,
            meta=meta,
        )
