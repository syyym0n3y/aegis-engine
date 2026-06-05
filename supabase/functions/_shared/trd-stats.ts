// trd-stats.ts — the honest statistics core of the falsification engine.
//
// DOCTRINE: a backtester that never kills a strategy is lying. These functions
// exist to make a wrong strategy fail loudly. Every Sharpe must be reported
// next to N (the number of trials), because a Sharpe without its trial count is
// the single most common backtest lie.
//
// References:
//  - Bailey & López de Prado (2012), "The Sharpe Ratio Efficient Frontier" (PSR)
//  - Bailey & López de Prado (2014), "The Deflated Sharpe Ratio" (DSR, MinTRL)
//  - Bailey, Borwein, López de Prado, Zhu (2017), "The Probability of Backtest
//    Overfitting" (PBO via CSCV)
//
// All inputs that feed PSR/DSR/MinTRL use the PER-OBSERVATION Sharpe (NOT
// annualized). Annualize only for human display, never for the gates.

const EULER_GAMMA = 0.5772156649015328606;

// ---------- normal distribution primitives (offline, no deps) ----------

/** Abramowitz & Stegun 7.1.26 — abs error < 1.5e-7. */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const p = 0.3275911;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
    a4 = -1.453152027, a5 = 1.061405429;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}

export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Acklam's inverse normal CDF (probit) — abs error < 1.2e-9 in the body. */
export function invNorm(p: number): number {
  if (p <= 0 || p >= 1) {
    if (p <= 0) return -Infinity;
    return Infinity;
  }
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q: number, r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ---------- moments ----------

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (ddof=1). */
export function sampleStd(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}

/** Population standard deviation (ddof=0), used to standardize skew/kurtosis. */
export function popStd(xs: number[]): number {
  const n = xs.length;
  if (n < 1) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / n);
}

/** Standardized skewness (Fisher–Pearson, population). */
export function skewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const m = mean(xs);
  const sd = popStd(xs);
  if (sd === 0) return 0;
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 3;
  return s / n;
}

/** Kurtosis (population, NORMAL = 3.0, i.e. not excess). */
export function kurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 3;
  const m = mean(xs);
  const sd = popStd(xs);
  if (sd === 0) return 3;
  let s = 0;
  for (const x of xs) s += ((x - m) / sd) ** 4;
  return s / n;
}

// ---------- performance metrics ----------

/** Per-observation Sharpe = mean / sampleStd. NOT annualized. */
export function sharpe(returns: number[], riskFreePerPeriod = 0): number {
  const sd = sampleStd(returns);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return (mean(returns) - riskFreePerPeriod) / sd;
}

export function annualizedSharpe(returns: number[], periodsPerYear: number, riskFreePerPeriod = 0): number {
  return sharpe(returns, riskFreePerPeriod) * Math.sqrt(periodsPerYear);
}

/** Sortino = mean / downside-deviation (population, target=0). */
export function sortino(returns: number[], target = 0): number {
  const m = mean(returns);
  let s = 0, k = 0;
  for (const r of returns) {
    if (r < target) { s += (r - target) * (r - target); k++; }
  }
  if (k === 0) return Infinity; // no downside observed
  const dd = Math.sqrt(s / returns.length);
  if (dd === 0) return Infinity;
  return (m - target) / dd;
}

/** Max drawdown of an equity curve built by compounding `returns` from 1.0.
 * Returns a POSITIVE fraction (0.2 = a 20% peak-to-trough drop). */
