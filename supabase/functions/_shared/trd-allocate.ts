// trd-allocate.ts — LAYER 3 (ALLOCATE): the disciplined global multi-factor book that
// HARVESTS the risk premia validated in D-077 (value/quality/momentum across US + intl
// + EM). Not a signal — a diversified, inverse-vol-weighted, vol-targeted combination
// of factor return streams. The "other side" of retail's momentum-chasing/panic-selling.
// PURE, offline. Feed it factor (or factor-ETF) return series; get weights + stats.

import { annualizedSharpe, maxDrawdown, mean, sampleStd } from "./trd-stats.ts";

export interface AllocInput {
  /** name -> aligned per-period return series (e.g. monthly factor or factor-ETF returns) */
  streams: Record<string, number[]>;
  periodsPerYear: number;
  targetAnnualVol?: number; // portfolio vol target (default 0.10)
  volLookback?: number; // periods for inverse-vol weighting (default 24)
  maxLeverage?: number; // cap on total gross leverage (default 1.5)
}

export interface AllocReport {
  /** final blended portfolio per-period returns (vol-targeted) */
  portfolio: number[];
  /** average inverse-vol weight per stream (diversification transparency) */
  weights: Record<string, number>;
  annualSharpe: number;
  annualReturnPct: number;
  maxDrawdownPct: number;
  correlationMatrix: Record<string, Record<string, number>>;
  plainEnglish: string;
}

function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < n; i++) { cov += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; }
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0;
}

/** Inverse-volatility (risk-parity-lite) weighting each period, blended, then scaled
 * so the realized portfolio vol tracks the target. Rebalance is implicit per period. */
export function buildFactorBook(inp: AllocInput): AllocReport {
  const names = Object.keys(inp.streams);
  const L = Math.min(...names.map((k) => inp.streams[k].length));
  const tgtP = (inp.targetAnnualVol ?? 0.10) / Math.sqrt(inp.periodsPerYear);
  const vlb = inp.volLookback ?? 24;
  const maxLev = inp.maxLeverage ?? 1.5;
  // align tails
  const S: Record<string, number[]> = {};
  for (const k of names) S[k] = inp.streams[k].slice(-L);

  const raw: number[] = [];
  const wAccum: Record<string, number> = {}; let wCount = 0;
  for (let t = 0; t < L; t++) {
    // inverse-vol weights from trailing window (available only up to t-1 → causal)
    const w: Record<string, number> = {}; let wsum = 0;
    for (const k of names) {
      if (t < vlb) { w[k] = 1; wsum += 1; continue; }
      const win = S[k].slice(t - vlb, t);
      const sd = sampleStd(win);
      const iv = sd > 0 ? 1 / sd : 0;
      w[k] = iv; wsum += iv;
    }
    if (wsum <= 0) { raw.push(0); continue; }
    let r = 0;
    for (const k of names) { const wn = w[k] / wsum; r += wn * S[k][t]; if (t >= vlb) { wAccum[k] = (wAccum[k] ?? 0) + wn; } }
    if (t >= vlb) wCount++;
    raw.push(r);
  }
  // vol-target the blended stream (using trailing realized vol, causal)
  const port: number[] = raw.map((v, t) => {
    if (t < vlb) return v;
    const sd = sampleStd(raw.slice(t - vlb, t));
    const lev = sd > 0 ? Math.min(maxLev, tgtP / sd) : 1;
    return lev * v;
  });

  const weights: Record<string, number> = {};
  for (const k of names) weights[k] = wCount ? (wAccum[k] ?? 0) / wCount : 1 / names.length;
  const cm: Record<string, Record<string, number>> = {};
  for (const a of names) { cm[a] = {}; for (const b of names) cm[a][b] = +corr(S[a], S[b]).toFixed(2); }

  const sh = annualizedSharpe(port, inp.periodsPerYear);
  const dd = maxDrawdown(port) * 100;
  const avgCorr = (() => { let s = 0, c = 0; for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { s += cm[names[i]][names[j]]; c++; } return c ? s / c : 0; })();
  const plainEnglish = `Blended ${names.length} return streams at ~${((inp.targetAnnualVol ?? 0.1) * 100).toFixed(0)}% vol target. Realized Sharpe ${sh.toFixed(2)}, max drawdown ${dd.toFixed(0)}%. Average pairwise correlation ${avgCorr.toFixed(2)} — ${avgCorr < 0.3 ? "genuinely diversified; the whole is steadier than any part" : "correlated; diversification benefit is limited"}. This harvests documented risk premia; expect multi-year droughts (patience is the price of the premium).`;

  return { portfolio: port, weights, annualSharpe: sh, annualReturnPct: mean(port) * inp.periodsPerYear * 100, maxDrawdownPct: dd, correlationMatrix: cm, plainEnglish };
}
