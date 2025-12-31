"""
Lightweight NumPy compatibility shim for restricted environments.

This module implements a minimal subset of the NumPy API used by the tests and
library code in this repository. It is **not** a drop-in replacement for the
real NumPy package; only the pieces that are exercised by the codebase are
provided. The goal is to keep the public surface familiar while delegating all
computation to simple Python lists and the standard library.
"""

from __future__ import annotations

import math
import random as _random
import builtins
from types import SimpleNamespace
from typing import Any, Callable, Iterable, Iterator, List, Sequence, Tuple, Union

Number = Union[int, float, bool]
builtins_abs = builtins.abs
builtins_min = builtins.min
builtins_max = builtins.max
builtins_all = builtins.all
builtins_any = builtins.any
builtins_sum = builtins.sum


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _is_seq(x: Any) -> bool:
    return isinstance(x, (list, tuple, ndarray))


def _infer_shape(x: Any) -> Tuple[int, ...]:
    if isinstance(x, ndarray):
        return x.shape
    if isinstance(x, (list, tuple)):
        if len(x) == 0:
            return (0,)
        first_shape = _infer_shape(x[0])
        for xi in x[1:]:
            if _infer_shape(xi) != first_shape:
                raise ValueError("Ragged nested sequences are not supported.")
        return (len(x),) + first_shape
    return ()


def _to_nested(x: Any, dtype: Any = float) -> Any:
    if isinstance(x, ndarray):
        return x._data_copy(dtype)
    if isinstance(x, (list, tuple)):
        return [_to_nested(xi, dtype=dtype) for xi in x]
    if dtype is bool:
        return bool(x)
    return float(x)


def _flatten(x: Any) -> List[Number]:
    if isinstance(x, ndarray):
        return x.flatten()
    if isinstance(x, (list, tuple)):
        out: List[Number] = []
        for xi in x:
            out.extend(_flatten(xi))
        return out
    return [x]


def _product(shape: Tuple[int, ...]) -> int:
    p = 1
    for s in shape:
        p *= s
    return p


def _reshape_list(flat: List[Number], shape: Tuple[int, ...]) -> Any:
    if not shape:
        return flat[0]
    if len(shape) == 1:
        return flat[: shape[0]]
    step = _product(shape[1:])
    out = []
    for i in range(shape[0]):
        out.append(_reshape_list(flat[i * step : (i + 1) * step], shape[1:]))
    return out


def _broadcast_shape(sa: Tuple[int, ...], sb: Tuple[int, ...]) -> Tuple[int, ...]:
    if sa == ():
        return sb
    if sb == ():
        return sa
    if sa != sb:
        raise ValueError(f"Shape mismatch: {sa} vs {sb}")
    return sa


def _binary_op_data(a: Any, b: Any, op: Callable[[Number, Number], Number]) -> Any:
    if _is_seq(a) and _is_seq(b):
        len_a = len(a)
        len_b = len(b)
        if len_a != len_b:
            if len_a == 1:
                return [_binary_op_data(a[0], bi, op) for bi in b]
            if len_b == 1:
                return [_binary_op_data(ai, b[0], op) for ai in a]
            raise ValueError("Shape mismatch for elementwise operation.")
        return [_binary_op_data(ai, bi, op) for ai, bi in zip(a, b)]
    if _is_seq(a):
        return [_binary_op_data(ai, b, op) for ai in a]
    if _is_seq(b):
        return [_binary_op_data(a, bi, op) for bi in b]
    return op(a, b)


def _unary_op_data(a: Any, op: Callable[[Number], Number]) -> Any:
    if _is_seq(a):
        return [_unary_op_data(ai, op) for ai in a]
    return op(a)


def _zero_like(data: Any) -> Any:
    if _is_seq(data):
        return [_zero_like(x) for x in data]
    return 0.0


