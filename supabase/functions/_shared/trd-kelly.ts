// trd-kelly — fractional-Kelly position sizing tied to the strategy's OWN measured forward edge.
//
// Synthesised from the eight-pillar "free finance" essay (D-101), pillar 2 (Kelly 1956 / Thorp):
// "You can pick the right trade and still go broke by sizing it wrong." Kelly gives the growth-optimal
// fraction f* = p − (1−p)/b (p = win rate, b = avg-win ÷ avg-loss payoff ratio). Two hard rules the
// essay stresses, both enforced here:
//   1. FRACTIONAL Kelly (quarter here) — "the formula assumes you know your edge exactly and you do
//      not. Overestimate your edge and full Kelly turns into overbetting without you noticing."
//   2. NEVER above the base risk budget — this composes with trd-vol-regime as a pure risk-REDUCER;
//      measured edge can only shrink size from the cap, never lever past it (Buffett: never lose money;
//      Mandelbrot: your real risk of ruin is larger than your model says → bias down, not up).
//
// Honest defaults for a YOUNG forward test: with too few closed trades we do NOT trust an edge estimate
// (small-sample Kelly overbets wildly), so we size at half the base budget until enough trades resolve.
// A measured NON-edge (f*≤0) drops to a tiny probe size so the forward test keeps accruing data without
// betting into a losing distribution. Pure function; reads only realised R multiples.

export const DEFAULT_FRACTION = 0.25;   // quarter-Kelly (the essay's "half or less", biased lower for thin edges)
export const MIN_SAMPLE = 20;           // below this, edge estimate is untrustworthy → conservative default
export const UNCERTAIN_MULT = 0.5;      // insufficient sample → half the base budget
export const PROBE_MULT = 0.1;          // measured non-edge → tiny probe size (keep the forward test alive)

export interface KellySize {
  n: number;              // closed-trade sample
  winRate: number;        // p
  payoff: number;         // b = avg win ÷ avg loss (in R)
  fStar: number;          // full-Kelly optimal risk fraction (of equity)
  fraction: number;       // the fractional-Kelly multiple actually used
  riskFraction: number;   // final risk-per-trade fraction, ALWAYS in [baseRisk*PROBE_MULT, baseRisk]
  reason: string;
}

/**
 * @param closedR realised R-multiples of resolved trades for this strategy (e.g. -1, +3, -1, +0.4…).
 * @param baseRisk the base risk-per-trade budget (fraction of equity), e.g. 0.01. The output is capped
 *   at this — Kelly here can only reduce from the cap, never exceed it.
 * @param fraction fractional-Kelly multiple (default quarter-Kelly).
 */
export function kellySize(closedR: number[], baseRisk = 0.01, fraction = DEFAULT_FRACTION): KellySize {
  const r = closedR.filter((x) => Number.isFinite(x));
  const n = r.length;
  const cap = baseRisk, floor = baseRisk * PROBE_MULT;
  if (n < MIN_SAMPLE) {
    return { n, winRate: NaN, payoff: NaN, fStar: NaN, fraction, riskFraction: baseRisk * UNCERTAIN_MULT, reason: `sample ${n}<${MIN_SAMPLE} — edge unknown, sizing at ${(UNCERTAIN_MULT * 100).toFixed(0)}% of base` };
  }
  const wins = r.filter((x) => x > 0), losses = r.filter((x) => x < 0);
  const p = wins.length / n;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  // degenerate: no losses observed yet (can't form a payoff ratio) → treat as unknown, conservative
  if (!(avgLoss > 0) || !(avgWin > 0)) {
    return { n, winRate: p, payoff: NaN, fStar: NaN, fraction, riskFraction: baseRisk * UNCERTAIN_MULT, reason: `no two-sided sample yet — sizing at ${(UNCERTAIN_MULT * 100).toFixed(0)}% of base` };
  }
  const b = avgWin / avgLoss;
  const fStar = p - (1 - p) / b;            // full-Kelly optimal fraction
  if (fStar <= 0) {
    return { n, winRate: p, payoff: b, fStar, fraction, riskFraction: floor, reason: `measured NON-edge (f*=${fStar.toFixed(3)}) — probe size only ${(PROBE_MULT * 100).toFixed(0)}% of base, keep measuring` };
  }
  const raw = fraction * fStar;
  const riskFraction = Math.max(floor, Math.min(cap, raw));
  return {
    n, winRate: p, payoff: b, fStar, fraction, riskFraction,
    reason: `${(fraction * 100).toFixed(0)}%-Kelly on measured edge (p=${(p * 100).toFixed(0)}%, b=${b.toFixed(2)}, f*=${(fStar * 100).toFixed(1)}%) → risk ${(riskFraction * 100).toFixed(2)}%${raw > cap ? " (capped at base)" : ""}`,
  };
}
