from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Callable, Dict, Tuple, List, Optional


# ----------------------------
# Utilities
# ----------------------------

def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


# ----------------------------
# McKibben / PAM Model
# ----------------------------

@dataclass(frozen=True)
class PAMParams:
    # Geometry
    b: float          # braid fiber length (m)
    n: float          # turns (dimensionless)
    L0: float         # neutral/rest length used for passive term (m), must satisfy 0 < L0 < b

    # Pressure limits
    P_max: float      # Pa

    # Loss terms
    c_v: float = 0.0  # viscous N/(m/s)
    c_c: float = 0.0  # coulomb N
    k_p: float = 0.0  # passive linear stiffness N/m

    # Optional scaling (e.g., multiple muscles in parallel)
    count: int = 1


@dataclass
class PAMState:
    L: float          # m
    Ldot: float       # m/s
    P: float          # Pa


class McKibbenPAM:
    """
    Idealized McKibben model:
      D(L) = 1/(pi*n)*sqrt(b^2 - L^2)
      cos(theta)=L/b
      F_active = P*A(L)*(3cos^2(theta)-1)

    Force composition:
      F_total = F_active - F_passive(L) - F_damp(Ldot)

    Notes:
    - This actuator cannot "push" (compress) without vacuum or antagonists.
      We allow negative values for modeling completeness.
    - Passive term is symmetric about L0 (acts in extension and shortening).
      force_passive() returns k_p*(L-L0) and is SUBTRACTED, giving restoring behavior toward L0.
    """

    def __init__(self, p: PAMParams):
        if p.b <= 0.0 or p.n <= 0.0 or p.P_max <= 0.0:
            raise ValueError("Invalid PAMParams: b,n,P_max must be > 0")
        if not (0.0 < p.L0 < p.b):
            raise ValueError("Invalid PAMParams: require 0 < L0 < b")
        if p.count < 1:
            raise ValueError("Invalid PAMParams: count must be >= 1")
        if p.k_p < 0.0 or p.c_v < 0.0 or p.c_c < 0.0:
            raise ValueError("Invalid PAMParams: k_p,c_v,c_c must be >= 0")
        self.p = p

    def diameter(self, L: float) -> float:
        Lc = clamp(L, 1e-9, self.p.b - 1e-9)
        rad = max(0.0, self.p.b * self.p.b - Lc * Lc)
        return (1.0 / (math.pi * self.p.n)) * math.sqrt(rad)

    def area(self, L: float) -> float:
        D = self.diameter(L)
        return math.pi * (D * D) / 4.0

    def cos_theta(self, L: float) -> float:
        return clamp(L / self.p.b, -1.0, 1.0)

    def force_active_ideal(self, P: float, L: float) -> float:
        c = self.cos_theta(L)
        return P * self.area(L) * (3.0 * c * c - 1.0)

    def force_passive(self, L: float) -> float:
        # Symmetric restoring term about L0. Subtracted in force().
        return self.p.k_p * (L - self.p.L0)

    def force_damping(self, Ldot: float, v_eps: float = 1e-6) -> float:
        # Returns a term with SAME sign as Ldot. Subtracted in force().
        v_eps = max(float(v_eps), 1e-12)
        visc = self.p.c_v * Ldot
        coul = self.p.c_c * math.tanh(Ldot / v_eps)
        return visc + coul

    def force(self, s: PAMState) -> float:
        P = clamp(s.P, 0.0, self.p.P_max)
        L = clamp(s.L, 1e-9, self.p.b - 1e-9)

        F_act = self.force_active_ideal(P, L)
        F_pas = self.force_passive(L)
        F_dmp = self.force_damping(s.Ldot)

        F = F_act - F_pas - F_dmp
        return float(self.p.count) * float(F)


# ----------------------------
# Pressure dynamics
# ----------------------------

@dataclass(frozen=True)
class PressureDynParams:
    tau_up: float   # s
    tau_dn: float   # s


