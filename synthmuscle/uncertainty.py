from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple, Union

import numpy as np


class UncertaintyError(RuntimeError):
    pass


@dataclass(frozen=True)
class RNGSpec:
    """
    Deterministic RNG spec for replay/manifests.
    """

    seed: int = 0

    def rng(self) -> np.random.Generator:
        return np.random.default_rng(int(self.seed))


@dataclass(frozen=True)
class ScalarDist:
    """
    Deterministic scalar distribution spec.
    Supported:
      - kind="uniform": params (low, high)
      - kind="normal": params (mean, std) with hard clip (min, max) optional
      - kind="loguniform": params (low, high) in linear space
    """

    kind: str
    a: float
    b: float
    clip_min: Optional[float] = None
    clip_max: Optional[float] = None

    def sample(self, rng: np.random.Generator, size: Optional[int] = None) -> np.ndarray:
        k = self.kind.lower().strip()
        if k == "uniform":
            x = rng.uniform(self.a, self.b, size=size)
        elif k == "normal":
            x = rng.normal(self.a, self.b, size=size)
        elif k == "loguniform":
            # sample uniform in log-space
            if self.a <= 0 or self.b <= 0:
                raise UncertaintyError("loguniform requires a,b > 0")
            lo = np.log(self.a)
            hi = np.log(self.b)
            x = np.exp(rng.uniform(lo, hi, size=size))
        else:
            raise UncertaintyError(f"Unsupported dist kind: {self.kind}")

        if self.clip_min is not None:
            x = np.maximum(x, self.clip_min)
        if self.clip_max is not None:
            x = np.minimum(x, self.clip_max)
        return np.asarray(x, dtype=float)


@dataclass(frozen=True)
class DomainRandomizationSpec:
    """
    Production-grade, contact-focused randomization knobs.
    All fields are deterministic distributions; sampling produces a single trial dict.

    Keys are chosen to map cleanly into MuJoCo adapter hooks (Fragment 10),
    and into task metrics aggregation (Fragment 18).
    """

    # Contact / ground
    friction: ScalarDist = field(default_factory=lambda: ScalarDist("uniform", 0.6, 1.4))
    torsional_friction: ScalarDist = field(default_factory=lambda: ScalarDist("uniform", 0.0, 0.02))
    rolling_friction: ScalarDist = field(default_factory=lambda: ScalarDist("uniform", 0.0, 0.01))

    ground_stiffness: ScalarDist = field(default_factory=lambda: ScalarDist("loguniform", 5e4, 5e6))
    ground_damping: ScalarDist = field(default_factory=lambda: ScalarDist("loguniform", 1e2, 1e4))

    # Mass & inertia drift (sim optimism killer)
    mass_scale: ScalarDist = field(default_factory=lambda: ScalarDist("normal", 1.0, 0.03, 0.90, 1.10))
    inertia_scale: ScalarDist = field(default_factory=lambda: ScalarDist("normal", 1.0, 0.06, 0.80, 1.20))

    # Actuation imperfections
    motor_strength_scale: ScalarDist = field(default_factory=lambda: ScalarDist("normal", 1.0, 0.05, 0.85, 1.15))
    joint_damping_scale: ScalarDist = field(default_factory=lambda: ScalarDist("loguniform", 0.5, 2.0))

    # Latency / sensing
    control_latency_s: ScalarDist = field(default_factory=lambda: ScalarDist("uniform", 0.0, 0.020))
    sensor_noise_scale: ScalarDist = field(default_factory=lambda: ScalarDist("loguniform", 0.3, 3.0))

    # Environment
    gravity_scale: ScalarDist = field(default_factory=lambda: ScalarDist("normal", 1.0, 0.005, 0.98, 1.02))

    def sample_trial(self, rng: np.random.Generator) -> Dict[str, float]:
        """
        Sample one trial parameter set. All values are floats.
        """
        return {
            "friction": float(self.friction.sample(rng)),
            "torsional_friction": float(self.torsional_friction.sample(rng)),
            "rolling_friction": float(self.rolling_friction.sample(rng)),
            "ground_stiffness": float(self.ground_stiffness.sample(rng)),
            "ground_damping": float(self.ground_damping.sample(rng)),
            "mass_scale": float(self.mass_scale.sample(rng)),
            "inertia_scale": float(self.inertia_scale.sample(rng)),
            "motor_strength_scale": float(self.motor_strength_scale.sample(rng)),
            "joint_damping_scale": float(self.joint_damping_scale.sample(rng)),
            "control_latency_s": float(self.control_latency_s.sample(rng)),
            "sensor_noise_scale": float(self.sensor_noise_scale.sample(rng)),
            "gravity_scale": float(self.gravity_scale.sample(rng)),
        }

    def to_dict(self) -> Dict[str, Any]:
        # For manifests
        return asdict(self)


@dataclass(frozen=True)
class DriftModel:
    """
    Deterministic per-episode drift model (slow changes) — separate from per-trial randomization.
    """

    mass_drift_per_s: float = 0.0
    friction_drift_per_s: float = 0.0

    def apply(self, base: Dict[str, float], t: float) -> Dict[str, float]:
        out = dict(base)
        out["mass_scale"] = float(out["mass_scale"] * (1.0 + self.mass_drift_per_s * t))
        out["friction"] = float(out["friction"] * (1.0 + self.friction_drift_per_s * t))
        return out
