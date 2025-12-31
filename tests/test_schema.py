from __future__ import annotations

import inspect
import importlib
from typing import Any, Dict, List, Optional, Sequence, Tuple, Type


def _pydantic_base_model_type() -> Optional[type]:
    try:
        import pydantic  # noqa: F401
    except Exception:
        return None

    # v2: pydantic.BaseModel, v1: pydantic.main.BaseModel
    try:
        from pydantic import BaseModel  # type: ignore
        return BaseModel
    except Exception:
        return None


def _iter_model_classes(mod) -> List[type]:
    BaseModel = _pydantic_base_model_type()
    if BaseModel is None:
        raise AssertionError("pydantic is required for synthmuscle.schema tests.")

    out: List[type] = []
    for _, obj in vars(mod).items():
        if inspect.isclass(obj) and issubclass(obj, BaseModel) and obj is not BaseModel:
            out.append(obj)
    return out


def _get_field_names(model_cls: type) -> Sequence[str]:
    # pydantic v2
    if hasattr(model_cls, "model_fields"):
        return list(getattr(model_cls, "model_fields").keys())
    # pydantic v1
    if hasattr(model_cls, "__fields__"):
        return list(getattr(model_cls, "__fields__").keys())
    return []


def _find_morphology_model(mod) -> type:
    candidates = _iter_model_classes(mod)
    if not candidates:
        raise AssertionError("No Pydantic models found in synthmuscle.schema.")

    # Prefer exact class names
    preferred = {"Morphology", "RobotMorphology", "MorphologySpec", "RobotSpec"}
    for c in candidates:
        if c.__name__ in preferred:
            return c

    # Fallback: anything with "Morph" in the name
    morph_like = [c for c in candidates if "morph" in c.__name__.lower()]
    if morph_like:
        return morph_like[0]

    raise AssertionError(
        "Could not locate a Morphology-like model in synthmuscle.schema. "
        "Expected a Pydantic model named Morphology/RobotMorphology (or containing 'Morph')."
    )


def test_schema_module_imports():
    mod = importlib.import_module("synthmuscle.schema")
    assert mod is not None


def test_morphology_model_has_schema_version():
    schema = importlib.import_module("synthmuscle.schema")
    Morph = _find_morphology_model(schema)

    fields = set(_get_field_names(Morph))
    assert "schema_version" in fields, (
        f"{Morph.__name__} must contain 'schema_version' field for version locking. "
        f"Found fields: {sorted(fields)}"
    )


def test_morphology_model_has_core_structure_fields():
    """
    Minimal structural expectation: a morphology must expose nodes + connectivity in some form.
    We accept a few common names to avoid brittle failures while still guarding drift.
    """
    schema = importlib.import_module("synthmuscle.schema")
    Morph = _find_morphology_model(schema)

    fields = set(_get_field_names(Morph))
    node_keys = {"nodes", "node", "body_nodes"}
    edge_keys = {"edges", "links", "connections", "joints"}

    has_nodes = any(k in fields for k in node_keys)
    has_edges = any(k in fields for k in edge_keys)

    assert has_nodes, (
        f"{Morph.__name__} must expose node list (one of {sorted(node_keys)}). "
        f"Found fields: {sorted(fields)}"
    )
    assert has_edges, (
        f"{Morph.__name__} must expose connectivity (one of {sorted(edge_keys)}). "
        f"Found fields: {sorted(fields)}"
    )


def test_schema_json_schema_is_generatable():
    schema = importlib.import_module("synthmuscle.schema")
    Morph = _find_morphology_model(schema)

    # v2: model_json_schema; v1: schema()
    if hasattr(Morph, "model_json_schema"):
        js = Morph.model_json_schema()
    elif hasattr(Morph, "schema"):
        js = Morph.schema()
    else:
        raise AssertionError("Morphology model must provide JSON schema generation (pydantic).")

    assert isinstance(js, dict)
    assert "title" in js or "$defs" in js or "definitions" in js, (
        "Generated schema dict does not look like a Pydantic JSON schema."
    )