class FirstOrderPressure:
    def __init__(self, p: PressureDynParams, P_max: float):
        if p.tau_up <= 0.0 or p.tau_dn <= 0.0:
            raise ValueError("tau_up and tau_dn must be > 0")
        if P_max <= 0.0:
            raise ValueError("P_max must be > 0")
        self.p = p
        self.P_max = float(P_max)

    def dPdt(self, P: float, P_cmd: float) -> float:
        P_cmd = clamp(P_cmd, 0.0, self.P_max)
        tau = self.p.tau_up if P_cmd > P else self.p.tau_dn
        return (P_cmd - P) / tau


# ----------------------------
# Mechanics coupling (1 DoF)
# ----------------------------

@dataclass(frozen=True)
class JointParams:
    r: float        # moment arm (m)
    I: float        # joint inertia (kg*m^2)
    b: float = 0.0  # joint viscous damping (N*m*s/rad)
    tau_ext: float = 0.0  # external torque (N*m). Constant here.


@dataclass
class JointState:
    q: float        # rad
    qdot: float     # rad/s


def L_from_q(L_rest: float, r: float, q: float) -> float:
    return L_rest - r * q


def qddot_from_tau(I: float, tau: float, b: float, qdot: float, tau_ext: float) -> float:
    return (tau - b * qdot - tau_ext) / I


# ----------------------------
# Controller (simple)
# ----------------------------

@dataclass(frozen=True)
class PressureControllerParams:
    kp: float
    ki: float
    P_max: float


@dataclass
class PressureControllerState:
    integ: float = 0.0


class PIForceToPressure:
    """
    PI on force error:
      e = F_ref - F
      P_cmd = clamp(kp*e + ki*∫e, 0, P_max)
    """

    def __init__(self, p: PressureControllerParams):
        if p.P_max <= 0.0:
            raise ValueError("P_max must be > 0")
        self.p = p

    def step(
        self,
        cs: PressureControllerState,
        dt: float,
        F_ref: float,
        F_meas: float
    ) -> Tuple[float, PressureControllerState]:
        if dt <= 0.0:
            raise ValueError("dt must be > 0")
        e = F_ref - F_meas
        cs.integ += e * dt
        P_cmd = self.p.kp * e + self.p.ki * cs.integ
        P_cmd = clamp(P_cmd, 0.0, self.p.P_max)
        return P_cmd, cs


# ----------------------------
# Simulation (RK4 for pressure)
# ----------------------------

@dataclass
class SimLog:
    t: List[float]
    P: List[float]
    P_cmd: List[float]
    L: List[float]
    Ldot: List[float]
    F: List[float]
    q: List[float]
    qdot: List[float]
    tau: List[float]


def rk4_step(x: float, dt: float, f: Callable[[float], float]) -> float:
    k1 = f(x)
    k2 = f(x + 0.5 * dt * k1)
    k3 = f(x + 0.5 * dt * k2)
    k4 = f(x + dt * k3)
    return x + (dt / 6.0) * (k1 + 2*k2 + 2*k3 + k4)


