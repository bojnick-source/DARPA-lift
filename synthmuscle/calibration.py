from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple
import numpy as np


@dataclass(frozen=True)
class EncoderCal:
    """
    Simple linear encoder calibration:
      q_true = scale * (q_raw - offset)
    """

    offset: float = 0.0
    scale: float = 1.0

    def apply(self, q_raw: float) -> float:
        return float(self.scale * (float(q_raw) - float(self.offset)))


@dataclass(frozen=True)
class ImuBias:
    """
    IMU bias model for accel and gyro.
    """

    accel_bias: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    gyro_bias: Tuple[float, float, float] = (0.0, 0.0, 0.0)

    def apply(self, accel_raw: np.ndarray, gyro_raw: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        ab = np.asarray(self.accel_bias, dtype=float)
        gb = np.asarray(self.gyro_bias, dtype=float)
        return np.asarray(accel_raw, dtype=float) - ab, np.asarray(gyro_raw, dtype=float) - gb


@dataclass
class DriftMonitor:
    """
    Tracks slow drift. If the signal mean deviates beyond threshold, flag.
    """

    window: int = 500
    thresh: float = 0.05

    _buf: Optional[np.ndarray] = None
    _idx: int = 0
    _filled: bool = False

    def update(self, x: float) -> bool:
        x = float(x)
        if self.window <= 2:
            raise ValueError("window must be > 2")
        if self._buf is None:
            self._buf = np.zeros((self.window,), dtype=float)

        self._buf[self._idx] = x
        self._idx = (self._idx + 1) % self.window
        if self._idx == 0:
            self._filled = True

        if not self._filled:
            return False

        mu = float(np.mean(self._buf))
        return abs(mu) > float(self.thresh)


def estimate_encoder_zero(samples: np.ndarray) -> EncoderCal:
    """
    Assume robot is in known pose where true q = 0 for this joint.
    Estimate offset as mean of raw samples.
    """
    s = np.asarray(samples, dtype=float).ravel()
    if s.size < 10:
        raise ValueError("Need at least 10 samples for zero estimation")
    return EncoderCal(offset=float(np.mean(s)), scale=1.0)


def estimate_imu_bias(accel_samples: np.ndarray, gyro_samples: np.ndarray) -> ImuBias:
    """
    Estimate IMU bias from stationary samples.
    accel bias: mean accel minus gravity direction is not resolved here. We only remove mean.
    gyro bias: mean gyro should be near 0 when stationary.
    """
    a = np.asarray(accel_samples, dtype=float)
    g = np.asarray(gyro_samples, dtype=float)
    if a.ndim != 2 or a.shape[1] != 3:
        raise ValueError("accel_samples must have shape (N,3)")
    if g.ndim != 2 or g.shape[1] != 3:
        raise ValueError("gyro_samples must have shape (N,3)")
    if a.shape[0] < 50 or g.shape[0] < 50:
        raise ValueError("Need at least 50 samples for bias estimation")

    accel_bias = tuple(np.mean(a, axis=0).astype(float).tolist())
    gyro_bias = tuple(np.mean(g, axis=0).astype(float).tolist())
    return ImuBias(accel_bias=accel_bias, gyro_bias=gyro_bias)


@dataclass
class CalibrationBundle:
    encoders: Dict[str, EncoderCal]
    imu: Optional[ImuBias] = None

    def apply_encoder(self, joint_id: str, q_raw: float) -> float:
        if joint_id not in self.encoders:
            raise KeyError(f"No encoder calibration for joint: {joint_id}")
        return self.encoders[joint_id].apply(q_raw)

    def apply_imu(self, accel_raw: np.ndarray, gyro_raw: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        if self.imu is None:
            return np.asarray(accel_raw, dtype=float), np.asarray(gyro_raw, dtype=float)
        return self.imu.apply(accel_raw, gyro_raw)
