from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Sequence, Tuple

import numpy as np

from synthmuscle.stats.cvar import quantiles, cvar_upper, cvar_lower


class MCGatingError(RuntimeError):
    pass


def _finite_list(vals: Sequence[float], name: str) -> List[float]:
    out = [float(v) for v in vals]
    if len(out) == 0:
        raise MCGatingError(f"{name} must be non-empty.")
    if not np.all(np.isfinite(np.asarray(out, dtype=float))):
        raise MCGatingError(f"{name} contains non-finite values.")
    return out


@dataclass(frozen=True)
class GateSpec:
    metric: str
    kind: str  # "per", "cvar_upper", "cvar_lower", "quantile"
    op: str    # "<=" or ">="
    threshold: float
    alpha: float = 0.95
    q: float = 0.10

    def validate(self) -> None:
        if not self.metric:
            raise MCGatingError("GateSpec.metric must be non-empty.")
        if self.kind not in ("per", "cvar_upper", "cvar_lower", "quantile"):
            raise MCGatingError("GateSpec.kind invalid.")
        if self.op not in ("<=", ">="):
            raise MCGatingError("GateSpec.op invalid.")
        th = float(self.threshold)
        if not np.isfinite(th):
            raise MCGatingError("GateSpec.threshold must be finite.")
        if not np.isfinite(float(self.alpha)) or not (0.0 < float(self.alpha) < 1.0):
            raise MCGatingError("GateSpec.alpha must be in (0,1).")
        if not np.isfinite(float(self.q)) or not (0.0 <= float(self.q) <= 1.0):
            raise MCGatingError("GateSpec.q must be in [0,1].")


@dataclass(frozen=True)
class MCConfig:
    quantile_set: Tuple[float, ...] = (0.10, 0.50, 0.90)
    cvar_alpha: float = 0.95
    dist_gates: Tuple[GateSpec, ...] = ()
    require_all_constraints_true: bool = True

    def validate(self) -> None:
        for q in self.quantile_set:
            qq = float(q)
            if not np.isfinite(qq) or not (0.0 <= qq <= 1.0):
                raise MCGatingError("quantile_set must be in [0,1].")
        al = float(self.cvar_alpha)
        if not np.isfinite(al) or not (0.0 < al < 1.0):
            raise MCGatingError("cvar_alpha must be in (0,1).")
        for g in self.dist_gates:
            g.validate()


def _op_check(val: float, op: str, th: float) -> bool:
    if op == "<=":
        return bool(val <= th)
    return bool(val >= th)


def aggregate_payloads(
    *,
    cfg: MCConfig,
    payloads: Sequence[Mapping[str, Any]],
    metric_keys: Sequence[str],
) -> Mapping[str, Any]:
    cfg.validate()
    if len(payloads) == 0:
        raise MCGatingError("payloads must be non-empty.")
    metric_keys = list(metric_keys)
    if len(metric_keys) == 0:
        raise MCGatingError("metric_keys must be non-empty.")

    per_ok: List[bool] = []
    for p in payloads:
        cons = dict(p.get("constraints", {}) or {})
        if cfg.require_all_constraints_true:
            ok = bool(all(bool(v) for v in cons.values())) if cons else True
        else:
            ok = True
        per_ok.append(ok)

    pass_rate = float(np.mean(np.asarray(per_ok, dtype=float)))

    agg: Dict[str, Any] = {"n": int(len(payloads)), "metrics": {}, "constraints": {}}
    agg["constraints"]["pass_rate"] = pass_rate
    agg["constraints"]["all_constraints_ok_rate"] = pass_rate

    for k in metric_keys:
        samples: List[float] = []
        for p in payloads:
            m = dict(p.get("metrics", {}) or {})
            if k in m and np.isfinite(float(m[k])):
                samples.append(float(m[k]))
        if len(samples) == 0:
            raise MCGatingError(f"Missing metric '{k}' in all payloads.")
        xs = _finite_list(samples, f"samples[{k}]")

        qd = quantiles(xs, cfg.quantile_set)
        cu = cvar_upper(xs, alpha=cfg.cvar_alpha)
        cl = cvar_lower(xs, alpha=1.0 - cfg.cvar_alpha)

        outk = {
            **{f"{k}_{qn}": float(v) for qn, v in qd.items()},
            f"{k}_mean": float(np.mean(xs)),
            f"{k}_std": float(np.std(xs)),
            f"{k}_cvar_upper_{int(round(cfg.cvar_alpha*100))}": float(cu),
            f"{k}_cvar_lower_{int(round((1.0-cfg.cvar_alpha)*100))}": float(cl),
        }
        agg["metrics"].update(outk)

    dist_ok = True
    gate_reports: Dict[str, bool] = {}
    for g in cfg.dist_gates:
        g.validate()
        metric = g.metric

        if g.kind == "cvar_upper":
            key = f"{metric}_cvar_upper_{int(round(g.alpha*100))}"
            if key not in agg["metrics"]:
                raise MCGatingError(f"Missing aggregated key for gate: {key}")
            val = float(agg["metrics"][key])
            ok = _op_check(val, g.op, float(g.threshold))
        elif g.kind == "cvar_lower":
            key = f"{metric}_cvar_lower_{int(round((1.0-g.alpha)*100))}"
            if key not in agg["metrics"]:
                raise MCGatingError(f"Missing aggregated key for gate: {key}")
            val = float(agg["metrics"][key])
            ok = _op_check(val, g.op, float(g.threshold))
        elif g.kind == "quantile":
            key = f"{metric}_q{int(round(g.q*100)):02d}"
            if key not in agg["metrics"]:
                raise MCGatingError(f"Missing aggregated key for gate: {key}")
            val = float(agg["metrics"][key])
            ok = _op_check(val, g.op, float(g.threshold))
        else:
            raise MCGatingError("GateSpec.kind 'per' not supported at distribution stage.")

        gate_reports[f"{g.kind}:{metric}"] = bool(ok)
        dist_ok = dist_ok and bool(ok)

    agg["constraints"]["dist_gates_ok"] = bool(dist_ok)
    agg["constraints"]["dist_gate_reports"] = gate_reports
    agg["feasible"] = bool(pass_rate > 0.0) and bool(dist_ok)
    return agg
