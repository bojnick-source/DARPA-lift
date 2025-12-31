from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np


class RoutingPhysicsError(RuntimeError):
    pass


def _finite_scalar(x: float, name: str) -> float:
    xf = float(x)
    if not np.isfinite(xf):
        raise RoutingPhysicsError(f"{name} must be finite.")
    return xf


def capstan_tension_out(t_in_n: float, mu: float, wrap_angle_rad: float) -> float:
    """
    Capstan friction model:
      T_out = T_in * exp(mu * theta)
    Assumes impending slip / worst-case amplification. Use mu, theta >= 0.

    This is direction-agnostic; you decide which side is "in" based on pull direction.
    """
    t_in = _finite_scalar(t_in_n, "t_in_n")
    mu = _finite_scalar(mu, "mu")
    th = _finite_scalar(wrap_angle_rad, "wrap_angle_rad")

    if t_in < 0:
        raise RoutingPhysicsError("t_in_n must be >= 0.")
    if mu < 0:
        raise RoutingPhysicsError("mu must be >= 0.")
    if th < 0:
        raise RoutingPhysicsError("wrap_angle_rad must be >= 0.")

    # exp can overflow; fail-closed with a cap
    expo = mu * th
    if expo > 100.0:
        raise RoutingPhysicsError("capstan exponent too large (mu*theta>100): numerically unsafe / physically extreme.")
    return float(t_in * float(np.exp(expo)))


def capstan_required_input(t_out_n: float, mu: float, wrap_angle_rad: float) -> float:
    """
    Inverse capstan:
      T_in = T_out * exp(-mu*theta)
    """
    t_out = _finite_scalar(t_out_n, "t_out_n")
    mu = _finite_scalar(mu, "mu")
    th = _finite_scalar(wrap_angle_rad, "wrap_angle_rad")
    if t_out < 0:
        raise RoutingPhysicsError("t_out_n must be >= 0.")
    if mu < 0 or th < 0:
        raise RoutingPhysicsError("mu and wrap_angle_rad must be >= 0.")
    expo = mu * th
    if expo > 100.0:
        raise RoutingPhysicsError("capstan exponent too large (mu*theta>100).")
    return float(t_out * float(np.exp(-expo)))


def tendon_extension_m(tension_n: float, length_m: float, E_pa: float, area_m2: float) -> float:
    """
    Linear elastic tendon extension:
      dL = (T * L) / (E * A)
    """
    T = _finite_scalar(tension_n, "tension_n")
    L = _finite_scalar(length_m, "length_m")
    E = _finite_scalar(E_pa, "E_pa")
    A = _finite_scalar(area_m2, "area_m2")

    if T < 0:
        raise RoutingPhysicsError("tension_n must be >= 0.")
    if L <= 0 or E <= 0 or A <= 0:
        raise RoutingPhysicsError("length_m, E_pa, area_m2 must be > 0.")
    return float((T * L) / (E * A))


@dataclass(frozen=True)
class WrapElement:
    """
    One wrap/contact segment (capstan-like).
    """

    mu: float                 # friction coefficient
    wrap_angle_rad: float     # total wrap angle (radians)


@dataclass(frozen=True)
class PulleyElement:
    """
    One pulley/bearing element.
    eff is multiplicative efficiency in (0,1].
    """

    eff: float = 0.98


@dataclass(frozen=True)
class TendonMaterial:
    """
    Tendon material for compliance.
    """

    E_pa: float
    area_m2: float


@dataclass(frozen=True)
class RoutePhysics:
    """
    Physics definition of a routing path, independent of geometry.
    """

    length_m: float
    wraps: Tuple[WrapElement, ...] = ()
    pulleys: Tuple[PulleyElement, ...] = ()
    tendon: Optional[TendonMaterial] = None

    def validate(self) -> None:
        L = _finite_scalar(self.length_m, "length_m")
        if L <= 0:
            raise RoutingPhysicsError("RoutePhysics.length_m must be > 0.")

        for i, w in enumerate(self.wraps):
            _finite_scalar(w.mu, f"wraps[{i}].mu")
            _finite_scalar(w.wrap_angle_rad, f"wraps[{i}].wrap_angle_rad")
            if w.mu < 0 or w.wrap_angle_rad < 0:
                raise RoutingPhysicsError("WrapElement mu and wrap_angle_rad must be >= 0.")

        for i, p in enumerate(self.pulleys):
            _finite_scalar(p.eff, f"pulleys[{i}].eff")
            if not (0.0 < p.eff <= 1.0):
                raise RoutingPhysicsError("PulleyElement.eff must be in (0,1].")

        if self.tendon is not None:
            _finite_scalar(self.tendon.E_pa, "tendon.E_pa")
            _finite_scalar(self.tendon.area_m2, "tendon.area_m2")
            if self.tendon.E_pa <= 0 or self.tendon.area_m2 <= 0:
                raise RoutingPhysicsError("TendonMaterial E_pa and area_m2 must be > 0.")


