from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple
import csv
import math
import statistics

from muscle.muscle_baseline import (
    clamp,
    PAMParams,
    PAMState,
    McKibbenPAM,
)


# ----------------------------
# Data containers
# ----------------------------

@dataclass(frozen=True)
class ForceSample:
    """
    One observation.
      L: length (m)
      Ldot: length rate (m/s)
      P: pressure (Pa)
      F: measured force (N)
    """

    L: float
    Ldot: float
    P: float
    F: float


@dataclass(frozen=True)
class FitBounds:
    c_v: Tuple[float, float]   # >=0
    c_c: Tuple[float, float]   # >=0
    k_p: Tuple[float, float]   # >=0


@dataclass(frozen=True)
class FitConfig:
    """
    Coordinate descent config.
    loss: "l2" (default) or "rmse"
    """

    bounds: FitBounds
    init: Dict[str, float]                 # keys: "c_v","c_c","k_p"
    step_frac: float = 0.25                # fraction of each parameter range
    step_shrink: float = 0.5               # multiply steps by this when no improvement
    min_step: float = 1e-6                 # stop when max step < min_step
    max_iters: int = 200
    loss: str = "l2"


@dataclass(frozen=True)
class FitResult:
    params: Dict[str, float]               # fitted c_v,c_c,k_p
    loss: float
    metrics: Dict[str, float]              # rmse, mae, r2
    iters: int


# ----------------------------
# Validation + helpers
# ----------------------------

def _is_finite(x: float) -> bool:
    return math.isfinite(float(x))


def _validate_bounds(b: FitBounds) -> None:
    for name, (lo, hi) in (("c_v", b.c_v), ("c_c", b.c_c), ("k_p", b.k_p)):
        lo = float(lo)
        hi = float(hi)
        if lo < 0.0 or hi < 0.0:
            raise ValueError(f"{name} bounds must be >= 0")
        if not (hi > lo):
            raise ValueError(f"{name} bounds must satisfy hi > lo")


def _validate_config(cfg: FitConfig) -> None:
    _validate_bounds(cfg.bounds)
    if cfg.step_frac <= 0.0:
        raise ValueError("step_frac must be > 0")
    if not (0.0 < cfg.step_shrink < 1.0):
        raise ValueError("step_shrink must be in (0, 1)")
    if cfg.min_step <= 0.0:
        raise ValueError("min_step must be > 0")
    if cfg.max_iters < 1:
        raise ValueError("max_iters must be >= 1")
    if cfg.loss not in ("l2", "rmse"):
        raise ValueError("loss must be one of: 'l2', 'rmse'")


def _range_width(lo_hi: Tuple[float, float]) -> float:
    lo, hi = lo_hi
    return float(hi) - float(lo)


def _clamp_params_to_bounds(x: Dict[str, float], b: FitBounds) -> Dict[str, float]:
    return {
        "c_v": clamp(float(x["c_v"]), b.c_v[0], b.c_v[1]),
        "c_c": clamp(float(x["c_c"]), b.c_c[0], b.c_c[1]),
        "k_p": clamp(float(x["k_p"]), b.k_p[0], b.k_p[1]),
    }


# ----------------------------
# I/O
# ----------------------------

def load_force_samples_csv(path: str) -> List[ForceSample]:
    """
    CSV must include columns: L, Ldot, P, F (case-sensitive).
    """
    out: List[ForceSample] = []
    with open(path, "r", newline="") as f:
        r = csv.DictReader(f)
        needed = {"L", "Ldot", "P", "F"}
        if r.fieldnames is None or not needed.issubset(set(r.fieldnames)):
            raise ValueError("CSV must include headers: L, Ldot, P, F")
        for row in r:
            try:
                L = float(row["L"])
                Ldot = float(row["Ldot"])
                P = float(row["P"])
                F = float(row["F"])
            except Exception:
                continue
            if not (_is_finite(L) and _is_finite(Ldot) and _is_finite(P) and _is_finite(F)):
                continue
            out.append(ForceSample(L=L, Ldot=Ldot, P=P, F=F))
    return out


def sanitize_samples(samples: Iterable[ForceSample], b_fiber: float) -> List[ForceSample]:
    """
    Drops samples with invalid geometry (L <= 0 or L >= b_fiber) or non-finite values.
    """
    bf = float(b_fiber)
    out: List[ForceSample] = []
    for s in samples:
        if not (_is_finite(s.L) and _is_finite(s.Ldot) and _is_finite(s.P) and _is_finite(s.F)):
            continue
        if float(s.L) <= 0.0:
            continue
        if float(s.L) >= bf:
            continue
        out.append(s)
    return out


# ----------------------------
# Objective + metrics
# ----------------------------

def _predict_forces(base: PAMParams, x: Dict[str, float], samples: List[ForceSample]) -> List[float]:
    pam_p = PAMParams(
        b=base.b,
        n=base.n,
        L0=base.L0,
        P_max=base.P_max,
        c_v=float(x["c_v"]),
        c_c=float(x["c_c"]),
        k_p=float(x["k_p"]),
        count=base.count,
    )
    pam = McKibbenPAM(pam_p)

    yhat: List[float] = []
    for s in samples:
        st = PAMState(L=float(s.L), Ldot=float(s.Ldot), P=float(s.P))
        yhat.append(float(pam.force(st)))
    return yhat


def _loss_value(y: List[float], yhat: List[float], loss: str) -> float:
    if len(y) != len(yhat) or len(y) == 0:
        raise ValueError("Loss requires non-empty y and yhat of equal length")
    if loss == "l2":
        # 0.5 * sum(e^2) for numeric stability and gradient-style convention
        sse = 0.0
        for a, b in zip(y, yhat):
            e = float(a) - float(b)
            sse += e * e
        return 0.5 * sse
    # rmse
    sse = 0.0
    for a, b in zip(y, yhat):
        e = float(a) - float(b)
        sse += e * e
    return math.sqrt(sse / float(len(y)))


