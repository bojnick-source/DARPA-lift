from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

import numpy as np
import xml.etree.ElementTree as ET

from synthmuscle.mjcf.inertia import inertia_box, inertia_cylinder, inertia_sphere
from synthmuscle.mjcf.xml_utils import add_comment, fmt_f, fmt_vec, tostring, sort_children_by_attr


class MJCFGenError(RuntimeError):
    pass


def _finite_vec(x: Sequence[float], n: int, name: str) -> np.ndarray:
    arr = np.asarray(list(x), dtype=float).reshape(-1)
    if arr.shape[0] != n:
        raise MJCFGenError(f"{name} must have length {n}.")
    if not np.all(np.isfinite(arr)):
        raise MJCFGenError(f"{name} contains non-finite values.")
    return arr


def _fs(x: Any, name: str) -> float:
    try:
        v = float(x)
    except Exception as e:
        raise MJCFGenError(f"{name} must be numeric: {e}") from e
    if not np.isfinite(v):
        raise MJCFGenError(f"{name} must be finite.")
    return v


def _s(x: Any, name: str) -> str:
    if x is None:
        raise MJCFGenError(f"{name} must be non-empty string.")
    s = str(x)
    if not s.strip():
        raise MJCFGenError(f"{name} must be non-empty string.")
    return s


@dataclass(frozen=True)
class MJCFDefaults:
    gravity: Tuple[float, float, float] = (0.0, 0.0, -9.81)
    timestep: float = 0.002
    density: float = 1200.0
    ground_friction: Tuple[float, float, float] = (1.0, 0.005, 0.0001)
    joint_damping: float = 1.0
    joint_armature: float = 0.01
    motor_ctrllimited: bool = True
    motor_ctrlrange: Tuple[float, float] = (-1.0, 1.0)

    def validate(self) -> None:
        _finite_vec(self.gravity, 3, "gravity")
        _fs(self.timestep, "timestep")
        _fs(self.density, "density")
        _finite_vec(self.ground_friction, 3, "ground_friction")
        _fs(self.joint_damping, "joint_damping")
        _fs(self.joint_armature, "joint_armature")
        if float(self.timestep) <= 0:
            raise MJCFGenError("timestep must be > 0.")
        if float(self.density) <= 0:
            raise MJCFGenError("density must be > 0.")


@dataclass(frozen=True)
class MJCFGenConfig:
    root_name: str = "root"
    add_ground: bool = True
    model_name: str = "synthmuscle_model"
    defaults: MJCFDefaults = MJCFDefaults()

    def validate(self) -> None:
        _s(self.root_name, "root_name")
        _s(self.model_name, "model_name")
        self.defaults.validate()


def _topo_order(nodes: Mapping[str, Mapping[str, Any]], root: str) -> List[str]:
    if root not in nodes:
        raise MJCFGenError(f"root node '{root}' missing from nodes.")

    parent: Dict[str, Optional[str]] = {}
    for name, nd in nodes.items():
        p = nd.get("parent", None)
        parent[name] = None if p in (None, "", "None") else str(p)

    for name, p in parent.items():
        if name == root:
            continue
        if p is None or p not in nodes:
            raise MJCFGenError(f"Node '{name}' missing valid parent (got '{p}').")

    children: Dict[str, List[str]] = {k: [] for k in nodes.keys()}
    for name, p in parent.items():
        if name == root:
            continue
        children[p].append(name)
    for k in children:
        children[k] = sorted(children[k])

    out: List[str] = []
    stack: List[str] = [root]
    while stack:
        cur = stack.pop()
        out.append(cur)
        ch = children.get(cur, [])
        for c in reversed(ch):
            stack.append(c)
    return out


def _infer_mass_from_geom(geom: Mapping[str, Any], density: float) -> float:
    gtype = str(geom.get("type", "box"))
    size = geom.get("size", None)
    if size is None:
        return float("nan")
    s = np.asarray(list(size), dtype=float).reshape(-1)
    if not np.all(np.isfinite(s)):
        return float("nan")
    rho = float(density)

    if gtype == "box" and s.size == 3:
        vol = (2 * s[0]) * (2 * s[1]) * (2 * s[2])
        return float(rho * vol)
    if gtype == "sphere" and s.size == 1:
        r = float(s[0])
        vol = (4.0 / 3.0) * np.pi * r**3
        return float(rho * vol)
    if gtype in ("cylinder", "capsule") and s.size >= 2:
        r = float(s[0])
        half = float(s[1])
        h = 2.0 * half
        vol_cyl = np.pi * r**2 * h
        if gtype == "capsule":
            vol_sph = (4.0 / 3.0) * np.pi * r**3
            vol = vol_cyl + vol_sph
        else:
            vol = vol_cyl
        return float(rho * vol)
    return float("nan")


