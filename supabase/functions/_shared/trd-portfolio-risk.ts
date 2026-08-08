// trd-portfolio-risk — the differentiator: PORTFOLIO-level, CORRELATION-aware, FAT-TAILED risk of ruin.
//
// The #1 way retail dies is not a bad signal — it's hidden correlation + oversizing. Five "different"
// longs that are 0.9-correlated are ONE bet at 5× size; a Gaussian VaR tool tells you you're fine right
// up until the joint tail eats the account. This engine works on a trader's REAL positions (any broker,
// just a positions list) and answers the only question that keeps them alive: given how these positions
// ACTUALLY co-move, what's the chance the account takes a ruinous drawdown before compounding can work?
//
// Method (honest): use REAL historical joint returns (fat tails + 2008/2020 baked in). BLOCK-bootstrap
// forward paths so volatility-clustering survives (a single-day iid bootstrap would erase the very tail
// dependence that ruins accounts). Report P(ruin), the drawdown distribution, the correlation matrix,
// and the EFFECTIVE number of independent bets (diversification ratio) — the trader's real bet count.
// Pure + deterministic (seeded RNG) so it is testable and reproducible.

export interface Position { symbol: string; side: 1 | -1; weight: number; } // weight = notional ÷ equity (leverage-aware; 0.5 = half the account)

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length); if (n < 3) return 0;
  const ma = mean(a.slice(-n)), mb = mean(b.slice(-n)); let cov = 0, va = 0, vb = 0;
  for (let i = a.length - n, j = b.length - n; i < a.length; i++, j++) { const da = a[i] - ma, db = b[j] - mb; cov += da * db; va += da * da; vb += db * db; }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** rows = aligned days, cols = positions (already trimmed to common length). */
export function corrMatrix(cols: number[][]): number[][] {
  const N = cols.length; const M: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) { const c = i === j ? 1 : correlation(cols[i], cols[j]); M[i][j] = M[j][i] = +c.toFixed(4); }
  return M;
}

/** per-day signed, weighted portfolio return series from aligned per-position return columns. */
export function portfolioReturns(cols: number[][], pos: Position[]): number[] {
  const T = Math.min(...cols.map((c) => c.length)); const out = new Array(T).fill(0);
  for (let p = 0; p < pos.length; p++) { const c = cols[p], off = c.length - T; for (let t = 0; t < T; t++) out[t] += pos[p].weight * pos[p].side * c[off + t]; }
  return out;
}

/** Effective number of independent bets = the diversification ratio SQUARED = ((Σ|wᵢ|σᵢ)÷σ_p)².
 * 1 ≈ one concentrated bet (fully correlated); ≈N ≈ N truly independent bets. This is the trader's
 * REAL bet count — five 0.9-correlated longs read as ~1, not 5. */
export function effectiveBets(cols: number[][], pos: Position[]): number {
  const T = Math.min(...cols.map((c) => c.length));
  const sumWSig = pos.reduce((s, p, i) => s + Math.abs(p.weight) * std(cols[i].slice(-T)), 0);
  const sp = std(portfolioReturns(cols, pos));
  return sp > 0 ? +((sumWSig / sp) ** 2).toFixed(2) : pos.length;
}

export interface RuinResult {
  pRuin: number;              // P(max drawdown ≥ ruinThreshold) over the horizon
  medianReturn: number;       // median horizon return
  p05: number; p95: number;   // 5th / 95th percentile horizon return
  medianMaxDD: number;        // median of the worst drawdown seen along the path
  annVol: number;             // annualized portfolio vol (from history)
  effectiveBets: number;
  grossExposure: number;      // Σ|weight| (leverage)
}

/**
 * Block-bootstrap Monte-Carlo ruin.
 * @param cols aligned per-position daily-return columns (real history).
 * @param pos positions (side + weight).
 * @param opts horizonDays, nSims, blockLen, ruinThreshold (fractional DD, e.g. 0.5), annPeriods, seed.
 */
export function bootstrapRuin(cols: number[][], pos: Position[], opts: Partial<{ horizonDays: number; nSims: number; blockLen: number; ruinThreshold: number; annPeriods: number; seed: number }> = {}): RuinResult {
  const horizon = opts.horizonDays ?? 252, nSims = opts.nSims ?? 4000, L = opts.blockLen ?? 10, thr = opts.ruinThreshold ?? 0.5, ann = opts.annPeriods ?? 252;
  const port = portfolioReturns(cols, pos); const T = port.length;
  let seed = (opts.seed ?? 12345) >>> 0; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const finals: number[] = [], maxDDs: number[] = []; let ruined = 0;
  if (T < L + 2) return { pRuin: 0, medianReturn: 0, p05: 0, p95: 0, medianMaxDD: 0, annVol: 0, effectiveBets: pos.length, grossExposure: pos.reduce((s, p) => s + Math.abs(p.weight), 0) };
  for (let s = 0; s < nSims; s++) {
    let eq = 1, peak = 1, maxDD = 0;
    for (let built = 0; built < horizon; built += L) {
      const start = Math.floor(rnd() * (T - L));
      for (let k = 0; k < L && built + k < horizon; k++) { eq *= (1 + port[start + k]); if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }
    }
    finals.push(eq - 1); maxDDs.push(maxDD); if (maxDD >= thr) ruined++;
  }
  finals.sort((a, b) => a - b); maxDDs.sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return {
    pRuin: +(ruined / nSims).toFixed(4),
    medianReturn: +q(finals, 0.5).toFixed(4), p05: +q(finals, 0.05).toFixed(4), p95: +q(finals, 0.95).toFixed(4),
    medianMaxDD: +q(maxDDs, 0.5).toFixed(4),
    annVol: +(std(port) * Math.sqrt(ann)).toFixed(4),
    effectiveBets: effectiveBets(cols, pos),
    grossExposure: +pos.reduce((s, p) => s + Math.abs(p.weight), 0).toFixed(2),
  };
}
