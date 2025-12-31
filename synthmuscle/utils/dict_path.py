from __future__ import annotations

from typing import Any, Mapping, MutableMapping, Tuple
import copy


class DictPathError(RuntimeError):
    pass


def _split(path: str) -> Tuple[str, ...]:
    if not isinstance(path, str) or not path.strip():
        raise DictPathError("path must be a non-empty string.")
    parts = tuple(p.strip() for p in path.split(".") if p.strip())
    if not parts:
        raise DictPathError("path must contain at least one key.")
    return parts


def deep_copy(d: Any) -> Any:
    return copy.deepcopy(d)


def get_path(d: Mapping[str, Any], path: str) -> Any:
    cur: Any = d
    for key in _split(path):
        if not isinstance(cur, Mapping) or key not in cur:
            raise DictPathError(f"Missing path segment '{key}' in '{path}'.")
        cur = cur[key]
    return cur


def set_path(d: MutableMapping[str, Any], path: str, value: Any, *, create: bool = False) -> None:
    cur: Any = d
    parts = _split(path)
    for key in parts[:-1]:
        if not isinstance(cur, MutableMapping):
            raise DictPathError(f"Cannot traverse non-mapping at '{key}' for '{path}'.")
        if key not in cur:
            if not create:
                raise DictPathError(f"Missing path segment '{key}' in '{path}'.")
            cur[key] = {}
        cur = cur[key]
    last = parts[-1]
    if not isinstance(cur, MutableMapping):
        raise DictPathError(f"Cannot set on non-mapping at '{last}' for '{path}'.")
    if (not create) and (last not in cur):
        raise DictPathError(f"Missing final key '{last}' in '{path}'.")
    cur[last] = value
