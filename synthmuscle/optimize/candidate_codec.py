from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping

import numpy as np

from synthmuscle.optimize.param_space import ParamSpace


class CandidateCodecError(RuntimeError):
    pass


def _finite_vec(x: np.ndarray, name: str) -> np.ndarray:
    v = np.asarray(x, dtype=float).reshape(-1)
    if not np.all(np.isfinite(v)):
        raise CandidateCodecError(f"{name} contains non-finite values.")
    return v


def _sigmoid(z: np.ndarray) -> np.ndarray:
    z = np.asarray(z, dtype=float)
    out = np.empty_like(z, dtype=float)
    pos = z >= 0
    neg = ~pos
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    ez = np.exp(z[neg])
    out[neg] = ez / (1.0 + ez)
    return out


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.asarray(p, dtype=float)
    eps = 1e-12
    p = np.clip(p, eps, 1.0 - eps)
    return np.log(p / (1.0 - p))


@dataclass(frozen=True)
class BoxTransform:
    lo: np.ndarray
    hi: np.ndarray

    def validate(self) -> None:
        lo = np.asarray(self.lo, dtype=float).reshape(-1)
        hi = np.asarray(self.hi, dtype=float).reshape(-1)
        if lo.shape != hi.shape:
            raise CandidateCodecError("BoxTransform lo/hi shape mismatch.")
        if not np.all(np.isfinite(lo)) or not np.all(np.isfinite(hi)):
            raise CandidateCodecError("BoxTransform lo/hi must be finite.")
        if np.any(lo >= hi):
            raise CandidateCodecError("BoxTransform requires lo < hi elementwise.")

    def forward(self, y: np.ndarray) -> np.ndarray:
        self.validate()
        y = np.asarray(y, dtype=float).reshape(-1)
        if y.shape != self.lo.reshape(-1).shape:
            raise CandidateCodecError("BoxTransform.forward input dim mismatch.")
        s = _sigmoid(y)
        return self.lo + (self.hi - self.lo) * s

    def inverse(self, x: np.ndarray) -> np.ndarray:
        self.validate()
        x = np.asarray(x, dtype=float).reshape(-1)
        if x.shape != self.lo.reshape(-1).shape:
            raise CandidateCodecError("BoxTransform.inverse input dim mismatch.")
        p = (x - self.lo) / (self.hi - self.lo)
        return _logit(p)


@dataclass(frozen=True)
class CandidateCodec:
    space: ParamSpace
    transform: BoxTransform
    candidate_key: str = "params"

    def __post_init__(self) -> None:
        self.space.validate()
        self.transform.validate()
        lo, _ = self.space.bounds()
        if lo.shape != self.transform.lo.reshape(-1).shape:
            raise CandidateCodecError("Transform bounds must match ParamSpace dim.")
        if not self.candidate_key:
            raise CandidateCodecError("candidate_key must be non-empty.")

    def y0(self) -> np.ndarray:
        x0 = self.space.init_x()
        return self.transform.inverse(x0)

    def y_to_candidate(self, y: np.ndarray) -> Mapping[str, Any]:
        y = _finite_vec(y, "y")
        x = self.transform.forward(y)
        d: Dict[str, float] = {}
        for i, spec in enumerate(self.space.specs):
            d[spec.name] = float(x[i])
        return {self.candidate_key: d}

    def candidate_to_y(self, candidate: Mapping[str, Any]) -> np.ndarray:
        if self.candidate_key not in candidate:
            raise CandidateCodecError(f"candidate missing key '{self.candidate_key}'.")
        params = candidate[self.candidate_key]
        if not isinstance(params, Mapping):
            raise CandidateCodecError("candidate params must be a mapping.")
        x = np.zeros((self.space.dim,), dtype=float)
        for i, spec in enumerate(self.space.specs):
            if spec.name not in params:
                raise CandidateCodecError(f"candidate params missing '{spec.name}'.")
            x[i] = float(params[spec.name])
        if not np.all(np.isfinite(x)):
            raise CandidateCodecError("candidate params contain non-finite values.")
        return self.transform.inverse(x)
