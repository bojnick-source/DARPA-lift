from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Callable, Dict, List, Optional, Sequence, Tuple
import math
import random

import numpy as np

# Fragment-2 imports (must exist)
from muscle.muscle_baseline import (
    clamp,
    McKibbenPAM,
    PAMParams,
    PAMState,
)


# ----------------------------
# Metrics + helpers
# ----------------------------

def _safe_float(x: float) -> float:
    x = float(x)
    return x if math.isfinite(x) else 0.0


def rmse(y: np.ndarray, yhat: np.ndarray) -> float:
    r = yhat - y
    return _safe_float(math.sqrt(float(np.mean(r * r))))


def mae(y: np.ndarray, yhat: np.ndarray) -> float:
    return _safe_float(float(np.mean(np.abs(yhat - y))))


def r2(y: np.ndarray, yhat: np.ndarray) -> float:
    y0 = float(np.mean(y))
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y0) ** 2))
    if ss_tot <= 0.0:
        return 0.0
    return _safe_float(1.0 - ss_res / ss_tot)


def aic(n: int, sse: float, k: int) -> float:
    # Gaussian errors, unknown variance. AIC = n*ln(SSE/n) + 2k (constants omitted)
    if n <= 0:
        return 0.0
    sse = max(float(sse), 1e-12)
    return _safe_float(n * math.log(sse / n) + 2.0 * k)


def bic(n: int, sse: float, k: int) -> float:
    # BIC = n*ln(SSE/n) + k*ln(n) (constants omitted)
    if n <= 0:
        return 0.0
    sse = max(float(sse), 1e-12)
    return _safe_float(n * math.log(sse / n) + float(k) * math.log(max(n, 2)))


# ----------------------------
# Data container
# ----------------------------

@dataclass(frozen=True)
class FitSample:
    """
    One measurement sample.

    Inputs:
      P, L, Ldot define the muscle state (Fragment-2 model).
      F_meas is the measured force at that state.

    Units:
      t: s
      P: Pa
      L: m
      Ldot: m/s
      F_meas: N
    """
    t: float
    P: float
    L: float
    Ldot: float
    F_meas: float


@dataclass(frozen=True)
class FitBounds:
    """
    Bounds for fitted parameters. Fragment-4 fits only:
      k_p >= 0
      c_v >= 0
      c_c >= 0
    """
    k_p: Tuple[float, float] = (0.0, 5e4)     # N/m
    c_v: Tuple[float, float] = (0.0, 5e4)     # N/(m/s)
    c_c: Tuple[float, float] = (0.0, 5e4)     # N


@dataclass(frozen=True)
class FitOptions:
    """
    - restarts: random initial points
    - iters: coordinate-search outer iterations
    - step0: starting step size as fraction of param range
    - step_decay: step multiplier per iter if no improvement
    - seed: RNG seed for reproducibility
    - huber_delta: robust loss threshold (N). If None, pure L2.
    """
    restarts: int = 12
    iters: int = 120
    step0: float = 0.15
    step_decay: float = 0.85
    seed: int = 7
    huber_delta: Optional[float] = 75.0


@dataclass(frozen=True)
class FitResult:
    params: PAMParams
    rmse: float
    mae: float
    r2: float
    sse: float
    aic: float
    bic: float
    n: int
    k: int
    resid_mean: float
    resid_std: float


@dataclass(frozen=True)
class BootstrapCI:
    k_p_ci: Tuple[float, float]
    c_v_ci: Tuple[float, float]
    c_c_ci: Tuple[float, float]


# ----------------------------
# Robust loss (optional)
# ----------------------------

def _huber_loss(resid: np.ndarray, delta: float) -> float:
    d = float(max(delta, 1e-9))
    a = np.abs(resid)
    quad = a <= d
    out = np.where(quad, 0.5 * resid * resid, d * (a - 0.5 * d))
    return float(np.sum(out))


def _sse_loss(resid: np.ndarray) -> float:
    return float(np.sum(resid * resid))


# ----------------------------
# Prediction (strict by default)
# ----------------------------

