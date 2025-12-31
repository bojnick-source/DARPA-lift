from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List, Tuple, Optional
import math
import random
import statistics

# ---- imports from earlier fragments ----
from muscle.muscle_baseline import (
    McKibbenPAM,
    PAMParams,
    PAMState,
    FirstOrderPressure,
    PressureDynParams,
    JointParams,
    JointState,
    PIForceToPressure,
    PressureControllerParams,
    PressureControllerState,
    simulate,
)


# ----------------------------
# Deterministic validation
# ----------------------------

@dataclass(frozen=True)
class ValidationResult:
    name: str
    passed: bool
    metric: float
    threshold: float
    note: str


def _is_finite(x: float) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(float(x))


def assert_near(x: float, ref: float, tol: float) -> bool:
    x = float(x)
    ref = float(ref)
    tol = float(tol)
    if tol < 0.0:
        raise ValueError("tol must be >= 0")
    return abs(x - ref) <= tol


def validate_static_zero_force(pam: McKibbenPAM, tol: float = 1e-6) -> ValidationResult:
    """
    At zero pressure and zero velocity, and at L = L0, total force should be ~0
    given the baseline symmetric passive model centered at L0.
    """
    if tol <= 0.0:
        raise ValueError("tol must be > 0")

    p = pam.p
    s = PAMState(L=p.L0, Ldot=0.0, P=0.0)
    F = float(pam.force(s))

    passed = _is_finite(F) and (abs(F) <= tol)
    return ValidationResult(
        name="static_zero_force",
        passed=passed,
        metric=F,
        threshold=tol,
        note="F≈0 at P=0, L=L0, Ldot=0 under symmetric passive term",
    )


def validate_force_monotonic_pressure(pam: McKibbenPAM) -> ValidationResult:
    """
    Force should be non-decreasing with increasing pressure at fixed geometry,
    provided the active gain term (3cos^2(theta)-1) is positive at that geometry.

    This test auto-selects a geometry close to L0 and checks the gain sign.
    If gain <= 0, monotonicity is not guaranteed and the test FAILS by design.
    """
    p = pam.p

    # pick a safe geometry close to L0 but not at clamp edge
    L = float(min(max(p.L0 * 0.98, 1e-6), p.b - 1e-6))
    c = float(max(min(L / p.b, 1.0), -1.0))
    gain = 3.0 * c * c - 1.0

    if gain <= 0.0:
        return ValidationResult(
            name="force_vs_pressure_monotone",
            passed=False,
            metric=gain,
            threshold=0.0,
            note="Active gain <= 0 at chosen geometry; monotonicity not expected",
        )

    s = PAMState(L=L, Ldot=0.0, P=0.0)

    Ps = [0.0, 0.25 * p.P_max, 0.5 * p.P_max, p.P_max]
    Fs: List[float] = []
    for P in Ps:
        s.P = float(P)
        Fs.append(float(pam.force(s)))

    deltas = [Fs[i + 1] - Fs[i] for i in range(len(Fs) - 1)]
    monotone = all(d >= -1e-12 for d in deltas)  # small numerical tolerance
    metric = min(deltas) if deltas else 0.0

    return ValidationResult(
        name="force_vs_pressure_monotone",
        passed=bool(monotone),
        metric=float(metric),
        threshold=0.0,
        note="ΔF >= 0 (within tolerance) for increasing P at positive active gain",
    )


# ----------------------------
# Monte-Carlo robustness
# ----------------------------

@dataclass(frozen=True)
class MonteCarloStats:
    samples: int
    success_rate: float
    F_mean: float
    F_std: float
    F_min: float
    F_max: float


def _sorted_range(a: float, b: float) -> Tuple[float, float]:
    a = float(a)
    b = float(b)
    return (a, b) if a <= b else (b, a)


