from __future__ import annotations

from dataclasses import dataclass
import numpy as np


class DiagCMAESError(RuntimeError):
    pass


def _finite_vec(x: np.ndarray, name: str) -> np.ndarray:
    v = np.asarray(x, dtype=float).reshape(-1)
    if v.size == 0:
        raise DiagCMAESError(f"{name} must be non-empty.")
    if not np.all(np.isfinite(v)):
        raise DiagCMAESError(f"{name} contains non-finite values.")
    return v


@dataclass(frozen=True)
class DiagCMAESConfig:
    n: int
    popsize: int | None = None
    seed: int = 0
    sigma0: float = 0.5

    def validate(self) -> None:
        n = int(self.n)
        if n <= 0:
            raise DiagCMAESError("n must be > 0.")
        if self.popsize is not None and int(self.popsize) <= 1:
            raise DiagCMAESError("popsize must be > 1.")
        s = int(self.seed)
        if s < 0:
            raise DiagCMAESError("seed must be >= 0.")
        sig = float(self.sigma0)
        if not np.isfinite(sig) or sig <= 0:
            raise DiagCMAESError("sigma0 must be finite and > 0.")


@dataclass
class DiagCMAESState:
    m: np.ndarray
    sigma: float
    diagC: np.ndarray
    pc: np.ndarray
    ps: np.ndarray
    gen: int = 0


class DiagCMAES:
    def __init__(self, *, cfg: DiagCMAESConfig, m0: np.ndarray):
        cfg.validate()
        m0 = _finite_vec(m0, "m0")
        if m0.shape[0] != int(cfg.n):
            raise DiagCMAESError("m0 dimension mismatch.")
        self.cfg = cfg

        n = int(cfg.n)
        lam = int(cfg.popsize) if cfg.popsize is not None else int(4 + np.floor(3 * np.log(n)))
        self.lam = max(2, lam)
        self.mu = self.lam // 2

        weights = np.log(self.mu + 0.5) - np.log(np.arange(1, self.mu + 1))
        weights = weights / np.sum(weights)
        self.weights = weights
        self.mueff = float(1.0 / np.sum(weights**2))

        self.cc = (4 + self.mueff / n) / (n + 4 + 2 * self.mueff / n)
        self.cs = (self.mueff + 2) / (n + self.mueff + 5)
        self.c1 = 2.0 / ((n + 1.3) ** 2 + self.mueff)
        self.cmu = min(
            1.0 - self.c1,
            2.0 * (self.mueff - 2 + 1 / self.mueff) / ((n + 2) ** 2 + self.mueff),
        )
        self.damps = 1 + 2 * max(0.0, np.sqrt((self.mueff - 1) / (n + 1)) - 1) + self.cs

        self.rng = np.random.default_rng(int(cfg.seed))

        self.state = DiagCMAESState(
            m=m0.copy(),
            sigma=float(cfg.sigma0),
            diagC=np.ones((n,), dtype=float),
            pc=np.zeros((n,), dtype=float),
            ps=np.zeros((n,), dtype=float),
            gen=0,
        )

    def ask(self) -> np.ndarray:
        st = self.state
        n = st.m.shape[0]
        z = self.rng.standard_normal(size=(self.lam, n))
        y = st.m[None, :] + float(st.sigma) * (np.sqrt(st.diagC)[None, :] * z)
        return y

    def tell(self, Y: np.ndarray, losses: np.ndarray) -> dict[str, float]:
        st = self.state
        Y = np.asarray(Y, dtype=float)
        losses = _finite_vec(losses, "losses")
        if Y.ndim != 2 or Y.shape[0] != self.lam or Y.shape[1] != st.m.shape[0]:
            raise DiagCMAESError("Y shape must be (lambda, n).")
        if losses.shape[0] != self.lam:
            raise DiagCMAESError("losses length must equal lambda.")

        idx = np.argsort(losses)
        Ysel = Y[idx[: self.mu], :]
        old_m = st.m.copy()

        st.m = np.sum(Ysel * self.weights[:, None], axis=0)

        denom = float(st.sigma) * np.sqrt(st.diagC)
        denom = np.where(denom > 1e-12, denom, 1e-12)
        Zsel = (Ysel - old_m[None, :]) / denom[None, :]

        c_inv_sqrt = 1.0 / np.sqrt(st.diagC)
        y_diff = (st.m - old_m) / (float(st.sigma) + 1e-12)
        st.ps = (1 - self.cs) * st.ps + np.sqrt(self.cs * (2 - self.cs) * self.mueff) * (c_inv_sqrt * y_diff)

        n = st.m.shape[0]
        norm_ps = float(np.linalg.norm(st.ps))
        chi_n = float(np.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n)))
        hsig = 1.0 if norm_ps / np.sqrt(1 - (1 - self.cs) ** (2 * (st.gen + 1))) < (1.4 + 2 / (n + 1)) * chi_n else 0.0

        st.pc = (1 - self.cc) * st.pc + hsig * np.sqrt(self.cc * (2 - self.cc) * self.mueff) * y_diff

        rank_one = st.pc**2
        rank_mu = np.sum(self.weights[:, None] * (Zsel**2), axis=0)

        st.diagC = (1 - self.c1 - self.cmu) * st.diagC + self.c1 * rank_one + self.cmu * st.diagC * rank_mu
        st.diagC = np.maximum(st.diagC, 1e-16)

        st.sigma = float(st.sigma * np.exp((self.cs / self.damps) * (norm_ps / chi_n - 1)))

        st.gen += 1

        return {
            "gen": float(st.gen),
            "best_loss": float(losses[idx[0]]),
            "sigma": float(st.sigma),
            "norm_ps": float(norm_ps),
            "hsig": float(hsig),
        }