def _reduce_axis(data: Any, axis: int, op: Callable[[Number, Number], Number]) -> Any:
    if axis == 0:
        if not isinstance(data, list):
            return data
        if len(data) == 0:
            return 0.0
        acc = data[0]
        for item in data[1:]:
            acc = _binary_op_data(acc, item, op)
        return acc
    if not isinstance(data, list):
        raise ValueError("Axis out of bounds.")
    return [_reduce_axis(item, axis - 1, op) for item in data]


# --------------------------------------------------------------------------- #
# ndarray implementation
# --------------------------------------------------------------------------- #
class ndarray:
    def __init__(self, data: Any, dtype: Any = float):
        self._data = _to_nested(data, dtype=dtype)
        self.shape: Tuple[int, ...] = _infer_shape(self._data)
        self.ndim: int = len(self.shape)
        self.dtype = dtype
        self.size = _product(self.shape)

    # Representation and basic protocol -------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"ndarray(shape={self.shape}, data={self._data})"

    def __iter__(self) -> Iterator[Any]:
        if isinstance(self._data, list):
            return iter(self._data)
        return iter([self._data])

    def __len__(self) -> int:
        return self.shape[0] if self.shape else 0

    def _scalar_value(self) -> Number:
        val: Any = self._data
        while isinstance(val, list):
            if len(val) == 0:
                return 0.0
            val = val[0]
        return val

    def __bool__(self) -> bool:
        if self.size == 1:
            return bool(self._scalar_value())
        raise ValueError("The truth value of an array with more than one element is ambiguous.")

    def __float__(self) -> float:
        if self.size == 1:
            return float(self._scalar_value())
        raise TypeError("Only size-1 arrays can be converted to Python scalars.")

    def __int__(self) -> int:
        if self.size == 1:
            return int(self._scalar_value())
        raise TypeError("Only size-1 arrays can be converted to Python scalars.")

    # Copy helpers ---------------------------------------------------------------------
    def _data_copy(self, dtype: Any = None) -> Any:
        dtype = dtype or self.dtype
        return _to_nested(self._data, dtype=dtype)

    def astype(self, dtype: Any) -> "ndarray":
        return ndarray(self._data, dtype=dtype)

    # Indexing -------------------------------------------------------------------------
    def _index(self, data: Any, key: Tuple[Any, ...]) -> Any:
        if not key:
            return data
        k, *rest = key
        if isinstance(k, ndarray):
            k = k._data
        if k is None:
            return self._index([data], tuple(rest))
        if isinstance(k, (int, float)):
            if not isinstance(data, list):
                raise ValueError("Indexing only valid on sequences.")
            return self._index(data[int(k)], tuple(rest))
        if isinstance(k, list) and builtins_all(isinstance(v, bool) for v in k):
            if not isinstance(data, list):
                raise ValueError("Boolean indexing only valid on sequences.")
            selected = [item for item, keep in zip(data, k) if keep]
            if rest:
                return [self._index(item, tuple(rest)) for item in selected]
            return selected
        if isinstance(k, list) and builtins_all(isinstance(v, (int, float)) for v in k):
            if not isinstance(data, list):
                raise ValueError("Integer list indexing only valid on sequences.")
            selected = [data[int(i)] for i in k]
            if rest:
                return [self._index(item, tuple(rest)) for item in selected]
            return selected
        if isinstance(k, slice):
            if not isinstance(data, list):
                raise ValueError("Slice indexing only valid on sequences.")
            sliced = data[k]
            if rest:
                return [self._index(item, tuple(rest)) for item in sliced]
            return sliced
        if isinstance(k, int):
            if not isinstance(data, list):
                raise ValueError("Indexing only valid on sequences.")
            return self._index(data[k], tuple(rest))
        raise TypeError(f"Unsupported index type: {type(k)}")

    def __getitem__(self, key: Any) -> Any:
        if not isinstance(key, tuple):
            key = (key,)
        out = self._index(self._data, key)
        if _is_seq(out):
            return ndarray(out, dtype=self.dtype)
        return out

    def _assign(self, data: Any, key: Tuple[Any, ...], value: Any) -> Any:
        if not key:
            return _to_nested(value, dtype=self.dtype)
        k, *rest = key
        if isinstance(k, ndarray):
            k = k._data
        if isinstance(k, list) and all(isinstance(v, bool) for v in k):
            if not isinstance(data, list):
                raise ValueError("Boolean indexing only valid on sequences.")
            idx = 0
            new_data = []
            for item, keep in zip(data, k):
                if keep:
                    new_data.append(self._assign(item, tuple(rest), value[idx] if _is_seq(value) else value))
                    idx += 1
                else:
                    new_data.append(item)
            return new_data
        if isinstance(k, slice):
            if not isinstance(data, list):
                raise ValueError("Slice assignment only valid on sequences.")
            new_data = list(data)
            vals = value
            if not _is_seq(vals):
                vals = [value] * len(range(*k.indices(len(new_data))))
            for i, vi in zip(range(*k.indices(len(new_data))), vals):
                new_data[i] = self._assign(new_data[i], tuple(rest), vi)
            return new_data
        if isinstance(k, int):
            if not isinstance(data, list):
                raise ValueError("Index assignment only valid on sequences.")
            new_data = list(data)
            new_data[k] = self._assign(new_data[k], tuple(rest), value)
            return new_data
        raise TypeError(f"Unsupported index type: {type(k)}")

    def __setitem__(self, key: Any, value: Any) -> None:
        if not isinstance(key, tuple):
            key = (key,)
        self._data = self._assign(self._data, key, value)

    # Arithmetic -----------------------------------------------------------------------
    def _binary(self, other: Any, op: Callable[[Number, Number], Number]) -> "ndarray":
        odata = other._data if isinstance(other, ndarray) else other
        data = _binary_op_data(self._data, odata, op)
        return ndarray(data, dtype=self.dtype)

    def __add__(self, other: Any) -> "ndarray":
        return self._binary(other, lambda a, b: a + b)

    def __radd__(self, other: Any) -> "ndarray":
        return self.__add__(other)

    def __sub__(self, other: Any) -> "ndarray":
        return self._binary(other, lambda a, b: a - b)

    def __rsub__(self, other: Any) -> "ndarray":
        return ndarray(other, dtype=self.dtype).__sub__(self)

    def __mul__(self, other: Any) -> "ndarray":
        return self._binary(other, lambda a, b: a * b)

    def __rmul__(self, other: Any) -> "ndarray":
        return self.__mul__(other)

    def __truediv__(self, other: Any) -> "ndarray":
        return self._binary(other, lambda a, b: a / b)

    def __rtruediv__(self, other: Any) -> "ndarray":
        return ndarray(other, dtype=self.dtype).__truediv__(self)

    def __neg__(self) -> "ndarray":
        return ndarray(_unary_op_data(self._data, lambda a: -a), dtype=self.dtype)

    def __pow__(self, power: Any) -> "ndarray":
        return self._binary(power, lambda a, b: a**b)

    def __lt__(self, other: Any) -> "ndarray":
        return ndarray(_binary_op_data(self._data, other._data if isinstance(other, ndarray) else other, lambda a, b: a < b), dtype=bool)

    def __le__(self, other: Any) -> "ndarray":
        return ndarray(_binary_op_data(self._data, other._data if isinstance(other, ndarray) else other, lambda a, b: a <= b), dtype=bool)

    def __gt__(self, other: Any) -> "ndarray":
        return ndarray(_binary_op_data(self._data, other._data if isinstance(other, ndarray) else other, lambda a, b: a > b), dtype=bool)

    def __ge__(self, other: Any) -> "ndarray":
        return ndarray(_binary_op_data(self._data, other._data if isinstance(other, ndarray) else other, lambda a, b: a >= b), dtype=bool)

    def __eq__(self, other: Any) -> "ndarray":  # type: ignore[override]
        return ndarray(_binary_op_data(self._data, other._data if isinstance(other, ndarray) else other, lambda a, b: a == b), dtype=bool)

    def __abs__(self) -> "ndarray":
        return ndarray(_unary_op_data(self._data, lambda a: abs(a)), dtype=self.dtype)

    def __or__(self, other: Any) -> "ndarray":
        odata = other._data if isinstance(other, ndarray) else other
        return ndarray(_binary_op_data(self._data, odata, lambda a, b: bool(a) or bool(b)), dtype=bool)

    def __and__(self, other: Any) -> "ndarray":
        odata = other._data if isinstance(other, ndarray) else other
        return ndarray(_binary_op_data(self._data, odata, lambda a, b: bool(a) and bool(b)), dtype=bool)

    # Shape manipulation ---------------------------------------------------------------
    def reshape(self, *shape: int) -> "ndarray":
        if len(shape) == 1 and isinstance(shape[0], tuple):
            shape = shape[0]
        shape = tuple(int(s) for s in shape)
        flat = self.flatten()
        if -1 in shape:
            if shape.count(-1) > 1:
                raise ValueError("Only one dimension can be inferred.")
            known = [s for s in shape if s != -1]
            missing = self.size // _product(tuple(known)) if known else self.size
            shape = tuple(missing if s == -1 else s for s in shape)
        if _product(shape) != self.size:
            raise ValueError("Cannot reshape array to the requested shape.")
        return ndarray(_reshape_list(flat, shape), dtype=self.dtype)

    def ravel(self) -> "ndarray":
        return ndarray(self.flatten(), dtype=self.dtype)

    def flatten(self) -> List[Number]:
        return _flatten(self._data)

    def copy(self) -> "ndarray":
        return ndarray(self._data_copy(dtype=self.dtype), dtype=self.dtype)

    def tolist(self) -> Any:
        return self._data_copy(dtype=self.dtype)


