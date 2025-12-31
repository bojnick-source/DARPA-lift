from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Dict, List, Mapping, Optional, Tuple, Union

import numpy as np


class SafetyError(RuntimeError):
    """Raised for invalid configuration or irrecoverable safety-layer misuse."""


class SafetyState(str, Enum):
    NOMINAL = "NOMINAL"
    CLAMPING = "CLAMPING"
    SAFE_OVERRIDE = "SAFE_OVERRIDE"
    KILLED = "KILLED"


class SafetyFault(str, Enum):
    # Integrity
    NAN_INF_OBS = "NAN_INF_OBS"
    NAN_INF_CMD = "NAN_INF_CMD"
    MISSING_OBS = "MISSING_OBS"
    MISSING_CMD = "MISSING_CMD"
    SHAPE_MISMATCH = "SHAPE_MISMATCH"

    # Limits
    JOINT_POS_LIMIT = "JOINT_POS_LIMIT"
    JOINT_VEL_LIMIT = "JOINT_VEL_LIMIT"
    JOINT_TORQUE_LIMIT = "JOINT_TORQUE_LIMIT"

    # Jump/contact realism
    CONTACT_IMPULSE = "CONTACT_IMPULSE"
    BASE_TILT = "BASE_TILT"

    # Hooks
    ROUTING_VIOLATION = "ROUTING_VIOLATION"
    ACTUATOR_THERMAL = "ACTUATOR_THERMAL"
    COMMS_TIMEOUT = "COMMS_TIMEOUT"


@dataclass(frozen=True)
class SafetyEvent:
    t: float
    fault: SafetyFault
    severity: str  # "WARN" | "ERROR" | "FATAL"
    state_before: SafetyState
    state_after: SafetyState
    details: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SafetyReport:
    t: float
    state: SafetyState
    faults: List[SafetyFault] = field(default_factory=list)
    events: List[SafetyEvent] = field(default_factory=list)
    clamped: bool = False
    overridden: bool = False
    killed: bool = False
    latched_fault: Optional[SafetyFault] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["state"] = self.state.value
        d["faults"] = [f.value for f in self.faults]
        d["events"] = [
            {
                "t": e.t,
                "fault": e.fault.value,
                "severity": e.severity,
                "state_before": e.state_before.value,
                "state_after": e.state_after.value,
                "details": e.details,
            }
            for e in self.events
        ]
        if self.latched_fault is not None:
            d["latched_fault"] = self.latched_fault.value
        return d


def _to_1d_float_array(x: Any, name: str) -> np.ndarray:
    try:
        arr = np.asarray(x, dtype=float).reshape(-1)
    except Exception as e:
        raise SafetyError(f"{name}: cannot convert to float array: {e}") from e
    if arr.ndim != 1:
        raise SafetyError(f"{name}: must be 1D.")
    return arr


def _finite(arr: np.ndarray) -> bool:
    return bool(np.all(np.isfinite(arr)))


@dataclass(frozen=True)
class JointLimits:
    q_min: np.ndarray  # (n,)
    q_max: np.ndarray  # (n,)
    qd_max: np.ndarray  # (n,) absolute
    tau_max: np.ndarray  # (n,) absolute

    def validate(self) -> int:
        q_min = _to_1d_float_array(self.q_min, "limits.q_min")
        q_max = _to_1d_float_array(self.q_max, "limits.q_max")
        qd_max = _to_1d_float_array(self.qd_max, "limits.qd_max")
        tau_max = _to_1d_float_array(self.tau_max, "limits.tau_max")
        n = q_min.shape[0]
        if q_max.shape != (n,) or qd_max.shape != (n,) or tau_max.shape != (n,):
            raise SafetyError("JointLimits arrays must all be shape (n,).")
        if np.any(q_max < q_min):
            raise SafetyError("JointLimits invalid: q_max must be >= q_min.")
        if np.any(qd_max <= 0) or np.any(tau_max <= 0):
            raise SafetyError("JointLimits invalid: qd_max and tau_max must be > 0.")
        return int(n)