def monte_carlo_force(
    pam_params: PAMParams,
    L_range: Tuple[float, float],
    P_range: Tuple[float, float],
    samples: int,
    seed: int = 0,
) -> MonteCarloStats:
    """
    Randomly samples (L, P) to check numerical stability and force distribution.

    Hardening:
      - samples must be > 0
      - ranges auto-sorted
      - pressure range clamped to [0, P_max]
      - geometry is still protected by pam.force() clamping
    """
    if samples <= 0:
        raise ValueError("samples must be > 0")

    rng = random.Random(int(seed))
    pam = McKibbenPAM(pam_params)

    L_lo, L_hi = _sorted_range(*L_range)
    eps = 1e-9
    L_lo = max(L_lo, eps)
    L_hi = min(L_hi, pam_params.b - eps)
    if L_hi < L_lo:
        L_hi = L_lo

    P_lo, P_hi = _sorted_range(*P_range)
    P_lo = max(0.0, P_lo)
    P_hi = min(float(pam_params.P_max), P_hi)

    if P_hi < P_lo:
        P_hi = P_lo

    forces: List[float] = []
    ok = 0

    for _ in range(int(samples)):
        L = rng.uniform(L_lo, L_hi)
        P = rng.uniform(P_lo, P_hi)
        s = PAMState(L=float(L), Ldot=0.0, P=float(P))

        try:
            F = float(pam.force(s))
            if _is_finite(F):
                ok += 1
                forces.append(F)
        except Exception:
            # ignore this sample
            pass

    if not forces:
        return MonteCarloStats(
            samples=int(samples),
            success_rate=0.0,
            F_mean=0.0,
            F_std=0.0,
            F_min=0.0,
            F_max=0.0,
        )

    mean = float(statistics.mean(forces))
    std = float(statistics.pstdev(forces)) if len(forces) > 1 else 0.0

    return MonteCarloStats(
        samples=int(samples),
        success_rate=float(ok) / float(samples),
        F_mean=mean,
        F_std=std,
        F_min=float(min(forces)),
        F_max=float(max(forces)),
    )


# ----------------------------
# Closed-loop performance metric
# ----------------------------

@dataclass(frozen=True)
class ClosedLoopMetrics:
    rms_force_error: float
    max_pressure: float
    settling_time: float


def evaluate_closed_loop(
    pam: McKibbenPAM,
    pdyn: FirstOrderPressure,
    jpar: JointParams,
    ctrl: PIForceToPressure,
    F_ref_fn: Callable[[float], float],
    T: float,
    dt: float,
    settle_frac: float = 0.05,
    settle_abs: float = 1e-3,
    L_rest: Optional[float] = None,
) -> ClosedLoopMetrics:
    """
    Runs Fragment-2 simulate() and extracts metrics.

    FIX (major):
      Settling time now means: earliest time index i such that
      |e[k]| <= band for ALL k >= i (suffix condition).
      The prior version only checked the first in-band sample.

    Hardening:
      - dt, T validated
      - band = max(settle_frac*|F_final|, settle_abs)
    """
    if T <= 0.0 or dt <= 0.0:
        raise ValueError("T and dt must be > 0")
    if not (0.0 <= settle_frac <= 1.0):
        raise ValueError("settle_frac must be in [0, 1]")
    if settle_abs < 0.0:
        raise ValueError("settle_abs must be >= 0")

    Lr = float(pam.p.L0 if L_rest is None else L_rest)
    if Lr <= 0.0 or Lr >= pam.p.b:
        raise ValueError("L_rest must be in (0, b)")

    log = simulate(
        T=float(T),
        dt=float(dt),
        pam=pam,
        pdyn=pdyn,
        jpar=jpar,
        L_rest=Lr,
        force_ref_fn=F_ref_fn,
        s0_pam=PAMState(L=Lr, Ldot=0.0, P=0.0),
        s0_joint=JointState(q=0.0, qdot=0.0),
        ctrl=ctrl,
        ctrl_state=PressureControllerState(),
    )

    errs = [float(F_ref_fn(t)) - float(f) for t, f in zip(log.t, log.F)]
    if not errs:
        raise RuntimeError("simulate() returned empty log")

    rms = math.sqrt(sum(e * e for e in errs) / float(len(errs)))
    Pmax = float(max(log.P)) if log.P else 0.0

    # Settling band
    F_final = float(F_ref_fn(float(log.t[-1])))
    band = max(float(settle_frac) * abs(F_final), float(settle_abs))

    # Suffix condition: from i onward always in band
    suffix_ok = [False] * len(errs)
    last_ok = True
    for i in range(len(errs) - 1, -1, -1):
        last_ok = last_ok and (abs(errs[i]) <= band)
        suffix_ok[i] = last_ok

    settle = float(T)
    for i, ok in enumerate(suffix_ok):
        if ok:
            settle = float(log.t[i])
            break

    return ClosedLoopMetrics(
        rms_force_error=float(rms),
        max_pressure=float(Pmax),
        settling_time=float(settle),
    )