def predict_force(
    base_params: PAMParams,
    samples: Sequence[FitSample],
    *,
    k_p: Optional[float] = None,
    c_v: Optional[float] = None,
    c_c: Optional[float] = None,
    strict: bool = True,
) -> np.ndarray:
    """
    Predict force for given samples using Fragment-2 McKibbenPAM.

    If strict=True:
      - Rejects samples with P outside [0, P_max] or L outside (0, b).
      - This prevents silent clamping from corrupting fits.

    If strict=False:
      - Allows out-of-range inputs (model will clamp internally).
    """
    # Validate params by constructing the model (Fragment-2 checks)
    _ = McKibbenPAM(base_params)

    p = base_params
    if k_p is not None or c_v is not None or c_c is not None:
        p = replace(
            p,
            k_p=float(p.k_p if k_p is None else k_p),
            c_v=float(p.c_v if c_v is None else c_v),
            c_c=float(p.c_c if c_c is None else c_c),
        )

    pam = McKibbenPAM(p)
    yhat = np.zeros(len(samples), dtype=float)
    s = PAMState(L=p.L0, Ldot=0.0, P=0.0)

    for i, sm in enumerate(samples):
        P = float(sm.P)
        L = float(sm.L)

        if strict:
            if not (0.0 <= P <= p.P_max):
                raise ValueError(f"Sample {i}: P={P} out of range [0, P_max={p.P_max}]")
            if not (0.0 < L < p.b):
                raise ValueError(f"Sample {i}: L={L} out of geometry (0, b={p.b})")

        s.P = P
        s.L = L
        s.Ldot = float(sm.Ldot)
        yhat[i] = float(pam.force(s))

    return yhat


# ----------------------------
# Fitter (derivative-free coordinate search)
# ----------------------------

def _check_bounds(lohi: Tuple[float, float], name: str) -> Tuple[float, float]:
    lo, hi = float(lohi[0]), float(lohi[1])
    if not (math.isfinite(lo) and math.isfinite(hi)):
        raise ValueError(f"Bounds for {name} must be finite")
    if hi < lo:
        raise ValueError(f"Bounds for {name} must satisfy hi >= lo")
    return lo, hi


def _clip(x: float, lohi: Tuple[float, float]) -> float:
    lo, hi = lohi
    return float(clamp(float(x), lo, hi))


def _param_ranges(b: FitBounds) -> Dict[str, float]:
    kplo, kphi = _check_bounds(b.k_p, "k_p")
    cvlo, cvhi = _check_bounds(b.c_v, "c_v")
    cclo, cchi = _check_bounds(b.c_c, "c_c")
    return {
        "k_p": float(kphi - kplo),
        "c_v": float(cvhi - cvlo),
        "c_c": float(cchi - cclo),
    }


def _eval_objective(
    base_params: PAMParams,
    samples: Sequence[FitSample],
    cand: Dict[str, float],
    huber_delta: Optional[float],
) -> Tuple[float, float, np.ndarray, np.ndarray]:
    y = np.array([float(s.F_meas) for s in samples], dtype=float)
    yhat = predict_force(
        base_params,
        samples,
        k_p=cand["k_p"],
        c_v=cand["c_v"],
        c_c=cand["c_c"],
        strict=True,
    )
    resid = yhat - y
    loss = _sse_loss(resid) if huber_delta is None else _huber_loss(resid, float(huber_delta))
    sse = _sse_loss(resid)
    return float(loss), float(sse), y, yhat


