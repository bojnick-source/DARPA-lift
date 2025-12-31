from __future__ import annotations

from typing import Tuple
import numpy as np


class InertiaError(RuntimeError):
    pass


def _fs(x: float, name: str) -> float:
    v = float(x)
    if not np.isfinite(v):
        raise InertiaError(f"{name} must be finite.")
    return v


def _pos(x: float, name: str) -> float:
    v = _fs(x, name)
    if v <= 0:
        raise InertiaError(f"{name} must be > 0.")
    return v


def inertia_box(mass: float, sx: float, sy: float, sz: float) -> Tuple[float, float, float]:
    m = _pos(mass, "mass")
    sx = _pos(sx, "sx")
    sy = _pos(sy, "sy")
    sz = _pos(sz, "sz")
    ixx = (m / 12.0) * (sy * sy + sz * sz)
    iyy = (m / 12.0) * (sx * sx + sz * sz)
    izz = (m / 12.0) * (sx * sx + sy * sy)
    return float(ixx), float(iyy), float(izz)


def inertia_sphere(mass: float, r: float) -> Tuple[float, float, float]:
    m = _pos(mass, "mass")
    r = _pos(r, "r")
    I = (2.0 / 5.0) * m * r * r
    return float(I), float(I), float(I)


def inertia_cylinder(mass: float, r: float, h: float, axis: str = "z") -> Tuple[float, float, float]:
    m = _pos(mass, "mass")
    r = _pos(r, "r")
    h = _pos(h, "h")
    axis = str(axis).lower()
    if axis not in ("x", "y", "z"):
        raise InertiaError("axis must be x|y|z")

    I_axis = 0.5 * m * r * r
    I_perp = (m / 12.0) * (3.0 * r * r + h * h)

    if axis == "x":
        return float(I_axis), float(I_perp), float(I_perp)
    if axis == "y":
        return float(I_perp), float(I_axis), float(I_perp)
    return float(I_perp), float(I_perp), float(I_axis)
