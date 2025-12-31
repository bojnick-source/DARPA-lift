from __future__ import annotations

from dataclasses import dataclass, asdict, replace
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Union
import csv
import json
import math

import numpy as np

# Fragment 2
from muscle.muscle_baseline import (
    clamp,
    McKibbenPAM,
    PAMParams,
    PAMState,
    PressureDynParams,
    FirstOrderPressure,
    JointParams,
    JointState,
    PressureControllerParams,
    PressureControllerState,
    PIForceToPressure,
)

# Fragment 3
from muscle.playback import (
    PlaybackPoint,
    PlaybackLog,
    run_playback,
)

# Fragment 4
from muscle.fitting import (
    FitSample,
    FitBounds,
    FitOptions,
    FitResult,
    BootstrapCI,
    samples_from_log,
    fit_passive_and_losses,
    bootstrap_ci,
    predict_force,
)


# ----------------------------
# IO: CSV loading
# ----------------------------

@dataclass(frozen=True)
class CSVSchema:
    """
    Column names for a dataset.

    Required for fitting:
      t, P, L, Ldot, F_meas

    Optional for playback:
      q, qdot, tau_ext, P_cmd, F_ref
    """

    t: str = "t"
    P: str = "P"
    L: str = "L"
    Ldot: str = "Ldot"
    F_meas: str = "F_meas"

    q: str = "q"
    qdot: str = "qdot"
    tau_ext: str = "tau_ext"
    P_cmd: str = "P_cmd"
    F_ref: str = "F_ref"


def _require_file(path: Union[str, Path]) -> Path:
    p = Path(path)
    if not p.exists() or not p.is_file():
        raise FileNotFoundError(f"CSV not found: {p}")
    return p


def _ensure_limit(limit: Optional[int]) -> Optional[int]:
    if limit is None:
        return None
    n = int(limit)
    if n <= 0:
        raise ValueError("limit must be positive if provided")
    return n


def _to_float(row: Dict[str, str], key: str, *, required: bool) -> Optional[float]:
    if key not in row:
        if required:
            raise ValueError(f"Missing required column: {key}")
        return None

    raw = row.get(key, "")
    if raw is None:
        if required:
            raise ValueError(f"Missing required value for: {key}")
        return None

    s = str(raw).strip()
    if s == "":
        if required:
            raise ValueError(f"Empty required value for: {key}")
        return None

    x = float(s)
    if not math.isfinite(x):
        raise ValueError(f"Non-finite value in column {key}: {s}")
    return x


def _check_required_headers(fieldnames: Sequence[str], required: Sequence[str]) -> None:
    have = set(fieldnames)
    missing = [c for c in required if c not in have]
    if missing:
        raise ValueError(f"CSV header missing required columns: {missing}")


def load_fit_samples_csv(
    csv_path: Union[str, Path],
    *,
    schema: CSVSchema = CSVSchema(),
    limit: Optional[int] = None,
) -> List[FitSample]:
    """
    Loads FitSample list from CSV with columns: t,P,L,Ldot,F_meas.
    """
    p = _require_file(csv_path)
    lim = _ensure_limit(limit)

    out: List[FitSample] = []

    with p.open("r", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV has no header row")

        _check_required_headers(
            reader.fieldnames,
            [schema.t, schema.P, schema.L, schema.Ldot, schema.F_meas],
        )

        for row in reader:
            if lim is not None and len(out) >= lim:
                break

            t = _to_float(row, schema.t, required=True)
            P = _to_float(row, schema.P, required=True)
            L = _to_float(row, schema.L, required=True)
            Ldot = _to_float(row, schema.Ldot, required=True)
            Fm = _to_float(row, schema.F_meas, required=True)

            assert t is not None and P is not None and L is not None and Ldot is not None and Fm is not None
            out.append(FitSample(t=t, P=P, L=L, Ldot=Ldot, F_meas=Fm))

    if len(out) < 2:
        raise ValueError("Loaded <2 fit samples. Bad file or schema.")
    return out


def load_playback_points_csv(
    csv_path: Union[str, Path],
    *,
    schema: CSVSchema = CSVSchema(),
    limit: Optional[int] = None,
) -> List[PlaybackPoint]:
    """
    Loads PlaybackPoint list from CSV.

    You can provide kinematic mode columns (q, qdot) OR none (dynamic mode).
    Optional: tau_ext, P_cmd, F_ref.
    """
    p = _require_file(csv_path)
    lim = _ensure_limit(limit)

    out: List[PlaybackPoint] = []

    with p.open("r", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV has no header row")

        _check_required_headers(reader.fieldnames, [schema.t])

        for row in reader:
            if lim is not None and len(out) >= lim:
                break

            t = _to_float(row, schema.t, required=True)
            q = _to_float(row, schema.q, required=False)
            qdot = _to_float(row, schema.qdot, required=False)
            tau_ext = _to_float(row, schema.tau_ext, required=False)
            P_cmd = _to_float(row, schema.P_cmd, required=False)
            F_ref = _to_float(row, schema.F_ref, required=False)

            assert t is not None
            out.append(
                PlaybackPoint(
                    t=t,
                    q=q,
                    qdot=qdot,
                    tau_ext=tau_ext,
                    P_cmd=P_cmd,
                    F_ref=F_ref,
                )
            )

    if len(out) < 2:
        raise ValueError("Loaded <2 playback points. Bad file or schema.")
    return out


# ----------------------------
# Reporting
# ----------------------------

def _jsonable(x: Any) -> Any:
    # Numpy scalars
    if isinstance(x, (np.integer, np.floating, np.bool_)):
        return x.item()

    if isinstance(x, (str, int, float, bool)) or x is None:
        return x

    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]

    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}

    # dataclasses
    if hasattr(x, "__dataclass_fields__"):
        return _jsonable(asdict(x))

    return str(x)


