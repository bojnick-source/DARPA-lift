from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Optional
import math

# Import Fragment 2 types
from muscle.muscle_baseline import (
    clamp,
    McKibbenPAM,
    PAMState,
    FirstOrderPressure,
    JointParams,
    JointState,
    PIForceToPressure,
    PressureControllerState,
    rk4_step,
    qddot_from_tau,
    L_from_q,
)


# ----------------------------
# Playback input + output
# ----------------------------

@dataclass(frozen=True)
class PlaybackPoint:
    """
    One sample at time t.

    Kinematic mode: provide q and qdot at every point.
    Dynamic mode: provide optional tau_ext at points; q/qdot come from integration.

    Optional commands:
      - P_cmd: explicit pressure command at sample time t
      - F_ref: reference force at sample time t (used by ctrl if P_cmd absent)

    Convention notes:
      - tau_ext is treated as ZERO-ORDER HOLD over [t_k, t_{k+1})
    """
    t: float
    q: Optional[float] = None
    qdot: Optional[float] = None
    tau_ext: Optional[float] = None
    P_cmd: Optional[float] = None
    F_ref: Optional[float] = None


@dataclass
class PlaybackLog:
    t: List[float]
    P: List[float]
    P_cmd: List[float]
    L: List[float]
    Ldot: List[float]
    F: List[float]
    q: List[float]
    qdot: List[float]
    tau: List[float]


# ----------------------------
# Validation helpers
# ----------------------------

def _validate_monotone_times(points: List[PlaybackPoint]) -> None:
    if len(points) < 2:
        raise ValueError("Need at least 2 playback points")
    for i in range(1, len(points)):
        if float(points[i].t) <= float(points[i - 1].t):
            raise ValueError("Playback times must be strictly increasing")


def _infer_mode(points: List[PlaybackPoint]) -> str:
    any_q = any((p.q is not None) or (p.qdot is not None) for p in points)
    if any_q:
        return "kinematic"
    return "dynamic"


def _clamp_pressure(P: float, P_max: float) -> float:
    return clamp(float(P), 0.0, float(P_max))


# ----------------------------
# Core playback runner
# ----------------------------

