from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple
import math

import numpy as np

from .base import SimEnv, StepResult, TaskSpec


@dataclass(frozen=True)
class MujocoDomainRandomization:
    """
    Minimal, safe-to-apply randomization knobs.

    Notes:
    - MuJoCo 'geom_friction' is 3 numbers per geom: (slide, spin, roll).
      We randomize slide friction only and keep others proportional.
    - Contact "stiffness" is not a single scalar in MuJoCo; it is shaped by
      solref/solimp. We provide a conservative hook that adjusts solref time-constant.
    """

    enable: bool = True

    # Friction (slide) randomization
    mu_nominal: float = 0.9
    mu_sigma: float = 0.15
    mu_min: float = 0.05
    mu_max: float = 2.00

    # Contact softness (solref) randomization (time constant, damping ratio)
    # solref = (timeconst, dampratio)
    solref_timeconst_nominal: float = 0.02
    solref_timeconst_sigma: float = 0.01
    solref_timeconst_min: float = 0.005
    solref_timeconst_max: float = 0.08
    solref_dampratio: float = 1.0  # keep stable

    # Mass drift on bodies (multiplicative) excluding world body
    body_mass_sigma: float = 0.03
    body_mass_min: float = 0.80
    body_mass_max: float = 1.20


@dataclass(frozen=True)
class MujocoSimConfig:
    model_xml_path: str
    dt: float = 0.002

    # Control scaling
    ctrl_clip: float = 1.0

    # Observation configuration
    obs_include_qpos: bool = True
    obs_include_qvel: bool = True

    # Domain randomization
    dr: MujocoDomainRandomization = MujocoDomainRandomization()


class MujocoAdapter(SimEnv):
    """
    Adapter contract:
      - reset(seed) -> obs
      - step(action) -> StepResult
      - render() -> optional viewer

    What this DOES:
      - Loads MJCF
      - Runs deterministic stepping with dt
      - Provides safe domain randomization hooks
      - Provides minimal observation vector and action mapping

    What this does NOT yet do:
      - Generate MJCF from your Morphology (separate fragment)
      - Compute task reward/metrics (separate fragment)
      - Implement safety layer or WBC/MPC (separate fragment)
    """

    def __init__(self, cfg: MujocoSimConfig, task: TaskSpec) -> None:
        self.cfg = cfg
        self.task = task
        self.t: float = 0.0

        # Lazy import so the package can import without mujoco installed
        try:
            import mujoco  # type: ignore

            self._mj = mujoco
        except Exception as e:
            raise RuntimeError("MuJoCo is not installed or failed to import.") from e

        try:
            self._m = self._mj.MjModel.from_xml_path(cfg.model_xml_path)
            self._m.opt.timestep = float(cfg.dt)
            self._d = self._mj.MjData(self._m)
        except Exception as e:
            raise RuntimeError("MuJoCo model failed to load from XML.") from e

        self._rng = np.random.default_rng(0)
        self._viewer = None

        # Cache defaults for reversible domain randomization
        self._default_geom_friction = np.array(self._m.geom_friction, dtype=float, copy=True)
        self._default_geom_solref = np.array(self._m.geom_solref, dtype=float, copy=True)
        self._default_body_mass = np.array(self._m.body_mass, dtype=float, copy=True)

        # Hardening: task dt must match sim dt unless you explicitly plan otherwise
        if abs(float(task.dt) - float(cfg.dt)) > 1e-12:
            raise ValueError("TaskSpec.dt must equal MujocoSimConfig.dt for this adapter.")

        if float(task.horizon_s) <= 0.0:
            raise ValueError("TaskSpec.horizon_s must be > 0")

        if float(cfg.ctrl_clip) <= 0.0:
            raise ValueError("ctrl_clip must be > 0")

    # ----------------------------
    # Public API
    # ----------------------------

    def reset(self, seed: Optional[int] = None) -> np.ndarray:
        if seed is not None:
            self._rng = np.random.default_rng(int(seed))

        self.t = 0.0
        self._mj.mj_resetData(self._m, self._d)

        # Restore deterministic defaults before applying any randomization
        self._restore_defaults()

        # Apply domain randomization (if enabled)
        if self.cfg.dr.enable:
            self._apply_domain_randomization()

        # Forward once to ensure derived quantities are consistent
        self._mj.mj_forward(self._m, self._d)

        return self._get_obs()

    def step(self, action: np.ndarray) -> StepResult:
        action = self._sanitize_action(action)

        # Apply control (MuJoCo ctrl vector length = nu)
        nu = int(self._m.nu)
        if nu == 0:
            raise RuntimeError("MuJoCo model has nu=0 controls but step(action) was called.")

        if action.shape != (nu,):
            raise ValueError(f"Action shape must be ({nu},), got {tuple(action.shape)}")

        self._d.ctrl[:] = action

        # Step physics
        self._mj.mj_step(self._m, self._d)
        self.t += float(self.cfg.dt)

        obs = self._get_obs()

        # Reward is task-specific, keep placeholder deterministic
        reward = 0.0
        done = bool(self.t >= float(self.task.horizon_s))
        info: Dict[str, Any] = {
            "t": float(self.t),
        }
        return StepResult(obs=obs, reward=reward, done=done, info=info)

    def render(self) -> None:
        """
        Optional viewer. If unavailable, silently no-op.
        """
        try:
            # Newer MuJoCo ships mujoco.viewer
            import mujoco.viewer  # type: ignore

            if self._viewer is None:
                self._viewer = mujoco.viewer.launch_passive(self._m, self._d)
            else:
                # Passive viewer updates on its own; nothing required here.
                pass
        except Exception:
            return

    # ----------------------------
    # Internals
    # ----------------------------

    def _sanitize_action(self, action: np.ndarray) -> np.ndarray:
        a = np.asarray(action, dtype=float).reshape(-1)
        clip = float(self.cfg.ctrl_clip)
        a = np.clip(a, -clip, clip)
        return a

    def _get_obs(self) -> np.ndarray:
        parts = []
        if self.cfg.obs_include_qpos:
            parts.append(np.array(self._d.qpos, dtype=float))
        if self.cfg.obs_include_qvel:
            parts.append(np.array(self._d.qvel, dtype=float))
        if not parts:
            # Hardening: never return empty obs
            return np.zeros((1,), dtype=float)
        return np.concatenate(parts, axis=0)

    def _restore_defaults(self) -> None:
        self._m.geom_friction[:] = self._default_geom_friction
        self._m.geom_solref[:] = self._default_geom_solref
        self._m.body_mass[:] = self._default_body_mass

    def _apply_domain_randomization(self) -> None:
        dr = self.cfg.dr

        # 1) Friction randomization on all geoms
        mu = float(self._rng.normal(dr.mu_nominal, dr.mu_sigma))
        mu = float(np.clip(mu, dr.mu_min, dr.mu_max))

        # geom_friction shape: (ngeom, 3)
        gf = np.array(self._m.geom_friction, dtype=float, copy=True)
        # Preserve spin/roll ratios from defaults
        default = self._default_geom_friction
        for i in range(gf.shape[0]):
            # Default slide friction is default[i,0]; keep proportions for [1],[2]
            slide0 = float(default[i, 0]) if float(default[i, 0]) > 1e-12 else 1.0
            spin_ratio = float(default[i, 1] / slide0)
            roll_ratio = float(default[i, 2] / slide0)
            gf[i, 0] = mu
            gf[i, 1] = mu * spin_ratio
            gf[i, 2] = mu * roll_ratio
        self._m.geom_friction[:] = gf

        # 2) Contact softness randomization via solref time constant
        tc = float(self._rng.normal(dr.solref_timeconst_nominal, dr.solref_timeconst_sigma))
        tc = float(np.clip(tc, dr.solref_timeconst_min, dr.solref_timeconst_max))
        solref = np.array(self._m.geom_solref, dtype=float, copy=True)
        # solref per geom: (timeconst, dampratio)
        solref[:, 0] = tc
        solref[:, 1] = float(dr.solref_dampratio)
        self._m.geom_solref[:] = solref

        # 3) Body mass drift (exclude world body = index 0)
        bm = np.array(self._m.body_mass, dtype=float, copy=True)
        for i in range(1, bm.shape[0]):
            mult = float(self._rng.normal(1.0, dr.body_mass_sigma))
            mult = float(np.clip(mult, dr.body_mass_min, dr.body_mass_max))
            bm[i] = float(self._default_body_mass[i]) * mult
        self._m.body_mass[:] = bm


