from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional, Tuple

import hashlib
import json
import numpy as np

from synthmuscle.utils.dict_path import deep_copy, get_path, set_path


class ParamBridgeError(RuntimeError):
    pass


def _fs(x: Any, name: str) -> float:
    try:
        v = float(x)
    except Exception as e:
        raise ParamBridgeError(f"{name} must be numeric: {e}") from e
    if not np.isfinite(v):
        raise ParamBridgeError(f"{name} must be finite.")
    return v


def _cast(v: float, dtype: str) -> Any:
    if dtype == "float":
        return float(v)
    if dtype == "int":
        iv = int(round(v))
        return int(iv)
    if dtype == "bool":
        return bool(v >= 0.5)
    raise ParamBridgeError(f"Unsupported dtype '{dtype}'.")


@dataclass(frozen=True)
class ParamBinding:
    param_name: str
    path: str
    dtype: str = "float"
    scale: float = 1.0
    offset: float = 0.0
    clip_low: Optional[float] = None
    clip_high: Optional[float] = None

    def validate(self) -> None:
        if not self.param_name:
            raise ParamBridgeError("ParamBinding.param_name must be non-empty.")
        if not self.path:
            raise ParamBridgeError("ParamBinding.path must be non-empty.")
        if self.dtype not in ("float", "int", "bool"):
            raise ParamBridgeError("ParamBinding.dtype must be float|int|bool.")
        _fs(self.scale, "scale")
        _fs(self.offset, "offset")
        if self.clip_low is not None:
            _fs(self.clip_low, "clip_low")
        if self.clip_high is not None:
            _fs(self.clip_high, "clip_high")
        if (self.clip_low is not None) and (self.clip_high is not None):
            if float(self.clip_low) > float(self.clip_high):
                raise ParamBridgeError("clip_low must be <= clip_high.")


@dataclass(frozen=True)
class BridgeSpec:
    bindings: Tuple[ParamBinding, ...]
    geometry_prefixes: Tuple[str, ...] = ("geom.", "geo.", "pico.")

    def validate(self) -> None:
        if not self.bindings:
            raise ParamBridgeError("BridgeSpec.bindings must be non-empty.")
        names = [b.param_name for b in self.bindings]
        if len(set(names)) != len(names):
            raise ParamBridgeError("BridgeSpec param_name values must be unique.")
        paths = [b.path for b in self.bindings]
        if len(set(paths)) != len(paths):
            raise ParamBridgeError("BridgeSpec paths must be unique.")
        for b in self.bindings:
            b.validate()
        for p in self.geometry_prefixes:
            if not isinstance(p, str) or p == "":
                raise ParamBridgeError("geometry_prefixes must be non-empty strings.")


def _stable_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def design_hash(payload: Mapping[str, Any]) -> str:
    h = hashlib.sha256(_stable_json(payload).encode("utf-8")).hexdigest()
    return str(h)


@dataclass(frozen=True)
class BridgeResult:
    config: Dict[str, Any]
    geometry_params: Dict[str, float]
    patched: Dict[str, Any]
    design_hash: str


class CandidateBridge:
    def __init__(self, *, spec: BridgeSpec):
        spec.validate()
        self.spec = spec

    def apply(self, *, base_config: Mapping[str, Any], candidate: Mapping[str, Any]) -> BridgeResult:
        if "params" not in candidate:
            raise ParamBridgeError("candidate must contain key 'params'.")
        params = candidate["params"]
        if not isinstance(params, Mapping):
            raise ParamBridgeError("candidate['params'] must be a mapping.")

        cfg = deep_copy(dict(base_config))

        patched: Dict[str, Any] = {}
        geometry_params: Dict[str, float] = {}

        for b in self.spec.bindings:
            b.validate()
            if b.param_name not in params:
                raise ParamBridgeError(f"Missing candidate param '{b.param_name}'.")
            raw = _fs(params[b.param_name], b.param_name)
            val = raw * float(b.scale) + float(b.offset)

            if b.clip_low is not None:
                val = max(val, float(b.clip_low))
            if b.clip_high is not None:
                val = min(val, float(b.clip_high))

            casted = _cast(val, b.dtype)

            _ = get_path(cfg, b.path)
            set_path(cfg, b.path, casted, create=False)

            patched[b.path] = casted

            if any(b.param_name.startswith(pref) for pref in self.spec.geometry_prefixes):
                if b.dtype == "bool":
                    geometry_params[b.param_name] = 1.0 if bool(casted) else 0.0
                else:
                    geometry_params[b.param_name] = float(casted)

        dh = design_hash({"patched": patched, "geometry_params": geometry_params})

        return BridgeResult(
            config=cfg,
            geometry_params=dict(sorted(geometry_params.items(), key=lambda kv: kv[0])),
            patched=dict(sorted(patched.items(), key=lambda kv: kv[0])),
            design_hash=dh,
        )
