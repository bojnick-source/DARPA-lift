from __future__ import annotations

import numpy as np
from typing import Sequence, Optional


def min_bend_radius(points: np.ndarray) -> float:
    pts = np.asarray(points, dtype=float)
    if pts.shape[0] < 3:
        return float("inf")
    # Very simple curvature estimate using three-point circles
    radii = []
    for i in range(pts.shape[0] - 2):
        p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2]
        a = np.linalg.norm(p1 - p2)
        b = np.linalg.norm(p2 - p3)
        c = np.linalg.norm(p3 - p1)
        s = 0.5 * (a + b + c)
        area = max(s * (s - a) * (s - b) * (s - c), 0.0)
        if area == 0.0:
            radii.append(float("inf"))
            continue
        area = np.sqrt(area)
        r = (a * b * c) / (4.0 * area + 1e-12)
        radii.append(r)
    return float(np.min(radii)) if radii else float("inf")


def compute_min_bend_radius(points: np.ndarray) -> float:
    return min_bend_radius(points)


def bend_radius_ok(points: np.ndarray, min_radius_m: float) -> bool:
    r = min_bend_radius(points)
    return bool(np.isinf(r) or r >= float(min_radius_m))


class RoutingEngine:
    def plan(self, points: np.ndarray) -> dict:
        return {"min_bend_radius": min_bend_radius(points)}


def route(points: np.ndarray) -> dict:
    return RoutingEngine().plan(points)