def fit_passive_and_losses(
    base_params: PAMParams,
    samples: Sequence[FitSample],
    *,
    bounds: FitBounds = FitBounds(),
    options: FitOptions = FitOptions(),
) -> FitResult:
    """
    Fits (k_p, c_v, c_c) while keeping (b, n, L0, P_max, count) fixed.

    Hardening:
    - strict sample validation (no silent clamp fitting).
    - deterministic RNG seed.
    - derivative-free coordinate search with random restarts.
    - robust Huber loss for optimization (SSE kept for reporting).
    """
    if len(samples) < 8:
        raise ValueError("Need >= 8 samples for a meaningful fit")

    # Validate params
    _ = McKibbenPAM(base_params)

    # Validate options
    if options.restarts < 1 or options.iters < 1:
        raise ValueError("restarts and iters must be >= 1")
    if not (0.0 < options.step0 <= 1.0):
        raise ValueError("step0 must be in (0, 1]")
    if not (0.0 < options.step_decay < 1.0):
        raise ValueError("step_decay must be in (0, 1)")

    # Validate sample fields (strict geometry + pressure range)
    for i, s in enumerate(samples):
        if not math.isfinite(float(s.t)):
            raise ValueError(f"Non-finite t at sample {i}")
        P = float(s.P)
        L = float(s.L)
        if not (math.isfinite(P) and 0.0 <= P <= base_params.P_max):
            raise ValueError(f"Sample {i}: P out of range [0, P_max]")
        if not (math.isfinite(L) and 0.0 < L < base_params.b):
            raise ValueError(f"Sample {i}: L out of geometry (0, b)")
        if not math.isfinite(float(s.Ldot)):
            raise ValueError(f"Invalid Ldot at sample {i}")
        if not math.isfinite(float(s.F_meas)):
            raise ValueError(f"Invalid F_meas at sample {i}")

    rng = random.Random(int(options.seed))
    pr = _param_ranges(bounds)

    kplo, kphi = _check_bounds(bounds.k_p, "k_p")
    cvlo, cvhi = _check_bounds(bounds.c_v, "c_v")
    cclo, cchi = _check_bounds(bounds.c_c, "c_c")

    def rand_in(lo: float, hi: float) -> float:
        return lo + (hi - lo) * rng.random()

    def make_start() -> Dict[str, float]:
        # Start near base params, jittered
        kp0 = _clip(float(base_params.k_p), (kplo, kphi))
        cv0 = _clip(float(base_params.c_v), (cvlo, cvhi))
        cc0 = _clip(float(base_params.c_c), (cclo, cchi))

        kp = _clip(kp0 + (rng.random() - 0.5) * 0.2 * pr["k_p"], (kplo, kphi))
        cv = _clip(cv0 + (rng.random() - 0.5) * 0.2 * pr["c_v"], (cvlo, cvhi))
        cc = _clip(cc0 + (rng.random() - 0.5) * 0.2 * pr["c_c"], (cclo, cchi))

        # If all zeros, randomize fully
        if kp0 == 0.0 and cv0 == 0.0 and cc0 == 0.0:
            kp = rand_in(kplo, kphi)
            cv = rand_in(cvlo, cvhi)
            cc = rand_in(cclo, cchi)

        return {"k_p": kp, "c_v": cv, "c_c": cc}

    best: Optional[Tuple[float, float, Dict[str, float]]] = None

    for _r in range(int(options.restarts)):
        cand = make_start()

        step_kp = max(1e-12, float(options.step0) * pr["k_p"])
        step_cv = max(1e-12, float(options.step0) * pr["c_v"])
        step_cc = max(1e-12, float(options.step0) * pr["c_c"])

        loss, sse, _, _ = _eval_objective(base_params, samples, cand, options.huber_delta)
        best_local = (loss, sse, dict(cand))

        for _it in range(int(options.iters)):
            improved = False

            for name, step, lohi in (
                ("k_p", step_kp, (kplo, kphi)),
                ("c_v", step_cv, (cvlo, cvhi)),
                ("c_c", step_cc, (cclo, cchi)),
            ):
                cur = best_local[2][name]
                for direction in (+1.0, -1.0):
                    trial = dict(best_local[2])
                    trial[name] = _clip(cur + direction * step, lohi)
                    loss_t, sse_t, _, _ = _eval_objective(base_params, samples, trial, options.huber_delta)
                    if loss_t < best_local[0]:
                        best_local = (loss_t, sse_t, trial)
                        improved = True

            if not improved:
                step_kp *= float(options.step_decay)
                step_cv *= float(options.step_decay)
                step_cc *= float(options.step_decay)
                if max(step_kp, step_cv, step_cc) < 1e-9:
                    break

        if best is None or best_local[0] < best[0]:
            best = best_local

    assert best is not None
    cand_best = best[2]

    # Final metrics computed on SSE (not robust loss)
    _, sse_final, y, yhat = _eval_objective(base_params, samples, cand_best, None)

    n = int(len(samples))
    k = 3
    resid = (yhat - y).astype(float)

    p_final = replace(
        base_params,
        k_p=float(cand_best["k_p"]),
        c_v=float(cand_best["c_v"]),
        c_c=float(cand_best["c_c"]),
    )

    return FitResult(
        params=p_final,
        rmse=rmse(y, yhat),
        mae=mae(y, yhat),
        r2=r2(y, yhat),
        sse=float(sse_final),
        aic=aic(n, float(sse_final), k),
        bic=bic(n, float(sse_final), k),
        n=n,
        k=k,
        resid_mean=_safe_float(float(np.mean(resid))),
        resid_std=_safe_float(float(np.std(resid, ddof=1))) if n > 1 else 0.0,
    )


