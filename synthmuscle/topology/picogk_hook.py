from __future__ import annotations

from dataclasses import dataclass, field, asdict
from hashlib import sha256
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union

import json
import numpy as np


class TopologyError(RuntimeError):
    """Raised for topology hook misuse, invalid specs, or missing backend."""


# ----------------------------
# Determinism utilities
# ----------------------------

def _canonical_json(obj: Any) -> str:
    """
    Canonical JSON for deterministic hashing / replay invariance.
    - sort_keys=True
    - separators fixed
    - no NaN/Inf allowed
    """

    def _sanitize(x: Any) -> Any:
        if isinstance(x, float):
            if not np.isfinite(x):
                raise TopologyError("Non-finite float encountered during canonicalization.")
            return float(x)
        if isinstance(x, (np.floating,)):
            xf = float(x)
            if not np.isfinite(xf):
                raise TopologyError("Non-finite numpy float encountered during canonicalization.")
            return xf
        if isinstance(x, (np.integer,)):
            return int(x)
        if isinstance(x, (list, tuple)):
            return [_sanitize(v) for v in x]
        if isinstance(x, dict):
            return {str(k): _sanitize(v) for k, v in x.items()}
        return x

    clean = _sanitize(obj)
    return json.dumps(clean, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def stable_hash(obj: Any) -> str:
    s = _canonical_json(obj).encode("utf-8")
    return sha256(s).hexdigest()


# ----------------------------
# Core specs (kept separate from sim)
# ----------------------------

@dataclass(frozen=True)
class MaterialSpec:
    """
    Minimal material properties for topology / sizing.
    """

    name: str
    density_kg_m3: float
    E_pa: float
    nu: float
    yield_pa: Optional[float] = None

    def validate(self) -> None:
        if not self.name:
            raise TopologyError("MaterialSpec.name must be non-empty.")
        for k, v in [
            ("density_kg_m3", self.density_kg_m3),
            ("E_pa", self.E_pa),
            ("nu", self.nu),
        ]:
            if not np.isfinite(float(v)):
                raise TopologyError(f"MaterialSpec.{k} must be finite.")
        if self.density_kg_m3 <= 0:
            raise TopologyError("MaterialSpec.density_kg_m3 must be > 0.")
        if self.E_pa <= 0:
            raise TopologyError("MaterialSpec.E_pa must be > 0.")
        if not (0.0 < self.nu < 0.5):
            raise TopologyError("MaterialSpec.nu must satisfy 0 < nu < 0.5.")
        if self.yield_pa is not None and (not np.isfinite(float(self.yield_pa)) or self.yield_pa <= 0):
            raise TopologyError("MaterialSpec.yield_pa must be finite and > 0 if provided.")


@dataclass(frozen=True)
class ManufacturingSpec:
    """
    Manufacturability constraints (kept abstract and backend-agnostic).
    """

    process: str = "additive"
    min_feature_m: float = 0.001
    min_thickness_m: float = 0.001
    max_overhang_deg: float = 45.0  # additive default

    def validate(self) -> None:
        if not self.process:
            raise TopologyError("ManufacturingSpec.process must be non-empty.")
        if self.min_feature_m <= 0 or self.min_thickness_m <= 0:
            raise TopologyError("ManufacturingSpec min_feature/min_thickness must be > 0.")
        if not (0.0 < self.max_overhang_deg <= 90.0):
            raise TopologyError("ManufacturingSpec.max_overhang_deg must be in (0, 90].")


@dataclass(frozen=True)
class LoadCase:
    """
    Abstract load case definition:
    - fixed_nodes: where displacement is constrained
    - forces: point forces (node_id -> [fx,fy,fz])
    - moments: point moments (node_id -> [mx,my,mz])
    """

    name: str
    fixed_nodes: Sequence[str]
    forces: Mapping[str, Sequence[float]] = field(default_factory=dict)
    moments: Mapping[str, Sequence[float]] = field(default_factory=dict)

    def validate(self) -> None:
        if not self.name:
            raise TopologyError("LoadCase.name must be non-empty.")
        if not isinstance(self.fixed_nodes, (list, tuple)) or len(self.fixed_nodes) == 0:
            raise TopologyError("LoadCase.fixed_nodes must be a non-empty list of node ids.")
        for nid, f in self.forces.items():
            if len(f) != 3:
                raise TopologyError(f"LoadCase.forces[{nid}] must be length-3.")
            if not all(np.isfinite(float(x)) for x in f):
                raise TopologyError(f"LoadCase.forces[{nid}] contains non-finite.")
        for nid, m in self.moments.items():
            if len(m) != 3:
                raise TopologyError(f"LoadCase.moments[{nid}] must be length-3.")
            if not all(np.isfinite(float(x)) for x in m):
                raise TopologyError(f"LoadCase.moments[{nid}] contains non-finite.")


@dataclass(frozen=True)
class TopologySolveSpec:
    """
    Backend-agnostic topology settings (SIMP-style naming, but generic).
    """

    volume_fraction: float = 0.25
    penalization: float = 3.0
    filter_radius_m: float = 0.01
    max_iters: int = 200
    convergence_tol: float = 1e-3

    def validate(self) -> None:
        if not (0.01 <= self.volume_fraction <= 0.95):
            raise TopologyError("TopologySolveSpec.volume_fraction must be in [0.01, 0.95].")
        if self.penalization < 1.0:
            raise TopologyError("TopologySolveSpec.penalization must be >= 1.0.")
        if self.filter_radius_m <= 0:
            raise TopologyError("TopologySolveSpec.filter_radius_m must be > 0.")
        if self.max_iters < 1:
            raise TopologyError("TopologySolveSpec.max_iters must be >= 1.")
        if self.convergence_tol <= 0:
            raise TopologyError("TopologySolveSpec.convergence_tol must be > 0.")


@dataclass(frozen=True)
class GeometryEnvelope:
    """
    PicoGK-friendly parametric envelope.
    No meshes here. Only scalar parameters + named interfaces.
    """

    part_id: str
    # bounding box in local part frame
    bbox_min_m: Tuple[float, float, float]
    bbox_max_m: Tuple[float, float, float]
    # ports (e.g., bolt holes, tendon anchors) expressed as named points + radii
    ports: Mapping[str, Dict[str, Any]] = field(default_factory=dict)

    def validate(self) -> None:
        if not self.part_id:
            raise TopologyError("GeometryEnvelope.part_id must be non-empty.")
        bmin = np.asarray(self.bbox_min_m, dtype=float).reshape(3)
        bmax = np.asarray(self.bbox_max_m, dtype=float).reshape(3)
        if not np.all(np.isfinite(bmin)) or not np.all(np.isfinite(bmax)):
            raise TopologyError("GeometryEnvelope bbox values must be finite.")
        if np.any(bmax <= bmin):
            raise TopologyError("GeometryEnvelope bbox_max must be > bbox_min per-axis.")
        for pname, p in self.ports.items():
            if "pos_m" not in p:
                raise TopologyError(f"GeometryEnvelope.ports[{pname}] missing 'pos_m'.")
            pos = p["pos_m"]
            if not (isinstance(pos, (list, tuple)) and len(pos) == 3):
                raise TopologyError(f"GeometryEnvelope.ports[{pname}].pos_m must be length-3.")


@dataclass(frozen=True)
class TopologyRequest:
    """
    All inputs needed for a topology pass. Deterministic by (request_hash, seed).
    """

    seed: int
    envelope: GeometryEnvelope
    material: MaterialSpec
    manufacturing: ManufacturingSpec
    solve: TopologySolveSpec
    loadcases: Sequence[LoadCase]

    # Optional extra params used by a backend (must remain JSON-serializable)
    extra: Mapping[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        self.envelope.validate()
        self.material.validate()
        self.manufacturing.validate()
        self.solve.validate()
        if not isinstance(self.loadcases, (list, tuple)) or len(self.loadcases) == 0:
            raise TopologyError("TopologyRequest.loadcases must be a non-empty list.")
        for lc in self.loadcases:
            lc.validate()
        # extra must be JSON-serializable and finite
        stable_hash(self.to_dict())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "seed": int(self.seed),
            "envelope": asdict(self.envelope),
            "material": asdict(self.material),
            "manufacturing": asdict(self.manufacturing),
            "solve": asdict(self.solve),
            "loadcases": [asdict(lc) for lc in self.loadcases],
            "extra": dict(self.extra),
        }

    def request_hash(self) -> str:
        return stable_hash(self.to_dict())


@dataclass(frozen=True)
class TopologyResult:
    """
    Backend output. The key contract is `geometry_params`:
    a deterministic param dict that PicoGK can compile into CAD/meshes.
    """

    request_hash: str
    seed: int

    # PicoGK param dict (must be deterministic; no random ordering)
    geometry_params: Mapping[str, Any]

    # Optional artifacts for downstream
    mass_kg_est: Optional[float] = None
    compliance_est: Optional[float] = None
    stress_peak_pa_est: Optional[float] = None
    notes: Mapping[str, Any] = field(default_factory=dict)

    def validate(self) -> None:
        if not self.request_hash:
            raise TopologyError("TopologyResult.request_hash must be non-empty.")
        if not isinstance(self.geometry_params, Mapping) or len(self.geometry_params) == 0:
            raise TopologyError("TopologyResult.geometry_params must be a non-empty mapping.")
        # enforce canonical hashability (no NaN/Inf)
        stable_hash({"geometry_params": dict(self.geometry_params)})

        for k in ["mass_kg_est", "compliance_est", "stress_peak_pa_est"]:
            v = getattr(self, k)
            if v is not None and (not np.isfinite(float(v))):
                raise TopologyError(f"TopologyResult.{k} must be finite if provided.")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_hash": self.request_hash,
            "seed": int(self.seed),
            "geometry_params": dict(self.geometry_params),
            "mass_kg_est": None if self.mass_kg_est is None else float(self.mass_kg_est),
            "compliance_est": None if self.compliance_est is None else float(self.compliance_est),
            "stress_peak_pa_est": None if self.stress_peak_pa_est is None else float(self.stress_peak_pa_est),
            "notes": dict(self.notes),
        }

    def geometry_hash(self) -> str:
        return stable_hash(self.geometry_params)