def simulate(
    T: float,
    dt: float,
    pam: McKibbenPAM,
    pdyn: FirstOrderPressure,
    jpar: JointParams,
    L_rest: float,
    force_ref_fn: Callable[[float], float],
    s0_pam: PAMState,
    s0_joint: JointState,
    ctrl: Optional[PIForceToPressure] = None,
    ctrl_state: Optional[PressureControllerState] = None,
) -> SimLog:
    """
    NOTE: This function MUTATES s0_pam and s0_joint in place.
    If you want non-mutating behavior, pass copies.
    """
    if dt <= 0.0 or T <= 0.0:
        raise ValueError("T and dt must be > 0")
    if jpar.I <= 0.0:
        raise ValueError("Joint inertia I must be > 0")
    if jpar.r <= 0.0:
        raise ValueError("Moment arm r must be > 0")

    steps = int(T / dt)

    log = SimLog([], [], [], [], [], [], [], [], [])
    sp = s0_pam
    sj = s0_joint
    cs = ctrl_state if ctrl_state is not None else PressureControllerState()

    for i in range(steps + 1):
        t = i * dt

        # Kinematics coupling
        sp.L = clamp(L_from_q(L_rest, jpar.r, sj.q), 1e-9, pam.p.b - 1e-9)

        # Set Ldot BEFORE force() so damping uses current velocity
        sp.Ldot = -jpar.r * sj.qdot

        # Force and torque
        F = pam.force(sp)
        tau = jpar.r * F

        # Controller
        F_ref = force_ref_fn(t)
        if ctrl is not None:
            P_cmd, cs = ctrl.step(cs, dt, F_ref, F)
        else:
            P_cmd = sp.P  # open-loop hold

        # Pressure update (RK4)
        def fP(Pval: float) -> float:
            return pdyn.dPdt(Pval, P_cmd)

        sp.P = rk4_step(sp.P, dt, fP)
        sp.P = clamp(sp.P, 0.0, pam.p.P_max)

        # Joint update (semi-implicit Euler)
        qdd = qddot_from_tau(jpar.I, tau, jpar.b, sj.qdot, jpar.tau_ext)
        sj.qdot += qdd * dt
        sj.q += sj.qdot * dt

        # Log
        log.t.append(t)
        log.P.append(sp.P)
        log.P_cmd.append(P_cmd)
        log.L.append(sp.L)
        log.Ldot.append(sp.Ldot)
        log.F.append(F)
        log.q.append(sj.q)
        log.qdot.append(sj.qdot)
        log.tau.append(tau)

    return log


# ----------------------------
# PicoGK hook (placeholder)
# ----------------------------

@dataclass(frozen=True)
class MuscleEnvelope:
    D0: float
    L0: float
    stroke: float
    port_diam: float
    mount_points: Dict[str, Tuple[float, float, float]]  # name -> xyz meters


def export_to_pico_gk(envelope: MuscleEnvelope) -> Dict[str, object]:
    return {
        "type": "mckibben_pam",
        "D0_m": float(envelope.D0),
        "L0_m": float(envelope.L0),
        "stroke_m": float(envelope.stroke),
        "port_diam_m": float(envelope.port_diam),
        "mount_points_m": {k: tuple(map(float, v)) for k, v in envelope.mount_points.items()},
        "notes": "Feed into PicoGK parametric generator."
    }


# ----------------------------
# Minimal example run
# ----------------------------

if __name__ == "__main__":
    pam_params = PAMParams(
        b=0.35,
        n=12.0,
        L0=0.30,
        P_max=600_000.0,
        c_v=20.0,
        c_c=5.0,
        k_p=200.0,
        count=2
    )
    pam = McKibbenPAM(pam_params)

    pd = FirstOrderPressure(PressureDynParams(tau_up=0.08, tau_dn=0.10), P_max=pam_params.P_max)

    joint = JointParams(r=0.02, I=0.02, b=0.02, tau_ext=0.0)

    ctrl = PIForceToPressure(PressureControllerParams(kp=1e-5, ki=3e-6, P_max=pam_params.P_max))
    cs = PressureControllerState()

    def Fref(t: float) -> float:
        return 0.0 if t < 0.5 else 800.0

    log = simulate(
        T=2.0, dt=0.002,
        pam=pam, pdyn=pd, jpar=joint,
        L_rest=pam_params.L0,
        force_ref_fn=Fref,
        s0_pam=PAMState(L=pam_params.L0, Ldot=0.0, P=0.0),
        s0_joint=JointState(q=0.0, qdot=0.0),
        ctrl=ctrl,
        ctrl_state=cs
    )

    env = MuscleEnvelope(
        D0=pam.diameter(pam_params.L0),
        L0=pam_params.L0,
        stroke=0.06,
        port_diam=0.004,
        mount_points={"proximal": (0.0, 0.0, 0.0), "distal": (0.0, 0.0, pam_params.L0)}
    )
    spec = export_to_pico_gk(env)
    print("Final P:", log.P[-1], "Final F:", log.F[-1])
    print("PicoGK spec:", spec)