def _infer_inertia(geom: Mapping[str, Any], mass: float) -> Tuple[float, float, float]:
    gtype = str(geom.get("type", "box"))
    size = np.asarray(list(geom.get("size", [])), dtype=float).reshape(-1)
    if not np.all(np.isfinite(size)) or size.size == 0:
        return (1e-6, 1e-6, 1e-6)

    m = float(mass)
    if m <= 0 or not np.isfinite(m):
        return (1e-6, 1e-6, 1e-6)

    if gtype == "box" and size.size == 3:
        sx, sy, sz = (2.0 * float(size[0]), 2.0 * float(size[1]), 2.0 * float(size[2]))
        return inertia_box(m, sx, sy, sz)

    if gtype == "sphere" and size.size >= 1:
        r = float(size[0])
        return inertia_sphere(m, r)

    if gtype in ("cylinder", "capsule") and size.size >= 2:
        r = float(size[0])
        half = float(size[1])
        h = 2.0 * half
        return inertia_cylinder(m, r, h, axis="z")

    return (1e-6, 1e-6, 1e-6)


class MJCFGenerator:
    def __init__(self, cfg: MJCFGenConfig = MJCFGenConfig()):
        cfg.validate()
        self.cfg = cfg

    def generate(
        self,
        *,
        morphology: Mapping[str, Any],
        actuators: Sequence[Mapping[str, Any]] = (),
        sensors: Sequence[Mapping[str, Any]] = (),
        geometry_params: Optional[Mapping[str, float]] = None,
        meta: Optional[Mapping[str, Any]] = None,
    ) -> str:
        if "nodes" not in morphology or not isinstance(morphology["nodes"], Mapping):
            raise MJCFGenError("morphology must contain mapping key 'nodes'.")

        nodes: Dict[str, Mapping[str, Any]] = {str(k): dict(v) for k, v in dict(morphology["nodes"]).items()}
        root = self.cfg.root_name

        order = _topo_order(nodes, root)

        mj = ET.Element("mujoco", attrib={"model": self.cfg.model_name})

        if geometry_params is not None:
            gp_items = sorted((str(k), float(v)) for k, v in dict(geometry_params).items())
            add_comment(mj, "geometry_params:" + ";".join([f"{k}={fmt_f(v)}" for k, v in gp_items]))
        if meta is not None:
            add_comment(mj, "meta:" + str(dict(meta)))

        ET.SubElement(mj, "compiler", attrib={"angle": "radian", "coordinate": "local"})
        ET.SubElement(mj, "option", attrib={"timestep": fmt_f(self.cfg.defaults.timestep), "gravity": fmt_vec(self.cfg.defaults.gravity)})

        default = ET.SubElement(mj, "default")
        ET.SubElement(
            default,
            "joint",
            attrib={
                "damping": fmt_f(self.cfg.defaults.joint_damping),
                "armature": fmt_f(self.cfg.defaults.joint_armature),
            },
        )
        ET.SubElement(
            default,
            "motor",
            attrib={
                "ctrllimited": "true" if self.cfg.defaults.motor_ctrllimited else "false",
                "ctrlrange": fmt_vec(self.cfg.defaults.motor_ctrlrange),
            },
        )

        world = ET.SubElement(mj, "worldbody")

        if self.cfg.add_ground:
            ET.SubElement(
                world,
                "geom",
                attrib={
                    "name": "ground",
                    "type": "plane",
                    "pos": "0 0 0",
                    "size": "10 10 0.1",
                    "friction": fmt_vec(self.cfg.defaults.ground_friction),
                    "rgba": "0.2 0.2 0.2 1",
                },
            )

        body_elems: Dict[str, ET.Element] = {}

        for name in order:
            nd = nodes[name]
            parent = nd.get("parent", None)
            pos = _finite_vec(nd.get("pos", [0, 0, 0]), 3, f"nodes[{name}].pos")
            quat = nd.get("quat", [1, 0, 0, 0])
            quat = _finite_vec(quat, 4, f"nodes[{name}].quat")

            if name == root:
                parent_elem = world
            else:
                parent_elem = body_elems[str(parent)]

            body = ET.SubElement(
                parent_elem,
                "body",
                attrib={
                    "name": name,
                    "pos": fmt_vec(pos),
                    "quat": fmt_vec(quat),
                },
            )
            body_elems[name] = body

            geom = dict(nd.get("geom", {}) or {})
            mass = nd.get("mass", None)
            if mass is None:
                mass_inf = _infer_mass_from_geom(geom, density=self.cfg.defaults.density)
                mass = mass_inf if np.isfinite(mass_inf) and mass_inf > 0 else 1.0
            m = _fs(mass, f"nodes[{name}].mass")
            if m <= 0:
                raise MJCFGenError(f"nodes[{name}].mass must be > 0.")

            inertia = nd.get("inertia", None)
            if inertia is None:
                ixx, iyy, izz = _infer_inertia(geom, m)
            else:
                ivec = _finite_vec(inertia, 3, f"nodes[{name}].inertia")
                ixx, iyy, izz = (float(ivec[0]), float(ivec[1]), float(ivec[2]))

            ET.SubElement(
                body,
                "inertial",
                attrib={
                    "pos": "0 0 0",
                    "mass": fmt_f(m),
                    "diaginertia": fmt_vec([ixx, iyy, izz]),
                },
            )

            if "joint" in nd and nd["joint"] is not None:
                js = dict(nd["joint"])
                jname = _s(js.get("name", f"{name}_joint"), f"nodes[{name}].joint.name")
                jtype = str(js.get("type", "hinge"))
                if jtype not in ("hinge", "slide", "ball", "free"):
                    raise MJCFGenError(f"Unsupported joint type '{jtype}' for '{name}'.")
                jattr: Dict[str, str] = {"name": jname, "type": jtype}
                if jtype in ("hinge", "slide"):
                    axis = _finite_vec(js.get("axis", [1, 0, 0]), 3, f"joint[{jname}].axis")
                    jattr["axis"] = fmt_vec(axis)
                    if "range" in js and js["range"] is not None:
                        r = _finite_vec(js["range"], 2, f"joint[{jname}].range")
                        jattr["range"] = fmt_vec(r)
                    if "damping" in js and js["damping"] is not None:
                        jattr["damping"] = fmt_f(_fs(js["damping"], f"joint[{jname}].damping"))
                    if "armature" in js and js["armature"] is not None:
                        jattr["armature"] = fmt_f(_fs(js["armature"], f"joint[{jname}].armature"))
                ET.SubElement(body, "joint", attrib=jattr)

            if geom:
                gtype = str(geom.get("type", "box"))
                gname = str(geom.get("name", f"{name}_geom"))
                size = geom.get("size", None)
                if size is None:
                    raise MJCFGenError(f"nodes[{name}].geom.size is required when geom is provided.")
                size_vec = np.asarray(list(size), dtype=float).reshape(-1)
                if not np.all(np.isfinite(size_vec)):
                    raise MJCFGenError(f"nodes[{name}].geom.size contains non-finite.")
                gattr: Dict[str, str] = {
                    "name": gname,
                    "type": gtype,
                    "size": fmt_vec(size_vec),
                }
                if "pos" in geom and geom["pos"] is not None:
                    gattr["pos"] = fmt_vec(_finite_vec(geom["pos"], 3, f"geom[{gname}].pos"))
                if "quat" in geom and geom["quat"] is not None:
                    gattr["quat"] = fmt_vec(_finite_vec(geom["quat"], 4, f"geom[{gname}].quat"))
                if "rgba" in geom and geom["rgba"] is not None:
                    rgba = _finite_vec(geom["rgba"], 4, f"geom[{gname}].rgba")
                    gattr["rgba"] = fmt_vec(rgba)
                if "friction" in geom and geom["friction"] is not None:
                    fr = _finite_vec(geom["friction"], 3, f"geom[{gname}].friction")
                    gattr["friction"] = fmt_vec(fr)
                if "contype" in geom:
                    gattr["contype"] = str(int(geom["contype"]))
                if "conaffinity" in geom:
                    gattr["conaffinity"] = str(int(geom["conaffinity"]))
                ET.SubElement(body, "geom", attrib=gattr)

        act = ET.SubElement(mj, "actuator")
        for a in sorted(list(actuators), key=lambda d: str(d.get("name", ""))):
            name = _s(a.get("name", None), "actuator.name")
            joint = _s(a.get("joint", None), f"actuator[{name}].joint")
            gear = _fs(a.get("gear", 1.0), f"actuator[{name}].gear")
            attr = {"name": name, "joint": joint, "gear": fmt_f(gear)}
            if "ctrlrange" in a and a["ctrlrange"] is not None:
                cr = _finite_vec(a["ctrlrange"], 2, f"actuator[{name}].ctrlrange")
                attr["ctrlrange"] = fmt_vec(cr)
                attr["ctrllimited"] = "true"
            ET.SubElement(act, "motor", attrib=attr)
        sort_children_by_attr(act, "name")

        sen = ET.SubElement(mj, "sensor")
        for s in sorted(list(sensors), key=lambda d: str(d.get("name", ""))):
            stype = _s(s.get("type", None), "sensor.type")
            sname = _s(s.get("name", None), "sensor.name")

            if stype in ("jointpos", "jointvel", "jointlimitpos", "jointlimitvel"):
                joint = _s(s.get("joint", None), f"sensor[{sname}].joint")
                ET.SubElement(sen, stype, attrib={"name": sname, "joint": joint})
            elif stype in ("framepos", "framequat", "frameangvel", "framelinvel"):
                obj = _s(s.get("objname", None), f"sensor[{sname}].objname")
                ET.SubElement(sen, stype, attrib={"name": sname, "objtype": "body", "objname": obj})
            else:
                raise MJCFGenError(f"Unsupported sensor type '{stype}' for '{sname}'.")
        sort_children_by_attr(sen, "name")

        return tostring(mj)
