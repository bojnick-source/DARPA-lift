from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple
import math
import random
import copy

from muscle.muscle_baseline import (
    clamp,
    PAMParams,
    PAMState,
    JointParams,
    JointState,
    PressureControllerState,
    McKibbenPAM,
    FirstOrderPressure,
    PIForceToPressure,
)
from muscle.playback import (
    PlaybackPoint,
    run_playback,
)


# ----------------------------
# Small utilities
# ----------------------------

def _is_finite(x: float) -> bool:
    return math.isfinite(float(x))


def _safe_float(x: float, name: str) -> float:
    xf = float(x)
    if not _is_finite(xf):
        raise ValueError(f"{name} must be finite")
    return xf


def _copy_state_pam(s: PAMState) -> PAMState:
    # Avoid shared mutation across runs
    return PAMState(L=float(s.L), Ldot=float(s.Ldot), P=float(s.P))


def _copy_state_joint(s: JointState) -> JointState:
    return JointState(q=float(s.q), qdot=float(s.qdot))


def _copy_state_ctrl(s: PressureControllerState) -> PressureControllerState:
    return PressureControllerState(integ=float(s.integ))


# ----------------------------
# Metrics
# ----------------------------

@dataclass(frozen=True)
class ErrorMetrics:
    n: int
    mae: float
    rmse: float
    max_abs: float
    bias: float
    r2: float


def compute_error_metrics(y_true: Sequence[float], y_pred: Sequence[float]) -> ErrorMetrics:
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have same length")
    n = len(y_true)
    if n == 0:
        raise ValueError("Need at least 1 sample")

    s_abs = 0.0
    s_sq = 0.0
    s_err = 0.0
    max_abs = 0.0

    # For R^2
    mean_true = sum(float(v) for v in y_true) / float(n)
    ss_tot = 0.0
    ss_res = 0.0

    for yt, yp in zip(y_true, y_pred):
        yt = _safe_float(yt, "y_true")
        yp = _safe_float(yp, "y_pred")
        e = yp - yt
        ae = abs(e)
        s_abs += ae
        s_sq += e * e
        s_err += e
        if ae > max_abs:
            max_abs = ae
        d = yt - mean_true
        ss_tot += d * d
        ss_res += e * e

    mae = s_abs / float(n)
    rmse = math.sqrt(s_sq / float(n))
    bias = s_err / float(n)

    # Handle constant signal
    if ss_tot <= 1e-18:
        r2 = 0.0 if ss_res > 0.0 else 1.0
    else:
        r2 = 1.0 - (ss_res / ss_tot)

    return ErrorMetrics(
        n=n,
        mae=float(mae),
        rmse=float(rmse),
        max_abs=float(max_abs),
        bias=float(bias),
        r2=float(r2),
    )


def huber_loss(residual: float, delta: float) -> float:
    r = abs(float(residual))
    d = float(delta)
    if d <= 0.0:
        raise ValueError("delta must be > 0")
    if r <= d:
        return 0.5 * r * r
    return d * (r - 0.5 * d)


def robust_mean_huber(residuals: Sequence[float], delta: float) -> float:
    if len(residuals) == 0:
        raise ValueError("Need at least 1 residual")
    s = 0.0
    for r in residuals:
        s += huber_loss(float(r), delta)
    return s / float(len(residuals))


# ----------------------------
# Trajectory evaluation helper
# ----------------------------

@dataclass(frozen=True)
class EvalConfig:
    L_rest: float
    pam_state0: PAMState
    joint_state0: JointState
    ctrl_state0: Optional[PressureControllerState] = None
    force_ref_fn: Optional[Callable[[float], float]] = None


@dataclass(frozen=True)
class TrajectoryEvalResult:
    t: List[float]
    F_pred: List[float]
    P: List[float]
    P_cmd: List[float]
    q: List[float]
    qdot: List[float]


