from __future__ import annotations

from typing import Any, Sequence
import numpy as np
import xml.etree.ElementTree as ET


class XMLUtilError(RuntimeError):
    pass


def _finite(x: float, name: str) -> float:
    v = float(x)
    if not np.isfinite(v):
        raise XMLUtilError(f"{name} must be finite.")
    return v


def fmt_f(x: float) -> str:
    v = _finite(x, "float")
    s = f"{v:.8f}".rstrip("0").rstrip(".")
    return s if s else "0"


def fmt_vec(xs: Sequence[float]) -> str:
    arr = np.asarray(list(xs), dtype=float).reshape(-1)
    if arr.size == 0:
        raise XMLUtilError("fmt_vec requires non-empty sequence.")
    if not np.all(np.isfinite(arr)):
        raise XMLUtilError("fmt_vec contains non-finite values.")
    return " ".join(fmt_f(float(v)) for v in arr.tolist())


def add_comment(parent: ET.Element, text: str) -> None:
    parent.append(ET.Comment(str(text)))


def tostring(root: ET.Element) -> str:
    xml = ET.tostring(root, encoding="unicode", method="xml")
    if not xml.startswith("<?xml"):
        return xml
    return xml


def sort_children_by_attr(parent: ET.Element, attr: str) -> None:
    kids = list(parent)

    def keyfn(e: ET.Element) -> str:
        return str(e.get(attr, ""))

    kids_sorted = sorted(kids, key=keyfn)
    parent[:] = kids_sorted