# --------------------------------------------------------------------------- #
# Constructors
# --------------------------------------------------------------------------- #
def array(x: Any, dtype: Any = float, copy: bool = True) -> ndarray:
    return ndarray(_to_nested(x, dtype=dtype) if copy else x, dtype=dtype)


def asarray(x: Any, dtype: Any = float) -> ndarray:
    if isinstance(x, ndarray) and x.dtype == dtype:
        return x
    return ndarray(x, dtype=dtype)


def zeros(shape: Tuple[int, ...], dtype: Any = float) -> ndarray:
    def _fill(sh: Tuple[int, ...]) -> Any:
        if not sh:
            return 0.0 if dtype is float else dtype()
        return [_fill(sh[1:]) for _ in range(int(sh[0]))]

    return ndarray(_fill(tuple(shape)), dtype=dtype)


def ones(shape: Tuple[int, ...], dtype: Any = float) -> ndarray:
    def _fill(sh: Tuple[int, ...]) -> Any:
        if not sh:
            return 1.0 if dtype is float else dtype()
        return [_fill(sh[1:]) for _ in range(int(sh[0]))]

    return ndarray(_fill(tuple(shape)), dtype=dtype)


def full(shape: Tuple[int, ...], fill_value: Number, dtype: Any = float) -> ndarray:
    def _fill(sh: Tuple[int, ...]) -> Any:
        if not sh:
            return dtype(fill_value) if callable(dtype) else fill_value
        return [_fill(sh[1:]) for _ in range(int(sh[0]))]

    return ndarray(_fill(tuple(shape)), dtype=dtype)


