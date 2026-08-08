"""aegis_gate.py — the Aegis falsification GATE, ported byte-faithfully from the TypeScript core
(supabase/functions/_shared/trd-stats.ts + trd-random-control.ts) so it can run inside a QuantConnect/LEAN
algorithm over the survivorship-free universe. This is the project's IP: the random-control test (D-146),
the Deflated Sharpe + MinTRL (Bailey/López de Prado), and PBO via CSCV. A backtester that never kills a
strategy is lying; this module makes a wrong strategy fail loudly.

Parity is enforced by test_aegis_gate.py against the TS original on shared fixtures — a port that is not
provably equal to the source is a rewrite, not a port.

Pure stdlib (math only) so it drops into LEAN's Python runtime with no dependencies.
"""
import math
from typing import Sequence

EULER_GAMMA = 0.5772156649015328606

# ---------- normal distribution primitives (match TS exactly) ----------

def erf(x: float) -> float:
    """Abramowitz & Stegun 7.1.26 — abs error < 1.5e-7 (same coefficients as TS)."""
    s = -1.0 if x < 0 else 1.0
    x = abs(x)
    p = 0.3275911
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * math.exp(-x * x)
    return s * y


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / math.sqrt(2.0)))


def inv_norm(p: float) -> float:
    """Acklam's inverse normal CDF (probit), same coefficients/branches as TS."""
    if p <= 0 or p >= 1:
        return -math.inf if p <= 0 else math.inf
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
               ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    elif p <= phigh:
        q = p - 0.5
        r = q * q
        return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / \
               (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    else:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / \
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)

# ---------- moments ----------

def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else math.nan


def sample_std(xs: Sequence[float]) -> float:
    n = len(xs)
    if n < 2:
        return math.nan
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def pop_std(xs: Sequence[float]) -> float:
    n = len(xs)
    if n < 1:
        return math.nan
    m = mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / n)


def skewness(xs: Sequence[float]) -> float:
    n = len(xs)
    if n < 3:
        return 0.0
    m = mean(xs)
    sd = pop_std(xs)
    if sd == 0:
        return 0.0
    return sum(((x - m) / sd) ** 3 for x in xs) / n


def kurtosis(xs: Sequence[float]) -> float:
    """Population kurtosis, NORMAL = 3.0 (not excess)."""
    n = len(xs)
    if n < 4:
        return 3.0
    m = mean(xs)
    sd = pop_std(xs)
    if sd == 0:
        return 3.0
    return sum(((x - m) / sd) ** 4 for x in xs) / n

# ---------- performance metrics ----------

def sharpe(returns: Sequence[float], rf: float = 0.0) -> float:
    sd = sample_std(returns)
    if not math.isfinite(sd) or sd == 0:
        return 0.0
    return (mean(returns) - rf) / sd


def annualized_sharpe(returns: Sequence[float], periods_per_year: float, rf: float = 0.0) -> float:
    return sharpe(returns, rf) * math.sqrt(periods_per_year)


def sortino(returns: Sequence[float], target: float = 0.0) -> float:
    m = mean(returns)
    s = 0.0
    k = 0
    for r in returns:
        if r < target:
            s += (r - target) ** 2
            k += 1
    if k == 0:
        return math.inf
    dd = math.sqrt(s / len(returns))
    return math.inf if dd == 0 else (m - target) / dd


def max_drawdown(returns: Sequence[float]) -> float:
    equity = peak = 1.0
    mdd = 0.0
    for r in returns:
        equity *= (1 + r)
        if equity > peak:
            peak = equity
        dd = (peak - equity) / peak
        if dd > mdd:
            mdd = dd
    return mdd


def calmar(returns: Sequence[float], periods_per_year: float) -> float:
    total = 1.0
    for r in returns:
        total *= (1 + r)
    years = len(returns) / periods_per_year
    if years <= 0:
        return 0.0
    ann = total ** (1 / years) - 1
    dd = max_drawdown(returns)
    if dd == 0:
        return math.inf if ann >= 0 else -math.inf
    return ann / dd

# ---------- PSR / DSR / MinTRL ----------

def probabilistic_sharpe(sr: float, sr_benchmark: float, n: int, skew: float, kurt: float) -> float:
    if n < 2:
        return math.nan
    denom = math.sqrt(1 - skew * sr + ((kurt - 1) / 4) * sr * sr)
    if not math.isfinite(denom) or denom <= 0:
        return math.nan
    return normal_cdf(((sr - sr_benchmark) * math.sqrt(n - 1)) / denom)