def eval_playback_force(
    points: List[PlaybackPoint],
    pam: McKibbenPAM,
    pdyn: FirstOrderPressure,
    jpar: JointParams,
    cfg: EvalConfig,
    ctrl: Optional[PIForceToPressure] = None,
) -> TrajectoryEvalResult:
    """
    Runs Fragment-3 playback but returns only the key traces for scoring.
    Hardened behavior:
      - clones states to avoid mutation leakage between experiments.
    """
    s_pam = _copy_state_pam(cfg.pam_state0)
    s_joint = _copy_state_joint(cfg.joint_state0)
    cs = _copy_state_ctrl(cfg.ctrl_state0) if cfg.ctrl_state0 is not None else None

    log = run_playback(
        points=points,
        pam=pam,
        pdyn=pdyn,
        jpar=jpar,
        L_rest=float(cfg.L_rest),
        s_pam=s_pam,
        s_joint=s_joint,
        ctrl=ctrl,
        ctrl_state=cs,
        force_ref_fn=cfg.force_ref_fn,
    )

    return TrajectoryEvalResult(
        t=list(log.t),
        F_pred=list(log.F),
        P=list(log.P),
        P_cmd=list(log.P_cmd),
        q=list(log.q),
        qdot=list(log.qdot),
    )


# ----------------------------
# Monte Carlo sweep over parameters
# ----------------------------

@dataclass(frozen=True)
class ParamPerturbation:
    """
    Relative perturbations are multiplicative (1 + u), where u ~ Uniform(-rel, +rel).
    Absolute perturbations are additive.
    Any field set to None means "do not perturb".
    """

    rel_b: Optional[float] = None
    rel_n: Optional[float] = None
    rel_L0: Optional[float] = None
    rel_P_max: Optional[float] = None

    rel_c_v: Optional[float] = None
    rel_c_c: Optional[float] = None
    rel_k_p: Optional[float] = None

    # Optional absolute perturbations
    abs_L0: Optional[float] = None  # meters
    abs_P_max: Optional[float] = None  # Pa


@dataclass(frozen=True)
class SweepScore:
    pam_params: PAMParams
    metrics: ErrorMetrics
    score: float  # default: RMSE


@dataclass(frozen=True)
class SweepResult:
    scores_sorted: List[SweepScore]


def _rand_rel(rel: float) -> float:
    r = float(rel)
    if r < 0.0:
        raise ValueError("relative perturbation must be >= 0")
    return 1.0 + random.uniform(-r, +r)


def _rand_abs(abs_mag: float) -> float:
    a = float(abs_mag)
    if a < 0.0:
        raise ValueError("absolute perturbation must be >= 0")
    return random.uniform(-a, +a)


def _perturb_params(base: PAMParams, p: ParamPerturbation) -> PAMParams:
    b = float(base.b)
    n = float(base.n)
    L0 = float(base.L0)
    P_max = float(base.P_max)
    c_v = float(base.c_v)
    c_c = float(base.c_c)
    k_p = float(base.k_p)

    if p.rel_b is not None:
        b *= _rand_rel(p.rel_b)
    if p.rel_n is not None:
        n *= _rand_rel(p.rel_n)
    if p.rel_L0 is not None:
        L0 *= _rand_rel(p.rel_L0)
    if p.abs_L0 is not None:
        L0 += _rand_abs(p.abs_L0)

    if p.rel_P_max is not None:
        P_max *= _rand_rel(p.rel_P_max)
    if p.abs_P_max is not None:
        P_max += _rand_abs(p.abs_P_max)

    if p.rel_c_v is not None:
        c_v *= _rand_rel(p.rel_c_v)
    if p.rel_c_c is not None:
        c_c *= _rand_rel(p.rel_c_c)
    if p.rel_k_p is not None:
        k_p *= _rand_rel(p.rel_k_p)

    # Harden: enforce nonneg for loss terms and strict constraints for geometry.
    c_v = max(0.0, c_v)
    c_c = max(0.0, c_c)
    k_p = max(0.0, k_p)

    # Keep L0 strictly inside (0, b) per Fragment-2 rules.
    # If perturbation pushes it out, clamp safely with margin.
    if b <= 1e-6:
        b = 1e-6
    L0 = clamp(L0, 1e-6, b - 1e-6)

    if P_max <= 1.0:
        P_max = 1.0

    return PAMParams(
        b=b,
        n=max(1e-6, n),
        L0=L0,
        P_max=P_max,
        c_v=c_v,
        c_c=c_c,
        k_p=k_p,
        count=int(base.count),
    )