# ----------------------------
# Bootstrap confidence intervals
# ----------------------------

def bootstrap_ci(
    base_params: PAMParams,
    samples: Sequence[FitSample],
    *,
    bounds: FitBounds = FitBounds(),
    options: FitOptions = FitOptions(),
    B: int = 200,
    alpha: float = 0.05,
) -> Tuple[FitResult, BootstrapCI]:
    """
    Percentile bootstrap for (k_p, c_v, c_c).

    Returns:
      - point estimate fit on full data
      - CI for each parameter
    """
    if B < 20:
        raise ValueError("B must be >= 20")
    B = int(min(B, 2000))
    alpha = float(clamp(alpha, 1e-6, 0.49))

    point = fit_passive_and_losses(base_params, samples, bounds=bounds, options=options)

    rng = random.Random(int(options.seed) + 999)
    n = len(samples)

    kp_list: List[float] = []
    cv_list: List[float] = []
    cc_list: List[float] = []

    for b in range(B):
        idx = [rng.randrange(0, n) for _ in range(n)]
        samp_b = [samples[i] for i in idx]
        opt_b = replace(options, seed=int(options.seed) + 1000 + b * 17)
        fit_b = fit_passive_and_losses(base_params, samp_b, bounds=bounds, options=opt_b)
        kp_list.append(float(fit_b.params.k_p))
        cv_list.append(float(fit_b.params.c_v))
        cc_list.append(float(fit_b.params.c_c))

    def pct_ci(arr: List[float]) -> Tuple[float, float]:
        a = np.array(arr, dtype=float)
        lo = float(np.quantile(a, alpha / 2.0))
        hi = float(np.quantile(a, 1.0 - alpha / 2.0))
        return (lo, hi)

    return point, BootstrapCI(
        k_p_ci=pct_ci(kp_list),
        c_v_ci=pct_ci(cv_list),
        c_c_ci=pct_ci(cc_list),
    )


# ----------------------------
# Convenience: build samples from arrays / logs
# ----------------------------

def samples_from_log(
    t: Sequence[float],
    P: Sequence[float],
    L: Sequence[float],
    Ldot: Sequence[float],
    F_meas: Sequence[float],
) -> List[FitSample]:
    if not (len(t) == len(P) == len(L) == len(Ldot) == len(F_meas)):
        raise ValueError("All sequences must have identical length")
    out: List[FitSample] = []
    for i in range(len(t)):
        out.append(FitSample(
            t=float(t[i]),
            P=float(P[i]),
            L=float(L[i]),
            Ldot=float(Ldot[i]),
            F_meas=float(F_meas[i]),
        ))
    return out


# ----------------------------
# Minimal self-check
# ----------------------------

if __name__ == "__main__":
    # Synthetic test: generate "measured" force using known params, then refit.
    true_params = PAMParams(
        b=0.35, n=12.0, L0=0.30, P_max=600_000.0,
        k_p=350.0, c_v=18.0, c_c=6.0,
        count=1
    )

    base = replace(true_params, k_p=0.0, c_v=0.0, c_c=0.0)

    rng = random.Random(3)
    N = 300
    t = np.linspace(0.0, 2.0, N)

    P = 300_000.0 + 200_000.0 * np.sin(2.0 * math.pi * t / 2.0)
    L = 0.29 + 0.015 * np.sin(2.0 * math.pi * t / 0.8)
    Ldot = np.gradient(L, t)

    sam = samples_from_log(t, P, L, Ldot, np.zeros(N))
    y_true = predict_force(true_params, sam, strict=True)

    noise = np.array([rng.gauss(0.0, 10.0) for _ in range(N)], dtype=float)
    y_meas = y_true + noise

    sam2 = samples_from_log(t, P, L, Ldot, y_meas)

    res = fit_passive_and_losses(base, sam2)
    print("FIT:", "k_p", res.params.k_p, "c_v", res.params.c_v, "c_c", res.params.c_c)
    print("RMSE", res.rmse, "R2", res.r2, "AIC", res.aic, "BIC", res.bic)

    point, ci = bootstrap_ci(base, sam2, B=80)
    print("CI k_p", ci.k_p_ci, "c_v", ci.c_v_ci, "c_c", ci.c_c_ci)
