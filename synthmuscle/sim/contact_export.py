from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional

import numpy as np


class ContactExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class ContactTrace:
    """
    Standard contact trace contract:

    forces_xyz: (T,C,3) world-frame contact forces summed per contact point
      - Z must be the normal axis (up). If your sim uses different axes, rotate before storing.
    foot_vel_xyz: optional (T,F,3) foot/contact-point velocities (for additional slip metrics later)
    """

    forces_xyz: np.ndarray
    foot_vel_xyz: Optional[np.ndarray] = None

    def validate(self) -> None:
        f = np.asarray(self.forces_xyz, dtype=float)
        if f.ndim == 2 and f.shape[1] == 3:
            f = f[:, None, :]
        if f.ndim != 3 or f.shape[2] != 3:
            raise ContactExportError("forces_xyz must be shape (T,3) or (T,C,3).")
        if not np.all(np.isfinite(f)):
            raise ContactExportError("forces_xyz contains non-finite values.")

        if self.foot_vel_xyz is not None:
            v = np.asarray(self.foot_vel_xyz, dtype=float)
            if v.ndim != 3 or v.shape[2] != 3:
                raise ContactExportError("foot_vel_xyz must be shape (T,F,3).")
            if not np.all(np.isfinite(v)):
                raise ContactExportError("foot_vel_xyz contains non-finite values.")

    def as_dict(self) -> Dict[str, object]:
        self.validate()
        return {
            "forces_xyz": self.forces_xyz,
            "foot_vel_xyz": self.foot_vel_xyz,
        }