def _metrics(y: List[float], yhat: List[float]) -> Dict[str, float]:
    n = len(y)
    if n == 0:
        raise ValueError("Metrics require non-empty data")

    abs_err = [abs(float(a) - float(b)) for a, b in zip(y, yhat)]
    sq_err = [(float(a) - float(b)) ** 2 for a, b in zip(y, yhat)]

    rmse = math.sqrt(sum(sq_err) / float(n))
    mae = sum(abs_err) / float(n)

    y_mean = statistics.mean(y)
    ss_tot = sum((float(a) - y_mean) ** 2 for a in y)
    ss_res = sum(sq_err)

    # Hardened constant-target case
    if ss_tot == 0.0:
        r2 = 1.0 if ss_res == 0.0 else 0.0
    else:
        r2 = 1.0 - (ss_res / ss_tot)

    return {"rmse": float(rmse), "mae": float(mae), "r2": float(r2)}


# ----------------------------
# Coordinate descent
# ----------------------------

def fit_loss_terms(
    base: PAMParams,
    samples: List[ForceSample],
    cfg: FitConfig,
) -> FitResult:
    """
    Fits c_v, c_c, k_p to measured force samples.

    base supplies b,n,L0,P_max,count. Only (c_v,c_c,k_p) are fitted.
    """
    _validate_config(cfg)

    if base.b <= 0.0 or base.n <= 0.0 or base.P_max <= 0.0:
        raise ValueError("Base PAMParams invalid: b,n,P_max must be > 0")
    if not (0.0 < base.L0 < base.b):
        raise ValueError("Base PAMParams invalid: require 0 < L0 < b")
    if base.count < 1:
        raise ValueError("Base PAMParams invalid: count must be >= 1")

    clean = sanitize_samples(samples, b_fiber=base.b)
    if len(clean) < 1:
        raise ValueError("No valid samples after sanitization")

    y = [float(s.F) for s in clean]

    # Init (clamped)
    x = {"c_v": float(cfg.init.get("c_v", 0.0)),
         "c_c": float(cfg.init.get("c_c", 0.0)),
         "k_p": float(cfg.init.get("k_p", 0.0))}
    x = _clamp_params_to_bounds(x, cfg.bounds)

    # Steps from ranges
    steps = {
        "c_v": cfg.step_frac * _range_width(cfg.bounds.c_v),
        "c_c": cfg.step_frac * _range_width(cfg.bounds.c_c),
        "k_p": cfg.step_frac * _range_width(cfg.bounds.k_p),
    }
    # If any range is tiny, enforce a minimum workable initial step
    for k in steps:
        if steps[k] <= 0.0:
            steps[k] = cfg.min_step

    def eval_loss(xcand: Dict[str, float]) -> float:
        yhat = _predict_forces(base, xcand, clean)
        return float(_loss_value(y, yhat, cfg.loss))

    best_loss = eval_loss(x)
    best_x = dict(x)

    it = 0
    for it in range(1, cfg.max_iters + 1):
        improved = False

        for key in ("c_v", "c_c", "k_p"):
            step = float(steps[key])
            if step < cfg.min_step:
                continue

            lo, hi = getattr(cfg.bounds, key)
            cur = float(best_x[key])

            # Try +/- step
            candidates = [
                clamp(cur + step, lo, hi),
                clamp(cur - step, lo, hi),
            ]

            for val in candidates:
                xc = dict(best_x)
                xc[key] = float(val)
                Lc = eval_loss(xc)
                if Lc + 1e-12 < best_loss:
                    best_loss = float(Lc)
                    best_x = xc
                    improved = True

        if not improved:
            # shrink all steps
            for k in steps:
                steps[k] = float(steps[k]) * float(cfg.step_shrink)

        if max(abs(float(steps[k])) for k in steps) < cfg.min_step:
            break

    # Final metrics
    yhat_best = _predict_forces(base, best_x, clean)
    mets = _metrics(y, yhat_best)

    return FitResult(params=best_x, loss=float(best_loss), metrics=mets, iters=int(it))


# ----------------------------
# Minimal self-check
# ----------------------------

if __name__ == "__main__":
    # Synthetic smoke test (does not prove correctness on real hardware data)
    base = PAMParams(b=0.35, n=12.0, L0=0.30, P_max=600_000.0, count=1)

    # Generate a tiny synthetic dataset with known loss terms
    true_x = {"c_v": 15.0, "c_c": 3.0, "k_p": 150.0}
    synth = []
    for i in range(40):
        L = 0.30 - 0.02 * (i / 39.0)
        Ldot = -0.10 + 0.20 * (i / 39.0)
        P = 200_000.0 + 50_000.0 * math.sin(i / 10.0)
        yhat = _predict_forces(base, true_x, [ForceSample(L, Ldot, P, 0.0)])[0]
        # add small noise
        F = yhat + 2.0 * math.sin(i)
        synth.append(ForceSample(L=L, Ldot=Ldot, P=P, F=F))

    cfg = FitConfig(
        bounds=FitBounds(c_v=(0.0, 50.0), c_c=(0.0, 20.0), k_p=(0.0, 500.0)),
        init={"c_v": 5.0, "c_c": 1.0, "k_p": 50.0},
        step_frac=0.25,
        step_shrink=0.5,
        min_step=1e-4,
        max_iters=200,
        loss="l2",
    )

    res = fit_loss_terms(base, synth, cfg)
    print("Fit:", res.params, "loss:", res.loss, "metrics:", res.metrics, "iters:", res.iters)
