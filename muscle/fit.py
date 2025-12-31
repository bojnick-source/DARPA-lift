from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence, Tuple
import math
import random

from muscle.muscle_baseline import (
    PAMParams,
    PAMState,
    JointParams,
    JointState,
    PressureControllerState,
    McKibbenPAM,
    FirstOrderPressure,
    PIForceToPressure,
)
from muscle.playback import PlaybackPoint
from muscle.metrics_mc import (
    EvalConfig,
    compute_error_metrics,
    robust_mean_huber,
    bootstrap_metrics_ci,
    eval_playback_force,
)


# ----------------------------
# Helpers
# ----------------------------

def _finite(x: float) -> bool:
    return math.isfinite(float(x))


def _require_finite(x: float, name: str) -> float:
    xf = float(x)
    if not _finite(xf):
        raise ValueError(f"{name} must be finite")
    return xf


def _clamp_pos(x: float, lo: float) -> float:
    x = float(x)
    if x < lo:
        return lo
    return x


def _validate_dataset(points: List[PlaybackPoint], F_true: Sequence[float]) -> None:
    if len(points) < 2:
        raise ValueError("Need at least 2 PlaybackPoint samples")
    if len(F_true) != len(points):
        raise ValueError("F_true length must match number of playback points")
    for i, p in enumerate(points):
        if not _finite(p.t):
            raise ValueError(f"points[{i}].t must be finite")
    for i in range(1, len(points)):
        if float(points[i].t) <= float(points[i - 1].t):
            raise ValueError("Playback times must be strictly increasing")
    for i, f in enumerate(F_true):
        if not _finite(f):
            raise ValueError(f"F_true[{i}] must be finite")


# ----------------------------
# Fit configuration
# ----------------------------

@dataclass(frozen=True)
class FitBounds:
    """
    Hard bounds for fitted parameters.
    Geometry constraints:
      - b > 0
      - 0 < L0 < b
      - n > 0
    Pressure:
      - P_max > 0
    Loss terms:
      - c_v, c_c, k_p >= 0
    """

    b_min: float = 1e-3
    b_max: float = 10.0

    n_min: float = 1e-3
    n_max: float = 1e3

    L0_min: float = 1e-6
    # L0_max is enforced as < b per-sample
    Pmax_min: float = 1.0
    Pmax_max: float = 20_000_000.0  # 20 MPa safety cap

    c_v_min: float = 0.0
    c_v_max: float = 1e6

    c_c_min: float = 0.0
    c_c_max: float = 1e6

    k_p_min: float = 0.0
    k_p_max: float = 1e9


@dataclass(frozen=True)
class FitTargets:
    """
    Choose which parameters are allowed to change.
    Anything False stays fixed at the base value.
    """

    b: bool = False
    n: bool = False
    L0: bool = False
    P_max: bool = False
    c_v: bool = True
    c_c: bool = True
    k_p: bool = True


@dataclass(frozen=True)
class FitObjective:
    """
    loss:
      - "rmse"
      - "mae"
      - "huber:<delta>" (e.g., huber:50)
    reg:
      - optional L2 regularization on deviations from base parameters.
        reg_lambda is applied to enabled params only.
    """

    loss: str = "rmse"
    reg_lambda: float = 0.0


@dataclass(frozen=True)
class FitSearch:
    """
    Random search settings. This is intentionally simple and robust.

    step_* are relative step sizes applied as multiplicative perturbations:
      x_new = x * exp(u), u ~ Uniform(-step, +step)
    (log-space steps avoid negative values and keep scale sane.)
    """

    iters: int = 2000
    seed: Optional[int] = 1234

    step_b: float = 0.05
    step_n: float = 0.10
    step_L0: float = 0.05
    step_Pmax: float = 0.10
    step_c_v: float = 0.30
    step_c_c: float = 0.30
    step_k_p: float = 0.30

    # Anneal factor multiplies steps over time (<=1 shrinks steps)
    anneal: float = 0.999


@dataclass(frozen=True)
class FitResult:
    best_params: PAMParams
    best_score: float
    metrics: object
    ci: Optional[object]
    history_best: List[float]


# ----------------------------
# Parameter proposal and clamping
# ----------------------------

def _logstep(x: float, step: float) -> float:
    x = float(x)
    step = float(step)
    if step < 0.0:
        raise ValueError("step must be >= 0")
    if x <= 0.0:
        x = 1e-12
    u = random.uniform(-step, +step)
    return x * math.exp(u)


