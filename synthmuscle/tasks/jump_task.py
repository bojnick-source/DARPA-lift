# ============================================
# Fragment P18 — synthmuscle/tasks/jump_task.py
# Reward + metrics task for “jump-like” behaviors with robustness metrics.
# ============================================

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple, Any
import math


# ---------- Config ----------

@dataclass(frozen=True)
class JumpTaskConfig:
    # Contact filtering (besides feet)
    allowed_contact_geoms: Tuple[str, ...] = ("foot_l", "foot_r")

    # Timing
    horizon_s: float = 1.2

    # Thresholds (robustness metrics)
    slip_speed_thresh_m_s: float = 0.20
    fall_tilt_deg: float = 55.0          # torso tilt from up-axis
    min_com_height_m: float = 0.25       # if COM drops below this, likely a fall
    unsafe_contact_penalty: float = 1.0  # used if reward_mode uses penalties

    # Landing window detection
    landing_detect_min_air_s: float = 0.06  # must be in-air at least this long before landing counted

    # Reward mode
    # - "power_ratio": maximize specific-power ratio while penalizing unsafe/falls
    # - "jump_height": maximize height with mild penalties
    reward_mode: str = "jump_height"

    # Optional known mass for specific-power normalization (if your sim can provide mass, use that instead)
    body_mass_kg: float = 75.0

    # Up-axis index in COM vector (0=x,1=y,2=z). If your sim is z-up, keep 2.
    up_axis: int = 2


# ---------- Metrics state ----------

@dataclass
class JumpTaskMetrics:
    # Power
    peak_power_w: float = 0.0
    power_sum_w: float = 0.0
    power_samples: int = 0
    energy_j: float = 0.0  # numerical integration of power over time (best-effort)

    # Contacts
    contact_steps: int = 0
    unsafe_contact_steps: int = 0
    slip_steps: int = 0

    # Air/landing detection
    in_air: bool = False
    air_start_s: Optional[float] = None
    airtime_s: float = 0.0
    takeoff_time_s: Optional[float] = None
    landing_time_s: Optional[float] = None

    # Landing impulse accumulation (best-effort if sim provides it)
    landing_impulse_n_s: float = 0.0
    landing_impulse_peak_n: float = 0.0
    landing_active: bool = False
    landing_started_s: Optional[float] = None

    # Stability
    fall_over: bool = False
    fall_time_s: Optional[float] = None


# ---------- Task ----------

