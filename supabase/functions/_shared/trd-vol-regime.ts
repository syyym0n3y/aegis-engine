// trd-vol-regime — the ONE empirically-verified risk control, as a pure, testable primitive.
//
// D-100 established on 121,962 real market-days across 15 tradeable assets (1970→2026) that a >3σ
// "tail" day is ~5.9× more likely when trailing-20d realised vol sits above its own trailing-252d
// median (a regime knowable IN ADVANCE); 84.5% of all tail days occur in that elevated regime. The
// SIGN of the move is not predictable — but the REGIME is. So the honest control is not a forecast;
// it is to shrink exposure in proportion to how elevated current vol is versus its own 1-year norm.
//
// This is vol-targeting capped as a strict RISK-REDUCER: size is scaled by min(1, medianRV/RV). At
// normal vol the factor is 1 (no-op); at 2× the 1y-median vol it halves size; floored so it never
// zeroes out and never EXCEEDS base size (it can only de-risk, matching the macro overlay's contract).
// Fully causal: it reads only trailing daily returns. Insufficient history → 1.0 (benign no-op).

export const VOL_REGIME_FLOOR = 0.3;   // never cut below 30% of base size
export const RV_WINDOW = 20;           // trailing realised-vol window (days)
export const RV_MEDIAN_WINDOW = 252;   // ~1 trading year, the "norm" we compare against
export const MIN_HISTORY = RV_WINDOW + 120; // need enough daily returns to form a stable median

function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function median(a: number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y); const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

export interface VolRegime {
  rv: number;          // current trailing realised vol (daily, stdev of last RV_WINDOW returns)
  medianRV: number;    // trailing median of RV over the last RV_MEDIAN_WINDOW days
  elevated: boolean;   // rv > medianRV
  deRisk: number;      // position-size multiplier in [FLOOR, 1]; ==1 when calm or history insufficient
  reason: string;
}

/**
 * @param dailyReturns chronologically ordered daily (log or simple) returns of the traded instrument,
 *   most recent LAST. Only trailing values are read → causal.
 */
export function volRegimeDeRisk(dailyReturns: number[]): VolRegime {
  const n = dailyReturns.length;
  if (n < MIN_HISTORY) return { rv: NaN, medianRV: NaN, elevated: false, deRisk: 1, reason: `insufficient history (${n}<${MIN_HISTORY}) — no-op` };
  const rv = std(dailyReturns.slice(n - RV_WINDOW));
  // trailing series of RV over the median window (each point uses only its own trailing 20d → causal)
  const rvSeries: number[] = [];
  const start = Math.max(RV_WINDOW, n - RV_MEDIAN_WINDOW);
  for (let i = start; i < n; i++) rvSeries.push(std(dailyReturns.slice(i - RV_WINDOW, i)));
  const medRV = median(rvSeries);
  if (!(medRV > 0) || !(rv >= 0)) return { rv, medianRV: medRV, elevated: false, deRisk: 1, reason: "degenerate vol — no-op" };
  const elevated = rv > medRV;
  // vol-target capped at base size, floored. Only ever ≤ 1.
  const deRisk = Math.max(VOL_REGIME_FLOOR, Math.min(1, medRV / rv));
  return {
    rv, medianRV: medRV, elevated, deRisk,
    reason: elevated
      ? `elevated vol (RV ${(rv * 100).toFixed(2)}% > 1y-median ${(medRV * 100).toFixed(2)}%) → size ×${deRisk.toFixed(2)}`
      : `calm vol (RV ${(rv * 100).toFixed(2)}% ≤ 1y-median ${(medRV * 100).toFixed(2)}%) → size ×1.00`,
  };
}