export function maxDrawdown(returns: number[]): number {
  let equity = 1, peak = 1, maxDD = 0;
  for (const r of returns) {
    equity *= (1 + r);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

/** Calmar = annualized return / |max drawdown|. */
export function calmar(returns: number[], periodsPerYear: number): number {
  const total = returns.reduce((acc, r) => acc * (1 + r), 1);
  const years = returns.length / periodsPerYear;
  if (years <= 0) return 0;
  const annReturn = Math.pow(total, 1 / years) - 1;
  const dd = maxDrawdown(returns);
  if (dd === 0) return annReturn >= 0 ? Infinity : -Infinity;
  return annReturn / dd;
}

// ---------- PSR / DSR / MinTRL ----------

/** Probabilistic Sharpe Ratio: P(true SR > benchmark SR | observed sr).
 * sr, srBenchmark are PER-OBSERVATION. kurt is non-excess (normal=3). */
export function probabilisticSharpe(
  sr: number, srBenchmark: number, n: number, skew: number, kurt: number,
): number {
  if (n < 2) return NaN;
  const denom = Math.sqrt(1 - skew * sr + ((kurt - 1) / 4) * sr * sr);
  if (!Number.isFinite(denom) || denom <= 0) return NaN;
  return normalCdf(((sr - srBenchmark) * Math.sqrt(n - 1)) / denom);
}

/** Expected maximum Sharpe under the null across `nTrials` independent
 * strategies whose Sharpe estimates have variance `varTrialSharpes`.
 * This is the deflation benchmark — testing many strategies inflates the best
 * one's Sharpe purely by chance, and DSR subtracts exactly that. */
export function expectedMaxSharpe(nTrials: number, varTrialSharpes: number): number {
  const N = Math.max(2, Math.floor(nTrials));
  const sd = Math.sqrt(Math.max(0, varTrialSharpes));
  return sd * ((1 - EULER_GAMMA) * invNorm(1 - 1 / N) + EULER_GAMMA * invNorm(1 - 1 / (N * Math.E)));
}

/** Deflated Sharpe Ratio = PSR with the benchmark set to the expected-max
 * Sharpe across all trials. DSR > 0.95 is a sane "kept" threshold, but it is
 * UNDER-POWERED at small n — pair it with a satisfied MinTRL. */
export function deflatedSharpe(
  sr: number, n: number, skew: number, kurt: number,
  nTrials: number, varTrialSharpes: number,
): number {
  const srStar = expectedMaxSharpe(nTrials, varTrialSharpes);
  return probabilisticSharpe(sr, srStar, n, skew, kurt);
}

/** Minimum Track Record Length: the # of observations needed for the observed
 * Sharpe to be > benchmark at `confidence`. If sr <= srBenchmark, no finite
 * track record suffices → Infinity (the honest answer). */
export function minTRL(
  sr: number, srBenchmark: number, skew: number, kurt: number, confidence = 0.95,
): number {
  if (sr <= srBenchmark) return Infinity;
  const z = invNorm(confidence);
  const variance = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr;
  return 1 + variance * (z / (sr - srBenchmark)) ** 2;
}

// ---------- PBO via CSCV ----------

function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > n || k < 0) return out;
  while (true) {
    out.push(idx.slice());
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}

function perfOf(M: number[][], rows: number[], strat: number): number {
  const xs = rows.map((r) => M[r][strat]);
  return sharpe(xs);
}

/** Probability of Backtest Overfitting via Combinatorially-Symmetric CV.
 * M: rows = observations (T), cols = strategies (N). The matrix is split into
 * `sBlocks` contiguous blocks; for every way to pick sBlocks/2 blocks as
 * in-sample, the IS-best strategy's OUT-OF-SAMPLE rank is logit-scored. PBO is
 * the fraction of splits where the IS-winner lands below the OOS median.
 * PBO >= 0.5 means the selection procedure is no better than chance — kill it. */
export function pboCSCV(M: number[][], sBlocks = 8): { pbo: number; nCombos: number } {
  const T = M.length;
  if (T === 0) return { pbo: NaN, nCombos: 0 };
  const N = M[0].length;
  if (sBlocks % 2 !== 0) sBlocks -= 1;
  if (sBlocks < 2 || sBlocks > T) return { pbo: NaN, nCombos: 0 };

  // contiguous block row-index sets
  const blocks: number[][] = [];
  const base = Math.floor(T / sBlocks);
  let extra = T % sBlocks, start = 0;
  for (let b = 0; b < sBlocks; b++) {
    const len = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    blocks.push(Array.from({ length: len }, (_, i) => start + i));
    start += len;
  }

  const combos = combinations(sBlocks, sBlocks / 2);
  let overfit = 0;
  for (const isBlocks of combos) {
    const isSet = new Set(isBlocks);
    const isRows: number[] = [], oosRows: number[] = [];
    for (let b = 0; b < sBlocks; b++) (isSet.has(b) ? isRows : oosRows).push(...blocks[b]);

    // IS-best strategy
    let best = 0, bestPerf = -Infinity;
    for (let s = 0; s < N; s++) {
      const p = perfOf(M, isRows, s);
      if (p > bestPerf) { bestPerf = p; best = s; }
    }
    // OOS rank of the IS-best (1 = worst .. N = best)
    const oosPerf = Array.from({ length: N }, (_, s) => perfOf(M, oosRows, s));
    const bestOos = oosPerf[best];
    let rank = 1;
    for (let s = 0; s < N; s++) if (s !== best && oosPerf[s] < bestOos) rank++;
    const omega = rank / (N + 1);
    const lambda = Math.log(omega / (1 - omega));
    if (lambda < 0) overfit++;
  }
  return { pbo: overfit / combos.length, nCombos: combos.length };
}