class JumpTask:
    """
    Generic task wrapper. It expects a `sim` object (SimAPI-like) that provides some methods.
    This file is written to be resilient: if a method is missing, that metric simply won't update.

    Expected (best-case) Sim API methods used (optional):
      - time_s() -> float
      - get_com_pos() -> Sequence[float] (len >= 3)
      - get_torso_tilt_deg(up_axis: int) -> float
      - get_contact_geoms() -> Sequence[str]
      - get_geom_linvel(name: str) -> Sequence[float] (len >= 3)
      - get_total_power_w() -> float OR get_motor_powers_w() -> Sequence[float]
      - get_contact_normal_force_n() -> float  (optional for landing impulse)
    """

    def __init__(self, cfg: Optional[JumpTaskConfig] = None) -> None:
        self.cfg = cfg or JumpTaskConfig()
        self.reset()

    def reset(self) -> None:
        self.m = JumpTaskMetrics()
        self.t0: float = 0.0
        self._last_t: Optional[float] = None

        # COM tracking
        self.com0: Optional[List[float]] = None
        self.max_com_h: float = -1e9

    # --- episode control ---

    def on_reset(self, sim: Any) -> None:
        self.reset()
        self.t0 = _safe_call(sim, "time_s", default=0.0)
        self._last_t = self.t0
        com = _safe_call(sim, "get_com_pos", default=None)
        if com is not None:
            self.com0 = list(com)
            self.max_com_h = float(self.com0[self.cfg.up_axis])

        # Initialize contact/air flags
        self._update_contacts(sim)

    def step(self, sim: Any) -> Tuple[float, bool, Dict[str, float]]:
        """
        Returns: (reward, done, info_metrics)
        """
        t = _safe_call(sim, "time_s", default=(self._last_t or 0.0))
        dt = 0.0 if self._last_t is None else max(0.0, float(t) - float(self._last_t))
        self._last_t = float(t)

        # Update power + energy
        self._update_power(sim, dt)

        # Update COM
        com = _safe_call(sim, "get_com_pos", default=None)
        if com is not None and len(com) > self.cfg.up_axis:
            h = float(com[self.cfg.up_axis])
            self.max_com_h = max(self.max_com_h, h)

        # Update contacts + robustness
        self._update_contacts(sim)

        # Update stability (fall detection)
        self._update_fall(sim, t)

        # Termination
        done_time = (t - self.t0) >= self.cfg.horizon_s
        done = bool(done_time or self.m.fall_over)

        # Reward
        reward = self._compute_reward(sim)

        # Info
        info = self.metrics(sim)
        return reward, done, info

    # --- metrics output ---

    def metrics(self, sim: Any) -> Dict[str, float]:
        base_h = float(self.com0[self.cfg.up_axis]) if self.com0 is not None else 0.0
        jump_height = float(self.max_com_h - base_h) if self.max_com_h > -1e8 else 0.0

        avg_power = (self.m.power_sum_w / self.m.power_samples) if self.m.power_samples > 0 else 0.0
        spec_peak_power = (self.m.peak_power_w / max(1e-9, self._mass_kg(sim)))  # W/kg

        return {
            # Performance
            "jump_height_m": jump_height,
            "com0_h_m": base_h,
            "max_com_h_m": float(self.max_com_h if self.max_com_h > -1e8 else 0.0),

            # Power
            "peak_power_w": float(self.m.peak_power_w),
            "avg_power_w": float(avg_power),
            "energy_j": float(self.m.energy_j),
            "specific_peak_power_w_per_kg": float(spec_peak_power),

            # Contacts / robustness
            "contact_steps": float(self.m.contact_steps),
            "unsafe_contact_steps": float(self.m.unsafe_contact_steps),
            "slip_steps": float(self.m.slip_steps),

            # Air/landing
            "in_air": 1.0 if self.m.in_air else 0.0,
            "airtime_s": float(self.m.airtime_s),
            "takeoff_time_s": float(self.m.takeoff_time_s or 0.0),
            "landing_time_s": float(self.m.landing_time_s or 0.0),

            # Landing impulse (best-effort)
            "landing_impulse_n_s": float(self.m.landing_impulse_n_s),
            "landing_impulse_peak_n": float(self.m.landing_impulse_peak_n),

            # Stability
            "fall_over": 1.0 if self.m.fall_over else 0.0,
            "fall_time_s": float(self.m.fall_time_s or 0.0),
        }

    # ---------- internals ----------

    def _mass_kg(self, sim: Any) -> float:
        # If your sim has a method for mass, use it; else config default.
        m = _safe_call(sim, "get_mass_kg", default=None)
        return float(m) if m is not None else float(self.cfg.body_mass_kg)

    def _update_power(self, sim: Any, dt: float) -> None:
        p = _safe_call(sim, "get_total_power_w", default=None)
        if p is None:
            motor_ps = _safe_call(sim, "get_motor_powers_w", default=None)
            if motor_ps is not None:
                try:
                    p = float(sum(float(x) for x in motor_ps))
                except Exception:
                    p = None

        if p is None:
            return

        p = float(p)
        self.m.peak_power_w = max(self.m.peak_power_w, p)
        self.m.power_sum_w += p
        self.m.power_samples += 1

        # energy integration (best-effort)
        if dt > 0.0:
            self.m.energy_j += p * dt

    def _update_contacts(self, sim: Any) -> None:
        contacts = _safe_call(sim, "get_contact_geoms", default=[])
        try:
            contacts = list(contacts)
        except Exception:
            contacts = []

        # Count contact step
        if len(contacts) > 0:
            self.m.contact_steps += 1

        # Unsafe contacts: any contact geom not in allowed list
        allowed = set(self.cfg.allowed_contact_geoms)
        unsafe = any((c not in allowed) for c in contacts) if contacts else False
        if unsafe:
            self.m.unsafe_contact_steps += 1

        # Slip: if any allowed foot contact is moving too fast laterally
        slipped = False
        for foot in self.cfg.allowed_contact_geoms:
            if foot in contacts:
                v = _safe_call(sim, "get_geom_linvel", foot, default=None)
                if v is None:
                    continue
                try:
                    vx, vy, vz = float(v[0]), float(v[1]), float(v[2])
                    # approximate tangential speed (ignore up-axis)
                    if self.cfg.up_axis == 2:
                        vt = math.sqrt(vx * vx + vy * vy)
                    elif self.cfg.up_axis == 1:
                        vt = math.sqrt(vx * vx + vz * vz)
                    else:
                        vt = math.sqrt(vy * vy + vz * vz)
                    if vt >= self.cfg.slip_speed_thresh_m_s:
                        slipped = True
                        break
                except Exception:
                    continue

        if slipped:
            self.m.slip_steps += 1

        # Air/landing detection: in_air if no allowed foot contacts
        feet_in_contact = any((foot in contacts) for foot in self.cfg.allowed_contact_geoms)
        now_in_air = not feet_in_contact

        t = _safe_call(sim, "time_s", default=(self._last_t or 0.0))

        # Transition: ground -> air (takeoff)
        if (not self.m.in_air) and now_in_air:
            self.m.in_air = True
            self.m.air_start_s = float(t)
            self.m.takeoff_time_s = float(t)

        # Stay in air
        if self.m.in_air and now_in_air and self.m.air_start_s is not None:
            self.m.airtime_s = float(t) - float(self.m.air_start_s)

        # Transition: air -> ground (landing)
        if self.m.in_air and (not now_in_air):
            air_dur = (float(t) - float(self.m.air_start_s)) if self.m.air_start_s is not None else 0.0
            if air_dur >= self.cfg.landing_detect_min_air_s:
                self.m.landing_time_s = float(t)
                self._landing_begin(t)

            self.m.in_air = False
            self.m.air_start_s = None
            self.m.airtime_s = 0.0

        # Landing impulse accumulation (best-effort)
        self._landing_update(sim, t)

    def _landing_begin(self, t: float) -> None:
        self.m.landing_active = True
        self.m.landing_started_s = float(t)
        # reset only per landing window
        self.m.landing_impulse_n_s = 0.0
        self.m.landing_impulse_peak_n = 0.0

    def _landing_update(self, sim: Any, t: float) -> None:
        if not self.m.landing_active:
            return
        if self.m.landing_started_s is None:
            self.m.landing_active = False
            return

        # Keep landing window short (prevents integrating forever)
        if float(t) - float(self.m.landing_started_s) > 0.20:
            self.m.landing_active = False
            self.m.landing_started_s = None
            return

        # If sim provides a total contact normal force (Newtons), integrate impulse
        fn = _safe_call(sim, "get_contact_normal_force_n", default=None)
        if fn is None:
            return

        fn = float(fn)
        self.m.landing_impulse_peak_n = max(self.m.landing_impulse_peak_n, fn)

        # Impulse integration needs dt
        if self._last_t is None:
            return
        # dt already applied in main; here we approximate with 0 (safe) or caller dt.
        # If your sim can provide a timestep, prefer that.
        dt = _safe_call(sim, "dt_s", default=0.0)
        try:
            dt = float(dt)
        except Exception:
            dt = 0.0
        if dt > 0.0:
            self.m.landing_impulse_n_s += fn * dt

    def _update_fall(self, sim: Any, t: float) -> None:
        if self.m.fall_over:
            return

        # 1) Tilt based fall
        tilt = _safe_call(sim, "get_torso_tilt_deg", self.cfg.up_axis, default=None)
        if tilt is not None:
            try:
                if float(tilt) >= float(self.cfg.fall_tilt_deg):
                    self.m.fall_over = True
                    self.m.fall_time_s = float(t)
                    return
            except Exception:
                pass

        # 2) COM-height based fall
        com = _safe_call(sim, "get_com_pos", default=None)
        if com is not None and len(com) > self.cfg.up_axis:
            try:
                h = float(com[self.cfg.up_axis])
                if h <= float(self.cfg.min_com_height_m):
                    self.m.fall_over = True
                    self.m.fall_time_s = float(t)
                    return
            except Exception:
                pass

    def _compute_reward(self, sim: Any) -> float:
        base_h = float(self.com0[self.cfg.up_axis]) if self.com0 is not None else 0.0
        jump_height = float(self.max_com_h - base_h) if self.max_com_h > -1e8 else 0.0

        unsafe = float(self.m.unsafe_contact_steps > 0)
        fell = float(self.m.fall_over)

        if self.cfg.reward_mode == "power_ratio":
            # “Specific power ratio” proxy: (specific peak power) * (height achieved)
            # then penalize unsafe/fall.
            spec_p = float(self.m.peak_power_w) / max(1e-9, self._mass_kg(sim))
            r = (0.25 * jump_height) + (0.001 * spec_p)
            r -= self.cfg.unsafe_contact_penalty * unsafe
            r -= 2.0 * fell
            return float(r)

        # default: jump_height
        r = jump_height
        # Mild penalties
        r -= 0.25 * unsafe
        r -= 2.0 * fell
        return float(r)


# ---------- helpers ----------

def _safe_call(obj: Any, name: str, *args: Any, default: Any = None) -> Any:
    fn = getattr(obj, name, None)
    if fn is None or not callable(fn):
        return default
    try:
        return fn(*args)
    except Exception:
        return default