def route_efficiency(route: RoutePhysics) -> float:
    """
    Multiplicative transmission efficiency due to pulley losses only.
    (Capstan friction is modeled as tension amplification requirement, not an 'efficiency'.)
    """
    route.validate()
    eff = 1.0
    for p in route.pulleys:
        eff *= float(p.eff)
    eff = float(eff)
    if eff <= 0.0 or not np.isfinite(eff):
        raise RoutingPhysicsError("Computed route efficiency invalid.")
    return eff


def required_input_tension_for_output(
    *,
    t_out_n: float,
    route: RoutePhysics,
) -> float:
    """
    Given desired output tension at the endpoint, compute required actuator-side input tension
    considering capstan friction across wraps.
    Pulley efficiencies are handled separately (energy/power).
    """
    route.validate()
    T = _finite_scalar(t_out_n, "t_out_n")
    if T < 0:
        raise RoutingPhysicsError("t_out_n must be >= 0.")

    for w in reversed(route.wraps):
        T = capstan_required_input(T, w.mu, w.wrap_angle_rad)
    return float(T)


def output_tension_from_input(
    *,
    t_in_n: float,
    route: RoutePhysics,
) -> float:
    """
    Forward capstan accumulation from actuator-side input to endpoint output tension.
    """
    route.validate()
    T = _finite_scalar(t_in_n, "t_in_n")
    if T < 0:
        raise RoutingPhysicsError("t_in_n must be >= 0.")
    for w in route.wraps:
        T = capstan_tension_out(T, w.mu, w.wrap_angle_rad)
    return float(T)


def slack_check(
    *,
    commanded_length_change_m: float,
    available_travel_m: float,
    min_tension_n: float,
    predicted_tension_n: float,
) -> bool:
    """
    Slack detection gate.
    Returns True if route is slack-risk (should FAIL feasibility), else False.

    Criteria:
      - commanded change exceeds available travel
      - predicted tension < min_tension
    """
    dl = _finite_scalar(commanded_length_change_m, "commanded_length_change_m")
    tr = _finite_scalar(available_travel_m, "available_travel_m")
    tmin = _finite_scalar(min_tension_n, "min_tension_n")
    tpred = _finite_scalar(predicted_tension_n, "predicted_tension_n")

    if tr <= 0:
        raise RoutingPhysicsError("available_travel_m must be > 0.")
    if tmin < 0:
        raise RoutingPhysicsError("min_tension_n must be >= 0.")

    if abs(dl) > tr:
        return True
    if tpred < tmin:
        return True
    return False


def compliance_extension(
    *,
    tension_n: float,
    route: RoutePhysics,
) -> float:
    """
    Route-level compliance extension using route length and tendon material (if provided).
    Returns 0 if no tendon material is specified.
    """
    route.validate()
    if route.tendon is None:
        return 0.0
    return tendon_extension_m(
        tension_n=tension_n,
        length_m=route.length_m,
        E_pa=route.tendon.E_pa,
        area_m2=route.tendon.area_m2,
    )


def transmission_power_losses_w(
    *,
    endpoint_power_w: float,
    route: RoutePhysics,
) -> float:
    """
    Approximate power losses from pulley efficiencies only:
      P_in = P_out / eff
      losses = P_in - P_out
    Capstan friction is not modeled as "loss" here because it depends on sliding regime; if you want
    a dissipative model, add it explicitly as heat when slip is detected or when tension gradient implies micro-slip.

    This returns 0 if eff==1.
    """
    route.validate()
    Pout = _finite_scalar(endpoint_power_w, "endpoint_power_w")
    eff = route_efficiency(route)
    if eff <= 0:
        raise RoutingPhysicsError("route_efficiency invalid.")
    Pin = Pout / eff
    loss = Pin - Pout
    return float(max(0.0, loss))