# ----------------------------
# Aggregate validation harness
# ----------------------------

@dataclass(frozen=True)
class ValidationSuiteConfig:
    pam_params: PAMParams
    pressure_dyn: PressureDynParams
    joint_params: JointParams
    controller_params: PressureControllerParams
    F_ref_fn: Callable[[float], float]
    T: float = 2.0
    dt: float = 0.002
    mc_samples: int = 500
    mc_L_range: Tuple[float, float] = (0.25, 0.34)
    mc_P_range: Tuple[float, float] = (0.0, 600_000.0)
    settle_frac: float = 0.05
    settle_abs: float = 1e-3
    L_rest: Optional[float] = None
    seed: int = 0


def run_validation_suite(cfg: ValidationSuiteConfig) -> dict:
    """
    Runs deterministic checks, Monte-Carlo robustness, and closed-loop metrics
    using the provided configuration.
    """
    pam = McKibbenPAM(cfg.pam_params)
    pdyn = FirstOrderPressure(cfg.pressure_dyn, P_max=cfg.pam_params.P_max)
    ctrl = PIForceToPressure(cfg.controller_params)

    det_results = [
        validate_static_zero_force(pam),
        validate_force_monotonic_pressure(pam),
    ]

    mc_stats = monte_carlo_force(
        pam_params=cfg.pam_params,
        L_range=cfg.mc_L_range,
        P_range=cfg.mc_P_range,
        samples=cfg.mc_samples,
        seed=cfg.seed,
    )

    closed_loop = evaluate_closed_loop(
        pam=pam,
        pdyn=pdyn,
        jpar=cfg.joint_params,
        ctrl=ctrl,
        F_ref_fn=cfg.F_ref_fn,
        T=cfg.T,
        dt=cfg.dt,
        settle_frac=cfg.settle_frac,
        settle_abs=cfg.settle_abs,
        L_rest=cfg.L_rest,
    )

    return {
        "deterministic": det_results,
        "monte_carlo": mc_stats,
        "closed_loop": closed_loop,
    }


# ----------------------------
# Minimal self-check
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
        count=1,
    )

    pam = McKibbenPAM(pam_params)

    # Deterministic checks
    r1 = validate_static_zero_force(pam)
    r2 = validate_force_monotonic_pressure(pam)
    print(r1)
    print(r2)

    # Monte-Carlo
    mc = monte_carlo_force(
        pam_params=pam_params,
        L_range=(0.25, 0.34),
        P_range=(0.0, pam_params.P_max),
        samples=1000,
        seed=42,
    )
    print(mc)

    # Closed-loop metric
    pd = FirstOrderPressure(PressureDynParams(tau_up=0.08, tau_dn=0.10), P_max=pam_params.P_max)
    ctrl = PIForceToPressure(PressureControllerParams(kp=1e-5, ki=3e-6, P_max=pam_params.P_max))
    jpar = JointParams(r=0.02, I=0.02)

    def Fref(t: float) -> float:
        return 800.0

    metrics = evaluate_closed_loop(
        pam=pam,
        pdyn=pd,
        jpar=jpar,
        ctrl=ctrl,
        F_ref_fn=Fref,
        T=2.0,
        dt=0.002,
    )
    print(metrics)