# ----------------------------
# Minimal self-check example
# ----------------------------

if __name__ == "__main__":
    # This is a smoke test only. Provide a real MJCF path to run it.
    from .base import TaskSpec

    cfg = MujocoSimConfig(model_xml_path="model.xml", dt=0.002)
    task = TaskSpec(name="smoke", horizon_s=0.02, dt=0.002)

    try:
        env = MujocoAdapter(cfg, task)
        obs = env.reset(seed=123)
        print("obs dim:", obs.shape[0])

        if int(env._m.nu) > 0:
            a = np.zeros((int(env._m.nu),), dtype=float)
            out = env.step(a)
            print("step ok, done:", out.done)
    except Exception as e:
        print("Smoke test skipped/failed:", str(e))

# ----------------------------
# Contact helper aliases (optional)
# ----------------------------

try:
    from synthmuscle.sim.mujoco_contact import summed_contact_force_world as _summed_contact_force_world
    from synthmuscle.sim.mujoco_contact import ContactForceConfig as _ContactForceConfig
except Exception:  # pragma: no cover
    _summed_contact_force_world = None  # type: ignore
    _ContactForceConfig = None  # type: ignore


def mujoco_get_summed_contact_force_xyz(model, data, *, frame_transpose: bool = False):
    """
    Returns (3,) world-frame summed contact force.
    Deterministic helper for adapters.
    """
    if _summed_contact_force_world is None:
        raise RuntimeError("MuJoCo contact helpers unavailable. Ensure synthmuscle/sim/mujoco_contact.py exists.")
    cfg = _ContactForceConfig(frame_transpose=bool(frame_transpose), include_only_active=True)
    return _summed_contact_force_world(model, data, cfg=cfg)
