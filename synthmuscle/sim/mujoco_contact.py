from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np


class MujocoContactError(RuntimeError):
    pass


def _require_mujoco():
    try:
        import mujoco  # type: ignore
    except Exception as e:  # pragma: no cover
        raise MujocoContactError(
            "MuJoCo python package not available. Install mujoco to use contact extraction."
        ) from e
    return mujoco


def _finite(x: np.ndarray, name: str) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    if not np.all(np.isfinite(a)):
        raise MujocoContactError(f"{name} contains non-finite values.")
    return a


@dataclass(frozen=True)
class ContactForceConfig:
    """
    frame_transpose:
      MuJoCo's contact.frame is a 3x3 contact frame in world coordinates.
      In some bindings/versions, reshaping can appear transposed depending on memory layout.
      If your normals look wrong, flip this flag.

    include_only_active:
      If True, ignore contacts where computed normal force <= 0.
    """

    frame_transpose: bool = False
    include_only_active: bool = True


def contact_forces_world(
    model,
    data,
    *,
    cfg: ContactForceConfig = ContactForceConfig(),
) -> np.ndarray:
    """
    Returns:
      forces_xyz: (C,3) world-frame force vectors for each contact.
    Notes:
      - Uses only the force component (first 3 entries) of the 6D wrench.
      - Force is expressed in the contact frame where:
          f_contact = [normal, friction1, friction2]
      - Convert via contact.frame to world:
          f_world = R @ f_contact
        where R columns are the contact-frame axes in world coordinates.
    """
    mujoco = _require_mujoco()

    ncon = int(getattr(data, "ncon", 0))
    if ncon <= 0:
        return np.zeros((0, 3), dtype=float)

    out = np.zeros((ncon, 3), dtype=float)
    wrench = np.zeros(6, dtype=float)

    for i in range(ncon):
        mujoco.mj_contactForce(model, data, i, wrench)
        f_contact = np.array(wrench[:3], dtype=float)

        c = data.contact[i]
        frame = np.array(c.frame, dtype=float).reshape(3, 3)

        if cfg.frame_transpose:
            frame = frame.T

        f_world = frame @ f_contact

        if cfg.include_only_active and float(f_contact[0]) <= 0.0:
            continue

        out[i, :] = f_world

    return _finite(out, "forces_xyz")


def summed_contact_force_world(
    model,
    data,
    *,
    cfg: ContactForceConfig = ContactForceConfig(),
) -> np.ndarray:
    """
    Returns:
      f_sum: (3,) sum of world-frame forces across all contacts.
    """
    f = contact_forces_world(model, data, cfg=cfg)
    if f.size == 0:
        return np.zeros(3, dtype=float)
    return _finite(np.sum(f, axis=0), "f_sum")