def monte_carlo_sweep(
    points: List[PlaybackPoint],
    F_true: Sequence[float],
    pam_base: PAMParams,
    pdyn: FirstOrderPressure,
    jpar: JointParams,
    cfg: EvalConfig,
    ctrl: Optional[PIForceToPressure],
    perturb: ParamPerturbation,
    n_samples: int = 200,
    score_fn: str = "rmse",
    seed: Optional[int] = 1234,
    top_k: int = 10,
) -> SweepResult:
    """
    Sweeps PAMParams around pam_base, evaluates predicted force vs F_true.

    score_fn:
      - "rmse" (default)
      - "mae"
      - "huber:<delta>" e.g. "huber:50.0"

    Returns top_k best (lowest score).
    """
    if seed is not None:
        random.seed(int(seed))
    if n_samples <= 0:
        raise ValueError("n_samples must be > 0")
    if top_k <= 0:
        raise ValueError("top_k must be > 0")

    # Parse score function
    mode = score_fn.strip().lower()
    huber_delta: Optional[float] = None
    if mode.startswith("huber:"):
        try:
            huber_delta = float(mode.split(":", 1)[1])
        except Exception as e:
            raise ValueError("Invalid huber score spec. Use 'huber:<delta>'") from e
        if huber_delta <= 0.0:
            raise ValueError("huber delta must be > 0")
        mode = "huber"

    scores: List[SweepScore] = []

    for _ in range(int(n_samples)):
        pp = _perturb_params(pam_base, perturb)
        pam = McKibbenPAM(pp)

        out = eval_playback_force(
            points=points,
            pam=pam,
            pdyn=pdyn,
            jpar=jpar,
            cfg=cfg,
            ctrl=ctrl,
        )

        if len(out.F_pred) != len(F_true):
            raise ValueError("F_true length must match playback sample count")

        metrics = compute_error_metrics(F_true, out.F_pred)

        if mode == "rmse":
            score = metrics.rmse
        elif mode == "mae":
            score = metrics.mae
        elif mode == "huber":
            # score = mean huber loss on residuals
            residuals = [float(yp) - float(yt) for yt, yp in zip(F_true, out.F_pred)]
            score = robust_mean_huber(residuals, float(huber_delta))
        else:
            raise ValueError("Unknown score_fn. Use rmse, mae, or huber:<delta>")

        scores.append(SweepScore(pam_params=pp, metrics=metrics, score=float(score)))

    scores_sorted = sorted(scores, key=lambda s: s.score)
    return SweepResult(scores_sorted=scores_sorted[: int(top_k)])


# ----------------------------
# Bootstrap confidence intervals on metrics
# ----------------------------

@dataclass(frozen=True)
class BootstrapCI:
    p05: float
    p50: float
    p95: float


@dataclass(frozen=True)
class BootstrapResult:
    mae: BootstrapCI
    rmse: BootstrapCI
    bias: BootstrapCI
    max_abs: BootstrapCI
    r2: BootstrapCI


def _percentile(xs: List[float], p: float) -> float:
    if len(xs) == 0:
        raise ValueError("Empty list")
    if not (0.0 <= p <= 1.0):
        raise ValueError("p must be in [0,1]")
    ys = sorted(xs)
    # linear interpolation
    idx = p * (len(ys) - 1)
    i0 = int(math.floor(idx))
    i1 = int(math.ceil(idx))
    if i0 == i1:
        return float(ys[i0])
    w = idx - float(i0)
    return float(ys[i0] * (1.0 - w) + ys[i1] * w)