@dataclass(frozen=True)
class ContactLimits:
    impulse_warn: float = 80.0
    impulse_max: float = 120.0

    def validate(self) -> None:
        if not (0 < self.impulse_warn <= self.impulse_max):
            raise SafetyError("ContactLimits invalid: require 0 < impulse_warn <= impulse_max.")


@dataclass(frozen=True)
class BaseLimits:
    tilt_warn_rad: float = float(np.deg2rad(45.0))
    tilt_max_rad: float = float(np.deg2rad(65.0))

    def validate(self) -> None:
        if not (0 < self.tilt_warn_rad <= self.tilt_max_rad):
            raise SafetyError("BaseLimits invalid: require 0 < tilt_warn_rad <= tilt_max_rad.")


@dataclass(frozen=True)
class SafetyConfig:
    """
    Deterministic, fail-closed safety configuration.

    Required obs fields:
      - q (n,), qd (n,)
    Optional obs fields (enforced only if present):
      - base_rpy (3,)  OR base_quat_wxyz (4,)
      - contact_impulse (float) OR contact_impulses (k,)
      - actuator_temp (float or (m,))
      - routing: {"min_bend_radius_m": float, ...}
      - last_cmd_t (float) for comms timeout

    Required cmd fields:
      - tau (n,)  OR q_des (n,) (+ optional qd_des (n,))
    """

    joint: JointLimits
    contact: ContactLimits = field(default_factory=ContactLimits)
    base: BaseLimits = field(default_factory=BaseLimits)

    # Behavior
    latch_kill: bool = True
    allow_clamp: bool = True
    consecutive_limit_frames_to_kill: int = 10

    # Timeout (only if obs has last_cmd_t)
    cmd_timeout_s: float = 0.25

    # Safe override
    safe_pose_q: Optional[np.ndarray] = None  # if using position override
    safe_tau_off: bool = True                # torque-off override always available

    def validate(self) -> int:
        n = self.joint.validate()
        self.contact.validate()
        self.base.validate()
        if self.consecutive_limit_frames_to_kill < 1:
            raise SafetyError("consecutive_limit_frames_to_kill must be >= 1.")
        if self.cmd_timeout_s <= 0:
            raise SafetyError("cmd_timeout_s must be > 0.")
        if self.safe_pose_q is not None:
            sp = _to_1d_float_array(self.safe_pose_q, "safe_pose_q")
            if sp.shape != (n,):
                raise SafetyError(f"safe_pose_q must be shape ({n},), got {sp.shape}")
        return n


class CommandMode(str, Enum):
    TORQUE = "TORQUE"
    POSITION = "POSITION"


@dataclass(frozen=True)
class NormalizedCommand:
    mode: CommandMode
    tau: Optional[np.ndarray] = None
    q_des: Optional[np.ndarray] = None
    qd_des: Optional[np.ndarray] = None

    def to_payload(self) -> Dict[str, Any]:
        if self.mode == CommandMode.TORQUE:
            return {"tau": self.tau}
        payload: Dict[str, Any] = {"q_des": self.q_des}
        if self.qd_des is not None:
            payload["qd_des"] = self.qd_des
        return payload


def _normalize_obs(obs: Mapping[str, Any], n: int) -> Dict[str, Any]:
    if "q" not in obs or "qd" not in obs:
        raise SafetyError("obs missing required keys: 'q' and/or 'qd'")
    q = _to_1d_float_array(obs["q"], "obs.q")
    qd = _to_1d_float_array(obs["qd"], "obs.qd")
    if q.shape != (n,) or qd.shape != (n,):
        raise SafetyError(f"obs shapes must be ({n},): q{q.shape} qd{qd.shape}")
    out: Dict[str, Any] = {"q": q, "qd": qd}

    if "base_rpy" in obs and obs["base_rpy"] is not None:
        rpy = _to_1d_float_array(obs["base_rpy"], "obs.base_rpy")
        if rpy.shape != (3,):
            raise SafetyError("obs.base_rpy must be shape (3,)")
        out["base_rpy"] = rpy
    if "base_quat_wxyz" in obs and obs["base_quat_wxyz"] is not None:
        quat = _to_1d_float_array(obs["base_quat_wxyz"], "obs.base_quat_wxyz")
        if quat.shape != (4,):
            raise SafetyError("obs.base_quat_wxyz must be shape (4,)")
        out["base_quat_wxyz"] = quat

    if "contact_impulse" in obs and obs["contact_impulse"] is not None:
        out["contact_impulse"] = float(obs["contact_impulse"])
    if "contact_impulses" in obs and obs["contact_impulses"] is not None:
        ci = _to_1d_float_array(obs["contact_impulses"], "obs.contact_impulses")
        out["contact_impulses"] = ci

    if "actuator_temp" in obs and obs["actuator_temp"] is not None:
        out["actuator_temp"] = np.asarray(obs["actuator_temp"], dtype=float)

    if "routing" in obs and isinstance(obs["routing"], Mapping):
        out["routing"] = dict(obs["routing"])

    if "last_cmd_t" in obs and obs["last_cmd_t"] is not None:
        out["last_cmd_t"] = float(obs["last_cmd_t"])

    return out