def save_report_json(report: Dict[str, Any], path: Union[str, Path]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w") as f:
        json.dump(_jsonable(report), f, indent=2, sort_keys=True)


# ----------------------------
# Pipeline: Fit + Bootstrap + Predictions
# ----------------------------

@dataclass(frozen=True)
class PipelineConfig:
    """
    base_params are the physical geometry + limits.
    The fitted parameters (k_p, c_v, c_c) override base for the result.
    """

    base_params: PAMParams
    fit_bounds: FitBounds = FitBounds()
    fit_options: FitOptions = FitOptions()

    do_bootstrap: bool = True
    bootstrap_B: int = 200
    bootstrap_alpha: float = 0.05

    export_predictions: bool = True


def run_fit_pipeline(samples: Sequence[FitSample], cfg: PipelineConfig) -> Dict[str, Any]:
    if len(samples) < 2:
        raise ValueError("Need at least 2 samples to fit")
    if len(samples) < 8:
        raise ValueError("Need at least 8 samples for a meaningful fit (per fit_passive_and_losses)")

    if not (0.0 < float(cfg.bootstrap_alpha) < 1.0):
        raise ValueError("bootstrap_alpha must be in (0,1)")
    if int(cfg.bootstrap_B) <= 0:
        raise ValueError("bootstrap_B must be positive")

    # Enforce base model validity early
    _ = McKibbenPAM(cfg.base_params)

    fit_res: FitResult = fit_passive_and_losses(
        cfg.base_params,
        samples,
        bounds=cfg.fit_bounds,
        options=cfg.fit_options,
    )

    report: Dict[str, Any] = {
        "base_params": asdict(cfg.base_params),
        "fit_bounds": asdict(cfg.fit_bounds),
        "fit_options": asdict(cfg.fit_options),
        "fit_result": {
            "params": asdict(fit_res.params),
            "rmse": fit_res.rmse,
            "mae": fit_res.mae,
            "r2": fit_res.r2,
            "sse": fit_res.sse,
            "aic": fit_res.aic,
            "bic": fit_res.bic,
            "n": fit_res.n,
            "k": fit_res.k,
            "resid_mean": fit_res.resid_mean,
            "resid_std": fit_res.resid_std,
        },
    }

    if cfg.do_bootstrap:
        _, ci = bootstrap_ci(
            cfg.base_params,
            samples,
            bounds=cfg.fit_bounds,
            options=cfg.fit_options,
            B=int(cfg.bootstrap_B),
            alpha=float(cfg.bootstrap_alpha),
        )
        report["bootstrap"] = {
            "B": int(cfg.bootstrap_B),
            "alpha": float(cfg.bootstrap_alpha),
            "ci": {
                "k_p": list(ci.k_p_ci),
                "c_v": list(ci.c_v_ci),
                "c_c": list(ci.c_c_ci),
            },
        }

    if cfg.export_predictions:
        y = np.array([float(s.F_meas) for s in samples], dtype=float)
        yhat = predict_force(fit_res.params, samples, strict=True)
        resid = yhat - y

        report["predictions"] = {
            "y_mean": float(np.mean(y)),
            "yhat_mean": float(np.mean(yhat)),
            "resid_mean": float(np.mean(resid)),
            "resid_std": float(np.std(resid, ddof=1)) if len(resid) > 1 else 0.0,
            "resid_p95_abs": float(np.quantile(np.abs(resid), 0.95)),
        }

    return report


# ----------------------------
# Pipeline: Playback runner
# ----------------------------

@dataclass(frozen=True)
class PlaybackConfig:
    pam_params: PAMParams
    pressure_dyn: PressureDynParams
    joint_params: JointParams
    L_rest: float

    use_controller: bool = True
    controller_params: PressureControllerParams = PressureControllerParams(
        kp=1e-5, ki=3e-6, P_max=600_000.0
    )


def run_playback_pipeline(
    points: Sequence[PlaybackPoint],
    cfg: PlaybackConfig,
    *,
    s0_pam: Optional[PAMState] = None,
    s0_joint: Optional[JointState] = None,
) -> Dict[str, Any]:
    if len(points) < 2:
        raise ValueError("Need at least 2 playback points")

    pam = McKibbenPAM(cfg.pam_params)
    pdyn = FirstOrderPressure(cfg.pressure_dyn, P_max=cfg.pam_params.P_max)

    if cfg.L_rest <= 0.0 or cfg.L_rest >= cfg.pam_params.b:
        raise ValueError("L_rest must satisfy 0 < L_rest < b")

    s_pam = s0_pam if s0_pam is not None else PAMState(L=cfg.L_rest, Ldot=0.0, P=0.0)
    s_joint = s0_joint if s0_joint is not None else JointState(q=0.0, qdot=0.0)

    ctrl: Optional[PIForceToPressure]
    cs: Optional[PressureControllerState]

    if cfg.use_controller:
        # Force controller's P_max to match actuator P_max
        cp = replace(cfg.controller_params, P_max=cfg.pam_params.P_max)
        ctrl = PIForceToPressure(cp)
        cs = PressureControllerState()
    else:
        ctrl = None
        cs = None

    log: PlaybackLog = run_playback(
        points=list(points),
        pam=pam,
        pdyn=pdyn,
        jpar=cfg.joint_params,
        L_rest=cfg.L_rest,
        s_pam=s_pam,
        s_joint=s_joint,
        ctrl=ctrl,
        ctrl_state=cs,
        force_ref_fn=None,
    )

    P_arr = np.array(log.P, dtype=float)
    F_arr = np.array(log.F, dtype=float)

    out: Dict[str, Any] = {
        "pam_params": asdict(cfg.pam_params),
        "pressure_dyn": asdict(cfg.pressure_dyn),
        "joint_params": asdict(cfg.joint_params),
        "L_rest": float(cfg.L_rest),
        "n_samples": len(log.t),
        "final": {
            "t": float(log.t[-1]),
            "P": float(log.P[-1]),
            "F": float(log.F[-1]),
            "q": float(log.q[-1]),
            "qdot": float(log.qdot[-1]),
        },
        "stats": {
            "P_mean": float(np.mean(P_arr)),
            "P_p95": float(np.quantile(P_arr, 0.95)),
            "F_mean": float(np.mean(F_arr)),
            "F_p95_abs": float(np.quantile(np.abs(F_arr), 0.95)),
        },
    }
    return out


# ----------------------------
# Minimal self-check example
# ----------------------------

if __name__ == "__main__":
    base = PAMParams(
        b=0.35, n=12.0, L0=0.30, P_max=600_000.0,
        c_v=0.0, c_c=0.0, k_p=0.0,
        count=1
    )

    rng = np.random.default_rng(4)
    N = 250
    t = np.linspace(0.0, 2.0, N)

    P = 300_000.0 + 200_000.0 * np.sin(2.0 * math.pi * t / 2.0)  # stays within [100k, 500k]
    L = 0.29 + 0.015 * np.sin(2.0 * math.pi * t / 0.8)           # stays within [0.275, 0.305]
    Ldot = np.gradient(L, t)

    # Build "measured" force from a truth model
    truth = replace(base, k_p=350.0, c_v=18.0, c_c=6.0)
    sam0 = samples_from_log(t, P, L, Ldot, np.zeros(N))
    y_true = predict_force(truth, sam0, strict=True)
    y_meas = y_true + rng.normal(0.0, 10.0, size=N)

    sam = samples_from_log(t, P, L, Ldot, y_meas)

    cfg = PipelineConfig(
        base_params=base,
        do_bootstrap=False,
        export_predictions=True,
    )

    report = run_fit_pipeline(sam, cfg)
    print("report keys:", list(report.keys()))
    print("fit rmse:", report["fit_result"]["rmse"])
    print("fit params:", report["fit_result"]["params"])