def zeros_like(x: ndarray) -> ndarray:
    return zeros(x.shape, dtype=x.dtype)


def arange(start: Number, stop: Number | None = None, step: Number = 1) -> ndarray:
    if stop is None:
        start, stop = 0, start
    vals = []
    v = float(start)
    while v < float(stop):
        vals.append(v)
        v += float(step)
    return ndarray(vals)


def linspace(start: Number, stop: Number, num: int) -> ndarray:
    if num <= 1:
        return ndarray([float(start)])
    step = (float(stop) - float(start)) / (num - 1)
    return ndarray([float(start) + i * step for i in range(num)])


def concatenate(arrays: Sequence[ndarray], axis: int = 0) -> ndarray:
    if not arrays:
        return ndarray([])
    axis = int(axis)
    if axis != 0:
        raise NotImplementedError("Only axis=0 concatenation supported.")
    data: List[Any] = []
    for arr in arrays:
        data.extend(arr._data if isinstance(arr, ndarray) else arr)
    return ndarray(data)


def stack(arrays: Sequence[ndarray], axis: int = 0) -> ndarray:
    axis = int(axis)
    if axis != 0:
        raise NotImplementedError("Only axis=0 stack supported.")
    data = [asarray(a)._data for a in arrays]
    return ndarray(data)