def bootstrap_metrics_ci(
    y_true: Sequence[float],
    y_pred: Sequence[float],
    n_boot: int = 1000,
    seed: Optional[int] = 1234,
) -> BootstrapResult:
    if seed is not None:
        random.seed(int(seed))
    if n_boot <= 0:
        raise ValueError("n_boot must be > 0")
    if len(y_true) != len(y_pred):
        raise ValueError("y_true and y_pred must have same length")
    n = len(y_true)
    if n < 2:
        raise ValueError("Need at least 2 samples for bootstrap")

    maes: List[float] = []
    rmses: List[float] = []
    biases: List[float] = []
    maxabs: List[float] = []
    r2s: List[float] = []

    for _ in range(int(n_boot)):
        idxs = [random.randrange(0, n) for _ in range(n)]
        yt = [float(y_true[i]) for i in idxs]
        yp = [float(y_pred[i]) for i in idxs]
        m = compute_error_metrics(yt, yp)
        maes.append(m.mae)
        rmses.append(m.rmse)
        biases.append(m.bias)
        maxabs.append(m.max_abs)
        r2s.append(m.r2)

    def ci(xs: List[float]) -> BootstrapCI:
        return BootstrapCI(
            p05=_percentile(xs, 0.05),
            p50=_percentile(xs, 0.50),
            p95=_percentile(xs, 0.95),
        )

    return BootstrapResult(
        mae=ci(maes),
        rmse=ci(rmses),
        bias=ci(biases),
        max_abs=ci(maxabs),
        r2=ci(r2s),
    )


# ----------------------------
# Minimal self-check example
# ----------------------------

if __name__ == "__main__":
    from muscle.muscle_baseline import PressureDynParams, PressureControllerParams

    # Nominal model
    pam_params = PAMParams(b=0.35, n=12.0, L0=0.30, P_max=600_000.0, c_v=20.0, c_c=5.0, k_p=200.0, count=1)
    pam = McKibbenPAM(pam_params)

    pd = FirstOrderPressure(PressureDynParams(tau_up=0.08, tau_dn=0.10), P_max=pam_params.P_max)
    jpar = JointParams(r=0.02, I=0.02, b=0.02, tau_ext=0.0)

    ctrl = PIForceToPressure(PressureControllerParams(kp=1e-5, ki=3e-6, P_max=pam_params.P_max))
    cfg = EvalConfig(
        L_rest=pam_params.L0,
        pam_state0=PAMState(L=pam_params.L0, Ldot=0.0, P=0.0),
        joint_state0=JointState(q=0.0, qdot=0.0),
        ctrl_state0=PressureControllerState(integ=0.0),
        force_ref_fn=None,
    )

    # Kinematic points
    pts = [
        PlaybackPoint(t=0.0, q=0.0, qdot=0.0, F_ref=0.0),
        PlaybackPoint(t=0.1, q=0.1, qdot=0.0, F_ref=800.0),
        PlaybackPoint(t=0.2, q=0.1, qdot=0.0, F_ref=800.0),
        PlaybackPoint(t=0.3, q=0.0, qdot=0.0, F_ref=0.0),
    ]

    # "Truth" for demo: just run the nominal model to generate F_true
    out = eval_playback_force(pts, pam, pd, jpar, cfg, ctrl=ctrl)
    F_true = list(out.F_pred)

    # Perturb and sweep
    sweep = monte_carlo_sweep(
        points=pts,
        F_true=F_true,
        pam_base=pam_params,
        pdyn=pd,
        jpar=jpar,
        cfg=cfg,
        ctrl=ctrl,
        perturb=ParamPerturbation(rel_c_v=0.20, rel_c_c=0.20, rel_k_p=0.20),
        n_samples=50,
        score_fn="rmse",
        seed=7,
        top_k=5,
    )

    best = sweep.scores_sorted[0]
    print("BEST score:", best.score)
    print("BEST metrics:", best.metrics)
    print("BEST params:", best.pam_params)

    # CI on nominal (should be tight because it's self-consistent)
    ci = bootstrap_metrics_ci(F_true, out.F_pred, n_boot=200, seed=7)
    print("Bootstrap RMSE CI:", ci.rmse)