def _apply_bounds(pp: PAMParams, bnd: FitBounds) -> PAMParams:
    b = float(pp.b)
    n = float(pp.n)
    L0 = float(pp.L0)
    P_max = float(pp.P_max)
    c_v = float(pp.c_v)
    c_c = float(pp.c_c)
    k_p = float(pp.k_p)

    b = min(max(b, bnd.b_min), bnd.b_max)
    n = min(max(n, bnd.n_min), bnd.n_max)
    P_max = min(max(P_max, bnd.Pmax_min), bnd.Pmax_max)

    c_v = min(max(c_v, bnd.c_v_min), bnd.c_v_max)
    c_c = min(max(c_c, bnd.c_c_min), bnd.c_c_max)
    k_p = min(max(k_p, bnd.k_p_min), bnd.k_p_max)

    # L0 must satisfy: bnd.L0_min < L0 < b
    # enforce margin to preserve geometry clamp behavior
    L0_lo = max(float(bnd.L0_min), 1e-9)
    L0_hi = max(L0_lo + 1e-9, b - 1e-9)
    L0 = min(max(L0, L0_lo), L0_hi)

    return PAMParams(
        b=b,
        n=n,
        L0=L0,
        P_max=P_max,
        c_v=c_v,
        c_c=c_c,
        k_p=k_p,
        count=int(pp.count),
    )


def _propose(base: PAMParams, tg: FitTargets, sch: FitSearch, steps: Dict[str, float]) -> PAMParams:
    b = base.b
    n = base.n
    L0 = base.L0
    P_max = base.P_max
    c_v = base.c_v
    c_c = base.c_c
    k_p = base.k_p

    if tg.b:
        b = _logstep(b, steps["b"])
    if tg.n:
        n = _logstep(n, steps["n"])
    if tg.L0:
        L0 = _logstep(L0, steps["L0"])
    if tg.P_max:
        P_max = _logstep(P_max, steps["P_max"])
    if tg.c_v:
        c_v = _logstep(max(c_v, 1e-12), steps["c_v"])
    if tg.c_c:
        c_c = _logstep(max(c_c, 1e-12), steps["c_c"])
    if tg.k_p:
        k_p = _logstep(max(k_p, 1e-12), steps["k_p"])

    return PAMParams(
        b=float(b),
        n=float(n),
        L0=float(L0),
        P_max=float(P_max),
        c_v=float(c_v),
        c_c=float(c_c),
        k_p=float(k_p),
        count=int(base.count),
    )


# ----------------------------
# Objective
# ----------------------------

def _score_from_metrics(loss_mode: str, F_true: Sequence[float], F_pred: Sequence[float]) -> float:
    m = compute_error_metrics(F_true, F_pred)
    mode = loss_mode.strip().lower()
    if mode == "rmse":
        return float(m.rmse)
    if mode == "mae":
        return float(m.mae)
    if mode.startswith("huber:"):
        try:
            delta = float(mode.split(":", 1)[1])
        except Exception as e:
            raise ValueError("Invalid huber spec. Use huber:<delta>") from e
        if delta <= 0.0:
            raise ValueError("huber delta must be > 0")
        residuals = [float(yp) - float(yt) for yt, yp in zip(F_true, F_pred)]
        return float(robust_mean_huber(residuals, delta))
    raise ValueError("Unknown loss. Use rmse, mae, or huber:<delta>")


def _l2_reg(base: PAMParams, cur: PAMParams, tg: FitTargets) -> float:
    s = 0.0
    if tg.b:
        s += (cur.b - base.b) ** 2
    if tg.n:
        s += (cur.n - base.n) ** 2
    if tg.L0:
        s += (cur.L0 - base.L0) ** 2
    if tg.P_max:
        s += (cur.P_max - base.P_max) ** 2
    if tg.c_v:
        s += (cur.c_v - base.c_v) ** 2
    if tg.c_c:
        s += (cur.c_c - base.c_c) ** 2
    if tg.k_p:
        s += (cur.k_p - base.k_p) ** 2
    return float(s)


# ----------------------------
# Main fit
# ----------------------------