def _quat_wxyz_to_rpy(quat: np.ndarray) -> np.ndarray:
    w, x, y, z = (float(quat[0]), float(quat[1]), float(quat[2]), float(quat[3]))
    t0 = 2.0 * (w * x + y * z)
    t1 = 1.0 - 2.0 * (x * x + y * y)
    roll = float(np.arctan2(t0, t1))
    t2 = 2.0 * (w * y - z * x)
    t2 = float(np.clip(t2, -1.0, 1.0))
    pitch = float(np.arcsin(t2))
    t3 = 2.0 * (w * z + x * y)
    t4 = 1.0 - 2.0 * (y * y + z * z)
    yaw = float(np.arctan2(t3, t4))
    return np.array([roll, pitch, yaw], dtype=float)


def _normalize_cmd(cmd: Mapping[str, Any], n: int) -> NormalizedCommand:
    if "tau" in cmd and cmd["tau"] is not None:
        tau = _to_1d_float_array(cmd["tau"], "cmd.tau")
        if tau.shape != (n,):
            raise SafetyError(f"cmd.tau must be shape ({n},), got {tau.shape}")
        return NormalizedCommand(mode=CommandMode.TORQUE, tau=tau)

    if "q_des" in cmd and cmd["q_des"] is not None:
        q_des = _to_1d_float_array(cmd["q_des"], "cmd.q_des")
        if q_des.shape != (n,):
            raise SafetyError(f"cmd.q_des must be shape ({n},), got {q_des.shape}")
        qd_des = None
        if "qd_des" in cmd and cmd["qd_des"] is not None:
            qd_des = _to_1d_float_array(cmd["qd_des"], "cmd.qd_des")
            if qd_des.shape != (n,):
                raise SafetyError(f"cmd.qd_des must be shape ({n},), got {qd_des.shape}")
        return NormalizedCommand(mode=CommandMode.POSITION, q_des=q_des, qd_des=qd_des)

    raise SafetyError("cmd missing required key: either 'tau' or 'q_des'.")


