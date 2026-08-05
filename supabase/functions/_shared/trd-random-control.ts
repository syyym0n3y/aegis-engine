// trd-random-control.ts — the PERMANENT gate produced by the D-146 audit (pure, tested).
// Lesson paid for in full: four candidates with +0.08…+0.32R OOS expectancy, cost-gated, era-tested and
// pre-registered, ALL turned out to be regime DRIFT — because nobody had compared them to a random entry in
// the same regime. A conditional expectancy is meaningless on its own: in calm VIX a RANDOM long earns
// +0.15–0.25R. The only question that matters is whether the SETUP beats its matched random control.
//
// Use: collect setup returns and controls (same instrument, same regime, same direction, same stop/target
// mechanics), then require edgeVsRandom().passes before any promotion.

export interface RandomControlResult {
  setupMean: number; controlMean: number; edge: number; tStat: number;
  passes: boolean; verdict: string;
}

function mean(a: number[]): number { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN; }
function variance(a: number[]): number { if (a.length < 2) return NaN; const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1); }

/** Welch t-test of setup vs matched random control. `minT` default 2 (≈95%). Fails closed on thin samples. */
export function edgeVsRandom(setup: number[], control: number[], minT = 2, minN = 30): RandomControlResult {
  if (setup.length < minN || control.length < minN) {
    return { setupMean: mean(setup), controlMean: mean(control), edge: NaN, tStat: NaN, passes: false, verdict: `insufficient sample (setup ${setup.length}, control ${control.length}; need ≥${minN}) — fails closed` };
  }
  const sm = mean(setup), cm = mean(control);
  const se = Math.sqrt(variance(setup) / setup.length + variance(control) / control.length);
  const edge = sm - cm; const t = se > 0 ? edge / se : 0;
  const passes = t >= minT;
  return {
    setupMean: +sm.toFixed(4), controlMean: +cm.toFixed(4), edge: +edge.toFixed(4), tStat: +t.toFixed(2), passes,
    verdict: passes ? `SETUP ADDS VALUE over random entry in the same regime (t=${t.toFixed(2)})` : `NO EDGE over random entry (t=${t.toFixed(2)}) — the expectancy is REGIME DRIFT, not a setup (D-146)`,
  };
}