def insert(arr: ndarray, index: int, values: Any, axis: int | None = None) -> ndarray:
    a = asarray(arr)
    vals = _flatten(values)
    if axis is None or a.ndim == 1:
        data = a.flatten()
        data[index:index] = vals
        return ndarray(data)
    if axis != 0:
        raise NotImplementedError("insert only supports axis=None or axis=0 in this shim.")
    data = list(a._data)
    data[index:index] = vals
    return ndarray(data)


# --------------------------------------------------------------------------- #
# Elementwise math
# --------------------------------------------------------------------------- #
def _elementwise(fn: Callable[[Number], Number], x: Any) -> ndarray:
    return ndarray(_unary_op_data(asarray(x)._data, fn))


def sqrt(x: Any) -> ndarray:
    return _elementwise(math.sqrt, x)


def exp(x: Any) -> ndarray:
    return _elementwise(math.exp, x)


def log(x: Any) -> ndarray:
    return _elementwise(math.log, x)


def sin(x: Any) -> ndarray:
    return _elementwise(math.sin, x)


def cos(x: Any) -> ndarray:
    return _elementwise(math.cos, x)


def arcsin(x: Any) -> ndarray:
    return _elementwise(math.asin, x)


def arctan2(y: Any, x: Any) -> ndarray:
    y_arr, x_arr = asarray(y), asarray(x)
    return ndarray(_binary_op_data(y_arr._data, x_arr._data, lambda a, b: math.atan2(a, b)))


def deg2rad(x: Any) -> ndarray:
    return _elementwise(math.radians, x)


def abs(x: Any) -> ndarray:  # type: ignore[override]
    return _elementwise(builtins_abs, x)


def maximum(a: Any, b: Any) -> ndarray:
    return ndarray(_binary_op_data(asarray(a)._data, asarray(b)._data, builtins_max))


def minimum(a: Any, b: Any) -> ndarray:
    return ndarray(_binary_op_data(asarray(a)._data, asarray(b)._data, builtins_min))


def clip(a: Any, a_min: Number, a_max: Number) -> ndarray:
    return ndarray(
        _unary_op_data(
            asarray(a)._data, lambda v: builtins_max(a_min, builtins_min(a_max, v))
        )
    )


# --------------------------------------------------------------------------- #
# Reductions and stats
# --------------------------------------------------------------------------- #
def sum(a: Any, axis: int | None = None) -> ndarray | float:
    arr = asarray(a)
    if axis is None:
        return float(math.fsum(arr.flatten()))
    reduced = _reduce_axis(arr._data, int(axis), lambda x, y: x + y)
    return ndarray(reduced, dtype=arr.dtype)


def mean(a: Any, axis: int | None = None) -> float | ndarray:
    arr = asarray(a)
    if axis is None:
        flat = arr.flatten()
        return float(math.fsum(flat) / len(flat) if flat else 0.0)
    reduced = sum(arr, axis=axis)
    count = arr.shape[axis]
    return reduced / count


def std(a: Any, axis: int | None = None, ddof: int = 0) -> float | ndarray:
    arr = asarray(a)
    if axis is None:
        flat = arr.flatten()
        if not flat:
            return 0.0
        m = mean(arr)
        var = math.fsum((x - m) ** 2 for x in flat) / builtins_max(1, len(flat) - ddof)
        return math.sqrt(var)
    axis = int(axis)
    m = mean(arr, axis=axis)
    diff = asarray(arr) - m
    sq = diff * diff
    summed = sum(sq, axis=axis)
    count = arr.shape[axis]
    denom = builtins_max(1, count - ddof)
    return sqrt(summed / denom)