def fit_pam_params_random_search(
    points: List[PlaybackPoint],
    F_true: Sequence[float],
    pam_base: PAMParams,
    pdyn: FirstOrderPressure,
    jpar: JointParams,
    cfg: EvalConfig,
    ctrl: Optional[PIForceToPressure] = None,
    tg: FitTargets = FitTargets(),
    bnd: FitBounds = FitBounds(),
    obj: FitObjective = FitObjective(),
    sch: FitSearch = FitSearch(),
    compute_ci: bool = True,
    ci_boot: int = 500,
) -> FitResult:
    """
    Random-search parameter fitting.

    Hardened behavior:
      - Enforces bounds every proposal.
      - Clones states in eval (via metrics_mc.eval_playback_force).
      - Keeps "best so far" monotone history for debugging.

    Returns:
      best_params + best_score + standard error metrics + optional bootstrap CI.
    """
    _validate_dataset(points, F_true)

    _require_finite(pam_base.b, "pam_base.b")
    _require_finite(pam_base.n, "pam_base.n")
    _require_finite(pam_base.L0, "pam_base.L0")
    _require_finite(pam_base.P_max, "pam_base.P_max")

    if sch.seed is not None:
        random.seed(int(sch.seed))
    if sch.iters <= 0:
        raise ValueError("iters must be > 0")
    if obj.reg_lambda < 0.0:
        raise ValueError("reg_lambda must be >= 0")

    # Initial step sizes
    steps = {
        "b": float(sch.step_b),
        "n": float(sch.step_n),
        "L0": float(sch.step_L0),
        "P_max": float(sch.step_Pmax),
        "c_v": float(sch.step_c_v),
        "c_c": float(sch.step_c_c),
        "k_p": float(sch.step_k_p),
    }
    if sch.anneal <= 0.0 or sch.anneal > 1.0:
        raise ValueError("anneal must be in (0,1]")

    # Evaluate base as starting best
    pam0 = _apply_bounds(pam_base, bnd)
    out0 = eval_playback_force(points, McKibbenPAM(pam0), pdyn, jpar, cfg, ctrl=ctrl)
    best_score = _score_from_metrics(obj.loss, F_true, out0.F_pred)
    best_score += float(obj.reg_lambda) * _l2_reg(pam_base, pam0, tg)
    best_params = pam0
    best_pred = list(out0.F_pred)

    history_best: List[float] = [float(best_score)]

    # Main loop
    for _ in range(int(sch.iters)):
        prop = _propose(best_params, tg, sch, steps)
        prop = _apply_bounds(prop, bnd)

        try:
            out = eval_playback_force(points, McKibbenPAM(prop), pdyn, jpar, cfg, ctrl=ctrl)
        except Exception:
            # reject invalid dynamics silently
            history_best.append(float(best_score))
            # anneal step sizes anyway
            for k in list(steps.keys()):
                steps[k] *= float(sch.anneal)
            continue

        score = _score_from_metrics(obj.loss, F_true, out.F_pred)
        if obj.reg_lambda > 0.0:
            score += float(obj.reg_lambda) * _l2_reg(pam_base, prop, tg)

        if score < best_score:
            best_score = float(score)
            best_params = prop
            best_pred = list(out.F_pred)

        history_best.append(float(best_score))

        # anneal
        for k in list(steps.keys()):
            steps[k] *= float(sch.anneal)

    # Final metrics + optional CI
    metrics = compute_error_metrics(F_true, best_pred)

    ci = None
    if compute_ci:
        # CIs describe error distribution, not parameter uncertainty.
        ci = bootstrap_metrics_ci(F_true, best_pred, n_boot=int(ci_boot), seed=sch.seed)

    return FitResult(
        best_params=best_params,
        best_score=float(best_score),
        metrics=metrics,
        ci=ci,
        history_best=history_best,
    )


# ----------------------------
# Minimal self-check
# ----------------------------

if __name__ == "__main__":
    from muscle.muscle_baseline import PressureDynParams, PressureControllerParams

    pam_base = PAMParams(b=0.35, n=12.0, L0=0.30, P_max=600_000.0, c_v=15.0, c_c=4.0, k_p=180.0, count=1)
    pd = FirstOrderPressure(PressureDynParams(tau_up=0.08, tau_dn=0.10), P_max=pam_base.P_max)
    jpar = JointParams(r=0.02, I=0.02, b=0.02, tau_ext=0.0)

    ctrl = PIForceToPressure(PressureControllerParams(kp=1e-5, ki=3e-6, P_max=pam_base.P_max))

    cfg = EvalConfig(
        L_rest=pam_base.L0,
        pam_state0=PAMState(L=pam_base.L0, Ldot=0.0, P=0.0),
        joint_state0=JointState(q=0.0, qdot=0.0),
        ctrl_state0=PressureControllerState(integ=0.0),
    )

    pts = [
        PlaybackPoint(t=0.0, q=0.0, qdot=0.0, F_ref=0.0),
        PlaybackPoint(t=0.1, q=0.1, qdot=0.0, F_ref=800.0),
        PlaybackPoint(t=0.2, q=0.1, qdot=0.0, F_ref=800.0),
        PlaybackPoint(t=0.3, q=0.0, qdot=0.0, F_ref=0.0),
    ]

    # Synthetic truth from a slightly different "real" parameter set
    pam_true = PAMParams(b=0.35, n=12.0, L0=0.30, P_max=600_000.0, c_v=22.0, c_c=6.0, k_p=220.0, count=1)
    out_true = eval_playback_force(pts, McKibbenPAM(pam_true), pd, jpar, cfg, ctrl=ctrl)
    F_true = list(out_true.F_pred)

    res = fit_pam_params_random_search(
        points=pts,
        F_true=F_true,
        pam_base=pam_base,
        pdyn=pd,
        jpar=jpar,
        cfg=cfg,
        ctrl=ctrl,
        tg=FitTargets(c_v=True, c_c=True, k_p=True, b=False, n=False, L0=False, P_max=False),
        obj=FitObjective(loss="rmse", reg_lambda=0.0),
        sch=FitSearch(iters=800, seed=7, step_c_v=0.40, step_c_c=0.40, step_k_p=0.40, anneal=0.999),
        compute_ci=True,
        ci_boot=200,
    )

    print("BEST score:", res.best_score)
    print("BEST params:", res.best_params)
    print("Metrics:", res.metrics)
    print("CI (rmse):", res.ci.rmse if res.ci is not None else None)
