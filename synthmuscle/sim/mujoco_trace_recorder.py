from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Tuple

import numpy as np

from synthmuscle.sim.contact_export import ContactTrace


class TraceRecorderError(RuntimeError):
    pass


def _finite(x: np.ndarray, name: str) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    if not np.all(np.isfinite(a)):
        raise TraceRecorderError(f"{name} contains non-finite values.")
    return a


@dataclass
class MujocoTraceRecorder:
    """
    Records:
      - tau: (T,J)
      - omega: (T,J)
      - forces_xyz: (T,1,3) summed contact force per step (world frame)
    """

    tau_steps: List[np.ndarray] = field(default_factory=list)
    omega_steps: List[np.ndarray] = field(default_factory=list)
    fsum_steps: List[np.ndarray] = field(default_factory=list)

    def append(self, *, tau: np.ndarray, omega: np.ndarray, contact_force_sum_xyz: np.ndarray) -> None:
        tau = _finite(np.asarray(tau, dtype=float).reshape(-1), "tau")
        omega = _finite(np.asarray(omega, dtype=float).reshape(-1), "omega")
        fsum = _finite(np.asarray(contact_force_sum_xyz, dtype=float).reshape(3), "contact_force_sum_xyz")

        if tau.shape != omega.shape:
            raise TraceRecorderError("tau and omega must have same shape per step.")

        self.tau_steps.append(tau)
        self.omega_steps.append(omega)
        self.fsum_steps.append(fsum)

    def finalize(self) -> Tuple[np.ndarray, np.ndarray, ContactTrace]:
        if not self.tau_steps:
            raise TraceRecorderError("No steps recorded.")

        tau = np.stack(self.tau_steps, axis=0)      # (T,J)
        omega = np.stack(self.omega_steps, axis=0)  # (T,J)
        fsum = np.stack(self.fsum_steps, axis=0)    # (T,3)

        forces_xyz = fsum[:, None, :]

        trace = ContactTrace(forces_xyz=forces_xyz, foot_vel_xyz=None)
        trace.validate()

        return tau, omega, trace