class SafetyLayer:
    """
    Deterministic safety filter.

    Behavior:
      - Validates obs/cmd (NaN/Inf => kill)
      - Enforces contact impulse + base tilt if present
      - Enforces joint limits on obs and cmd (clamp then kill if persistent)
      - Latches kill until reset() if cfg.latch_kill=True
    """

    def __init__(self, cfg: SafetyConfig):
        self.cfg = cfg
        self.n = cfg.validate()

        self._state: SafetyState = SafetyState.NOMINAL
        self._killed: bool = False
        self._latched_fault: Optional[SafetyFault] = None
        self._limit_frames: int = 0
        self._last_cmd_t_seen: Optional[float] = None

    def reset(self, reason: str = "manual_reset") -> None:
        self._state = SafetyState.NOMINAL
        self._killed = False
        self._latched_fault = None
        self._limit_frames = 0
        self._last_cmd_t_seen = None

    def is_killed(self) -> bool:
        return self._killed

    def _emit(
        self,
        report: SafetyReport,
        *,
        t: float,
        fault: SafetyFault,
        severity: str,
        next_state: SafetyState,
        details: Dict[str, Any],
    ) -> None:
        ev = SafetyEvent(
            t=float(t),
            fault=fault,
            severity=severity,
            state_before=self._state,
            state_after=next_state,
            details=dict(details),
        )
        report.events.append(ev)
        report.faults.append(fault)
        self._state = next_state
        if next_state == SafetyState.KILLED:
            self._killed = True
            if self.cfg.latch_kill:
                self._latched_fault = fault

    def _safe_override(self) -> NormalizedCommand:
        # Always available
        if self.cfg.safe_tau_off:
            return NormalizedCommand(mode=CommandMode.TORQUE, tau=np.zeros((self.n,), dtype=float))

        # Position override if requested and provided
        if self.cfg.safe_pose_q is not None:
            q = _to_1d_float_array(self.cfg.safe_pose_q, "cfg.safe_pose_q")
            q = np.clip(q, self.cfg.joint.q_min, self.cfg.joint.q_max)
            return NormalizedCommand(
                mode=CommandMode.POSITION,
                q_des=q,
                qd_des=np.zeros((self.n,), dtype=float),
            )

        # Fail-closed fallback: torque-off
        return NormalizedCommand(mode=CommandMode.TORQUE, tau=np.zeros((self.n,), dtype=float))

    def step(
        self,
        *,
        t: float,
        obs: Mapping[str, Any],
        cmd: Mapping[str, Any],
    ) -> Tuple[Dict[str, Any], SafetyReport]:
        report = SafetyReport(t=float(t), state=self._state, latched_fault=self._latched_fault)

        # If latched killed, always override until reset
        if self._killed and self.cfg.latch_kill:
            report.state = SafetyState.KILLED
            report.killed = True
            report.overridden = True
            report.latched_fault = self._latched_fault
            return self._safe_override().to_payload(), report

        # Normalize/validate obs/cmd
        try:
            o = _normalize_obs(obs, self.n)
        except Exception as e:
            self._emit(
                report,
                t=t,
                fault=SafetyFault.MISSING_OBS,
                severity="FATAL",
                next_state=SafetyState.KILLED,
                details={"error": str(e)},
            )
            report.state = self._state
            report.killed = self._killed
            report.overridden = True
            report.latched_fault = self._latched_fault
            return self._safe_override().to_payload(), report

        if not _finite(o["q"]) or not _finite(o["qd"]):
            self._emit(
                report,
                t=t,
                fault=SafetyFault.NAN_INF_OBS,
                severity="FATAL",
                next_state=SafetyState.KILLED,
                details={"q_finite": _finite(o["q"]), "qd_finite": _finite(o["qd"])},
            )
            report.state = self._state
            report.killed = self._killed
            report.overridden = True
            report.latched_fault = self._latched_fault
            return self._safe_override().to_payload(), report

        try:
            c = _normalize_cmd(cmd, self.n)
        except Exception as e:
            self._emit(
                report,
                t=t,
                fault=SafetyFault.MISSING_CMD,
                severity="FATAL",
                next_state=SafetyState.KILLED,
                details={"error": str(e)},
            )
            report.state = self._state
            report.killed = self._killed
            report.overridden = True
            report.latched_fault = self._latched_fault
            return self._safe_override().to_payload(), report

        # Command NaN/Inf kill
        if c.mode == CommandMode.TORQUE and c.tau is not None and not _finite(c.tau):
            self._emit(
                report,
                t=t,
                fault=SafetyFault.NAN_INF_CMD,
                severity="FATAL",
                next_state=SafetyState.KILLED,
                details={"tau_finite": _finite(c.tau)},
            )
            report.state = self._state
            report.killed = self._killed
            report.overridden = True
            report.latched_fault = self._latched_fault
            return self._safe_override().to_payload(), report

        if c.mode == CommandMode.POSITION and c.q_des is not None and not _finite(c.q_des):
            self._emit(
                report,
                t=t,
                fault=SafetyFault.NAN_INF_CMD,
                severity="FATAL",
                next_state=SafetyState.KILLED,
                details={"q_des_finite": _finite(c.q_des)},
            )
            report.state = self._state
            report.killed = self._killed
            report.overridden = True
            report.latched_fault = self._latched_fault
            return self._safe_override().to_payload(), report

        # Optional comms timeout (only if obs provides last_cmd_t)
        if "last_cmd_t" in o:
            self._last_cmd_t_seen = float(o["last_cmd_t"])
        if self._last_cmd_t_seen is not None:
            dt_cmd = float(t) - float(self._last_cmd_t_seen)
            if dt_cmd > self.cfg.cmd_timeout_s:
                self._emit(
                    report,
                    t=t,
                    fault=SafetyFault.COMMS_TIMEOUT,
                    severity="FATAL",
                    next_state=SafetyState.KILLED,
                    details={"dt_cmd": dt_cmd, "timeout_s": self.cfg.cmd_timeout_s},
                )
                report.state = self._state
                report.killed = self._killed
                report.overridden = True
                report.latched_fault = self._latched_fault
                return self._safe_override().to_payload(), report

        # Optional base tilt
        if "base_rpy" in o or "base_quat_wxyz" in o:
            rpy = o.get("base_rpy", None)
            if rpy is None:
                rpy = _quat_wxyz_to_rpy(o["base_quat_wxyz"])
            roll, pitch = float(rpy[0]), float(rpy[1])
            tilt = float(np.sqrt(roll * roll + pitch * pitch))
            if tilt > self.cfg.base.tilt_max_rad:
                self._emit(
                    report,
                    t=t,
                    fault=SafetyFault.BASE_TILT,
                    severity="FATAL",
                    next_state=SafetyState.KILLED,
                    details={"tilt_rad": tilt, "tilt_max_rad": self.cfg.base.tilt_max_rad},
                )
                report.state = self._state
                report.killed = self._killed
                report.overridden = True
                report.latched_fault = self._latched_fault
                return self._safe_override().to_payload(), report
            elif tilt > self.cfg.base.tilt_warn_rad:
                self._emit(
                    report,
                    t=t,
                    fault=SafetyFault.BASE_TILT,
                    severity="WARN",
                    next_state=SafetyState.CLAMPING,
                    details={"tilt_rad": tilt, "tilt_warn_rad": self.cfg.base.tilt_warn_rad},
                )

        # Optional contact impulse
        impulse = None
        if "contact_impulse" in o:
            impulse = float(o["contact_impulse"])
        elif "contact_impulses" in o:
            ci = o["contact_impulses"]
            if ci.size > 0:
                impulse = float(np.max(ci))

        if impulse is not None:
            if impulse > self.cfg.contact.impulse_max:
                self._emit(
                    report,
                    t=t,
                    fault=SafetyFault.CONTACT_IMPULSE,
                    severity="FATAL",
                    next_state=SafetyState.KILLED,
                    details={"impulse": impulse, "impulse_max": self.cfg.contact.impulse_max},
                )
                report.state = self._state
                report.killed = self._killed
                report.overridden = True
                report.latched_fault = self._latched_fault
                return self._safe_override().to_payload(), report
            elif impulse > self.cfg.contact.impulse_warn:
                self._emit(
                    report,
                    t=t,
                    fault=SafetyFault.CONTACT_IMPULSE,
                    severity="WARN",
                    next_state=SafetyState.CLAMPING,
                    details={"impulse": impulse, "impulse_warn": self.cfg.contact.impulse_warn},
                )

        # Optional routing hook (enforced only if metric present)
        if "routing" in o:
            routing = o["routing"]
            mbr = routing.get("min_bend_radius_m", None)
            if mbr is not None and np.isfinite(float(mbr)):
                # If user provides a min bend radius metric, they must also provide the threshold elsewhere;
                # we enforce "violation if mbr <= 0" as a hard fail-closed sanity, and leave thresholding to later integration.
                if float(mbr) <= 0.0:
                    self._emit(
                        report,
                        t=t,
                        fault=SafetyFault.ROUTING_VIOLATION,
                        severity="FATAL",
                        next_state=SafetyState.KILLED,
                        details={"min_bend_radius_m": float(mbr), "reason": "non-positive"},
                    )
                    report.state = self._state
                    report.killed = self._killed
                    report.overridden = True
                    report.latched_fault = self._latched_fault
                    return self._safe_override().to_payload(), report

        # Joint limit enforcement (obs + cmd). Clamp first (if allowed), kill if persistent.
        jl = self.cfg.joint
        q = o["q"]
        qd = o["qd"]

        pos_violation = np.logical_or(q < jl.q_min, q > jl.q_max)
        vel_violation = np.abs(qd) > jl.qd_max

        limit_faults: List[SafetyFault] = []
        if np.any(pos_violation):
            limit_faults.append(SafetyFault.JOINT_POS_LIMIT)
        if np.any(vel_violation):
            limit_faults.append(SafetyFault.JOINT_VEL_LIMIT)

        clamped_any = False
        cmd_out = c

        if c.mode == CommandMode.TORQUE and c.tau is not None:
            tau_violation = np.abs(c.tau) > jl.tau_max
            if np.any(tau_violation):
                limit_faults.append(SafetyFault.JOINT_TORQUE_LIMIT)
                if self.cfg.allow_clamp:
                    tau_clamped = np.clip(c.tau, -jl.tau_max, jl.tau_max)
                    cmd_out = NormalizedCommand(mode=CommandMode.TORQUE, tau=tau_clamped)
                    clamped_any = True

        if c.mode == CommandMode.POSITION and c.q_des is not None:
            q_des_violation = np.logical_or(c.q_des < jl.q_min, c.q_des > jl.q_max)
            if np.any(q_des_violation):
                limit_faults.append(SafetyFault.JOINT_POS_LIMIT)
                if self.cfg.allow_clamp:
                    q_des_clamped = np.clip(c.q_des, jl.q_min, jl.q_max)
                    cmd_out = NormalizedCommand(mode=CommandMode.POSITION, q_des=q_des_clamped, qd_des=c.qd_des)
                    clamped_any = True

            if c.qd_des is not None:
                qd_des_violation = np.abs(c.qd_des) > jl.qd_max
                if np.any(qd_des_violation):
                    limit_faults.append(SafetyFault.JOINT_VEL_LIMIT)
                    if self.cfg.allow_clamp:
                        qd_des_clamped = np.clip(c.qd_des, -jl.qd_max, jl.qd_max)
                        cmd_out = NormalizedCommand(mode=CommandMode.POSITION, q_des=cmd_out.q_des, qd_des=qd_des_clamped)
                        clamped_any = True

        if limit_faults:
            self._limit_frames += 1
            for f in limit_faults:
                self._emit(
                    report,
                    t=t,
                    fault=f,
                    severity="WARN" if self.cfg.allow_clamp else "ERROR",
                    next_state=SafetyState.CLAMPING,
                    details={"limit_frames": int(self._limit_frames)},
                )

            should_kill = (not self.cfg.allow_clamp) or (self._limit_frames >= self.cfg.consecutive_limit_frames_to_kill)
            if should_kill:
                self._emit(
                    report,
                    t=t,
                    fault=limit_faults[0],
                    severity="FATAL",
                    next_state=SafetyState.KILLED,
                    details={
                        "limit_frames": int(self._limit_frames),
                        "threshold": int(self.cfg.consecutive_limit_frames_to_kill),
                        "allow_clamp": bool(self.cfg.allow_clamp),
                    },
                )
                report.state = self._state
                report.killed = self._killed
                report.overridden = True
                report.latched_fault = self._latched_fault
                return self._safe_override().to_payload(), report
        else:
            self._limit_frames = 0

        report.state = self._state if report.faults else SafetyState.NOMINAL
        if not report.faults:
            self._state = SafetyState.NOMINAL

        report.clamped = bool(clamped_any)
        report.killed = bool(self._killed)
        report.latched_fault = self._latched_fault
        return cmd_out.to_payload(), report

# Compatibility shim: expose SafetyRuntime classes in this namespace (append-only).
try:  # pragma: no cover - import-time aliasing only
    from synthmuscle.control.safety_runtime import (
        SafetyRuntime,
        SafetyRuntimeConfig,
        SafetyState as SafetyRuntimeState,
        SafetyStepResult as SafetyRuntimeStepResult,
    )
except Exception:
    # If dependencies are missing, ignore to keep legacy API intact.
    pass