def min(a: Any) -> Number:  # type: ignore[override]
    return float(builtins_min(asarray(a).flatten())) if asarray(a).flatten() else 0.0


def max(a: Any) -> Number:  # type: ignore[override]
    return float(builtins_max(asarray(a).flatten())) if asarray(a).flatten() else 0.0


def argmin(a: Any) -> int:
    flat = asarray(a).flatten()
    if not flat:
        return 0
    m = builtins_min(flat)
    return flat.index(m)


def argmax(a: Any) -> int:
    flat = asarray(a).flatten()
    if not flat:
        return 0
    m = builtins_max(flat)
    return flat.index(m)


def argsort(a: Any) -> ndarray:
    flat = asarray(a).flatten()
    idx = list(range(len(flat)))
    idx.sort(key=lambda i: flat[i])
    return ndarray(idx)


def quantile(a: Any, q: float, axis: int | None = None) -> float:
    arr = asarray(a)
    flat = arr.flatten() if axis is None else asarray(a)._data  # axis handling minimal
    flat_list = flat if isinstance(flat, list) else [flat]
    if not flat_list:
        return 0.0
    flat_list_sorted = sorted(flat_list)
    q = float(q)
    if q <= 0:
        return float(flat_list_sorted[0])
    if q >= 1:
        return float(flat_list_sorted[-1])
    pos = (len(flat_list_sorted) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(flat_list_sorted[lo])
    frac = pos - lo
    return float(flat_list_sorted[lo] * (1 - frac) + flat_list_sorted[hi] * frac)


def cumsum(a: Any, axis: int | None = None) -> ndarray:
    arr = asarray(a)
    if axis is None or arr.ndim == 1:
        data = []
        total = 0.0
        for v in arr.flatten():
            total += v
            data.append(total)
        return ndarray(data)
    if axis != 0:
        raise NotImplementedError("cumsum supports only axis=None or axis=0.")
    out = []
    running = _zero_like(arr._data[0])
    for row in arr._data:
        running = _binary_op_data(running, row, lambda x, y: x + y)
        out.append(running)
    return ndarray(out)


def all(a: Any) -> bool:  # type: ignore[override]
    return builtins_all(bool(x) for x in asarray(a).flatten())


def any(a: Any) -> bool:  # type: ignore[override]
    return builtins_any(bool(x) for x in asarray(a).flatten())


def allclose(a: Any, b: Any, rtol: float = 1e-05, atol: float = 1e-08) -> bool:
    return all(isclose(a, b, rtol=rtol, atol=atol))


def isclose(a: Any, b: Any, rtol: float = 1e-05, atol: float = 1e-08) -> ndarray:
    a_arr, b_arr = asarray(a), asarray(b)
    return ndarray(
        _binary_op_data(
            a_arr._data,
            b_arr._data,
            lambda x, y: abs(x - y) <= (atol + rtol * abs(y)),
        ),
        dtype=bool,
    )


def isfinite(a: Any) -> ndarray:
    return ndarray(_unary_op_data(asarray(a)._data, lambda x: math.isfinite(float(x))), dtype=bool)


def isinf(a: Any) -> ndarray:
    return ndarray(_unary_op_data(asarray(a)._data, lambda x: math.isinf(float(x))), dtype=bool)


def where(condition: Any, x: Any, y: Any) -> ndarray:
    cond = asarray(condition)
    x_arr = asarray(x)
    y_arr = asarray(y)

    def _select(c: Any, xv: Any, yv: Any) -> Any:
        if _is_seq(c):
            xv_seq = xv if _is_seq(xv) else [xv] * len(c)
            yv_seq = yv if _is_seq(yv) else [yv] * len(c)
            return [_select(ci, xi, yi) for ci, xi, yi in zip(c, xv_seq, yv_seq)]
        return xv if c else yv

    return ndarray(_select(cond._data, x_arr._data, y_arr._data), dtype=x_arr.dtype)


def logical_or(a: Any, b: Any) -> ndarray:
    return ndarray(_binary_op_data(asarray(a)._data, asarray(b)._data, lambda x, y: bool(x) or bool(y)), dtype=bool)


# --------------------------------------------------------------------------- #
# Linear algebra
# --------------------------------------------------------------------------- #
class _Linalg:
    @staticmethod
    def norm(x: Any) -> float:
        arr = asarray(x)
        return math.sqrt(builtins_sum(v * v for v in arr.flatten()))


linalg = _Linalg()


def dot(a: Any, b: Any) -> float:
    a_arr, b_arr = asarray(a), asarray(b)
    if a_arr.ndim != 1 or b_arr.ndim != 1:
        raise NotImplementedError("dot only supports 1D vectors in this shim.")
    if a_arr.size != b_arr.size:
        raise ValueError("shapes not aligned")
    return float(builtins_sum(x * y for x, y in zip(a_arr.flatten(), b_arr.flatten())))


# --------------------------------------------------------------------------- #
# Random numbers
# --------------------------------------------------------------------------- #
class _Generator:
    def __init__(self, seed: int | None = None):
        self._rng = _random.Random(seed)

    def _generate(self, size: Any, fn: Callable[[], float], dtype: Any = float) -> ndarray | float:
        def _convert(val: Any) -> Any:
            try:
                return dtype(val) if callable(dtype) else val
            except Exception:
                return val

        if size is None:
            return _convert(fn())
        if isinstance(size, tuple):
            if len(size) == 0:
                return _convert(fn())
            return ndarray([self._generate(size[1:], fn, dtype=dtype) for _ in range(int(size[0]))], dtype=dtype)
        return ndarray([self._generate(None, fn, dtype=dtype) for _ in range(int(size))], dtype=dtype)

    def normal(self, loc: float = 0.0, scale: float = 1.0, size: Any = None) -> ndarray | float:
        return self._generate(size, lambda: self._rng.gauss(loc, scale))

    def standard_normal(self, size: Any = None) -> ndarray | float:
        return self.normal(0.0, 1.0, size=size)

    def uniform(self, low: float = 0.0, high: float = 1.0, size: Any = None) -> ndarray | float:
        return self._generate(size, lambda: self._rng.uniform(low, high))

    def integers(self, low: int, high: int | None = None, size: Any = None) -> ndarray | int:
        if high is None:
            low, high = 0, low
        return self._generate(size, lambda: self._rng.randrange(low, high), dtype=int)

    def choice(self, seq: Sequence[Any]) -> Any:
        return self._rng.choice(seq)


class _RandomNS:
    def default_rng(self, seed: int | None = None) -> _Generator:
        return _Generator(seed)


random = _RandomNS()


# --------------------------------------------------------------------------- #
# Misc constants/utilities
# --------------------------------------------------------------------------- #
pi = math.pi
bool_ = bool
floating = float
integer = int
bool8 = bool
float64 = float

__all__ = [
    "array",
    "asarray",
    "zeros",
    "ones",
    "full",
    "zeros_like",
    "arange",
    "linspace",
    "concatenate",
    "stack",
    "insert",
    "sqrt",
    "exp",
    "log",
    "sin",
    "cos",
    "arcsin",
    "arctan2",
    "deg2rad",
    "abs",
    "maximum",
    "minimum",
    "clip",
    "sum",
    "mean",
    "std",
    "min",
    "max",
    "argmin",
    "argmax",
    "argsort",
    "quantile",
    "cumsum",
    "all",
    "any",
    "allclose",
    "isclose",
    "isfinite",
    "isinf",
    "where",
    "logical_or",
    "dot",
    "linalg",
    "random",
    "pi",
    "ndarray",
    "bool_",
    "floating",
    "integer",
    "bool8",
    "float64",
]