def run_playback(
    points: List[PlaybackPoint],
    pam: McKibbenPAM,
    pdyn: FirstOrderPressure,
    jpar: JointParams,
    L_rest: float,
    s_pam: PAMState,
    s_joint: JointState,
    ctrl: Optional[PIForceToPressure] = None,
    ctrl_state: Optional[PressureControllerState] = None,
    force_ref_fn: Optional[Callable[[float], float]] = None,
    *,
    # Hardening toggles
    require_force_ref_if_ctrl: bool = False,
    # Pressure integrator robustness (substeps per hold interval)
    max_substep_dt: float = 0.01,
    # Enforce that pdyn and pam use the same pressure cap
    enforce_pressure_cap_match: bool = True,
    pressure_cap_tol: float = 1e-9,
) -> PlaybackLog:
    """
    Replays a trajectory over irregular sample times.

    State mutation:
      - s_pam and s_joint are mutated in place.

    Command selection at each sample k:
      1) If points[k].P_cmd is provided: use it.
      2) Else if ctrl is provided: compute P_cmd using force error and dt_hold.
      3) Else: hold current pressure (open-loop).

    IMPORTANT:
      - Controller dt uses dt_hold = (t_{k+1} - t_k), i.e. the interval the command will be held.
      - tau_ext uses ZERO-ORDER HOLD over [t_k, t_{k+1}) in dynamic mode.
    """
    _validate_monotone_times(points)

    if jpar.I <= 0.0:
        raise ValueError("Joint inertia I must be > 0")
    if jpar.r <= 0.0:
        raise ValueError("Moment arm r must be > 0")
    if L_rest <= 0.0:
        raise ValueError("L_rest must be > 0")
    if L_rest >= pam.p.b:
        raise ValueError("L_rest must be < pam.p.b to satisfy geometry")

    P_MAX_PDY = float(pdyn.P_max)
    P_MAX_PAM = float(pam.p.P_max)

    if enforce_pressure_cap_match:
        if abs(P_MAX_PDY - P_MAX_PAM) > float(pressure_cap_tol):
            raise ValueError(
                f"Pressure cap mismatch: pdyn.P_max={P_MAX_PDY} vs pam.p.P_max={P_MAX_PAM}. "
                "Fix by making them equal or disable enforce_pressure_cap_match."
            )

    # Choose one cap as the playback cap. If matching is enforced, they are the same.
    P_MAX = min(P_MAX_PDY, P_MAX_PAM)

    # Clamp incoming pressure immediately so first log sample is sane
    s_pam.P = _clamp_pressure(s_pam.P, P_MAX)

    mode = _infer_mode(points)

    # Mode hardening
    if mode == "kinematic":
        for i, p in enumerate(points):
            if p.q is None or p.qdot is None:
                raise ValueError(f"Kinematic mode requires q and qdot at every point (missing at index {i})")
    else:
        for i, p in enumerate(points):
            if p.q is not None or p.qdot is not None:
                raise ValueError(f"Dynamic mode does not allow q/qdot in points (found at index {i})")

    cs = ctrl_state if ctrl_state is not None else PressureControllerState()
    log = PlaybackLog(t=[], P=[], P_cmd=[], L=[], Ldot=[], F=[], q=[], qdot=[], tau=[])

    def _update_muscle_kinematics() -> None:
        s_pam.L = clamp(L_from_q(L_rest, jpar.r, s_joint.q), 1e-9, pam.p.b - 1e-9)
        s_pam.Ldot = -jpar.r * s_joint.qdot

    def _integrate_pressure_hold(P0: float, P_cmd: float, dt_hold: float) -> float:
        """
        Integrate dP/dt over dt_hold with optional substepping for robustness.
        Uses RK4 per substep with command held constant.
        """
        P_cmd = _clamp_pressure(P_cmd, P_MAX)
        dt_hold = float(dt_hold)
        if dt_hold <= 0.0:
            return _clamp_pressure(P0, P_MAX)

        max_dt = float(max_substep_dt)
        if max_dt <= 0.0:
            max_dt = dt_hold

        n = int(math.ceil(dt_hold / max_dt))
        if n < 1:
            n = 1
        h = dt_hold / float(n)

        P = float(P0)
        for _ in range(n):
            def fP(Pval: float) -> float:
                return pdyn.dPdt(Pval, P_cmd)

            P = rk4_step(P, h, fP)
            P = _clamp_pressure(P, P_MAX)
        return P

    # Seed initial joint state from first kinematic point if applicable
    if mode == "kinematic":
        s_joint.q = float(points[0].q)        # type: ignore[arg-type]
        s_joint.qdot = float(points[0].qdot)  # type: ignore[arg-type]

    for k in range(len(points)):
        pk = points[k]
        t_k = float(pk.t)

        # Determine dt_hold for this sample's command (interval to next sample)
        if k < len(points) - 1:
            dt_hold = float(points[k + 1].t) - t_k
            if dt_hold <= 0.0:
                raise ValueError("Non-positive dt_hold encountered")
        else:
            dt_hold = float(points[k].t) - float(points[k - 1].t)
            if dt_hold <= 0.0:
                dt_hold = 1e-6

        # Apply kinematics if kinematic mode
        if mode == "kinematic":
            s_joint.q = float(pk.q)         # type: ignore[arg-type]
            s_joint.qdot = float(pk.qdot)   # type: ignore[arg-type]

        # Update muscle kinematics at this sample
        _update_muscle_kinematics()

        # Compute current force and torque
        F_k = pam.force(s_pam)
        tau_k = jpar.r * F_k

        # Compute command at this sample time
        if pk.P_cmd is not None:
            P_cmd_k = _clamp_pressure(pk.P_cmd, P_MAX)
        elif ctrl is not None:
            if pk.F_ref is not None:
                F_ref_k = float(pk.F_ref)
            elif force_ref_fn is not None:
                F_ref_k = float(force_ref_fn(t_k))
            else:
                if require_force_ref_if_ctrl:
                    raise ValueError("Controller provided but no F_ref or force_ref_fn supplied")
                F_ref_k = 0.0

            P_cmd_k, cs = ctrl.step(cs, float(dt_hold), F_ref_k, float(F_k))
            P_cmd_k = _clamp_pressure(P_cmd_k, P_MAX)
        else:
            P_cmd_k = _clamp_pressure(s_pam.P, P_MAX)

        # Log sample-aligned state
        log.t.append(t_k)
        log.P.append(float(s_pam.P))
        log.P_cmd.append(float(P_cmd_k))
        log.L.append(float(s_pam.L))
        log.Ldot.append(float(s_pam.Ldot))
        log.F.append(float(F_k))
        log.q.append(float(s_joint.q))
        log.qdot.append(float(s_joint.qdot))
        log.tau.append(float(tau_k))

        # Integrate to next sample (if not last)
        if k == len(points) - 1:
            break

        # Pressure integration with constant command over [t_k, t_{k+1})
        s_pam.P = _integrate_pressure_hold(float(s_pam.P), float(P_cmd_k), float(dt_hold))

        # Joint integration only in dynamic mode
        if mode == "dynamic":
            tau_ext = float(pk.tau_ext) if pk.tau_ext is not None else 0.0
            qdd = qddot_from_tau(jpar.I, float(tau_k), jpar.b, float(s_joint.qdot), float(tau_ext))
            s_joint.qdot = float(s_joint.qdot + qdd * float(dt_hold))
            s_joint.q = float(s_joint.q + s_joint.qdot * float(dt_hold))

    return log


# ----------------------------
# Minimal self-check example
# ----------------------------

if __name__ == "__main__":
    from muscle.muscle_baseline import (
        PAMParams,
        PressureDynParams,
        PressureControllerParams,
    )

    pam_params = PAMParams(b=0.35, n=12.0, L0=0.30, P_max=600_000.0, c_v=20.0, c_c=5.0, k_p=200.0, count=1)
    pam = McKibbenPAM(pam_params)

    pd = FirstOrderPressure(PressureDynParams(tau_up=0.08, tau_dn=0.10), P_max=pam_params.P_max)
    jpar = JointParams(r=0.02, I=0.02, b=0.02, tau_ext=0.0)

    ctrl = PIForceToPressure(PressureControllerParams(kp=1e-5, ki=3e-6, P_max=pam_params.P_max))
    cs = PressureControllerState()

    # Kinematic playback
    pts = [
        PlaybackPoint(t=0.0, q=0.0, qdot=0.0, F_ref=0.0),
        PlaybackPoint(t=0.1, q=0.1, qdot=0.0, F_ref=800.0),
        PlaybackPoint(t=0.2, q=0.1, qdot=0.0, F_ref=800.0),
    ]

    log = run_playback(
        points=pts,
        pam=pam,
        pdyn=pd,
        jpar=jpar,
        L_rest=pam_params.L0,
        s_pam=PAMState(L=pam_params.L0, Ldot=0.0, P=0.0),
        s_joint=JointState(q=0.0, qdot=0.0),
        ctrl=ctrl,
        ctrl_state=cs,
        require_force_ref_if_ctrl=False,
        max_substep_dt=0.01,
        enforce_pressure_cap_match=True,
    )

    print("samples:", len(log.t), "final P:", log.P[-1], "final F:", log.F[-1])