# ----------------------------
# Backend interface (no hard dependency)
# ----------------------------

class TopologyBackend:
    """
    Minimal backend interface for topology solving.
    Provide your own backend that calls PicoGK or another solver.

    Must be deterministic for (request, request.seed).
    """

    def run(self, request: TopologyRequest) -> TopologyResult:  # pragma: no cover
        raise NotImplementedError


class NoBackend(TopologyBackend):
    """
    Fail-closed backend: explicit error so we don't silently ship fake topology.
    """

    def run(self, request: TopologyRequest) -> TopologyResult:
        raise TopologyError(
            "No topology backend configured. Provide a TopologyBackend implementation "
            "that can produce geometry_params (PicoGK-compatible)."
        )


# ----------------------------
# PicoGK handoff helpers
# ----------------------------

def morphology_to_envelope_params(morphology: Any) -> Dict[str, Any]:
    """
    Extracts deterministic envelope parameters from a Morphology object,
    without assuming CAD or mesh existence.

    This is intentionally conservative and schema-agnostic:
    - requires nodes with id + pos
    - exports node positions and any node.geom/envelope fields as plain scalars

    The MJCF generator must consume the same envelope values.
    """

    # Pydantic v1/v2 dump
    if hasattr(morphology, "model_dump"):
        m = morphology.model_dump()
    elif hasattr(morphology, "dict"):
        m = morphology.dict()
    else:
        raise TopologyError("morphology_to_envelope_params: morphology must be Pydantic model.")

    if "nodes" not in m or not isinstance(m["nodes"], list) or len(m["nodes"]) == 0:
        raise TopologyError("morphology_to_envelope_params: morphology missing non-empty 'nodes'.")

    nodes = sorted(m["nodes"], key=lambda n: str(n.get("id", "")))
    out_nodes: Dict[str, Any] = {}
    for n in nodes:
        if "id" not in n or "pos" not in n:
            raise TopologyError("morphology_to_envelope_params: each node requires 'id' and 'pos'.")
        nid = str(n["id"])
        pos = n["pos"]
        if not (isinstance(pos, (list, tuple)) and len(pos) == 3):
            raise TopologyError(f"morphology_to_envelope_params: node '{nid}' pos must be length-3.")
        # pass through optional geom/envelope fields if present
        out_nodes[nid] = {
            "pos_m": [float(pos[0]), float(pos[1]), float(pos[2])],
            "geom": n.get("geom", None),
            "envelope": n.get("envelope", None),
        }

    params = {
        "schema_version": m.get("schema_version", None),
        "nodes": out_nodes,
        "edges": m.get("edges", m.get("links", None)),
        "actuators": m.get("actuators", None),
    }

    # Determinism gate: must be hashable without NaN/Inf.
    _ = stable_hash(params)
    return params


def run_topology(
    *,
    request: TopologyRequest,
    backend: Optional[TopologyBackend] = None,
) -> TopologyResult:
    """
    Runs topology optimization via backend and enforces determinism + contract.
    """

    request.validate()
    be = backend or NoBackend()
    result = be.run(request)

    # Hard contract checks
    if result.request_hash != request.request_hash():
        raise TopologyError("TopologyResult.request_hash does not match TopologyRequest hash.")
    if int(result.seed) != int(request.seed):
        raise TopologyError("TopologyResult.seed must equal TopologyRequest.seed.")
    result.validate()
    return result


def determinism_check(
    *,
    request: TopologyRequest,
    backend: TopologyBackend,
) -> Dict[str, Any]:
    """
    Runs the backend twice with identical request; asserts geometry_params hash matches.
    """

    r1 = run_topology(request=request, backend=backend)
    r2 = run_topology(request=request, backend=backend)

    h1 = r1.geometry_hash()
    h2 = r2.geometry_hash()
    if h1 != h2:
        raise TopologyError("Topology backend is non-deterministic: geometry hash mismatch.")

    return {
        "request_hash": request.request_hash(),
        "geometry_hash": h1,
        "ok": True,
    }