def expected_max_sharpe(n_trials: int, var_trial_sharpes: float) -> float:
    N = max(2, int(math.floor(n_trials)))
    sd = math.sqrt(max(0.0, var_trial_sharpes))
    return sd * ((1 - EULER_GAMMA) * inv_norm(1 - 1 / N) + EULER_GAMMA * inv_norm(1 - 1 / (N * math.e)))


def deflated_sharpe(sr: float, n: int, skew: float, kurt: float, n_trials: int, var_trial_sharpes: float) -> float:
    sr_star = expected_max_sharpe(n_trials, var_trial_sharpes)
    return probabilistic_sharpe(sr, sr_star, n, skew, kurt)


def min_trl(sr: float, sr_benchmark: float, skew: float, kurt: float, confidence: float = 0.95) -> float:
    if sr <= sr_benchmark:
        return math.inf
    z = inv_norm(confidence)
    variance = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr
    return 1 + variance * (z / (sr - sr_benchmark)) ** 2

# ---------- PBO via CSCV ----------

def _combinations(n: int, k: int):
    out = []
    if k > n or k < 0:
        return out
    idx = list(range(k))
    while True:
        out.append(idx[:])
        i = k - 1
        while i >= 0 and idx[i] == i + n - k:
            i -= 1
        if i < 0:
            break
        idx[i] += 1
        for j in range(i + 1, k):
            idx[j] = idx[j - 1] + 1
    return out


def _perf_of(M, rows, strat):
    return sharpe([M[r][strat] for r in rows])


def pbo_cscv(M, s_blocks: int = 8):
    """Probability of Backtest Overfitting via Combinatorially-Symmetric CV.
    M: rows = observations (T), cols = strategies (N). PBO >= 0.5 = selection no better than chance."""
    T = len(M)
    if T == 0:
        return {"pbo": math.nan, "nCombos": 0}
    N = len(M[0])
    if s_blocks % 2 != 0:
        s_blocks -= 1
    if s_blocks < 2 or s_blocks > T:
        return {"pbo": math.nan, "nCombos": 0}
    blocks = []
    base = T // s_blocks
    extra = T % s_blocks
    start = 0
    for _ in range(s_blocks):
        length = base + (1 if extra > 0 else 0)
        if extra > 0:
            extra -= 1
        blocks.append(list(range(start, start + length)))
        start += length
    combos = _combinations(s_blocks, s_blocks // 2)
    overfit = 0
    for is_blocks in combos:
        is_set = set(is_blocks)
        is_rows, oos_rows = [], []
        for b in range(s_blocks):
            (is_rows if b in is_set else oos_rows).extend(blocks[b])
        best, best_perf = 0, -math.inf
        for s in range(N):
            p = _perf_of(M, is_rows, s)
            if p > best_perf:
                best_perf, best = p, s
        oos_perf = [_perf_of(M, oos_rows, s) for s in range(N)]
        best_oos = oos_perf[best]
        rank = 1
        for s in range(N):
            if s != best and oos_perf[s] < best_oos:
                rank += 1
        omega = rank / (N + 1)
        lam = math.log(omega / (1 - omega))
        if lam < 0:
            overfit += 1
    return {"pbo": overfit / len(combos), "nCombos": len(combos)}

# ---------- the D-146 random-control gate ----------

def _variance(a: Sequence[float]) -> float:
    if len(a) < 2:
        return math.nan
    m = mean(a)
    return sum((x - m) ** 2 for x in a) / (len(a) - 1)


def edge_vs_random(setup: Sequence[float], control: Sequence[float], min_t: float = 2.0, min_n: int = 30) -> dict:
    """Welch t-test of setup vs matched random control. Fails closed on thin samples. Mirrors TS edgeVsRandom."""
    if len(setup) < min_n or len(control) < min_n:
        return {"setupMean": mean(setup), "controlMean": mean(control), "edge": math.nan, "tStat": math.nan,
                "passes": False,
                "verdict": f"insufficient sample (setup {len(setup)}, control {len(control)}; need >={min_n}) — fails closed"}
    sm, cm = mean(setup), mean(control)
    se = math.sqrt(_variance(setup) / len(setup) + _variance(control) / len(control))
    edge = sm - cm
    t = edge / se if se > 0 else 0.0
    passes = t >= min_t
    return {"setupMean": round(sm, 4), "controlMean": round(cm, 4), "edge": round(edge, 4),
            "tStat": round(t, 2), "passes": passes,
            "verdict": (f"SETUP ADDS VALUE over random entry in the same regime (t={t:.2f})" if passes
                        else f"NO EDGE over random entry (t={t:.2f}) — the expectancy is REGIME DRIFT, not a setup (D-146)")}
